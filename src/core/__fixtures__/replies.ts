// Hand-written replies shaped like the recorded responses in the Clocked API reference.
// All content is fictional. `ok()` adds the cost figures the gateway sends as headers.
import type { ClockedCall, ClockedReply, ClockedTransport } from '../clocked.js';
import type { EndpointName, PolicyPack } from '../types.js';

export const ok = (data: unknown, credits = 2): ClockedReply => ({ ok: true, status: 200, data, modelMs: credits * 25, credits });
export const fail = (status = 500, error = 'upstream failure'): ClockedReply => ({ ok: false, status, data: null, error });

export function rerankReply(useIds: string[], allIds: string[] = useIds): unknown {
  const entry = (id: string, index: number) => {
    const use = useIds.includes(id);
    return use
      ? { index, id, action: 'use', relevance_score: 0.9966, document_score: 0.9975, levels: { answers: 0.9966, elsewhere: 0.0008, different_case: 0.0009, unrelated: 0.0017 } }
      : { index, id, action: 'skip', reason: 'unrelated', relevance_score: 0.0016, document_score: 0.0029, levels: { answers: 0.0016, elsewhere: 0.0013, different_case: 0.0038, unrelated: 0.9933 } };
  };
  return { model: 'clocked-1.0', results: allIds.map(entry), usage: { input_tokens: 390 } };
}

export function scriptReply(malicious: number, category = 'benign administration', evidence: { line: string; start: number; end: number }[] = []): unknown {
  return {
    model: 'clocked-1.0',
    malicious,
    suspicious: malicious,
    verdict: malicious >= 0.5 ? 'malicious' : 'benign',
    threshold: 0.5,
    instructions_used: 'custom',
    category,
    categories: { 'benign administration': 1 - malicious, [category]: malicious },
    severity: malicious >= 0.5 ? 'critical' : 'none',
    evidence: evidence.map((e) => ({ ...e, confidence: 1 })),
    timing: { read_ms: 109, total_ms: 110 },
  };
}

export interface ExtractSpec {
  hosts?: { value: string; start: number; end: number }[];
  paths?: string[];
  recipients?: string[];
  amount?: { value: string; start: number; end: number; normalized?: unknown };
}

export function extractReply(spec: ExtractSpec = {}): unknown {
  const list = (values: string[]) => ({ value: values, items: values.map((value) => ({ value, confidence: 1 })), confidence: 1 });
  const hosts = spec.hosts ?? [];
  return {
    model: 'clocked-1.0',
    fields: {
      hosts: { value: hosts.map((h) => h.value), items: hosts.map((h) => ({ ...h, confidence: 1 })), confidence: 1 },
      file_paths: list(spec.paths ?? []),
      recipients: list(spec.recipients ?? []),
      amount: spec.amount ? { ...spec.amount, confidence: 1 } : { value: null, confidence: 1, p_blank: 1 },
    },
    timing: { read_ms: 299, total_ms: 299, server_ms: 308 },
  };
}

export interface ScopeSpec {
  in_scope?: number;
  violates_clause?: number;
  needs_approval?: number;
  reversibility?: 'irreversible' | 'hard to undo' | 'easy to undo';
  action_class?: string;
}

const REVERSIBILITY = ['irreversible', 'hard to undo', 'easy to undo'];

export function noulAnswer(noul: number): unknown {
  return { type: 'noul', noul };
}

export function scopeReply(spec: ScopeSpec = {}): unknown {
  const top = REVERSIBILITY.indexOf(spec.reversibility ?? 'easy to undo');
  const actionClass = spec.action_class ?? 'read-only';
  return {
    model: 'clocked-1.0',
    answers: {
      in_scope: noulAnswer(spec.in_scope ?? 0.98),
      violates_clause: noulAnswer(spec.violates_clause ?? 0.02),
      needs_approval: noulAnswer(spec.needs_approval ?? 0.02),
      reversibility: {
        type: 'score',
        score: top,
        legend: { '0': 'irreversible', '1': 'hard to undo', '2': 'easy to undo' },
        probabilities: { '0': top === 0 ? 0.97 : 0.015, '1': top === 1 ? 0.97 : 0.015, '2': top === 2 ? 0.97 : 0.015 },
        confidence: 0.96,
      },
      action_class: { type: 'choice', choice: actionClass, probabilities: { [actionClass]: 0.98 }, confidence: 0.97 },
    },
    usage: { input_tokens: 185, output_tokens: 14 },
  };
}

export interface FoundEntity { type: string; value: string; start: number; end: number; }

