import type { ClockedReply, ClockedTransport } from '../clocked.js';
import { THRESHOLDS, combine, failureReason } from '../policy.js';
import type { CheckResult, EndpointName, GateKind, GateResult, PolicyClause, Reason, ReviewCard, Span, Verdict } from '../types.js';

/** Thrown while reading a reply whose shape is not usable, so the check fails closed. */
export class ShapeError extends Error {}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ShapeError(`Response has no usable ${name}`);
  return value;
}

export async function safeCall(t: ClockedTransport, endpoint: EndpointName, body: unknown): Promise<ClockedReply> {
  try {
    return await t.call({ endpoint, body });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CheckIdentity { id: string; title: string; endpoint: EndpointName; }

export function skippedCheck(who: CheckIdentity, summary: string): CheckResult {
  return { ...who, status: 'skipped', outcome: 'info', summary, effect: 'No effect on the verdict.', spans: [] };
}

export function failedCheck(who: CheckIdentity, reply: Pick<ClockedReply, 'modelMs' | 'credits' | 'data'>, error: string, effect: string): CheckResult {
  return {
    ...who,
    status: 'failed',
    outcome: 'uncertain',
    summary: `The request failed: ${error}.`,
    effect,
    spans: [],
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data ?? undefined,
    error,
  };
}

/**
 * A helper's failure is not an unknown safety result, so it must not read as `uncertain`, which
 * would hold on its own. Its effect on the verdict is decided by the gate.
 */
export function failedHelperCheck(who: CheckIdentity, reply: Pick<ClockedReply, 'modelMs' | 'credits' | 'data'>, error: string, effect: string): CheckResult {
  return { ...failedCheck(who, reply, error, effect), outcome: 'info' };
}

const HOLD_EFFECT = 'Held: this check could not run, so a person must decide.';

/** Records a failed safety check and its hold reason. */
export function failSafety(who: CheckIdentity, reply: ClockedReply, error: string, checks: CheckResult[], reasons: Reason[]): void {
  const check = failedCheck(who, reply, error, HOLD_EFFECT);
  checks.push(check);
  const reason = failureReason(check);
  if (reason) reasons.push(reason);
}

/** The API counts Unicode code points. JavaScript strings index UTF-16 code units. */
function codePointToUtf16(source: string, offset: number): number {
  let units = 0;
  let points = 0;
  for (const ch of source) {
    if (points === offset) return units;
    units += ch.length;
    points++;
  }
  return points === offset ? units : -1;
}

/** Builds a span against the original field. Offsets that do not fit the source give null. */
export function makeSpan(source: string, start: unknown, end: unknown, field: string, label?: string): Span | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const from = codePointToUtf16(source, start as number);
  const to = codePointToUtf16(source, end as number);
  if (from < 0 || to < 0 || to <= from) return null;
  const span: Span = { start: from, end: to, quote: source.slice(from, to), field };
  if (label !== undefined) span.label = label;
  return span;
}

/** Finds a verbatim passage when the API gives no offsets for it. */
export function findSpan(source: string, passage: string, field: string, label?: string): Span | null {
  const from = source.indexOf(passage);
  if (passage === '' || from < 0) return null;
  const span: Span = { start: from, end: from + passage.length, quote: passage, field };
  if (label !== undefined) span.label = label;
  return span;
}

export function compact<T>(items: (T | null | undefined)[]): T[] {
  return items.filter((item): item is T => item !== null && item !== undefined);
}

export function clauseText(clauses: PolicyClause[]): string {
  if (clauses.length === 0) return 'No policy clause applies to this action.';
  return clauses.map((c) => `${c.id} (${c.title}): ${c.text}`).join('\n');
}

export function clauseIds(clauses: PolicyClause[]): string {
  return clauses.length === 0 ? 'none' : clauses.map((c) => c.id).join(', ');
}

export function formatScore(p: number): string {
  return p.toFixed(2);
}

export interface PiiRead { spans: Span[]; kinds: string[]; count: number; anonymized: string | undefined; }

/**
 * Reads a pii result. Offsets stay on the original text. A result with findings must carry an
 * anonymized copy that no longer contains any finding, or it cannot be forwarded.
 */
export function readPii(data: any, source: string, field: string): PiiRead {
  if (!Array.isArray(data?.entities)) throw new ShapeError('Response has no entities list');
  const entities: any[] = data.entities;
  const anonymized: unknown = data.anonymized_text;
  if (entities.length > 0) {
    if (typeof anonymized !== 'string') throw new ShapeError('Response found personal data but has no anonymized text');
    if (entities.some((e) => typeof e?.value === 'string' && e.value !== '' && anonymized.includes(e.value))) {
      throw new ShapeError('Anonymized text still contains a detected value');
    }
  }
  return {
    spans: compact(entities.map((e) => makeSpan(source, e?.start, e?.end, field, typeof e?.type === 'string' ? e.type : undefined))),
    kinds: [...new Set(entities.map((e) => String(e?.type)))],
    count: entities.length,
    anonymized: typeof anonymized === 'string' ? anonymized : undefined,
  };
}

const REVIEW_CARD = { id: 'review-card', title: 'Prepare the review card', endpoint: 'fill' } as const;

function fieldValue(fields: any, name: string): unknown {
  const value = fields?.[name]?.value;
  return value === undefined ? null : value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Step: fill the review card when the verdict so far needs a person. Never clears anything. */
export async function reviewCardStep(
  t: ClockedTransport,
  verdict: Verdict,
  text: string,
  checks: CheckResult[],
  reasons: Reason[],
): Promise<ReviewCard | undefined> {
  if (verdict !== 'HELD' && verdict !== 'REFUSED') {
    checks.push(skippedCheck(REVIEW_CARD, 'Nothing needs a person, so no review card was prepared.'));
    return undefined;
  }
  const reasonLines = reasons.filter((r) => r.severity !== 'info').map((r) => `- ${r.text}`).join('\n');
  const reply = await safeCall(t, 'fill', {
    text: `${text}\nReasons:\n${reasonLines}`,
    instructions: 'This record describes an AI agent step that was stopped for review. Use only this record. State unknowns as unknown.',
    fields: {
      summary: { type: 'generate', description: 'One plain sentence for the person on call saying what the agent tried and why it was stopped.', max_tokens: 80 },
      affected_system: { type: 'extract', description: 'The system, service or data the step would change or reach.' },
      risk_level: { type: 'score', description: 'How much harm the step could do if it went ahead.', levels: ['low', 'medium', 'high', 'critical'] },
      rollback_available: { type: 'yes_no', description: 'Could the effect of this step be undone afterwards?' },
      requested_decision: { type: 'generate', description: 'The decision needed from the person on call, as a short question.', max_tokens: 30 },
    },
  });

  const noCard = (error: string, source: Pick<ClockedReply, 'data' | 'modelMs' | 'credits'>): undefined => {
    const effect = `The verdict stays ${verdict}. There is no review card, so the reviewer works from the reasons.`;
    checks.push(failedHelperCheck(REVIEW_CARD, source, error, effect));
    reasons.push({ checkId: REVIEW_CARD.id, severity: 'info', text: 'The review card could not be prepared; read the reasons and the checks instead.' });
    return undefined;
  };
  if (!reply.ok) return noCard(reply.error ?? `HTTP ${reply.status}`, reply);
  const fields = reply.data?.fields;
  const summary = stringOrNull(fieldValue(fields, 'summary'));
  if (summary === null) return noCard('Response has no usable summary', reply);

  const rollback = fieldValue(fields, 'rollback_available');
  const card: ReviewCard = {
    summary,
    affectedSystem: stringOrNull(fieldValue(fields, 'affected_system')),
    riskLevel: stringOrNull(fieldValue(fields, 'risk_level')),
    rollbackAvailable: typeof rollback === 'boolean' ? rollback : null,
    requestedDecision: stringOrNull(fieldValue(fields, 'requested_decision')),
  };

  const rollbackField = fields?.rollback_available;
  const noProbability = rollbackField?.probabilities?.no ?? rollbackField?.confidence;
  const confidentNoRollback = rollback === false && typeof noProbability === 'number' && noProbability >= THRESHOLDS.rollbackConfident;
  const warnNoRollback = confidentNoRollback && verdict === 'HELD';
  if (warnNoRollback) {
    reasons.push({ checkId: REVIEW_CARD.id, severity: 'info', text: 'There is no rollback for this step: if a person approves it, it cannot be undone.' });
  }
  checks.push({
    ...REVIEW_CARD,
    status: 'ok',
    outcome: 'info',
    summary: `Risk reads as ${card.riskLevel ?? 'unknown'} and the affected system as ${card.affectedSystem ?? 'unknown'}.`,
    effect: warnNoRollback
      ? 'Gave the reviewer a card and warned that there is no rollback.'
      : 'Gave the reviewer a card; the verdict is unchanged.',
    spans: [],
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data,
  });
  return card;
}

export function finish(
  gate: GateKind,
  checks: CheckResult[],
  reasons: Reason[],
  extras: { forwardText?: string; reviewCard?: ReviewCard } = {},
): GateResult {
  const result: GateResult = {
    gate,
    verdict: combine(gate, checks, reasons),
    reasons,
    checks,
    totals: {
      modelMs: checks.reduce((sum, c) => sum + (c.modelMs ?? 0), 0),
      credits: checks.reduce((sum, c) => sum + (c.credits ?? 0), 0),
      failedChecks: checks.filter((c) => c.status === 'failed').length,
    },
  };
  if (extras.forwardText !== undefined) result.forwardText = extras.forwardText;
  if (extras.reviewCard !== undefined) result.reviewCard = extras.reviewCard;
  return result;
}
