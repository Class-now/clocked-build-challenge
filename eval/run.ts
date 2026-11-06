// Runs the labelled eval. `npm run eval` calls the live API and spends credits.
// `npm run eval -- --replay` recomputes from saved replies. `-- --sweep` tries other thresholds.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveTransport, recordingTransport, runGate } from '../src/core/index.js';
import type { ClockedReply, ClockedTransport } from '../src/core/index.js';
import { computeMetrics, loadCases, renderResults, renderSweep, replayCases, sweep } from './lib.js';
import type { EvalCase } from './lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface EvalOptions {
  casesPath: string;
  recordingsDir: string;
  resultsPath: string;
  /** The live API. Null when no key is available. */
  transport: ClockedTransport | null;
  log(text: string): void;
  error(text: string): void;
}

export function defaultOptions(apiKey: string | undefined): EvalOptions {
  return {
    casesPath: join(HERE, 'cases.json'),
    recordingsDir: join(HERE, 'recordings'),
    resultsPath: join(HERE, 'results.md'),
    transport: apiKey ? liveTransport({ apiKey }) : null,
    log: (text) => console.log(text),
    error: (text) => console.error(text),
  };
}

async function record(cases: EvalCase[], transport: ClockedTransport, options: EvalOptions): Promise<number> {
  mkdirSync(options.recordingsDir, { recursive: true });
  let failures = 0;
  for (const c of cases) {
    const replies: Record<string, ClockedReply> = {};
    const result = await runGate({ gate: c.gate, input: c.input }, recordingTransport(transport, replies));
    if (Object.values(replies).some((r) => !r.ok)) {
      // A failed request says nothing about the gate. Any earlier good recording stays.
      failures++;
      options.error(`${c.id}: a request failed, so its recording was not written.`);
      continue;
    }
    const recording = { caseId: c.id, recordedAt: new Date().toISOString(), replies };
    writeFileSync(join(options.recordingsDir, `${c.id}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    options.log(`${c.id.padEnd(28)}${c.expected.padEnd(18)}${result.verdict}`);
  }
  return failures;
}

export async function runEval(argv: string[], options: EvalOptions): Promise<number> {
  const unknown = argv.find((a) => a !== '--replay' && a !== '--sweep');
  if (unknown !== undefined) {
    options.error(`Unknown argument: ${unknown}. Use --replay or --sweep, or neither for a live run.`);
    return 2;
  }
  const cases = loadCases(options.casesPath);

  if (argv.includes('--sweep')) {
    const rows = await sweep(cases, options.recordingsDir);
    if (rows.every((r) => r.total === 0)) {
      options.error(`No saved replies in ${options.recordingsDir}. Run npm run eval first.`);
      return 1;
    }
    options.log(renderSweep(rows));
    return 0;
  }

  let failures = 0;
  if (!argv.includes('--replay')) {
    if (options.transport === null) {
      options.error('CLOCKED_API_KEY is not set. Put it in .env or the environment, or use --replay to read saved replies.');
      return 1;
    }
    failures = await record(cases, options.transport, options);
  }

  // A live run reports through the same path, so both modes give the same numbers.
  const { rows, notRun } = await replayCases(cases, options.recordingsDir);
  if (rows.length === 0) {
    options.error(`No saved replies in ${options.recordingsDir} match the cases. Run npm run eval first.`);
    return 1;
  }
  const metrics = computeMetrics(rows);
  writeFileSync(options.resultsPath, renderResults(metrics, notRun));
  options.log(`Agreement: ${metrics.agreed} of ${metrics.total}. Unsafe clears: ${metrics.unsafeClears.length}. False alarms: ${metrics.falseAlarms.length}. Credits: ${metrics.credits}.`);
  options.log(`Wrote ${options.resultsPath}`);
  return failures > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  const envFile = join(process.cwd(), '.env');
  const fromFile = existsSync(envFile) ? /^[ \t]*CLOCKED_API_KEY[ \t]*=[ \t]*(.*?)[ \t\r]*$/m.exec(readFileSync(envFile, 'utf8'))?.[1] : undefined;
  runEval(process.argv.slice(2), defaultOptions(process.env.CLOCKED_API_KEY || fromFile)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
