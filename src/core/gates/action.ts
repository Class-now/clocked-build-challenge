import type { ClockedTransport } from '../clocked.js';
import { assuranceSeverity, combine, failureReason, hostAllowed, missingDataReason, normalizeHost, outcomeFor, riskSeverity } from '../policy.js';
import type { ActionInput, CheckResult, GateResult, PolicyClause, Reason, Span } from '../types.js';
import {
  ShapeError, clauseIds, clauseText, compact, failSafety, failedHelperCheck, findSpan, finish, formatScore, makeSpan,
  readPii, requireNumber, reviewCardStep, safeCall, skippedCheck,
} from './shared.js';

const POLICY_MATCH = { id: 'policy-match', title: 'Find the clauses that apply', endpoint: 'rerank' } as const;
const SCRIPT_RISK = { id: 'script-risk', title: 'Inspect the script', endpoint: 'script' } as const;
const TARGETS = { id: 'targets', title: 'Find targets and amounts', endpoint: 'extract' } as const;
const SCOPE = { id: 'scope', title: 'Decide whether this is in scope', endpoint: 'decide' } as const;
const OUTBOUND_PII = { id: 'outbound-pii', title: 'Protect personal data going out', endpoint: 'pii' } as const;

// The API refuses a rerank query over this length, and an action must not fail on a long payload.
const RERANK_QUERY_LIMIT = 4000;
const SHELL_TOOLS = new Set(['bash', 'sh', 'powershell', 'python', 'script']);
const NETWORK_TOOL_WORDS = new Set(['curl', 'wget', 'http', 'https', 'fetch', 'send', 'email', 'mail', 'webhook', 'slack', 'post', 'upload', 'notify', 'sms']);
const PAYMENT_TOOL_WORDS = new Set(['refund', 'pay', 'payment', 'payout', 'charge', 'transfer', 'invoice']);
const SCRIPT_PATTERN = /^#!|\b(?:curl|wget|sudo|rm|chmod|Set-[A-Z]\w+|Invoke-[A-Z]\w+)\b|\|\s*(?:ba)?sh\b|&&/m;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>|)]+/gi;
const NETWORK_COMMAND_PATTERN = /\b(?:curl|wget|ssh|scp|nc)\b/;

const ACTION_CLASSES: Record<string, string> = {
  'read-only': 'Only reads; nothing changes.',
  'code change': 'Changes source code or a build output.',
  'data change': 'Changes stored records or data.',
  'outbound message': 'Sends a message to a person or a system outside the agent.',
  payment: 'Moves money or issues a refund.',
  deployment: 'Releases or changes a running service.',
  'security control': 'Changes a security tool, permission or control.',
  'not established': 'The action does not show which of these it is.',
};

