// The demo API as plain functions: a request object in, a status and a body out.
// Nothing here logs. Visitor text and the key must never reach a log.
import { liveTransport, runGate, validateGateRequest } from '../core/index.js';
import type { ActionInput, ClockedTransport, ContentInput, GateKind, GateRequest, GateResult, PolicyPack, ReportInput } from '../core/index.js';
import { POLICY_PACKS, SCENARIOS } from '../scenarios/index.js';
import type { RecordedRun, ReviewError, ReviewSuccess, ScenariosResponse } from './contract.js';
import { INPUT_CAPS, createLimits } from './limits.js';
import type { Limits } from './limits.js';
import { RECORDINGS } from './recordings.generated.js';

export interface DemoRequest { method: string; ip: string; body?: unknown; }
export interface DemoResponse<T = unknown> { status: number; headers?: Record<string, string>; body: T; }

export interface Deps {
  env: { CLOCKED_API_KEY?: string | undefined; GATEHOUSE_LIVE?: string | undefined };
  limits: Limits;
  recordings: Record<string, RecordedRun>;
  makeTransport(apiKey: string, scenarioId: string | null): ClockedTransport;
  fakeData?: boolean;
}

// A serverless request cannot wait out the client's defaults of five tries at a minute each.
const LIVE_TIMEOUT_MS = 15_000;
const LIVE_MAX_RETRIES = 1;

const instanceLimits = createLimits();

/** The real dependencies. Limits live in this module, so they last as long as the instance. */
export function liveDeps(env: Deps['env'] = process.env): Deps {
  return {
    env,
    limits: instanceLimits,
    recordings: RECORDINGS,
    makeTransport: (apiKey) => liveTransport({ apiKey, timeoutMs: LIVE_TIMEOUT_MS, maxRetries: LIVE_MAX_RETRIES }),
  };
}

function fail(status: number, error: ReviewError, headers?: Record<string, string>): DemoResponse<ReviewError> {
  return headers ? { status, headers, body: error } : { status, body: error };
}

const methodNotAllowed = (allow: string) => fail(405, { code: 'method_not_allowed' }, { Allow: allow });
const badRequest = (...problems: string[]) => fail(400, { code: 'bad_request', problems });

export function handleScenarios(req: DemoRequest, deps: Deps): DemoResponse<ScenariosResponse | ReviewError> {
  if (req.method !== 'GET') return methodNotAllowed('GET');
  const body: ScenariosResponse = {
    scenarios: SCENARIOS.map((s) => ({ ...s, recording: deps.recordings[s.id] ?? null })),
    packs: Object.values(POLICY_PACKS),
  };
  if (deps.fakeData) body.fakeData = true;
  return { status: 200, body };
}

function liveKey(env: Deps['env']): string | null {
  const key = env.CLOCKED_API_KEY?.trim();
  return key && env.GATEHOUSE_LIVE !== 'off' ? key : null;
}

