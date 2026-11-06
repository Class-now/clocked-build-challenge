// The Gatehouse command line. See README.md.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveTransport, runGate, validateGateRequest } from '../core/index.js';
import type { ClockedTransport, GateKind, GateRequest, GateResult } from '../core/index.js';
import { resolvePolicy } from './config.js';
import { playDemo } from './demo.js';
import { HOOK_DEADLINE_MS, hookPostTool, hookPreTool, hookStop } from './hooks.js';
import type { HookContext, HookOutput } from './hooks.js';

export const EXIT = { cleared: 0, usage: 2, held: 10, refused: 20 } as const;

const USAGE = `Usage:
  gatehouse check <action|content|report> --file input.json [--json]
  gatehouse hook <pre-tool|post-tool|stop>     reads a Claude Code hook event from stdin
  gatehouse demo                               plays a recorded session, with no API key

Exit codes for check: 0 cleared, 10 held, 20 refused, 2 usage error.`;

// A hook has to answer before its deadline, so it waits and retries less than other callers.
const HOOK_TIMEOUT_MS = 15_000;
const HOOK_RETRIES = 1;

export interface CliDeps {
  readStdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Replaces the live API, for tests. */
  transport?: ClockedTransport;
  now?(): Date;
  deadlineMs?: number;
  /** Where `gatehouse demo` finds recordings. Defaults to recordings/ in this repository. */
  recordingsDir?: string;
}

function apiKey(env: CliDeps['env'], cwd: string): string | null {
  if (env.CLOCKED_API_KEY) return env.CLOCKED_API_KEY;
  const file = resolve(cwd, '.env');
  if (!existsSync(file)) return null;
  const match = /^[ \t]*CLOCKED_API_KEY[ \t]*=[ \t]*(.*?)[ \t\r]*$/m.exec(readFileSync(file, 'utf8'));
  return match?.[1]?.replace(/^(['"])(.*)\1$/, '$2') || null;
}

function hookContext(deps: CliDeps): HookContext {
  return {
    transport: (cwd) => {
      if (deps.transport) return deps.transport;
      const key = apiKey(deps.env, cwd);
      return key === null ? null : liveTransport({ apiKey: key, timeoutMs: HOOK_TIMEOUT_MS, maxRetries: HOOK_RETRIES });
    },
    now: deps.now ?? (() => new Date()),
    deadlineMs: deps.deadlineMs ?? HOOK_DEADLINE_MS,
  };
}

export function exitCodeFor(verdict: GateResult['verdict']): number {
  if (verdict === 'REFUSED') return EXIT.refused;
  return verdict === 'HELD' ? EXIT.held : EXIT.cleared;
}

export function formatResult(result: GateResult): string {
  const lines = [`Verdict: ${result.verdict}`];
  if (result.reasons.length > 0) {
    lines.push('', 'Reasons:');
    for (const r of result.reasons) lines.push(`  [${r.severity}] ${r.text}`);
  }
  lines.push('', 'Checks:');
  for (const c of result.checks) {
    const score = c.score === undefined ? '' : ` (${c.score.toFixed(2)})`;
    lines.push(`  ${c.title}: ${c.status === 'ok' ? c.outcome : c.status}${score}`, `    ${c.summary}`, `    ${c.effect}`);
    for (const s of c.spans) lines.push(`    evidence in ${s.field}: "${s.quote}"`);
  }
  if (result.verdict === 'CLEARED_REDACTED' && result.forwardText !== undefined) {
    lines.push('', 'Redacted text:', result.forwardText);
  }
  lines.push('', `Credits: ${result.totals.credits}. Failed checks: ${result.totals.failedChecks}.`);
  return lines.join('\n');
}

const GATES: readonly string[] = ['action', 'content', 'report'];

async function check(args: string[], deps: CliDeps): Promise<number> {
  const usage = (message: string): number => {
    deps.stderr(`${message}\n\n${USAGE}`);
    return EXIT.usage;
  };
  const gate = args[0];
  if (gate === undefined || !GATES.includes(gate)) return usage(`Unknown gate: ${gate ?? '(none)'}.`);
  const fileAt = args.indexOf('--file');
  const file = fileAt < 0 ? undefined : args[fileAt + 1];
  if (file === undefined) return usage('--file is required.');
  const known = new Set([gate, '--file', file, '--json']);
  const stray = args.find((a) => !known.has(a));
  if (stray !== undefined) return usage(`Unknown argument: ${stray}.`);

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(readFileSync(resolve(deps.cwd, file), 'utf8'));
    // A policy may be named instead of written out.
    if (typeof input.policy === 'string') input.policy = resolvePolicy(input.policy, deps.cwd);
  } catch (err) {
    return usage(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}.`);
  }
  const request = { gate: gate as GateKind, input } as unknown as GateRequest;
  const problems = validateGateRequest(request);
  if (problems.length > 0) return usage(`${file} is not a valid ${gate} input: ${problems.join('; ')}.`);

  let transport = deps.transport;
  if (!transport) {
    const key = apiKey(deps.env, deps.cwd);
    if (key === null) return usage('CLOCKED_API_KEY is not set. Put it in the environment or in .env.');
    transport = liveTransport({ apiKey: key });
  }
  const result = await runGate(request, transport);
  deps.stdout(args.includes('--json') ? JSON.stringify(result, null, 2) : formatResult(result));
  return exitCodeFor(result.verdict);
}

async function hook(args: string[], deps: CliDeps): Promise<number> {
  const handlers: Record<string, (raw: string, ctx: HookContext) => Promise<HookOutput>> = {
    'pre-tool': hookPreTool,
    'post-tool': hookPostTool,
    stop: hookStop,
  };
  const handler = args[0] === undefined ? undefined : handlers[args[0]];
  if (handler === undefined || args.length > 1) {
    deps.stderr(USAGE);
    return EXIT.usage;
  }
  const output = await handler(await deps.readStdin(), hookContext(deps));
  if (output !== null) deps.stdout(JSON.stringify(output));
  // Exit 0 is what makes Claude Code read the JSON. Every decision is in the JSON.
  return 0;
}

const DEFAULT_RECORDINGS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'recordings');

async function demo(deps: CliDeps): Promise<number> {
  const played = await playDemo(deps.recordingsDir ?? DEFAULT_RECORDINGS);
  if ('error' in played) {
    deps.stderr(played.error);
    return 1;
  }
  deps.stdout(played.text);
  return 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'check') return check(rest, deps);
  if (command === 'hook') return hook(rest, deps);
  if (command === 'demo' && rest.length === 0) return demo(deps);
  deps.stderr(USAGE);
  return EXIT.usage;
}

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(argv, {
    readStdin: readProcessStdin,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    env: process.env,
    cwd: process.cwd(),
  });
}

const entry = process.argv[1];
if (entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = EXIT.usage;
  });
}