function toolWords(tool: string): string[] {
  return tool.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function isScriptLike(input: ActionInput): boolean {
  return SHELL_TOOLS.has(input.tool.trim().toLowerCase()) || SCRIPT_PATTERN.test(input.payload);
}

async function policyMatch(input: ActionInput, t: ClockedTransport, checks: CheckResult[], reasons: Reason[]): Promise<PolicyClause[]> {
  const clauses = input.policy.clauses;
  const reply = await safeCall(t, 'rerank', {
    query: `${input.tool}\n${input.payload}`.slice(0, RERANK_QUERY_LIMIT),
    context: input.brief,
    documents: clauses.map((c) => ({ id: c.id, title: c.title, text: c.text })),
  });
  const degrade = (error: string): PolicyClause[] => {
    checks.push(failedHelperCheck(POLICY_MATCH, reply, error, 'Every clause went into the later checks, because the matching step did not run.'));
    reasons.push({ checkId: POLICY_MATCH.id, severity: 'info', text: 'Clause matching did not run, so every policy clause was applied.' });
    return clauses;
  };
  if (!reply.ok) return degrade(reply.error ?? `HTTP ${reply.status}`);
  if (!Array.isArray(reply.data?.results)) return degrade('Response has no results list');

  const results: any[] = reply.data.results;
  const useIds = new Set(results.filter((r) => r?.action === 'use').map((r) => r.id ?? clauses[r.index]?.id));
  const applicable = clauses.filter((c) => useIds.has(c.id));
  const top = results.find((r) => r?.action === 'use');
  checks.push({
    ...POLICY_MATCH,
    status: 'ok',
    outcome: 'info',
    summary: `${applicable.length} of ${clauses.length} clauses apply to this action: ${clauseIds(applicable)}.`,
    effect: applicable.length === 0
      ? 'No clause went into the later checks.'
      : `Only ${clauseIds(applicable)} went into the later checks and the reasons.`,
    score: typeof top?.relevance_score === 'number' ? top.relevance_score : undefined,
    spans: [],
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data,
  });
  return applicable;
}

async function scriptRisk(input: ActionInput, applicable: PolicyClause[], t: ClockedTransport, checks: CheckResult[], reasons: Reason[]): Promise<void> {
  if (!isScriptLike(input)) {
    checks.push(skippedCheck(SCRIPT_RISK, 'This action is not a script, so there was nothing to inspect.'));
    return;
  }
  const reply = await safeCall(t, 'script', {
    script: input.payload,
    instructions: `Approved work: ${input.brief}\nPolicy clauses:\n${clauseText(applicable)}`,
    evidence: true,
  });
  if (!reply.ok) return failSafety(SCRIPT_RISK, reply, reply.error ?? `HTTP ${reply.status}`, checks, reasons);

  let malicious: number;
  try {
    malicious = requireNumber(reply.data?.malicious, 'malicious score');
  } catch (err) {
    return failSafety(SCRIPT_RISK, reply, (err as Error).message, checks, reasons);
  }
  const category = typeof reply.data.category === 'string' ? reply.data.category : 'unclassified behaviour';
  const evidence: any[] = Array.isArray(reply.data.evidence) ? reply.data.evidence : [];
  const severity = riskSeverity(malicious);
  const clauseNote = `Applicable clauses: ${clauseIds(applicable)}.`;
  const text = severity === 'refuse'
    ? `The script shows ${category} (malicious ${formatScore(malicious)}). ${clauseNote}`
    : `The script may show ${category}, but the score (${formatScore(malicious)}) is too unsure to decide alone. ${clauseNote}`;
  if (severity) reasons.push({ checkId: SCRIPT_RISK.id, severity, text });
  checks.push({
    ...SCRIPT_RISK,
    status: 'ok',
    outcome: outcomeFor(severity, malicious),
    summary: `The script reads as ${category}, with a malicious score of ${formatScore(malicious)}.`,
    effect: severity === 'refuse'
      ? `Refused: the script shows ${category}, checked against ${clauseIds(applicable)}.`
      : severity === 'hold'
        ? 'Held: the score is inside the band where a person must look.'
        : 'No objection, but this alone does not authorise the action.',
    score: malicious,
    spans: compact(evidence.map((e) => makeSpan(input.payload, e?.start, e?.end, 'payload', category))),
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data,
  });
}

interface Targets { hosts: string[]; recipients: number; amount: string | null; ran: boolean; }

function listValues(field: any): string[] {
  return Array.isArray(field?.value) ? field.value.filter((v: unknown): v is string => typeof v === 'string') : [];
}

/** `normalized` for money is not shown in the reference, so every plausible form is read. */
function describeAmount(field: any): string | null {
  if (typeof field?.value !== 'string' || field.value.trim() === '') return null;
  const normalized = field.normalized;
  if (normalized === undefined || normalized === null) return field.value;
  const reading = typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized);
  return `${field.value} (normalized: ${reading})`;
}

