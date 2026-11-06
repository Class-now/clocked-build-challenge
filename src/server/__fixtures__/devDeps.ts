// The dependencies behind `npm run dev:fake`. Every result is invented and the page says so.
import type { ClockedTransport } from '../../core/index.js';
import type { Deps } from '../handlers.js';
import { createLimits } from '../limits.js';
import { buildFakeRecordings, fakeTransportFor } from './fakeRecordings.js';

// A pause per call, so the waiting state can be seen while developing.
const FAKE_CALL_MS = 500;

function slowed(inner: ClockedTransport): ClockedTransport {
  return {
    async call(c) {
      await new Promise((done) => setTimeout(done, FAKE_CALL_MS));
      return inner.call(c);
    },
  };
}

const limits = createLimits();
let recordings: Deps['recordings'] | undefined;

export async function fakeDeps(env: Record<string, string | undefined>): Promise<Deps> {
  recordings ??= await buildFakeRecordings();
  return {
    env: { CLOCKED_API_KEY: 'fake-dev-mode', GATEHOUSE_LIVE: env.GATEHOUSE_LIVE },
    limits,
    recordings,
    makeTransport: (_key, scenarioId) => slowed(fakeTransportFor(scenarioId)),
    fakeData: true,
  };
}
