// Pure constants and an in-memory limiter. The web page imports the caps, so no Node imports here.

/** Longest accepted value per input field, in JavaScript string length. */
export const INPUT_CAPS = {
  payload: 8000,
  text: 8000,
  brief: 4000,
  report: 4000,
  changelog: 4000,
  logText: 4000,
  logCount: 6,
  // Short labels, but they reach the API too, so they cannot be a way around the caps above.
  tool: 100,
  source: 500,
  logId: 100,
} as const;

export const RUNS_PER_IP_PER_HOUR = 12;
export const RUNS_PER_INSTANCE_PER_DAY = 400;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type LimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };
export interface Limits { take(ip: string): LimitDecision; }

export interface LimitOptions { perIpPerHour?: number; perInstancePerDay?: number; now?: () => number; }

/**
 * Sliding windows held in memory, so they last as long as one server instance. A refused run
 * records nothing, which also bounds the memory: at most one timestamp per allowed run.
 */
export function createLimits(options: LimitOptions = {}): Limits {
  const perIp = options.perIpPerHour ?? RUNS_PER_IP_PER_HOUR;
  const perDay = options.perInstancePerDay ?? RUNS_PER_INSTANCE_PER_DAY;
  const now = options.now ?? Date.now;
  const byIp = new Map<string, number[]>();
  let instanceRuns: number[] = [];

  const secondsUntil = (time: number, at: number) => Math.max(1, Math.ceil((time - at) / 1000));

  return {
    take(ip) {
      const at = now();
      instanceRuns = instanceRuns.filter((t) => t > at - DAY_MS);
      for (const [key, times] of byIp) {
        const recent = times.filter((t) => t > at - HOUR_MS);
        if (recent.length === 0) byIp.delete(key);
        else byIp.set(key, recent);
      }

      const mine = byIp.get(ip) ?? [];
      const waits: number[] = [];
      if (mine.length >= perIp) waits.push(secondsUntil(mine[0]! + HOUR_MS, at));
      if (instanceRuns.length >= perDay) waits.push(secondsUntil(instanceRuns[0]! + DAY_MS, at));
      if (waits.length > 0) return { ok: false, retryAfterSeconds: Math.max(...waits) };

      mine.push(at);
      byIp.set(ip, mine);
      instanceRuns.push(at);
      return { ok: true };
    },
  };
}