async function findTargets(input: ActionInput, t: ClockedTransport, checks: CheckResult[], reasons: Reason[]): Promise<Targets> {
  // URLs are also read in code, so a value the model misses still meets the allowlist.
  const urlSpans: Span[] = compact([...input.payload.matchAll(URL_PATTERN)].map((m) => findSpan(input.payload, m[0], 'payload', 'host')));
  const urlHosts = compact(urlSpans.map((s) => normalizeHost(s.quote)));
  const blockedUrlHosts = urlHosts.filter((h) => !hostAllowed(h, input.policy.allowedHosts));

  const reply = await safeCall(t, 'extract', {
    text: input.payload,
    instructions: 'Read the action an AI agent is about to run. Copy values exactly as written.',
    fields: {
      hosts: { description: 'URLs and hostnames this action reaches', list: true, max_items: 32 },
      file_paths: { description: 'File or directory paths this action touches', list: true, max_items: 32 },
      recipients: { description: 'People or addresses this action sends to', list: true, max_items: 32 },
      amount: { description: 'The amount of money this action moves', normalize: 'money' },
    },
  });

  const shapeProblem = !reply.ok ? (reply.error ?? `HTTP ${reply.status}`) : reply.data?.fields ? null : 'Response has no fields';
  if (shapeProblem !== null) {
    checks.push(failedHelperCheck(TARGETS, reply, shapeProblem, 'The allowlist could only be checked for URLs read in code; an action that needs targets or amounts is held.'));
    if (blockedUrlHosts.length > 0) {
      reasons.push({ checkId: TARGETS.id, severity: 'hold', text: `This action reaches hosts outside the allowlist: ${[...new Set(blockedUrlHosts)].join(', ')}.` });
    }
    return { hosts: urlHosts, recipients: 0, amount: null, ran: false };
  }

  const fields = reply.data.fields;
  const paths = new Set(listValues(fields.file_paths));
  const items: any[] = (Array.isArray(fields.hosts?.items) ? fields.hosts.items : []).filter((i: any) => !paths.has(i?.value));
  const extracted = listValues(fields.hosts).filter((v) => !paths.has(v));
  const hosts = [...new Set([...compact(extracted.map(normalizeHost)), ...urlHosts])];
  const blocked = hosts.filter((h) => !hostAllowed(h, input.policy.allowedHosts));
  const recipients = listValues(fields.recipients).length;
  const amount = describeAmount(fields.amount);

  const hostSpans = compact(items.map((i) => makeSpan(input.payload, i?.start, i?.end, 'payload', 'host')));
  const amountSpan = makeSpan(input.payload, fields.amount?.start, fields.amount?.end, 'payload', 'amount');
  const spans = compact([...(hostSpans.length > 0 ? hostSpans : urlSpans), amountSpan]);
  const blockedSpans = spans.filter((s) => s.label === 'host' && blocked.includes(normalizeHost(s.quote) ?? ''));

  if (blocked.length > 0) {
    reasons.push({ checkId: TARGETS.id, severity: 'hold', text: `This action reaches hosts outside the allowlist: ${blocked.join(', ')}.` });
  }
  checks.push({
    ...TARGETS,
    status: 'ok',
    outcome: blocked.length > 0 ? 'flag' : 'pass',
    summary: `Found ${hosts.length} host(s), ${paths.size} path(s), ${recipients} recipient(s) and ${amount ? `an amount of ${amount}` : 'no amount'}.`,
    effect: blocked.length > 0
      ? `Held: ${blocked.join(', ')} is not on the allowlist.`
      : amount
        ? 'The amount went into the scope decision; every host is on the allowlist.'
        : 'Every host found is on the allowlist.',
    spans: blocked.length > 0 ? [...blockedSpans, ...spans.filter((s) => s.label !== 'host')] : spans,
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data,
  });
  return { hosts, recipients, amount, ran: true };
}

interface Scope { actionClass: string; }

function topLevel(answer: any): string {
  const probabilities: Record<string, number> | undefined = answer?.probabilities;
  const legend: Record<string, string> | undefined = answer?.legend;
  if (!probabilities || !legend) throw new ShapeError('Response has no reversibility levels');
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  const level = top ? legend[top[0]] : undefined;
  if (level === undefined) throw new ShapeError('Response has no reversibility levels');
  return level;
}

