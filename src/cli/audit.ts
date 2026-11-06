import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GateKind, GateResult } from '../core/index.js';

export interface AuditEntry {
  time: string;
  gate: GateKind;
  verdict: GateResult['verdict'] | 'SKIPPED' | 'ERROR';
  /** Reason ids and severities only: reason texts can quote the checked text. */
  reasons: { checkId: string; severity: string }[];
  credits: number;
}

/** Appends one line. A failure to write never changes what the hook prints. */
export function appendAudit(cwd: string, entry: AuditEntry): void {
  try {
    const dir = join(cwd, '.gatehouse');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'audit.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch {
    // The audit is a record, not a control.
  }
}

export function auditResult(cwd: string, time: Date, result: GateResult): void {
  appendAudit(cwd, {
    time: time.toISOString(),
    gate: result.gate,
    verdict: result.verdict,
    reasons: result.reasons.map((r) => ({ checkId: r.checkId, severity: r.severity })),
    credits: result.totals.credits,
  });
}
