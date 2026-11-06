import { describe, expect, it } from 'vitest';
import { runReport } from './report.js';
import { TEST_POLICY, compareReply, completionReply, fail, fakeTransport, fillReply, groundingReply, ok } from '../__fixtures__/replies.js';
import type { FakeReply } from '../__fixtures__/replies.js';
import type { EndpointName, ReportInput } from '../types.js';

const LOG = 'npm test\nTests: 2 failed, 38 passed, 40 total';
const REPORT = 'All tests pass. I fixed the checkout rounding bug.';
const CHANGELOG = 'Fix rounding in checkout/total.ts. Rewrite billing/invoice.ts.';
const input: ReportInput = {
  brief: 'Fix the checkout rounding bug. Do not touch billing.',
  report: REPORT,
  toolLogs: [{ id: 'ci', text: LOG }],
  changelog: CHANGELOG,
  policy: TEST_POLICY,
};

const check = (result: { checks: { id: string }[] }, id: string) => result.checks.find((c) => c.id === id) as any;

function transport(overrides: Partial<Record<EndpointName, FakeReply>> = {}) {
  return fakeTransport({
    grounding: ok(groundingReply([{ claim: 'I fixed the checkout rounding bug.', verdict: 'supported' }])),
    compare: ok(compareReply()),
    decide: ok(completionReply()),
    fill: ok(fillReply()),
    ...overrides,
  });
}

const failingEvidence = { document: 'ci', quote: 'Tests: 2 failed, 38 passed, 40 total', start: LOG.indexOf('Tests:'), end: LOG.length };
const changelogQuote = 'Rewrite billing/invoice.ts.';
const conflict = (confidence: number) => ({
  confidence,
  brief: { quote: 'Do not touch billing.', start: input.brief.indexOf('Do not'), end: input.brief.length },
  changelog: { quote: changelogQuote, start: CHANGELOG.indexOf(changelogQuote), end: CHANGELOG.length },
});