async function decideScope(input: ActionInput, applicable: PolicyClause[], targets: Targets, t: ClockedTransport, checks: CheckResult[], reasons: Reason[]): Promise<Scope> {
  const amountLine = targets.amount ?? (targets.ran ? 'none found' : 'not available');
  const reply = await safeCall(t, 'decide', {
    state: `Approved work: ${input.brief}\nTool: ${input.tool}\nPayload: ${input.payload}\nExtracted amount: ${amountLine}`,
    instructions: `Policy clauses that apply:\n${clauseText(applicable)}`,
    questions: {
      in_scope: { type: 'noul', instructions: 'Is this action part of the approved work?' },
      violates_clause: { type: 'noul', instructions: 'Does this action do something a clause forbids outright? A clause that allows the action once a person approves it, or once a change number exists, is not forbidding it.' },
      needs_approval: { type: 'noul', instructions: 'Does a clause allow this action only with something the action does not show, such as a person\'s approval or a change number?' },
      reversibility: { type: 'score', instructions: 'How hard would this action be to undo?', criteria: ['irreversible', 'hard to undo', 'easy to undo'] },
      action_class: { type: 'choice', instructions: 'What kind of action is this?', criteria: ACTION_CLASSES },
    },
  });
  const unknown: Scope = { actionClass: 'not established' };
  if (!reply.ok) {
    failSafety(SCOPE, reply, reply.error ?? `HTTP ${reply.status}`, checks, reasons);
    return unknown;
  }

  let inScope: number, violates: number, needsApproval: number, level: string, actionClass: string;
  try {
    const answers = reply.data?.answers;
    inScope = requireNumber(answers?.in_scope?.noul, 'in_scope answer');
    violates = requireNumber(answers?.violates_clause?.noul, 'violates_clause answer');
    needsApproval = requireNumber(answers?.needs_approval?.noul, 'needs_approval answer');
    level = topLevel(answers?.reversibility);
    if (typeof answers?.action_class?.choice !== 'string') throw new ShapeError('Response has no action_class answer');
    actionClass = answers.action_class.choice;
  } catch (err) {
    failSafety(SCOPE, reply, (err as Error).message, checks, reasons);
    return unknown;
  }

  const clauseNote = `Applicable clauses: ${clauseIds(applicable)}.`;
  const before = reasons.length;
  const scopeSeverity = assuranceSeverity(inScope);
  if (scopeSeverity) {
    reasons.push({ checkId: SCOPE.id, severity: scopeSeverity, text: `This action is not clearly part of the approved work (in scope ${formatScore(inScope)}).` });
  }
  const violationSeverity = riskSeverity(violates);
  if (violationSeverity === 'refuse') {
    reasons.push({ checkId: SCOPE.id, severity: 'refuse', text: `This action breaks a policy clause (${formatScore(violates)}). ${clauseNote}` });
  } else if (violationSeverity === 'hold') {
    reasons.push({ checkId: SCOPE.id, severity: 'hold', text: `This action may break a policy clause (${formatScore(violates)}). ${clauseNote}` });
  }
  if (riskSeverity(needsApproval)) {
    reasons.push({ checkId: SCOPE.id, severity: 'hold', text: `A clause needs an approval or a change number this action does not show (${formatScore(needsApproval)}). ${clauseNote}` });
  }
  const irreversible = level === 'irreversible' && actionClass !== 'read-only';
  if (irreversible) {
    reasons.push({ checkId: SCOPE.id, severity: 'hold', text: `This ${actionClass} action looks irreversible, so a person must approve it.` });
  }
  const added = reasons.slice(before);
  const worst = added.find((r) => r.severity === 'refuse') ?? added[0];
  const uncertain = [inScope, violates, needsApproval].some((p) => riskSeverity(p) === 'hold');
  checks.push({
    ...SCOPE,
    status: 'ok',
    outcome: added.length === 0 ? 'pass' : uncertain && !added.some((r) => r.severity === 'refuse') ? 'uncertain' : 'flag',
    summary: `Reads as a ${actionClass} action, ${level}, in scope ${formatScore(inScope)}, clause violation ${formatScore(violates)}.`,
    effect: worst ? `${worst.severity === 'refuse' ? 'Refused' : 'Held'}: ${worst.text}` : 'In scope, and no applicable clause objects.',
    score: inScope,
    spans: [],
    modelMs: reply.modelMs,
    credits: reply.credits,
    raw: reply.data,
  });
  return { actionClass };
}

