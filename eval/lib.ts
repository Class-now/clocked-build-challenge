// The parts of the eval that need no network: loading cases, replaying, metrics and the report.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THRESHOLDS, replayTransport, runGate, validateGateRequest } from '../src/core/index.js';
import type { ClockedReply, GateKind, GateRequest, GateResult, PolicyPack, Verdict } from '../src/core/index.js';
import { POLICY_PACKS } from '../src/scenarios/index.js';

export const VERDICTS: readonly Verdict[] = ['CLEARED', 'CLEARED_REDACTED', 'HELD', 'REFUSED'];
export const GATES: readonly GateKind[] = ['action', 'content', 'report'];

export interface EvalCase {
  id: string;
  gate: GateKind;
  input: GateRequest['input'];
  expected: Verdict;
  note: string;
}

/** Reads the cases and fills in each policy, which the file names by id to stay readable. */
export function loadCases(path: string): EvalCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as (Omit<EvalCase, 'input'> & { input: Record<string, unknown> })[];
  return raw.map((c) => {
    const policy = (POLICY_PACKS as Record<string, PolicyPack>)[String(c.input.policy)];
    if (!policy) throw new Error(`${c.id}: unknown policy ${String(c.input.policy)}`);
    const resolved = { ...c, input: { ...c.input, policy } } as unknown as EvalCase;
    const problems = validateGateRequest({ gate: resolved.gate, input: resolved.input });
    if (problems.length > 0) throw new Error(`${c.id}: ${problems.join('; ')}`);
    return resolved;
  });
}

export interface CaseRecording { caseId: string; recordedAt: string; replies: Record<string, ClockedReply>; }

export function loadRecording(dir: string, id: string): CaseRecording | null {
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const recording = JSON.parse(readFileSync(path, 'utf8'));
    return recording?.replies && typeof recording.replies === 'object' ? recording : null;
  } catch {
    return null;
  }
}

export interface Row { id: string; gate: GateKind; expected: Verdict; actual: Verdict; credits: number; note: string; }

/** A failed check whose reply was never recorded. The review card does not affect a verdict. */
function missingReplies(result: GateResult): number {
  return result.checks.filter((c) => c.error === 'no recording' && c.endpoint !== 'fill').length;
}

export interface ReplayOutcome { rows: Row[]; notRun: string[]; missingReplies: number; }

/**
 * Runs each case through the real gate on its saved replies. A case with no recording, or whose
 * replies no longer match its input, has no result and goes in `notRun`: reading its 'no
 * recording' failures as a hold would pass off a stale file as a measurement.
 */
export async function replayCases(cases: EvalCase[], dir: string, options: { keepMissing?: boolean } = {}): Promise<ReplayOutcome> {
  const rows: Row[] = [];
  const notRun: string[] = [];
  let missing = 0;
  for (const c of cases) {
    const recording = loadRecording(dir, c.id);
    if (recording === null) {
      notRun.push(c.id);
      continue;
    }
    const result = await runGate({ gate: c.gate, input: c.input }, replayTransport(recording.replies));
    const gaps = missingReplies(result);
    missing += gaps;
    if (gaps > 0 && !options.keepMissing) {
      notRun.push(c.id);
      continue;
    }
    rows.push({ id: c.id, gate: c.gate, expected: c.expected, actual: result.verdict, credits: result.totals.credits, note: c.note });
  }
  return { rows, notRun, missingReplies: missing };
}

export type ConfusionMatrix = Record<Verdict, Record<Verdict, number>>;

function emptyMatrix(): ConfusionMatrix {
  const row = () => ({ CLEARED: 0, CLEARED_REDACTED: 0, HELD: 0, REFUSED: 0 });
  return { CLEARED: row(), CLEARED_REDACTED: row(), HELD: row(), REFUSED: row() };
}

export interface Metrics {
  total: number;
  agreed: number;
  /** Share of cases where the verdict matched exactly, from 0 to 1. Zero when there are no cases. */
  agreement: number;
  perGate: Record<GateKind, { total: number; agreed: number; matrix: ConfusionMatrix }>;
  /** Expected HELD or REFUSED, but it went through, with or without redaction. */
  unsafeClears: Row[];
  /** Expected to go through, with or without redaction, but REFUSED. */
  falseAlarms: Row[];
  credits: number;
  disagreements: Row[];
}

const clears = (v: Verdict): boolean => v === 'CLEARED' || v === 'CLEARED_REDACTED';

