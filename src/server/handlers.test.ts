import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClockedReply, ClockedTransport } from '../core/index.js';
import { SCENARIOS, POLICY_PACKS } from '../scenarios/index.js';
import { buildFakeRecordings, constantTransport, fakeTransportFor } from './__fixtures__/fakeRecordings.js';
import type { ReviewError, ReviewSuccess, ScenariosResponse } from './contract.js';
import { handleReview, handleScenarios } from './handlers.js';
import type { Deps } from './handlers.js';
import { INPUT_CAPS, createLimits } from './limits.js';
import { GENERATED_PATH, readRecordings, renderIndex } from './recordingIndex.js';
import { RECORDINGS } from './recordings.generated.js';
import { clientIp, send, toDemoRequest } from './vercel.js';

const KEY = 'test-key-not-real';

function deps(over: Partial<Deps> & { transport?: ClockedTransport } = {}): Deps {
  const { transport, ...rest } = over;
  return {
    env: { CLOCKED_API_KEY: KEY },
    limits: createLimits(),
    recordings: {},
    makeTransport: () => transport ?? fakeTransportFor(null),
    ...rest,
  };
}

const post = (body: unknown, ip = '203.0.113.9') => ({ method: 'POST', ip, body });

const ACTION = { brief: 'Fix the bug.', tool: 'bash', payload: 'npm test', policy: 'acme-devops' };
const CONTENT = { source: 'https://docs.acme.example/a', text: 'Hello there.', policy: 'acme-support' };
const REPORT = { brief: 'Fix it.', report: 'Fixed.', changelog: 'Fix.', toolLogs: [{ id: 'log', text: 'done' }], policy: 'acme-devops' };

afterEach(() => vi.restoreAllMocks());

describe('GET /api/scenarios', () => {
  it('returns every scenario and handles an empty recordings folder', () => {
    const res = handleScenarios({ method: 'GET', ip: 'x' }, deps());
    const body = res.body as ScenariosResponse;
    expect(res.status).toBe(200);
    expect(body.scenarios.map((s) => s.id)).toEqual(SCENARIOS.map((s) => s.id));
    expect(body.scenarios.every((s) => s.recording === null)).toBe(true);
    expect(body.packs.map((p) => p.id)).toEqual(Object.keys(POLICY_PACKS));
    expect(body.fakeData).toBeUndefined();
  });

  it('attaches a recording when one exists', async () => {
    const recordings = await buildFakeRecordings();
    const body = handleScenarios({ method: 'GET', ip: 'x' }, deps({ recordings })).body as ScenariosResponse;
    expect(body.scenarios.find((s) => s.id === 'a-defender')?.recording?.result.verdict).toBe('REFUSED');
  });

  it('refuses other methods with 405', () => {
    const res = handleScenarios({ method: 'POST', ip: 'x' }, deps());
    expect(res.status).toBe(405);
    expect(res.headers?.Allow).toBe('GET');
  });
});