function parseObject(body: unknown): Record<string, any> | null {
  let value = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function findPack(id: unknown): PolicyPack | null {
  if (typeof id !== 'string' || !Object.hasOwn(POLICY_PACKS, id)) return null;
  return POLICY_PACKS[id as keyof typeof POLICY_PACKS];
}

/** Copies only the fields a gate reads, so nothing else a visitor sends goes further. */
function customRequest(gate: GateKind, raw: Record<string, any>, policy: PolicyPack): GateRequest {
  switch (gate) {
    case 'action': {
      const input = { brief: raw.brief, tool: raw.tool, payload: raw.payload, policy } as ActionInput;
      if (raw.outbound !== undefined) input.outbound = raw.outbound;
      return { gate, input };
    }
    case 'content':
      return { gate, input: { source: raw.source, text: raw.text, policy } as ContentInput };
    case 'report':
      return { gate, input: { brief: raw.brief, report: raw.report, toolLogs: raw.toolLogs, changelog: raw.changelog, policy } as ReportInput };
  }
}

/** The first field over its cap, as [field, limit], or null when all fit. */
function firstOverCap(request: GateRequest): ReviewError | null {
  const c = INPUT_CAPS;
  const sizes: [string, number, number][] = [];
  if (request.gate === 'action') {
    const i = request.input as ActionInput;
    sizes.push(['brief', i.brief.length, c.brief], ['tool', i.tool.length, c.tool], ['payload', i.payload.length, c.payload]);
  } else if (request.gate === 'content') {
    const i = request.input as ContentInput;
    sizes.push(['source', i.source.length, c.source], ['text', i.text.length, c.text]);
  } else {
    const i = request.input as ReportInput;
    sizes.push(['brief', i.brief.length, c.brief], ['report', i.report.length, c.report], ['changelog', i.changelog.length, c.changelog]);
    sizes.push(['toolLogs', i.toolLogs.length, c.logCount]);
    i.toolLogs.forEach((log, n) => {
      sizes.push([`toolLogs[${n}].id`, log.id.length, c.logId], [`toolLogs[${n}].text`, log.text.length, c.logText]);
    });
  }
  const over = sizes.find(([, length, limit]) => length > limit);
  return over ? { code: 'too_long', field: over[0], limit: over[2] } : null;
}

/** Keeps the statuses a gate saw, because a check holds only the error text. */
function watchStatuses(inner: ClockedTransport): { transport: ClockedTransport; statuses: number[] } {
  const statuses: number[] = [];
  return {
    statuses,
    transport: {
      async call(c) {
        const reply = await inner.call(c);
        statuses.push(reply.status);
        return reply;
      },
    },
  };
}

function withoutRaw(result: GateResult): GateResult {
  return { ...result, checks: result.checks.map(({ raw: _raw, ...check }) => check) };
}

export async function handleReview(req: DemoRequest, deps: Deps): Promise<DemoResponse<ReviewSuccess | ReviewError>> {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const apiKey = liveKey(deps.env);
  if (apiKey === null) return fail(503, { code: 'live_off' });

  const body = parseObject(req.body);
  if (body === null) return badRequest('The request body must be a JSON object.');

  let request: GateRequest;
  let scenarioId: string | null = null;
  if (body.scenarioId !== undefined) {
    const scenario = SCENARIOS.find((s) => s.id === body.scenarioId);
    if (!scenario) return fail(404, { code: 'unknown_scenario' });
    request = scenario;
    scenarioId = scenario.id;
  } else {
    const gate = body.gate;
    if (gate !== 'action' && gate !== 'content' && gate !== 'report') return badRequest('gate must be action, content or report.');
    const raw = parseObject(body.input);
    if (raw === null) return badRequest('input must be an object.');
    const policy = findPack(raw.policy);
    if (policy === null) return badRequest(`policy must be one of: ${Object.keys(POLICY_PACKS).join(', ')}.`);
    request = customRequest(gate, raw, policy);
    const problems = validateGateRequest(request);
    if (problems.length > 0) return badRequest(...problems);
    const tooLong = firstOverCap(request);
    if (tooLong) return fail(413, tooLong);
  }

  const allowed = deps.limits.take(req.ip);
  if (!allowed.ok) {
    return fail(429, { code: 'rate_limited', retryAfterSeconds: allowed.retryAfterSeconds }, { 'Retry-After': String(allowed.retryAfterSeconds) });
  }

  try {
    const { transport, statuses } = watchStatuses(deps.makeTransport(apiKey, scenarioId));
    const result = await runGate(request, transport);
    if (statuses.length > 0 && statuses.every((s) => s === 402)) return fail(503, { code: 'out_of_credits' });
    return {
      status: 200,
      body: { result: scenarioId ? result : withoutRaw(result), scenarioId, ranAt: new Date().toISOString() },
    };
  } catch {
    return fail(500, { code: 'internal' });
  }
}
