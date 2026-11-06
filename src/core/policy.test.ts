import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS, assuranceSeverity, band, combine, failureReason, hostAllowed, missingDataReason, normalizeHost, riskSeverity,
} from './policy.js';
import type { CheckResult, EndpointName, GateKind, Reason, Verdict } from './types.js';

function check(id: string, endpoint: EndpointName, over: Partial<CheckResult> = {}): CheckResult {
  return { id, title: id, endpoint, status: 'ok', outcome: 'pass', summary: '', effect: '', spans: [], ...over };
}
const reason = (severity: Reason['severity']): Reason => ({ checkId: 'x', severity, text: 't' });
const scope = check('scope', 'decide');

describe('combine', () => {
  const cases: { name: string; gate: GateKind; checks: CheckResult[]; reasons: Reason[]; expected: Verdict }[] = [
    { name: 'refuse beats hold', gate: 'content', checks: [], reasons: [reason('hold'), reason('refuse')], expected: 'REFUSED' },
    { name: 'hold beats redaction', gate: 'content', checks: [check('p', 'pii', { transformed: true })], reasons: [reason('hold')], expected: 'HELD' },
    { name: 'info does not hold', gate: 'content', checks: [], reasons: [reason('info')], expected: 'CLEARED' },
    { name: 'transformed text is redacted', gate: 'content', checks: [check('p', 'pii', { transformed: true })], reasons: [], expected: 'CLEARED_REDACTED' },
    { name: 'untransformed text is cleared', gate: 'report', checks: [check('c', 'compare')], reasons: [], expected: 'CLEARED' },
    { name: 'uncertain outcome never clears', gate: 'report', checks: [check('c', 'compare', { outcome: 'uncertain' })], reasons: [], expected: 'HELD' },
    { name: 'failed safety check holds with no reason', gate: 'report', checks: [check('g', 'grounding', { status: 'failed' })], reasons: [], expected: 'HELD' },
    { name: 'failed helper does not hold by itself', gate: 'report', checks: [check('f', 'fill', { status: 'failed' })], reasons: [], expected: 'CLEARED' },
    { name: 'skipped check does not hold', gate: 'report', checks: [check('s', 'script', { status: 'skipped', outcome: 'info' })], reasons: [], expected: 'CLEARED' },
    { name: 'benign detector alone does not clear an action', gate: 'action', checks: [check('script-risk', 'script')], reasons: [], expected: 'HELD' },
    { name: 'an out-of-scope action is held', gate: 'action', checks: [check('script-risk', 'script'), check('scope', 'decide', { outcome: 'flag' })], reasons: [], expected: 'HELD' },
    { name: 'a failed allowlist holds an action', gate: 'action', checks: [scope, check('targets', 'extract', { outcome: 'flag' })], reasons: [], expected: 'HELD' },
    { name: 'in scope with a passing allowlist clears', gate: 'action', checks: [scope, check('targets', 'extract')], reasons: [], expected: 'CLEARED' },
    { name: 'in scope with redaction is redacted', gate: 'action', checks: [scope, check('p', 'pii', { transformed: true })], reasons: [], expected: 'CLEARED_REDACTED' },
  ];
  it.each(cases)('$name', ({ gate, checks, reasons, expected }) => {
    expect(combine(gate, checks, reasons)).toBe(expected);
  });
});

describe('thresholds', () => {
  it('has the agreed band', () => {
    expect(THRESHOLDS.uncertainLow).toBe(0.35);
    expect(THRESHOLDS.refuseAt).toBe(0.75);
  });

  it.each([
    [0, 'low', null, 'hold'],
    [0.3499, 'low', null, 'hold'],
    [0.35, 'uncertain', 'hold', 'hold'],
    [0.7499, 'uncertain', 'hold', 'hold'],
    [0.75, 'high', 'refuse', null],
    [1, 'high', 'refuse', null],
  ] as const)('at %s', (p, expectedBand, risk, assurance) => {
    expect(band(p)).toBe(expectedBand);
    expect(riskSeverity(p)).toBe(risk);
    expect(assuranceSeverity(p)).toBe(assurance);
  });
});

describe('failureReason', () => {
  it.each(['script', 'injection', 'pii', 'grounding', 'compare', 'decide'] as const)('a failed %s holds', (endpoint) => {
    expect(failureReason(check('c', endpoint, { status: 'failed' }))?.severity).toBe('hold');
  });
  it.each(['rerank', 'fill', 'extract'] as const)('a failed %s holds only when depended on', (endpoint) => {
    const failed = check('c', endpoint, { status: 'failed' });
    expect(failureReason(failed)).toBeNull();
    expect(failureReason(failed, true)?.severity).toBe('hold');
  });
  it('says the check could not run', () => {
    expect(failureReason(check('c', 'script', { status: 'failed', title: 'Inspect' }))?.text).toContain('could not run');
  });
  it('ignores a check that ran', () => {
    expect(failureReason(check('c', 'script'))).toBeNull();
  });
});

describe('missingDataReason', () => {
  const none = { network: false, payment: false, hasTarget: false, hasAmount: false };
  it.each([
    ['a local action', none, false],
    ['a network action with no target', { ...none, network: true }, true],
    ['a network action with a target', { ...none, network: true, hasTarget: true }, false],
    ['a payment with no amount', { ...none, payment: true }, true],
    ['a payment with an amount', { ...none, payment: true, hasAmount: true }, false],
  ])('%s', (_name, action, holds) => {
    expect(missingDataReason('targets', action)?.severity === 'hold').toBe(holds);
  });
});

describe('hostAllowed', () => {
  const allowed = ['example.com', 'API.Partner.example'];
  it.each([
    ['example.com', true],
    ['EXAMPLE.com.', true],
    ['docs.example.com', true],
    ['https://docs.example.com:8443/path?q=1', true],
    ['api.partner.example', true],
    ['partner.example', false],
    ['notexample.com', false],
    ['example.com.evil.test', false],
    ['https://example.com@evil.test/', false],
    ['http://203.0.113.9/', false],
    ['', false],
  ])('%s -> %s', (host, expected) => {
    expect(hostAllowed(host, allowed)).toBe(expected);
  });

  it.each([
    ['./dist', null],
    ['/etc/hosts', null],
    ['dist', null],
    ['not a host', null],
    ['localhost', 'localhost'],
    ['https://Files.Example.com/a', 'files.example.com'],
  ])('normalizes %s', (value, expected) => {
    expect(normalizeHost(value)).toBe(expected);
  });
});
