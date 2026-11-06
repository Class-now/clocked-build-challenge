import type { CheckResult, EndpointName, GateKind, Reason, Verdict } from './types.js';

export const THRESHOLDS = {
  // Below this a risk probability counts as low. From here up to refuseAt the model is unsure,
  // and an unsure answer goes to a person: it neither clears nor refuses.
  uncertainLow: 0.35,
  // At or above this a risk is confident enough to refuse without a person, and an assurance
  // such as "in scope" is confident enough to rely on.
  refuseAt: 0.75,
  // Wrapping text in an untrusted-data envelope costs nothing, so an unsure answer about
  // whether content addresses the assistant counts as yes. It starts at the bottom of the band.
  instructsAgent: 0.35,
  // Telling a reviewer "there is no rollback" is a strong statement, so it needs the same
  // confidence as a refusal before it is shown.
  rollbackConfident: 0.75,
} as const;

export type Band = 'low' | 'uncertain' | 'high';

/** Low is below uncertainLow. Uncertain includes uncertainLow and stops before refuseAt. */
export function band(p: number): Band {
  if (p < THRESHOLDS.uncertainLow) return 'low';
  return p < THRESHOLDS.refuseAt ? 'uncertain' : 'high';
}

/** For a probability of harm: high refuses, inside the band holds. */
export function riskSeverity(p: number): 'refuse' | 'hold' | null {
  const b = band(p);
  if (b === 'high') return 'refuse';
  return b === 'uncertain' ? 'hold' : null;
}

/** For a probability that something is fine: anything short of high holds. */
export function assuranceSeverity(p: number): 'hold' | null {
  return band(p) === 'high' ? null : 'hold';
}

export function outcomeFor(severity: 'refuse' | 'hold' | null, p: number): CheckResult['outcome'] {
  if (severity === null) return 'pass';
  return band(p) === 'uncertain' ? 'uncertain' : 'flag';
}

const SAFETY_ENDPOINTS: ReadonlySet<EndpointName> = new Set<EndpointName>([
  'script', 'injection', 'pii', 'grounding', 'compare', 'decide', 'pipeline',
]);

export function isSafetyCheck(check: Pick<CheckResult, 'endpoint'>): boolean {
  return SAFETY_ENDPOINTS.has(check.endpoint);
}

/**
 * A failed safety check holds. A failed helper (rerank, fill, extract) holds only when the
 * action depends on what the helper would have returned.
 */
export function failureReason(check: CheckResult, dependsOnOutput = false): Reason | null {
  if (check.status !== 'failed') return null;
  if (!isSafetyCheck(check) && !dependsOnOutput) return null;
  return {
    checkId: check.id,
    severity: 'hold',
    text: `"${check.title}" could not run, so its result is unknown and a person must decide.`,
  };
}

/** A network action needs a known target and a payment needs a known amount. */
export function missingDataReason(
  checkId: string,
  action: { network: boolean; payment: boolean; hasTarget: boolean; hasAmount: boolean },
): Reason | null {
  const missing = [
    action.network && !action.hasTarget ? 'target' : null,
    action.payment && !action.hasAmount ? 'amount' : null,
  ].filter(Boolean);
  if (missing.length === 0) return null;
  return {
    checkId,
    severity: 'hold',
    text: `No ${missing.join(' or ')} could be found for this action, so it cannot be checked against the policy.`,
  };
}

/** Reduces a URL or a bare hostname to its lowercase host, or null when it is neither. */
export function normalizeHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (!hasScheme && /^[./\\~]/.test(trimmed)) return null;
  try {
    const host = new URL(hasScheme ? trimmed : `https://${trimmed}`).hostname.toLowerCase().replace(/\.$/, '');
    if (host === '') return null;
    return hasScheme || host.includes('.') || host === 'localhost' ? host : null;
  } catch {
    return null;
  }
}

/** Exact host or subdomain. `notexample.com` and `example.com.evil.test` do not match `example.com`. */
export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const candidate = normalizeHost(host);
  if (candidate === null) return false;
  return allowedHosts.some((entry) => {
    const allowed = normalizeHost(entry);
    return allowed !== null && (candidate === allowed || candidate.endsWith(`.${allowed}`));
  });
}

/**
 * Turns the reasons and checks of one gate run into a verdict. Checks are re-read as well as
 * reasons, so a gate that forgets a reason still cannot clear on an unknown or unsure result.
 */
export function combine(gate: GateKind, checks: CheckResult[], reasons: Reason[]): Verdict {
  if (reasons.some((r) => r.severity === 'refuse')) return 'REFUSED';
  if (reasons.some((r) => r.severity === 'hold')) return 'HELD';
  if (checks.some((c) => (c.status === 'failed' && isSafetyCheck(c)) || c.outcome === 'uncertain')) return 'HELD';
  if (gate === 'action') {
    // A benign detector does not authorise anything: an action must also be in scope and
    // must not have failed the allowlist.
    const scope = checks.find((c) => c.id === 'scope');
    const targets = checks.find((c) => c.id === 'targets');
    if (scope?.status !== 'ok' || scope.outcome !== 'pass' || targets?.outcome === 'flag') return 'HELD';
  }
  return checks.some((c) => c.transformed) ? 'CLEARED_REDACTED' : 'CLEARED';
}
