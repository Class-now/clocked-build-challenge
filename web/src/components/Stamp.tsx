import type { Verdict } from '../../../src/core/types.js';
import { VERDICT_TEXT } from '../lib/verdicts.js';

export function Stamp({ verdict, size = 'small' }: { verdict: Verdict; size?: 'small' | 'large' }) {
  const text = VERDICT_TEXT[verdict];
  return (
    <span className={`stamp stamp--${size} stamp--${text.css}`} role="img" aria-label={`Verdict: ${text.words}`}>
      <span aria-hidden="true">{text.stamp}</span>
    </span>
  );
}
