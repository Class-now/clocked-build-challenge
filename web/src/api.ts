import type { ReviewError, ReviewSuccess, ScenariosResponse } from '../../src/server/contract.js';

export type ReviewBody =
  | { scenarioId: string }
  | { gate: string; input: Record<string, unknown> };

export type ReviewOutcome =
  | { ok: true; value: ReviewSuccess }
  | { ok: false; error: ReviewError | { code: 'network' } };

export async function fetchScenarios(): Promise<ScenariosResponse> {
  const response = await fetch('/api/scenarios');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Never throws. A reply that is not one of ours, such as a platform timeout, counts as network. */
export async function runReview(body: ReviewBody): Promise<ReviewOutcome> {
  try {
    const response = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (response.ok) return { ok: true, value };
    return typeof value?.code === 'string' ? { ok: false, error: value } : { ok: false, error: { code: 'network' } };
  } catch {
    return { ok: false, error: { code: 'network' } };
  }
}
