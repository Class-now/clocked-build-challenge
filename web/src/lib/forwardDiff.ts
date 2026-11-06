import type { Span } from '../../../src/core/types.js';

export type DiffPart =
  | { kind: 'same'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'placeholder'; text: string }
  | { kind: 'added'; text: string };

function mergedRanges(original: string, spans: Span[]): { start: number; end: number }[] {
  const sorted = spans
    .filter((s) => s.start >= 0 && s.end <= original.length && s.start < s.end)
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

/**
 * Lines the forwarded text up against the original. The unchanged runs between the personal data
 * are found in order, so what sits between them in the forwarded text is the placeholder. Anything
 * before the first run or after the last, such as an untrusted-data envelope, counts as added.
 * When the two cannot be lined up, the forwarded text is shown as it is, without pretending.
 */
export function forwardDiff(original: string, forward: string, spans: Span[]): DiffPart[] {
  const ranges = mergedRanges(original, spans);
  const runs: string[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    runs.push(original.slice(cursor, start));
    cursor = end;
  }
  runs.push(original.slice(cursor));

  const parts: DiffPart[] = [];
  const firstRun = runs[0]!;
  const firstAt = forward.indexOf(firstRun);
  if (firstAt < 0) return [{ kind: 'same', text: forward }];
  if (firstAt > 0) parts.push({ kind: 'added', text: forward.slice(0, firstAt) });
  if (firstRun) parts.push({ kind: 'same', text: firstRun });
  let at = firstAt + firstRun.length;

  for (const [i, range] of ranges.entries()) {
    const run = runs[i + 1]!;
    const isLast = i === ranges.length - 1;
    const next = run === '' && isLast ? forward.length : forward.indexOf(run, at);
    if (next < 0) return [{ kind: 'same', text: forward }];
    parts.push({ kind: 'removed', text: original.slice(range.start, range.end) });
    const placeholder = forward.slice(at, next);
    if (placeholder) parts.push({ kind: 'placeholder', text: placeholder });
    if (run) parts.push({ kind: 'same', text: run });
    at = next + run.length;
  }
  if (at < forward.length) parts.push({ kind: 'added', text: forward.slice(at) });
  return parts;
}