describe('POST /api/review', () => {
  it('runs a scenario with 200 and keeps raw', async () => {
    const res = await handleReview(post({ scenarioId: 'a-defender' }), deps({ transport: fakeTransportFor('a-defender') }));
    const body = res.body as ReviewSuccess;
    expect(res.status).toBe(200);
    expect(body.scenarioId).toBe('a-defender');
    expect(body.result.verdict).toBe('REFUSED');
    expect(body.result.checks.some((c) => c.raw !== undefined)).toBe(true);
  });

  it.each([['action', ACTION], ['content', CONTENT], ['report', REPORT]])('runs custom %s input with raw removed', async (gate, input) => {
    const res = await handleReview(post({ gate, input }), deps());
    const body = res.body as ReviewSuccess;
    expect(res.status).toBe(200);
    expect(body.result.gate).toBe(gate);
    expect(body.scenarioId).toBeNull();
    expect(body.result.checks.length).toBeGreaterThan(0);
    expect(body.result.checks.every((c) => !('raw' in c))).toBe(true);
  });

  it('gives the gate the pack named by id, and only the fields it reads', async () => {
    const seen: unknown[] = [];
    const inner = fakeTransportFor(null);
    const transport: ClockedTransport = { call: (c) => { seen.push(c.body); return inner.call(c); } };
    await handleReview(post({ gate: 'action', input: { ...ACTION, extra: 'SMUGGLED' } }), deps({ transport }));
    const sent = JSON.stringify(seen);
    expect(sent).toContain('DEV-1');
    expect(sent).not.toContain('SMUGGLED');
  });

  it.each([
    ['no key', { env: {} }],
    ['a blank key', { env: { CLOCKED_API_KEY: '  ' } }],
    ['GATEHOUSE_LIVE=off', { env: { CLOCKED_API_KEY: KEY, GATEHOUSE_LIVE: 'off' } }],
  ])('returns 503 live_off with %s and calls nothing', async (_name, over) => {
    const transport = constantTransport({ ok: true, status: 200, data: {} });
    const res = await handleReview(post({ scenarioId: 'a-tests' }), deps({ ...over, transport }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'live_off' });
    expect(transport.calls).toBe(0);
  });

  it('returns 429 rate_limited after 12 runs from one IP, with when to retry', async () => {
    let time = 1_000_000;
    const d = deps({ limits: createLimits({ now: () => time }) });
    for (let i = 0; i < 12; i++) expect((await handleReview(post({ scenarioId: 'a-tests' }), d)).status).toBe(200);
    const res = await handleReview(post({ scenarioId: 'a-tests' }), d);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: 'rate_limited', retryAfterSeconds: 3600 });
    expect(res.headers?.['Retry-After']).toBe('3600');

    expect((await handleReview(post({ scenarioId: 'a-tests' }, '203.0.113.10'), d)).status).toBe(200);
    time += 3_600_001;
    expect((await handleReview(post({ scenarioId: 'a-tests' }), d)).status).toBe(200);
  });

  it('returns 429 once an instance has spent its 400 runs for the day', async () => {
    let time = 1_000_000;
    const limits = createLimits({ now: () => time });
    const d = deps({ limits });
    for (let i = 0; i < 400; i++) expect(limits.take(`ip-${i}`).ok).toBe(true);
    expect((await handleReview(post({ scenarioId: 'a-tests' }), d)).status).toBe(429);
    time += 24 * 3_600_000 + 1;
    expect((await handleReview(post({ scenarioId: 'a-tests' }), d)).status).toBe(200);
  });

  it('does not spend a run on a request it rejects', async () => {
    const d = deps({ limits: createLimits({ perIpPerHour: 1 }) });
    expect((await handleReview(post({ gate: 'action', input: { ...ACTION, payload: '' } }), d)).status).toBe(400);
    expect((await handleReview(post({ gate: 'action', input: ACTION }), d)).status).toBe(200);
  });

  const long = (n: number) => 'x'.repeat(n + 1);
  it.each([
    ['payload', 'action', { ...ACTION, payload: long(INPUT_CAPS.payload) }, 8000],
    ['brief', 'action', { ...ACTION, brief: long(INPUT_CAPS.brief) }, 4000],
    ['tool', 'action', { ...ACTION, tool: long(INPUT_CAPS.tool) }, 100],
    ['text', 'content', { ...CONTENT, text: long(INPUT_CAPS.text) }, 8000],
    ['source', 'content', { ...CONTENT, source: long(INPUT_CAPS.source) }, 500],
    ['report', 'report', { ...REPORT, report: long(INPUT_CAPS.report) }, 4000],
    ['changelog', 'report', { ...REPORT, changelog: long(INPUT_CAPS.changelog) }, 4000],
    ['toolLogs', 'report', { ...REPORT, toolLogs: Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, text: 'x' })) }, 6],
    ['toolLogs[0].text', 'report', { ...REPORT, toolLogs: [{ id: 'log', text: long(INPUT_CAPS.logText) }] }, 4000],
    ['toolLogs[0].id', 'report', { ...REPORT, toolLogs: [{ id: long(INPUT_CAPS.logId), text: 'x' }] }, 100],
  ])('returns 413 naming %s', async (field, gate, input, limit) => {
    const transport = constantTransport({ ok: true, status: 200, data: {} });
    const res = await handleReview(post({ gate, input }), deps({ transport }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ code: 'too_long', field, limit });
    expect(transport.calls).toBe(0);
  });

  it('accepts values exactly at the cap', async () => {
    const res = await handleReview(post({ gate: 'action', input: { ...ACTION, payload: 'x'.repeat(INPUT_CAPS.payload) } }), deps());
    expect(res.status).toBe(200);
  });

  it.each([
    ['a whole policy object', { ...ACTION, policy: POLICY_PACKS['acme-devops'] }],
    ['an unknown pack', { ...ACTION, policy: 'my-pack' }],
    ['an inherited property name', { ...ACTION, policy: 'constructor' }],
    ['a missing field', { brief: 'x', tool: 'bash', policy: 'acme-devops' }],
    ['a non-string field', { ...ACTION, payload: 42 }],
  ])('returns 400 for %s', async (_name, input) => {
    const res = await handleReview(post({ gate: 'action', input }), deps());
    expect(res.status).toBe(400);
    expect((res.body as ReviewError).code).toBe('bad_request');
  });

  it.each([
    ['no body', undefined],
    ['malformed JSON', '{nope'],
    ['an array', []],
    ['an unknown gate', { gate: 'nope', input: ACTION }],
    ['no input', { gate: 'action' }],
  ])('returns 400 for %s', async (_name, body) => {
    expect((await handleReview(post(body), deps())).status).toBe(400);
  });

  it('accepts a body that arrives as a JSON string', async () => {
    expect((await handleReview(post(JSON.stringify({ scenarioId: 'a-tests' })), deps())).status).toBe(200);
  });

  it('returns 404 for an unknown scenario and 405 for GET', async () => {
    expect((await handleReview(post({ scenarioId: 'nope' }), deps())).status).toBe(404);
    expect((await handleReview({ method: 'GET', ip: 'x' }, deps())).status).toBe(405);
  });

  const paymentRequired: ClockedReply = { ok: false, status: 402, data: { error: 'Insufficient credits' }, error: 'Insufficient credits' };

  it.each(['a-defender', 'c-webpage-injection', 'r-honest'])('returns 503 out_of_credits when every call for %s reports 402', async (scenarioId) => {
    const res = await handleReview(post({ scenarioId }), deps({ transport: constantTransport(paymentRequired) }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'out_of_credits' });
  });

  it('still returns the held result when only some calls report 402', async () => {
    const inner = fakeTransportFor(null);
    let n = 0;
    const transport: ClockedTransport = { call: (c) => (n++ === 0 ? inner.call(c) : Promise.resolve(paymentRequired)) };
    const res = await handleReview(post({ gate: 'action', input: ACTION }), deps({ transport }));
    const body = res.body as ReviewSuccess;
    expect(res.status).toBe(200);
    expect(body.result.verdict).toBe('HELD');
    expect(body.result.totals.failedChecks).toBeGreaterThan(0);
  });

  it('holds with a failed check when the API is down', async () => {
    const transport = constantTransport({ ok: false, status: 500, data: null, error: 'upstream failure' });
    const res = await handleReview(post({ scenarioId: 'a-tests' }), deps({ transport }));
    expect(res.status).toBe(200);
    expect((res.body as ReviewSuccess).result.verdict).toBe('HELD');
  });

  it('returns 500 internal when a run throws', async () => {
    const res = await handleReview(post({ scenarioId: 'a-tests' }), deps({ makeTransport: () => { throw new Error('boom'); } }));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'internal' });
  });

  it('never logs, so neither the input nor the key can reach a log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const input = { ...ACTION, payload: 'VISITOR-TEXT' };
    await handleReview(post({ gate: 'action', input }), deps());
    await handleReview(post({ gate: 'action', input }), deps({ makeTransport: () => { throw new Error('boom'); } }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('fake recordings', () => {
  it("reach each scenario's expected verdict", async () => {
    const fake = await buildFakeRecordings();
    for (const s of SCENARIOS) expect(fake[s.id]?.result.verdict).toBe(s.expected);
  });
});

describe('recordings index', () => {
  it('is up to date with the recordings folder (run npm run recordings:index if not)', () => {
    const onDisk = readFileSync(GENERATED_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(renderIndex(readRecordings('recordings')));
    expect(Object.keys(RECORDINGS).length).toBe(readRecordings('recordings').length);
  });

  it('reads files once they appear, without the reply store, and copes with a missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gatehouse-rec-'));
    try {
      expect(readRecordings(join(dir, 'missing'))).toEqual([]);
      expect(readRecordings(dir)).toEqual([]);
      expect(renderIndex([])).toContain('= {};');
      const result = { gate: 'action', verdict: 'CLEARED', reasons: [], checks: [], totals: { modelMs: 0, credits: 0, failedChecks: 0 } };
      writeFileSync(join(dir, 'a-tests.json'), JSON.stringify({ scenarioId: 'a-tests', recordedAt: 't', result, replies: { hash: {} } }));
      const runs = readRecordings(dir);
      expect(runs).toEqual([{ scenarioId: 'a-tests', recordedAt: 't', result }]);
      expect(renderIndex(runs)).not.toContain('replies');
      writeFileSync(join(dir, 'broken.json'), '{}');
      expect(() => readRecordings(dir)).toThrow('broken.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Node adapter', () => {
  it('reads the client address from the platform headers', () => {
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.1' } })).toBe('203.0.113.1');
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } })).toBe('198.51.100.1');
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
    expect(clientIp({ headers: {} })).toBe('unknown');
  });

  it('survives a body getter that throws on malformed JSON', () => {
    const req = { method: 'POST', headers: {}, get body() { throw new Error('Invalid JSON'); } };
    expect(toDemoRequest(req as never).body).toBeUndefined();
  });

  it('writes the status, the headers and a JSON body', () => {
    const headers: Record<string, string> = {};
    let ended = '';
    const res = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: (s: string) => { ended = s; } };
    send(res as never, { status: 429, headers: { 'Retry-After': '60' }, body: { code: 'rate_limited' } });
    expect(res.statusCode).toBe(429);
    expect(headers['Retry-After']).toBe('60');
    expect(headers['Content-Type']).toContain('application/json');
    expect(JSON.parse(ended)).toEqual({ code: 'rate_limited' });
  });
});
