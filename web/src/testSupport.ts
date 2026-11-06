// Test helpers. Results are invented by running the real gates on scripted replies.
import { vi } from 'vitest';
import { POLICY_PACKS, SCENARIOS } from '../../src/scenarios/index.js';
import { buildFakeRecordings } from '../../src/server/__fixtures__/fakeRecordings.js';
import type { RecordedRun, ScenariosResponse } from '../../src/server/contract.js';

export function responseWith(recordings: Record<string, RecordedRun>): ScenariosResponse {
  return {
    scenarios: SCENARIOS.map((s) => ({ ...s, recording: recordings[s.id] ?? null })),
    packs: Object.values(POLICY_PACKS),
  };
}

export const recordedResponse = async () => responseWith(await buildFakeRecordings());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Answers GET /api/scenarios with `scenarios`, and POST /api/review through `review`. */
export function stubApi(scenarios: ScenariosResponse, review: (body: any) => Response | Promise<Response> = () => json(503, { code: 'live_off' })) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/scenarios') return json(200, scenarios);
    return review(JSON.parse(String(init?.body)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export { json };
