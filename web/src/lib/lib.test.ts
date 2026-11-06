import { describe, expect, it } from 'vitest';
import type { CheckResult, Span } from '../../../src/core/types.js';
import { forwardDiff } from './forwardDiff.js';
import { evidenceByField, segmentText } from './segments.js';
import { checkState } from './verdicts.js';

const span = (text: string, quote: string, field = 'text'): Span => {
  const start = text.indexOf(quote);
  return { start, end: start + quote.length, quote, field };
};

describe('segmentText', () => {
  const check = (id: string, spans: Span[], outcome: CheckResult['outcome'] = 'flag'): CheckResult => ({
    id, title: id, endpoint: 'script', status: 'ok', outcome, summary: '', effect: '', spans,
  });

  it('returns the whole text when nothing is marked', () => {
    expect(segmentText('hello', [])).toEqual([{ text: 'hello', evidence: [] }]);
  });

  it('cuts overlapping spans into shared segments and keeps every character', () => {
    const text = 'one two three';
    const fields = evidenceByField([check('a', [span(text, 'one two')]), check('b', [span(text, 'two three')])]);
    const segments = segmentText(text, fields.get('text')!);
    expect(segments.map((s) => s.text)).toEqual(['one ', 'two', ' three']);
    expect(segments.map((s) => s.evidence.map((e) => e.checkId))).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('ignores spans that do not fit the text', () => {
    const bad = { start: 3, end: 99, quote: 'x', field: 'text' };
    expect(segmentText('hello', evidenceByField([check('a', [bad])]).get('text')!)).toEqual([{ text: 'hello', evidence: [] }]);
  });

  it('reads a replaced value as a warning, not a stop', () => {
    const fields = evidenceByField([{ ...check('p', [span('x y', 'y')]), transformed: true }]);
    expect(fields.get('text')![0]!.tone).toBe('warn');
  });
});

describe('forwardDiff', () => {
  const original = 'Call +1 202 555 0142 or mail a@example.com today';

  it('shows each removed value beside its placeholder', () => {
    const forward = 'Call <PHONE> or mail <EMAIL> today';
    expect(forwardDiff(original, forward, [span(original, '+1 202 555 0142'), span(original, 'a@example.com')])).toEqual([
      { kind: 'same', text: 'Call ' },
      { kind: 'removed', text: '+1 202 555 0142' },
      { kind: 'placeholder', text: '<PHONE>' },
      { kind: 'same', text: ' or mail ' },
      { kind: 'removed', text: 'a@example.com' },
      { kind: 'placeholder', text: '<EMAIL>' },
      { kind: 'same', text: ' today' },
    ]);
  });

  it('handles a value at the very end of the text', () => {
    const text = 'Mail a@example.com';
    expect(forwardDiff(text, 'Mail <EMAIL>', [span(text, 'a@example.com')])).toEqual([
      { kind: 'same', text: 'Mail ' },
      { kind: 'removed', text: 'a@example.com' },
      { kind: 'placeholder', text: '<EMAIL>' },
    ]);
  });

  it('marks an envelope around the text as added', () => {
    expect(forwardDiff('body', '<wrap>\nbody\n</wrap>', [])).toEqual([
      { kind: 'added', text: '<wrap>\n' },
      { kind: 'same', text: 'body' },
      { kind: 'added', text: '\n</wrap>' },
    ]);
  });

  it('shows the forwarded text as it is when the two do not line up', () => {
    expect(forwardDiff('abc', 'something else', [])).toEqual([{ kind: 'same', text: 'something else' }]);
  });
});

describe('checkState', () => {
  it.each([
    [{ status: 'failed', outcome: 'uncertain' }, 'Failed'],
    [{ status: 'skipped', outcome: 'info' }, 'Skipped'],
    [{ status: 'ok', outcome: 'pass' }, 'Passed'],
    [{ status: 'ok', outcome: 'uncertain' }, 'Unsure'],
    [{ status: 'ok', outcome: 'flag' }, 'Flagged'],
    [{ status: 'ok', outcome: 'info' }, 'Noted'],
    [{ status: 'ok', outcome: 'flag', transformed: true }, 'Redacted'],
  ] as const)('gives %j a word', (check, word) => {
    expect(checkState(check).word).toBe(word);
  });
});
