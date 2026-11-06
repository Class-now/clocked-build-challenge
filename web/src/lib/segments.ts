import type { CheckResult, Span } from '../../../src/core/types.js';

export type EvidenceTone = 'stop' | 'warn' | 'note';

export interface Evidence {
  checkId: string;
  checkTitle: string;
  tone: EvidenceTone;
  span: Span;
}

export interface Segment { text: string; evidence: Evidence[]; }

function toneOf(check: CheckResult): EvidenceTone {
  if (check.transformed || check.outcome === 'uncertain') return 'warn';
  return check.outcome === 'flag' ? 'stop' : 'note';
}

/** Groups every check's spans by the input field they point at. */
export function evidenceByField(checks: CheckResult[]): Map<string, Evidence[]> {
  const fields = new Map<string, Evidence[]>();
  for (const check of checks) {
    for (const span of check.spans) {
      const list = fields.get(span.field) ?? [];
      list.push({ checkId: check.id, checkTitle: check.title, tone: toneOf(check), span });
      fields.set(span.field, list);
    }
  }
  return fields;
}

/** Cuts text at every span edge. Overlapping spans share a segment. Bad offsets are ignored. */
export function segmentText(text: string, evidence: Evidence[]): Segment[] {
  const usable = evidence.filter(({ span }) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= text.length && span.start < span.end);
  const cuts = [...new Set([0, text.length, ...usable.flatMap(({ span }) => [span.start, span.end])])].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    segments.push({
      text: text.slice(from, to),
      evidence: usable.filter(({ span }) => span.start <= from && span.end >= to),
    });
  }
  return segments;
}

const TONE_ORDER: EvidenceTone[] = ['stop', 'warn', 'note'];

export function strongestTone(evidence: Evidence[]): EvidenceTone {
  return TONE_ORDER.find((tone) => evidence.some((e) => e.tone === tone)) ?? 'note';
}
