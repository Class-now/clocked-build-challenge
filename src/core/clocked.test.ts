import { describe, expect, it, vi } from 'vitest';
import { callKey, liveTransport, recordingTransport, replayTransport } from './clocked.js';
import type { ClockedReply } from './clocked.js';

const API_KEY = 'fictional-test-key';
const CALL = { endpoint: 'decide' as const, body: { state: 'x', questions: {} } };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function idempotencyKeys(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((args) => (args[1] as RequestInit & { headers: Record<string, string> }).headers['Idempotency-Key']!);
}

function transport(fetchImpl: ReturnType<typeof vi.fn>, extra = {}) {
  const sleep = vi.fn(async () => undefined);
  return {
    sleep,
    t: liveTransport({ apiKey: API_KEY, fetchImpl: fetchImpl as unknown as typeof fetch, sleep, ...extra }),
  };
}

describe('liveTransport', () => {
  it('returns data and cost headers on success', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ answers: {} }, 200, { 'X-Clocked-Model-Ms': '120', 'X-Clocked-Credits': '5', 'X-Clocked-Cost-Usd': '0.001200' }),
    );
    const { t } = transport(fetchImpl);
    const reply = await t.call(CALL);
    expect(reply).toEqual({ ok: true, status: 200, data: { answers: {} }, modelMs: 120, credits: 5, costUsd: 0.0012 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://clocked.rezolve.ai/clocked/decide');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body as string)).toEqual(CALL.body);
  });

  it('retries a 429 under the same idempotency key', async () => {
    const responses = [json({ error: 'busy' }, 429), json({ answers: {} })];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const { t, sleep } = transport(fetchImpl);
    const reply = await t.call(CALL);
    expect(reply.ok).toBe(true);
    const keys = idempotencyKeys(fetchImpl);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('uses a new idempotency key for a new logical call', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const { t } = transport(fetchImpl);
    await t.call(CALL);
    await t.call(CALL);
    const keys = idempotencyKeys(fetchImpl);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('honours Retry-After', async () => {
    const responses = [json({}, 429, { 'Retry-After': '7' }), json({})];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const { t, sleep } = transport(fetchImpl);
    await t.call(CALL);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('retries a 5xx and stops at maxRetries', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'down' }, 503));
    const { t, sleep } = transport(fetchImpl, { maxRetries: 2 });
    const reply = await t.call(CALL);
    expect(reply).toMatchObject({ ok: false, status: 503, error: 'down' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 402', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'Insufficient credits' }, 402));
    const { t, sleep } = transport(fetchImpl);
    const reply = await t.call(CALL);
    expect(reply).toMatchObject({ ok: false, status: 402, error: 'Insufficient credits' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops retrying when the API says retryAsNew', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'ended', retryAsNew: true }, 500));
    const { t } = transport(fetchImpl);
    const reply = await t.call(CALL);
    expect(reply.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false after network failures, without throwing or leaking the key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { t } = transport(fetchImpl, { maxRetries: 1 });
    const reply = await t.call(CALL);
    expect(reply).toMatchObject({ ok: false, status: 0, error: 'fetch failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(reply)).not.toContain(API_KEY);
  });

  it('returns ok:false when an attempt times out, even if fetch ignores the abort', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const { t } = transport(fetchImpl, { maxRetries: 1, timeoutMs: 5 });
    const reply = await t.call(CALL);
    expect(reply.ok).toBe(false);
    expect(reply.status).toBe(0);
    expect(reply.error).toContain('Timed out');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const keys = idempotencyKeys(fetchImpl as unknown as ReturnType<typeof vi.fn>);
    expect(keys[0]).toBe(keys[1]);
  });

  it('returns ok:false on a 200 that is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }));
    const { t } = transport(fetchImpl);
    expect(await t.call(CALL)).toMatchObject({ ok: false, status: 200 });
  });

  it('never runs two calls at once', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return json({});
    });
    const { t } = transport(fetchImpl);
    const replies = await Promise.all([t.call(CALL), t.call(CALL), t.call(CALL)]);
    expect(replies.every((r) => r.ok)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('keeps the queue moving after a failed call', async () => {
    const responses = [json({ error: 'bad' }, 422), json({})];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const { t } = transport(fetchImpl);
    const [first, second] = await Promise.all([t.call(CALL), t.call(CALL)]);
    expect(first!.ok).toBe(false);
    expect(second!.ok).toBe(true);
  });
});

describe('callKey', () => {
  it('ignores key order and separates endpoints and bodies', () => {
    const a = callKey({ endpoint: 'pii', body: { text: 't', anonymize: 'replace', nested: { b: 1, a: 2 } } });
    const b = callKey({ endpoint: 'pii', body: { nested: { a: 2, b: 1 }, anonymize: 'replace', text: 't' } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(callKey({ endpoint: 'extract', body: { text: 't' } })).not.toBe(callKey({ endpoint: 'pii', body: { text: 't' } }));
    expect(callKey({ endpoint: 'pii', body: { text: 't' } })).not.toBe(callKey({ endpoint: 'pii', body: { text: 'u' } }));
  });
});

describe('record and replay', () => {
  it('round trips a reply', async () => {
    const original: ClockedReply = { ok: true, status: 200, data: { injection: 0.01 }, modelMs: 40, credits: 2 };
    const inner = { call: vi.fn(async () => original) };
    const sink: Record<string, ClockedReply> = {};
    const recorded = await recordingTransport(inner, sink).call(CALL);
    expect(recorded).toEqual(original);
    expect(Object.keys(sink)).toEqual([callKey(CALL)]);

    const stored = JSON.parse(JSON.stringify(sink)) as Record<string, ClockedReply>;
    expect(await replayTransport(stored).call(CALL)).toEqual(original);
    expect(inner.call).toHaveBeenCalledTimes(1);
  });

  it('reports a miss', async () => {
    expect(await replayTransport({}).call(CALL)).toMatchObject({ ok: false, status: 0, error: 'no recording' });
  });
});
