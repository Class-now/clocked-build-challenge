import type { ReviewError } from '../../../src/server/contract.js';
import { INPUT_CAPS } from '../../../src/server/limits.js';

export interface FailureNotice {
  message: string;
  details?: string[];
  /** The run cannot work now, so the page goes back to the recordings. */
  backToRecorded?: boolean;
  /** Trying the same request again could work. */
  canRetry?: boolean;
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

const FIELD_NAMES: Record<string, string> = {
  brief: 'The brief',
  tool: 'The tool name',
  payload: 'The payload',
  source: 'The source',
  text: 'The text',
  report: 'The report',
  changelog: 'The changelog',
};

function fieldName(field: string): string {
  const log = /^toolLogs\[(\d+)\]\.(id|text)$/.exec(field);
  if (log) return `${log[2] === 'id' ? 'The name of tool log' : 'Tool log'} ${Number(log[1]) + 1}`;
  return FIELD_NAMES[field] ?? field;
}

export function describeFailure(error: ReviewError | { code: 'network' }): FailureNotice {
  switch (error.code) {
    case 'live_off':
      return { message: 'Live runs are off on this server, so the page now shows recordings only.', backToRecorded: true };
    case 'out_of_credits':
      return { message: 'The demo has used up its Clocked credits, so the page now shows recordings only.', backToRecorded: true };
    case 'rate_limited':
      return { message: `Live runs are limited to protect the demo's credits. Try again in about ${formatWait(error.retryAfterSeconds)}. The recordings still work in the meantime.` };
    case 'too_long':
      if (error.field === 'toolLogs') return { message: `There are too many tool logs. The limit is ${INPUT_CAPS.logCount}, so remove some and run again.` };
      return { message: `${fieldName(error.field)} is too long. The limit is ${error.limit.toLocaleString('en-US')} characters, so shorten it and run again.` };
    case 'bad_request':
      return { message: 'The form needs a change before it can run.', details: error.problems };
    case 'network':
      return { message: 'The server could not be reached, so nothing ran.', canRetry: true };
    default:
      return { message: 'Something went wrong on the server, so nothing ran.', canRetry: true };
  }
}
