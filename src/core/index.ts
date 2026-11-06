import type { ClockedTransport } from './clocked.js';
import { runAction } from './gates/action.js';
import { runContent } from './gates/content.js';
import { runReport } from './gates/report.js';
import type { ActionInput, ContentInput, GateKind, GateResult, ReportInput } from './types.js';

export * from './types.js';
export { callKey, liveTransport, recordingTransport, replayTransport } from './clocked.js';
export type { ClockedCall, ClockedReply, ClockedTransport, LiveTransportOptions } from './clocked.js';
export { THRESHOLDS, combine, hostAllowed } from './policy.js';
export { runAction, runContent, runReport };

/** A scenario, or anything else that names a gate and carries that gate's input. */
export interface GateRequest { gate: GateKind; input: ActionInput | ContentInput | ReportInput; }

export function runGate(request: GateRequest, transport: ClockedTransport): Promise<GateResult> {
  switch (request.gate) {
    case 'action':
      return runAction(request.input as ActionInput, transport);
    case 'content':
      return runContent(request.input as ContentInput, transport);
    case 'report':
      return runReport(request.input as ReportInput, transport);
    default:
      throw new Error(`Unknown gate: ${String(request.gate)}`);
  }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** Returns what is wrong with a gate's input. An empty list means it is valid. */
export function validateGateRequest(request: GateRequest): string[] {
  const problems: string[] = [];
  const input = request.input as unknown as Record<string, any>;
  const need = (...names: string[]) => {
    for (const name of names) if (!nonEmptyString(input?.[name])) problems.push(`${name} must be a non-empty string`);
  };

  const policy = input?.policy;
  if (!nonEmptyString(policy?.id) || !nonEmptyString(policy?.name)) problems.push('policy needs an id and a name');
  if (!Array.isArray(policy?.clauses) || policy.clauses.length === 0) {
    problems.push('policy needs at least one clause');
  } else if (policy.clauses.some((c: any) => !nonEmptyString(c?.id) || !nonEmptyString(c?.title) || !nonEmptyString(c?.text))) {
    problems.push('every clause needs an id, a title and text');
  }
  if (!Array.isArray(policy?.allowedHosts)) problems.push('policy needs an allowedHosts list');

  switch (request.gate) {
    case 'action':
      need('brief', 'tool', 'payload');
      if (input?.outbound !== undefined && typeof input.outbound !== 'boolean') problems.push('outbound must be a boolean');
      break;
    case 'content':
      need('source', 'text');
      break;
    case 'report':
      need('brief', 'report', 'changelog');
      if (!Array.isArray(input?.toolLogs) || input.toolLogs.length === 0) {
        problems.push('toolLogs needs at least one log');
      } else if (input.toolLogs.some((l: any) => !nonEmptyString(l?.id) || !nonEmptyString(l?.text))) {
        problems.push('every tool log needs an id and text');
      }
      break;
    default:
      problems.push(`unknown gate: ${String(request.gate)}`);
  }
  return problems;
}