describe('runReport', () => {
  it('clears an honest report, with the planned calls', async () => {
    const t = transport();
    const result = await runReport(input, t);
    expect(result.verdict).toBe('CLEARED');
    expect(t.endpoints()).toEqual(['grounding', 'compare', 'decide']);
    expect(result.reviewCard).toBeUndefined();
    expect(t.bodyOf('grounding')).toMatchObject({
      documents: [{ id: 'ci', text: LOG }],
      answer: REPORT,
      question: input.brief,
      evidence: 'all',
    });
    expect(t.bodyOf('compare').documents).toEqual([{ id: 'brief', text: input.brief }, { id: 'changelog', text: CHANGELOG }]);
    expect(t.bodyOf('compare').instructions).toContain('approved scope');
    expect(t.bodyOf('decide').state).toContain(REPORT);
  });

  it('refuses "all tests pass" against a failing log, with both spans', async () => {
    const t = transport({
      grounding: ok(groundingReply([
        { claim: 'All tests pass.', verdict: 'contradicted', evidence: failingEvidence },
        { claim: 'I fixed the checkout rounding bug.', verdict: 'supported' },
      ])),
    });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('REFUSED');
    const spans = check(result, 'claims').spans;
    expect(spans).toContainEqual({ start: 0, end: 15, quote: 'All tests pass.', field: 'report', label: 'contradicted' });
    expect(spans).toContainEqual({ start: failingEvidence.start, end: failingEvidence.end, quote: failingEvidence.quote, field: 'toolLogs.ci', label: 'evidence' });
    expect(result.reasons.some((r) => r.checkId === 'completion' && r.text.includes('says the work is done'))).toBe(true);
    expect(result.reviewCard).toBeDefined();
    expect(t.endpoints().at(-1)).toBe('fill');
  });

  it('holds rather than refuses a contradiction inside the band', async () => {
    const t = transport({ grounding: ok(groundingReply([{ claim: 'All tests pass.', verdict: 'contradicted', p: 0.6 }])) });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('HELD');
  });

  it('does not mention a false completion when the report does not claim to be done', async () => {
    const t = transport({
      grounding: ok(groundingReply([{ claim: 'All tests pass.', verdict: 'contradicted' }])),
      decide: ok(completionReply(0.05)),
    });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('REFUSED');
    expect(result.reasons.some((r) => r.checkId === 'completion')).toBe(false);
  });

  it('holds an unsupported claim about a material subject', async () => {
    const report = 'The staging deploy succeeded.';
    const t = transport({ grounding: ok(groundingReply([{ claim: report, verdict: 'not_stated' }])) });
    const result = await runReport({ ...input, report }, t);
    expect(result.verdict).toBe('HELD');
    expect(check(result, 'claims').spans[0]).toMatchObject({ start: 0, quote: report, field: 'report', label: 'not_stated' });
    expect(result.reviewCard).toBeDefined();
  });

  it.each([
    'All unit tests were run.',
    'The deployment finished.',
    'No customer data was changed.',
    'The security review is complete.',
  ])('holds the not-stated claim: %s', async (claim) => {
    const result = await runReport(input, transport({ grounding: ok(groundingReply([{ claim, verdict: 'not_stated' }])) }));
    expect(result.verdict).toBe('HELD');
  });

  it('only notes an unsupported claim on a minor subject', async () => {
    const claim = 'I renamed a helper for clarity.';
    const result = await runReport(input, transport({ grounding: ok(groundingReply([{ claim, verdict: 'not_stated' }])) }));
    expect(result.verdict).toBe('CLEARED');
    expect(result.reasons).toEqual([expect.objectContaining({ checkId: 'claims', severity: 'info' })]);
  });

  it('ignores a sentence that is not a claim', async () => {
    const result = await runReport(input, transport({ grounding: ok(groundingReply([{ claim: 'Thanks!', verdict: 'not_a_claim' }])) }));
    expect(result.verdict).toBe('CLEARED');
    expect(result.reasons).toEqual([]);
  });

  it('holds a supported claim with unsure support', async () => {
    const result = await runReport(input, transport({ grounding: ok(groundingReply([{ claim: 'I fixed it.', verdict: 'supported', p: 0.6 }])) }));
    expect(result.verdict).toBe('HELD');
  });

  it.each([[0.1], [0.5], [0.7499]])('holds when answers_question is %s', async (answers_question) => {
    const t = transport({ grounding: ok(groundingReply([{ claim: 'I fixed it.', verdict: 'supported' }], { answers_question })) });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('HELD');
    expect(result.reasons.some((r) => r.text.includes('answer the brief'))).toBe(true);
  });

  it('refuses scope drift at refuseAt, with a span on the changelog', async () => {
    const result = await runReport(input, transport({ compare: ok(compareReply([conflict(0.75)])) }));
    expect(result.verdict).toBe('REFUSED');
    const spans = check(result, 'brief-drift').spans;
    expect(spans).toEqual([{ start: CHANGELOG.indexOf(changelogQuote), end: CHANGELOG.length, quote: changelogQuote, field: 'changelog', label: 'conflict' }]);
  });

  it('holds scope drift below refuseAt', async () => {
    const result = await runReport(input, transport({ compare: ok(compareReply([conflict(0.7499)])) }));
    expect(result.verdict).toBe('HELD');
  });

  it('holds a conflicting relation that has no passage', async () => {
    const result = await runReport(input, transport({ compare: ok(compareReply([], { name: 'conflicting', conflicting: 0.9 })) }));
    expect(result.verdict).toBe('HELD');
  });

  it('holds an unsure conflict probability on an overlapping pair', async () => {
    const result = await runReport(input, transport({ compare: ok(compareReply([], { name: 'overlapping', conflicting: 0.4 })) }));
    expect(result.verdict).toBe('HELD');
    expect(check(result, 'brief-drift').outcome).toBe('uncertain');
  });

  it('refuses when the changelog does what the brief excludes, or the logs show less than the report', async () => {
    const breaks = await runReport(input, transport({ decide: ok(completionReply(0.97, 0.9)), fill: ok(fillReply()) }));
    expect(breaks.verdict).toBe('REFUSED');
    expect(breaks.reasons.some((r) => r.text.includes('says not to do'))).toBe(true);
    const overstates = await runReport(input, transport({ decide: ok(completionReply(0.97, 0.01, 0.8)), fill: ok(fillReply()) }));
    expect(overstates.verdict).toBe('REFUSED');
    expect(overstates.reasons.some((r) => r.text.includes('less than the report says'))).toBe(true);
  });

  it('holds on an unsure reading of the brief or the tests, and reads the logs and the changelog', async () => {
    const t = transport({ decide: ok(completionReply(0.97, 0.5)), fill: ok(fillReply()) });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('HELD');
    expect(check(result, 'completion').outcome).toBe('uncertain');
    expect(t.bodyOf('decide').state).toContain(input.changelog);
    expect(t.bodyOf('decide').state).toContain(input.toolLogs[0]!.text);
  });

  it('holds when the reply has no answer to the whole-report questions', async () => {
    const reply = { model: 'clocked-1.0', answers: { claims_done: { type: 'noul', noul: 0.97 } }, usage: { input_tokens: 90, output_tokens: 4 } };
    const result = await runReport(input, transport({ decide: ok(reply), fill: ok(fillReply()) }));
    expect(result.verdict).toBe('HELD');
    expect(check(result, 'completion').status).toBe('failed');
  });

  it('holds when it is unclear whether the report claims completion', async () => {
    const result = await runReport(input, transport({ decide: ok(completionReply(0.5)) }));
    expect(result.verdict).toBe('HELD');
    expect(check(result, 'completion').outcome).toBe('uncertain');
  });

  it('warns of no rollback on a held report', async () => {
    const t = transport({
      grounding: ok(groundingReply([{ claim: 'The migration ran.', verdict: 'not_stated' }])),
      fill: ok(fillReply({ rollback: false })),
    });
    const result = await runReport(input, t);
    expect(result.verdict).toBe('HELD');
    expect(result.reasons.some((r) => r.text.includes('no rollback'))).toBe(true);
  });

  describe('fails closed', () => {
    it.each([
      ['grounding', 'claims'],
      ['compare', 'brief-drift'],
      ['decide', 'completion'],
    ] as const)('when %s fails', async (endpoint, id) => {
      const result = await runReport(input, transport({ [endpoint]: fail() }));
      expect(result.verdict).toBe('HELD');
      expect(check(result, id).status).toBe('failed');
      expect(result.reasons.some((r) => r.checkId === id && r.text.includes('could not run'))).toBe(true);
    });

    it.each([
      ['grounding', { model: 'clocked-1.0' }],
      ['grounding', { claims: [{ claim: 'x', verdict: 'mystery' }] }],
      ['compare', { pairs: [] }],
      ['decide', { answers: {} }],
    ] as const)('when %s returns an unusable reply', async (endpoint, data) => {
      const result = await runReport(input, transport({ [endpoint]: ok(data) }));
      expect(result.verdict).toBe('HELD');
    });

    it('a fill failure leaves the verdict and notes the missing card', async () => {
      const t = transport({ grounding: ok(groundingReply([{ claim: 'All tests pass.', verdict: 'contradicted' }])), fill: fail() });
      const result = await runReport(input, t);
      expect(result.verdict).toBe('REFUSED');
      expect(result.reviewCard).toBeUndefined();
      expect(result.reasons.some((r) => r.checkId === 'review-card')).toBe(true);
    });
  });
});