export function piiReply(entities: FoundEntity[] = [], anonymized?: string): unknown {
  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return {
    model: 'clocked-1.0',
    entities: entities.map((e) => ({ ...e, confidence: 1, source: 'model' })),
    counts,
    threshold: 0.5,
    instructions_used: 'default',
    anonymized_text: anonymized,
    timing: { read_ms: 175, total_ms: 176 },
  };
}

/** Finds each value in `text` and returns entities plus a typed-placeholder copy, as pii does. */
export function piiFor(text: string, found: { type: string; value: string }[]): unknown {
  const entities = found.map((f) => {
    const start = text.indexOf(f.value);
    if (start < 0) throw new Error(`Fixture value not in text: ${f.value}`);
    return { ...f, start, end: start + f.value.length };
  });
  const anonymized = found.reduce((out, f) => out.replace(f.value, `<${f.type.toUpperCase()}>`), text);
  return piiReply(entities, anonymized);
}

export function fillReply(over: { rollback?: boolean; rollbackNo?: number; summary?: string | null } = {}): unknown {
  const rollback = over.rollback ?? true;
  const no = over.rollbackNo ?? (rollback ? 0.02 : 0.98);
  return {
    model: 'clocked-1.0',
    fields: {
      summary: { value: over.summary === undefined ? 'The agent tried a step that was stopped for review.' : over.summary, confidence: 0.97, source: 'generated' },
      affected_system: { value: 'checkout service', start: 0, end: 16, confidence: 1 },
      risk_level: { value: 'high', confidence: 0.77, expected: 2, probabilities: { low: 0.03, medium: 0.03, high: 0.83, critical: 0.11 } },
      rollback_available: { value: rollback, confidence: 0.96, probabilities: { yes: 1 - no, no } },
      requested_decision: { value: 'Approve this step once, or reject it?', confidence: 0.97, source: 'generated' },
    },
    timing: { read_ms: 165, generate_ms: 554, total_ms: 583 },
  };
}

export function injectionResult(injection: number, category = 'benign', evidence: { quote: string; start: number; end: number }[] = []): unknown {
  return {
    model: 'clocked-1.0',
    injection,
    verdict: injection >= 0.5 ? 'injection' : 'benign',
    threshold: 0.5,
    source: 'content',
    instructions_used: 'custom',
    category,
    categories: { benign: 1 - injection, [category]: injection },
    severity: injection >= 0.5 ? 'critical' : 'none',
    evidence: evidence.map((e) => ({ ...e, confidence: 1 })),
    timing: { read_ms: 61, total_ms: 63 },
  };
}

export type PipelineStep = { result: unknown } | { status: number; error: unknown };

export function pipelineReply(injection: PipelineStep, pii: PipelineStep): unknown {
  const entry = (step: number, endpoint: string, s: PipelineStep) =>
    'result' in s ? { step, endpoint, status: 200, ms: 64, result: s.result } : { step, endpoint, status: s.status, ms: 3, error: s.error };
  return {
    model: 'clocked-1.0',
    steps: [entry(0, 'injection', injection), entry(1, 'pii', pii)],
    stopped: null,
    timing: { total_ms: 163, model_ms: 0 },
  };
}

export function instructsReply(noul: number, threshold = 0.35): unknown {
  return { model: 'clocked-1.0', answers: { instructs_agent: { type: 'noul', noul, decision: noul >= threshold, threshold } }, usage: { input_tokens: 90, output_tokens: 4 } };
}

export function completionReply(noul = 0.97, breaks = 0.01, overstates = 0.01): unknown {
  return { model: 'clocked-1.0', answers: { claims_done: { type: 'noul', noul }, breaks_brief: { type: 'noul', noul: breaks }, overstates_tests: { type: 'noul', noul: overstates } }, usage: { input_tokens: 90, output_tokens: 4 } };
}

export interface ClaimSpec {
  claim: string;
  verdict: 'supported' | 'contradicted' | 'not_stated' | 'not_a_claim';
  p?: number;
  evidence?: { document: string; quote: string; start: number; end: number };
}