interface OutboundText { redacted?: string; sendable?: string; }

async function protectOutbound(input: ActionInput, scope: Scope, t: ClockedTransport, checks: CheckResult[], reasons: Reason[]): Promise<OutboundText> {
  if (input.outbound !== true && scope.actionClass !== 'outbound message') {
    checks.push(skippedCheck(OUTBOUND_PII, 'This action sends nothing out, so personal data was not checked.'));
    return {};
  }
  const reply = await safeCall(t, 'pii', { text: input.payload, anonymize: 'replace' });
  if (!reply.ok) {
    failSafety(OUTBOUND_PII, reply, reply.error ?? `HTTP ${reply.status}`, checks, reasons);
    return {};
  }
  try {
    const read = readPii(reply.data, input.payload, 'payload');
    const found = read.count > 0;
    checks.push({
      ...OUTBOUND_PII,
      status: 'ok',
      outcome: found ? 'flag' : 'pass',
      summary: found ? `Found ${read.count} personal data item(s): ${read.kinds.join(', ')}.` : 'Found no personal data.',
      effect: found ? 'The recipient gets the redacted copy, with placeholders in place of these values.' : 'The text goes out unchanged.',
      spans: read.spans,
      modelMs: reply.modelMs,
      credits: reply.credits,
      raw: reply.data,
      transformed: found,
    });
    return found ? { redacted: read.anonymized, sendable: read.anonymized } : { sendable: input.payload };
  } catch (err) {
    failSafety(OUTBOUND_PII, reply, (err as Error).message, checks, reasons);
    return {};
  }
}

/** Runs the action gate. Calls run one at a time, in order. Nothing short-circuits the trace. */
export async function runAction(input: ActionInput, t: ClockedTransport): Promise<GateResult> {
  const checks: CheckResult[] = [];
  const reasons: Reason[] = [];

  const applicable = await policyMatch(input, t, checks, reasons);
  await scriptRisk(input, applicable, t, checks, reasons);
  const targets = await findTargets(input, t, checks, reasons);
  const scope = await decideScope(input, applicable, targets, t, checks, reasons);
  const outbound = await protectOutbound(input, scope, t, checks, reasons);

  // Whether extract matters depends on the action, so this comes after the class is known.
  const words = toolWords(input.tool);
  const network = input.outbound === true || scope.actionClass === 'outbound message'
    || words.some((w) => NETWORK_TOOL_WORDS.has(w)) || NETWORK_COMMAND_PATTERN.test(input.payload);
  const payment = scope.actionClass === 'payment' || words.some((w) => PAYMENT_TOOL_WORDS.has(w));
  if (targets.ran) {
    const missing = missingDataReason(TARGETS.id, { network, payment, hasTarget: targets.hosts.length > 0 || targets.recipients > 0, hasAmount: targets.amount !== null });
    if (missing) reasons.push(missing);
  } else {
    const targetsCheck = checks.find((c) => c.id === TARGETS.id)!;
    const reason = failureReason(targetsCheck, network || payment);
    if (reason) reasons.push(reason);
    else reasons.push({ checkId: TARGETS.id, severity: 'info', text: 'Targets could not be read, but this action does not depend on them.' });
    targetsCheck.effect = reason
      ? 'Held: this action depends on targets or amounts that could not be read.'
      : 'No effect on the verdict: this action reaches no network and moves no money.';
  }

  const verdict = combine('action', checks, reasons);
  const shownPayload = outbound.redacted ?? input.payload;
  const reviewCard = await reviewCardStep(t, verdict, `Brief: ${input.brief}\nTool: ${input.tool}\nAction: ${shownPayload}`, checks, reasons);
  const forwardText = verdict === 'HELD' || verdict === 'REFUSED' ? undefined : outbound.sendable;
  return finish('action', checks, reasons, { forwardText, reviewCard });
}
