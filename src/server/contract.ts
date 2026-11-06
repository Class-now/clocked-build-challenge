// The shapes the demo API sends. Types only, so the web page can import them.
import type { GateResult, PolicyPack } from '../core/types.js';
import type { Scenario } from '../scenarios/index.js';

export interface RecordedRun { scenarioId: string; recordedAt: string; result: GateResult; }

export interface ScenarioEntry extends Scenario { recording: RecordedRun | null; }

export interface ScenariosResponse {
  scenarios: ScenarioEntry[];
  packs: PolicyPack[];
  /** True only under the local fake-data dev mode, so the page can say so. */
  fakeData?: boolean;
}

export interface ReviewSuccess { result: GateResult; scenarioId: string | null; ranAt: string; }

export type ReviewError =
  | { code: 'live_off' }
  | { code: 'out_of_credits' }
  | { code: 'rate_limited'; retryAfterSeconds: number }
  | { code: 'too_long'; field: string; limit: number }
  | { code: 'bad_request'; problems: string[] }
  | { code: 'unknown_scenario' }
  | { code: 'method_not_allowed' }
  | { code: 'internal' };