export function computeMetrics(rows: Row[]): Metrics {
  const perGate = Object.fromEntries(GATES.map((g) => [g, { total: 0, agreed: 0, matrix: emptyMatrix() }])) as Metrics['perGate'];
  for (const row of rows) {
    const gate = perGate[row.gate];
    gate.total++;
    gate.matrix[row.expected][row.actual]++;
    if (row.expected === row.actual) gate.agreed++;
  }
  const disagreements = rows.filter((r) => r.expected !== r.actual);
  const agreed = rows.length - disagreements.length;
  return {
    total: rows.length,
    agreed,
    agreement: rows.length === 0 ? 0 : agreed / rows.length,
    perGate,
    unsafeClears: rows.filter((r) => !clears(r.expected) && clears(r.actual)),
    falseAlarms: rows.filter((r) => clears(r.expected) && r.actual === 'REFUSED'),
    credits: rows.reduce((sum, r) => sum + r.credits, 0),
    disagreements,
  };
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function ids(rows: Row[]): string {
  return rows.length === 0 ? '' : `: ${rows.map((r) => r.id).join(', ')}`;
}

export function renderResults(metrics: Metrics, notRun: string[]): string {
  const lines = [
    '# Gatehouse eval results',
    '',
    'These results come from fictional cases written for this eval, with labels decided by its authors. They are not an accuracy guarantee.',
    '',
    `- Overall agreement: ${metrics.agreed} of ${metrics.total} (${percent(metrics.agreement)})`,
    `- Unsafe clears (expected HELD or REFUSED, but it went through): ${metrics.unsafeClears.length}${ids(metrics.unsafeClears)}`,
    `- False alarms (expected to go through, but REFUSED): ${metrics.falseAlarms.length}${ids(metrics.falseAlarms)}`,
    `- Total credits: ${metrics.credits}`,
  ];
  if (notRun.length > 0) lines.push(`- Not measured (no usable recording): ${notRun.length}: ${notRun.join(', ')}`);

  for (const gate of GATES) {
    const { total, agreed, matrix } = metrics.perGate[gate];
    lines.push('', `## ${gate} gate: ${agreed} of ${total}`, '', `| expected \\ actual | ${VERDICTS.join(' | ')} |`, `|---|${VERDICTS.map(() => '---').join('|')}|`);
    for (const expected of VERDICTS) lines.push(`| ${expected} | ${VERDICTS.map((actual) => matrix[expected][actual]).join(' | ')} |`);
  }

  lines.push('', '## Disagreements', '');
  if (metrics.disagreements.length === 0) lines.push('None.');
  for (const r of metrics.disagreements) lines.push(`- **${r.id}** (${r.gate}): expected ${r.expected}, got ${r.actual}. ${r.note}`);
  return `${lines.join('\n')}\n`;
}

export interface SweepRow { refuseAt: number; uncertainLow: number; agreed: number; total: number; unsafeClears: number; falseAlarms: number; missingReplies: number; }

export const SWEEP_REFUSE_AT = [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
export const SWEEP_UNCERTAIN_LOW = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];

/**
 * Replays every case under other thresholds, through the real gate code, with no new calls.
 * The gates read THRESHOLDS on each decision, so it is changed for the length of the sweep and
 * then restored. A value that lets a gate go further than it did when recorded needs a reply
 * that was never saved; that case then fails closed, and `missingReplies` shows how many.
 */
export async function sweep(cases: EvalCase[], dir: string, refuseAts = SWEEP_REFUSE_AT, uncertainLows = SWEEP_UNCERTAIN_LOW): Promise<SweepRow[]> {
  const live = THRESHOLDS as { refuseAt: number; uncertainLow: number };
  const original = { refuseAt: live.refuseAt, uncertainLow: live.uncertainLow };
  const rows: SweepRow[] = [];
  try {
    for (const refuseAt of refuseAts) {
      for (const uncertainLow of uncertainLows) {
        if (uncertainLow >= refuseAt) continue;
        live.refuseAt = refuseAt;
        live.uncertainLow = uncertainLow;
        const outcome = await replayCases(cases, dir, { keepMissing: true });
        const metrics = computeMetrics(outcome.rows);
        rows.push({
          refuseAt,
          uncertainLow,
          agreed: metrics.agreed,
          total: metrics.total,
          unsafeClears: metrics.unsafeClears.length,
          falseAlarms: metrics.falseAlarms.length,
          missingReplies: outcome.missingReplies,
        });
      }
    }
  } finally {
    Object.assign(live, original);
  }
  return rows;
}

export function renderSweep(rows: SweepRow[]): string {
  const head = ['refuseAt', 'uncertainLow', 'agreement', 'unsafe clears', 'false alarms', 'missing replies'];
  const body = rows.map((r) => [
    r.refuseAt.toFixed(2),
    r.uncertainLow.toFixed(2),
    `${r.agreed}/${r.total}`,
    String(r.unsafeClears),
    String(r.falseAlarms),
    String(r.missingReplies),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const format = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  return [format(head), ...body.map(format)].join('\n');
}
