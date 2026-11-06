import type { CheckResult, GateKind, Verdict } from '../../../src/core/types.js';

export const VERDICT_TEXT: Record<Verdict, { stamp: string; words: string; css: string }> = {
  CLEARED: { stamp: 'CLEARED', words: 'Cleared', css: 'cleared' },
  CLEARED_REDACTED: { stamp: 'CLEARED · REDACTED', words: 'Cleared, with personal data redacted', css: 'redacted' },
  HELD: { stamp: 'HELD', words: 'Held for a person', css: 'held' },
  REFUSED: { stamp: 'REFUSED', words: 'Refused', css: 'refused' },
};

export const GATE_LABELS: Record<GateKind, string> = {
  action: 'Before it acts',
  content: 'Before it reads',
  report: 'Before it reports done',
};

export const GATE_ORDER: GateKind[] = ['action', 'content', 'report'];

const MEANING: Record<GateKind, Record<Verdict, string>> = {
  action: {
    CLEARED: 'The action runs.',
    CLEARED_REDACTED: 'The action runs, using the redacted text below.',
    HELD: 'The action waits until a person decides.',
    REFUSED: 'The action does not run.',
  },
  content: {
    CLEARED: 'The agent may read this content.',
    CLEARED_REDACTED: 'The agent reads a copy with the personal data replaced.',
    HELD: 'The agent reads nothing until a person looks.',
    REFUSED: 'The agent reads nothing. The content is quarantined.',
  },
  report: {
    CLEARED: 'The report is accepted as done.',
    CLEARED_REDACTED: 'The report is accepted as done.',
    HELD: 'The work is not marked done until a person looks.',
    REFUSED: 'The report is sent back. The work is not marked done.',
  },
};

export function verdictMeaning(gate: GateKind, verdict: Verdict): string {
  return MEANING[gate][verdict];
}

/** A word for each state, so a check never relies on colour. */
export function checkState(check: Pick<CheckResult, 'status' | 'outcome' | 'transformed'>): { word: string; css: string } {
  if (check.status === 'failed') return { word: 'Failed', css: 'failed' };
  if (check.status === 'skipped') return { word: 'Skipped', css: 'skipped' };
  if (check.transformed) return { word: 'Redacted', css: 'uncertain' };
  switch (check.outcome) {
    case 'pass':
      return { word: 'Passed', css: 'pass' };
    case 'uncertain':
      return { word: 'Unsure', css: 'uncertain' };
    case 'flag':
      return { word: 'Flagged', css: 'flag' };
    default:
      return { word: 'Noted', css: 'info' };
  }
}
