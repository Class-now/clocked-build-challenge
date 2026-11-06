import { createHash, randomUUID } from 'node:crypto';
import type { EndpointName } from './types.js';

export interface ClockedCall { endpoint: EndpointName; body: unknown; }
export interface ClockedReply {
  ok: boolean; status: number; data: any; modelMs?: number; credits?: number; error?: string;
  costUsd?: number;
}
export interface ClockedTransport { call(c: ClockedCall): Promise<ClockedReply>; }

export interface LiveTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://clocked.rezolve.ai/clocked';
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
// A Retry-After is honoured up to this cap, so a bad header cannot stall the serial queue.
const RETRY_AFTER_CAP_MS = 30_000;

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return undefined;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
}

function errorText(data: any, status: number): string {
  const detail = data?.error ?? data?.detail ?? data?.message;
  if (typeof detail === 'string') return detail;
  if (detail !== undefined) return JSON.stringify(detail);
  return `HTTP ${status}`;
}

function parseJson(text: string): { parsed: boolean; value: any } {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false, value: undefined };
  }
}

/**
 * Calls the live API one request at a time. Never throws: every failure comes back as
 * `{ ok: false }`. The key is only ever placed in the Authorization header.
 */
export function liveTransport(opts: LiveTransportOptions): ClockedTransport {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function attempt(c: ClockedCall, idempotencyKey: string) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs} ms`));
        controller.abort();
      }, timeoutMs);
    });
    const request = (async () => {
      const response = await fetchImpl(`${baseUrl}/${c.endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(c.body),
        signal: controller.signal,
      });
      return { response, text: await response.text() };
    })();
    // The race also bounds a fetch that ignores its abort signal. The loser must not surface
    // as an unhandled rejection.
    request.catch(() => undefined);
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(c: ClockedCall): Promise<ClockedReply> {
    // One key per logical call: a retry must reuse it so the API can replay, not bill twice.
    const idempotencyKey = randomUUID();
    let last: ClockedReply = { ok: false, status: 0, data: null, error: 'Request was not attempted' };

    for (let tries = 0; tries <= maxRetries; tries++) {
      let waitMs = backoffMs(tries);
      try {
        const { response, text } = await attempt(c, idempotencyKey);
        const { parsed, value } = parseJson(text);
        const cost = {
          modelMs: numberHeader(response.headers, 'x-clocked-model-ms'),
          credits: numberHeader(response.headers, 'x-clocked-credits'),
          costUsd: numberHeader(response.headers, 'x-clocked-cost-usd'),
        };
        if (response.ok) {
          if (parsed) return { ok: true, status: response.status, data: value, ...cost };
          return { ok: false, status: response.status, data: null, ...cost, error: 'Response was not valid JSON' };
        }
        last = {
          ok: false,
          status: response.status,
          data: parsed ? value : null,
          ...cost,
          error: errorText(parsed ? value : null, response.status),
        };
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || value?.retryAsNew === true) return last;
        waitMs = retryAfterMs(response.headers) ?? waitMs;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        last = { ok: false, status: 0, data: null, error: message };
      }
      if (tries < maxRetries) await sleep(waitMs);
    }
    return last;
  }

  let tail: Promise<unknown> = Promise.resolve();
  return {
    call(c) {
      const result = tail.then(() => run(c));
      tail = result;
      return result;
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha256 of the endpoint and the stable JSON of the body. */
export function callKey(c: ClockedCall): string {
  return createHash('sha256').update(`${c.endpoint}\n${stableJson(c.body)}`).digest('hex');
}

export function recordingTransport(inner: ClockedTransport, sink: Record<string, ClockedReply>): ClockedTransport {
  return {
    async call(c) {
      const reply = await inner.call(c);
      sink[callKey(c)] = reply;
      return reply;
    },
  };
}

export function replayTransport(store: Record<string, ClockedReply>): ClockedTransport {
  return {
    async call(c) {
      return store[callKey(c)] ?? { ok: false, status: 0, data: null, error: 'no recording' };
    },
  };
}