export function groundingReply(claims: ClaimSpec[], over: { answers_question?: number } = {}): unknown {
  const items = claims.map((c) => {
    const p = c.p ?? 0.98;
    const rest = (1 - p) / 3;
    return {
      claim: c.claim,
      kind: c.verdict === 'not_a_claim' ? 'not_a_claim' : 'claim',
      counted: c.verdict !== 'not_a_claim',
      weight: 1 / claims.length,
      supported: c.verdict === 'supported' ? p : rest,
      contradicted: c.verdict === 'contradicted' ? p : rest,
      not_stated: c.verdict === 'not_stated' ? p : rest,
      not_a_claim: c.verdict === 'not_a_claim' ? p : rest,
      verdict: c.verdict,
      sources: {},
      source: c.evidence?.document ?? null,
      ...(c.evidence ? { evidence: { ...c.evidence, confidence: 0.98 } } : {}),
    };
  });
  const supported = claims.filter((c) => c.verdict === 'supported').length / Math.max(claims.length, 1);
  return {
    model: 'clocked-1.0',
    grounded: supported,
    ungrounded: 1 - supported,
    verdict: supported === 1 ? 'supported' : 'contradicted',
    threshold: 0.5,
    instructions_used: 'custom',
    documents: [],
    claims: items,
    unsupported_claims: [],
    not_claims: [],
    weakest_claim: null,
    answers_question: over.answers_question ?? 0.99,
    timing: { read_ms: 245, total_ms: 186 },
  };
}

export interface ConflictSpec { confidence: number; brief: { quote: string; start: number; end: number }; changelog: { quote: string; start: number; end: number }; }

export function compareReply(conflicts: ConflictSpec[] = [], relation?: { name: string; conflicting: number }): unknown {
  const name = relation?.name ?? (conflicts.length > 0 ? 'conflicting' : 'overlapping');
  const conflicting = relation?.conflicting ?? (conflicts.length > 0 ? 0.97 : 0.01);
  return {
    model: 'clocked-1.0',
    verdict: conflicts.length > 0 ? 'conflicts' : 'overlaps',
    threshold: 0.5,
    instructions_used: 'custom',
    evidence: 'flagged',
    documents: [
      { id: 'brief', duplicates: [], overlaps: [], conflicts: conflicts.length > 0 ? ['changelog'] : [] },
      { id: 'changelog', duplicates: [], overlaps: [], conflicts: conflicts.length > 0 ? ['brief'] : [] },
    ],
    pairs: [{
      a: 'brief',
      b: 'changelog',
      relation: name,
      related: 0.98,
      probabilities: { same: 0.01, overlapping: 0.98 - conflicting, conflicting, unrelated: 0.01 },
      duplicates: [],
      conflicts: conflicts.map((c) => ({
        kind: 'contradiction',
        confidence: c.confidence,
        a: { document: 'brief', ...c.brief, confidence: 1 },
        b: { document: 'changelog', ...c.changelog, confidence: 1 },
      })),
    }],
    duplicates: [],
    overlaps: [],
    conflicts: conflicts.length > 0 ? [0] : [],
    related_pairs: [0],
    timing: { read_ms: 93, total_ms: 95 },
  };
}

export type FakeReply = ClockedReply | ((c: ClockedCall) => ClockedReply);

const DEFAULTS: Partial<Record<EndpointName, FakeReply>> = {
  rerank: (c) => {
    const ids = ((c.body as any).documents as { id: string }[]).map((d) => d.id);
    return ok(rerankReply(ids.slice(0, 1), ids));
  },
  script: ok(scriptReply(0.02)),
  extract: ok(extractReply()),
  decide: ok(scopeReply()),
  pii: ok(piiReply([])),
  fill: ok(fillReply()),
};

export interface FakeTransport extends ClockedTransport { calls: ClockedCall[]; endpoints(): EndpointName[]; bodyOf(endpoint: EndpointName): any; }

/** A transport keyed by endpoint. Anything not overridden answers as a clean default. */
export function fakeTransport(overrides: Partial<Record<EndpointName, FakeReply>> = {}): FakeTransport {
  const calls: ClockedCall[] = [];
  return {
    calls,
    endpoints: () => calls.map((c) => c.endpoint),
    bodyOf: (endpoint) => calls.find((c) => c.endpoint === endpoint)?.body,
    async call(c) {
      calls.push(c);
      const reply = overrides[c.endpoint] ?? DEFAULTS[c.endpoint];
      if (reply === undefined) return fail(500, `No fixture for ${c.endpoint}`);
      return typeof reply === 'function' ? reply(c) : reply;
    },
  };
}

export const TEST_POLICY: PolicyPack = {
  id: 'test-pack',
  name: 'Test pack',
  allowedHosts: ['example.com', 'partner.example'],
  clauses: [
    { id: 'SEC-1', title: 'Security tools', text: 'Do not disable security tools.' },
    { id: 'PAY-1', title: 'Refund limit', text: 'Refunds over USD 500 need a person.' },
    { id: 'OPS-1', title: 'Production changes', text: 'Production changes need a change number.' },
  ],
};
