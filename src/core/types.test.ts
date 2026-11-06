import { describe, expect, it } from 'vitest';
import type { GateResult, PolicyPack } from './types.js';

describe('shared contract', () => {
  it('describes a complete gate result', () => {
    const policy: PolicyPack = { id: 'p', name: 'Pack', clauses: [], allowedHosts: [] };
    const result: GateResult = {
      gate: 'action',
      verdict: 'CLEARED',
      reasons: [],
      checks: [],
      totals: { modelMs: 0, credits: 0, failedChecks: 0 },
    };
    expect(result.verdict).toBe('CLEARED');
    expect(policy.clauses).toEqual([]);
  });
});
