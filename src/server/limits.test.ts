import { describe, expect, it } from 'vitest';
import { RUNS_PER_INSTANCE_PER_DAY, RUNS_PER_IP_PER_HOUR, createLimits } from './limits.js';

describe('createLimits', () => {
  it('uses the planned numbers', () => {
    expect(RUNS_PER_IP_PER_HOUR).toBe(12);
    expect(RUNS_PER_INSTANCE_PER_DAY).toBe(400);
  });

  it('frees a slot once the oldest run leaves the window', () => {
    let time = 0;
    const limits = createLimits({ perIpPerHour: 2, now: () => time });
    expect(limits.take('a').ok).toBe(true);
    time = 1000;
    expect(limits.take('a').ok).toBe(true);
    expect(limits.take('a')).toEqual({ ok: false, retryAfterSeconds: 3599 });
    time = 3_600_001;
    expect(limits.take('a').ok).toBe(true);
    expect(limits.take('a').ok).toBe(false);
  });

  it('reports the longer wait when both limits are reached', () => {
    const limits = createLimits({ perIpPerHour: 1, perInstancePerDay: 1, now: () => 0 });
    expect(limits.take('a').ok).toBe(true);
    expect(limits.take('a')).toEqual({ ok: false, retryAfterSeconds: 86_400 });
  });
});
