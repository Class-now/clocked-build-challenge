// Runs every scenario against the live API and saves the result. Run with `npm run record`.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveTransport, recordingTransport, runGate } from '../src/core/index.js';
import type { ClockedReply } from '../src/core/index.js';
import { SCENARIOS } from '../src/scenarios/index.js';

const OUT_DIR = 'recordings';

function column(text: string | number, width: number): string {
  return String(text).padEnd(width);
}

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile?.('.env');
  const apiKey = process.env.CLOCKED_API_KEY;
  if (!apiKey) {
    console.error('CLOCKED_API_KEY is not set. Put it in .env or the environment, then run npm run record again.');
    return 1;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const live = liveTransport({ apiKey });
  let transportFailures = 0;
  let totalCredits = 0;

  console.log(`${column('id', 22)}${column('expected', 18)}${column('actual', 18)}${column('credits', 9)}failed`);
  for (const scenario of SCENARIOS) {
    const replies: Record<string, ClockedReply> = {};
    const result = await runGate(scenario, recordingTransport(live, replies));
    const failed = Object.values(replies).some((r) => !r.ok) || result.totals.failedChecks > 0;
    totalCredits += result.totals.credits;
    console.log(`${column(scenario.id, 22)}${column(scenario.expected, 18)}${column(result.verdict, 18)}${column(result.totals.credits, 9)}${result.totals.failedChecks}`);
    if (failed) {
      // A run that could not reach the API must not replace a good recording.
      transportFailures++;
      console.error(`${scenario.id}: a request failed, so its recording was not written.`);
      continue;
    }
    const recording = { scenarioId: scenario.id, recordedAt: new Date().toISOString(), result, replies };
    writeFileSync(join(OUT_DIR, `${scenario.id}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  }

  console.log(`Total credits: ${totalCredits}`);
  // A verdict that differs from the expected one is shown above but is not a failure here.
  return transportFailures > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
