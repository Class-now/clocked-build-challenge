// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGate } from '../../src/core/index.js';
import { SCENARIOS } from '../../src/scenarios/index.js';
import { constantTransport } from '../../src/server/__fixtures__/fakeRecordings.js';
import { App } from './App.js';
import { Inspection } from './components/Inspection.js';
import { AUDIT_KEY } from './lib/audit.js';
import { recordedResponse, responseWith, stubApi } from './testSupport.js';

const scrollIntoView = vi.fn();

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openApp = async () => {
  render(<App />);
  await screen.findByRole('navigation', { name: 'Scenario queue' });
};
const queueRow = (name: RegExp) => within(screen.getByRole('navigation', { name: 'Scenario queue' })).getByRole('button', { name });
const verdict = () => within(screen.getByRole('region', { name: 'Verdict' })).getByRole('img');

describe('the first paint', () => {
  it('selects a-defender and shows a REFUSED stamp and evidence', async () => {
    stubApi(await recordedResponse());
    await openApp();
    expect(queueRow(/printer fix/).getAttribute('aria-current')).toBe('true');
    expect(verdict().getAttribute('aria-label')).toBe('Verdict: Refused');
    const mark = screen.getByRole('button', { name: /Evidence for the check "Inspect the script"/ });
    expect(mark.textContent).toBe('Set-MpPreference -DisableRealtimeMonitoring $true');
  });

  it('puts a-defender first in the queue, grouped for a person', async () => {
    stubApi(await recordedResponse());
    await openApp();
    const nav = screen.getByRole('navigation', { name: 'Scenario queue' });
    expect(within(nav).getAllByRole('button')[0]!.textContent).toContain('A printer fix');
    for (const label of ['Before it acts', 'Before it reads', 'Before it reports done']) {
      expect(within(nav).getByRole('heading', { name: label })).toBeTruthy();
    }
  });

  it('shows the credit count of the run on screen', async () => {
    stubApi(await recordedResponse());
    await openApp();
    expect(screen.getByText(/This run/).parentElement?.textContent).toMatch(/\d+ credits/);
  });
});

describe('recorded mode', () => {
  it('shows a result on selection with no network call beyond the first load', async () => {
    const fetchMock = stubApi(await recordedResponse());
    await openApp();
    for (const row of [/hidden note/, /An honest report/, /A refund over/, /vendor update/]) fireEvent.click(queueRow(row));
    expect(verdict().getAttribute('aria-label')).toContain('Cleared, with personal data redacted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a-tests', /Run the unit tests/, 'CLEARED', 'Verdict: Cleared'],
    ['a-email-pii', /vendor update/, 'CLEARED · REDACTED', 'Verdict: Cleared, with personal data redacted'],
    ['a-refund-big', /A refund over/, 'HELD', 'Verdict: Held for a person'],
    ['r-false-tests', /two failures/, 'REFUSED', 'Verdict: Refused'],
  ])('renders the verdict of %s with a text alternative', async (_id, row, stamp, alt) => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(row));
    expect(verdict().getAttribute('aria-label')).toBe(alt);
    expect(verdict().textContent).toBe(stamp);
  });

  it('moves through the queue with the arrow keys', async () => {
    stubApi(await recordedResponse());
    await openApp();
    const first = queueRow(/printer fix/);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(queueRow(/Run the unit tests/).getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(queueRow(/Run the unit tests/));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(queueRow(/printer fix/).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(queueRow(/A deploy nobody logged/).getAttribute('aria-current')).toBe('true');
  });

  it('offers a live run for a scenario with no recording', async () => {
    stubApi(responseWith({}));
    await openApp();
    expect(screen.getAllByText('Not recorded yet').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: /run it live/i })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Verdict' })).toBeNull();
    expect(screen.getByText('Tool: powershell')).toBeTruthy();
  });
});

describe('evidence', () => {
  const mark = () => screen.getByRole('button', { name: /Evidence for the check "Inspect the script"/ });
  const row = () => document.getElementById('check-script-risk')!;

  it('highlights the spans of a hovered check', async () => {
    stubApi(await recordedResponse());
    await openApp();
    expect(mark().className).not.toContain('is-active');
    fireEvent.mouseEnter(row());
    expect(mark().className).toContain('is-active');
    fireEvent.mouseLeave(row());
    expect(mark().className).not.toContain('is-active');
    fireEvent.mouseEnter(document.getElementById('check-policy-match')!);
    expect(mark().className).not.toContain('is-active');
  });

  it('marks and scrolls to the check of a hovered span', async () => {
    stubApi(await recordedResponse());
    await openApp();
    scrollIntoView.mockClear();
    fireEvent.mouseEnter(mark());
    expect(row().className).toContain('is-active');
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(row()));
  });

  it('moves focus to the check when a span is opened with the keyboard', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.keyDown(mark(), { key: 'Enter' });
    expect(document.activeElement).toBe(row());
  });
});

describe('the ledger', () => {
  it('names the effect of every check and gives each its cost', async () => {
    stubApi(await recordedResponse());
    await openApp();
    const row = document.getElementById('check-script-risk')!;
    expect(within(row).getByText('script')).toBeTruthy();
    expect(within(row).getByText('Effect on the verdict')).toBeTruthy();
    expect(row.textContent).toMatch(/\d+ ms · \d+ credits/);
    expect(row.querySelector('details pre')?.textContent).toContain('"malicious"');
  });

  it('says why a check was skipped', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(/A refund over/));
    const row = document.getElementById('check-outbound-pii')!;
    expect(row.className).toContain('check--skipped');
    expect(row.textContent).toContain('Skipped: This action sends nothing out');
  });

  it('makes a failed check loud and says the gate failed closed', async () => {
    const scenario = SCENARIOS.find((s) => s.id === 'a-tests')!;
    const result = await runGate(scenario, constantTransport({ ok: false, status: 500, data: null, error: 'upstream failure' }));
    render(<Inspection gate={scenario.gate} input={scenario.input} result={result} onDecide={() => undefined} />);
    const row = document.getElementById('check-script-risk')!;
    expect(row.className).toContain('check--failed');
    expect(row.textContent).toContain('This check failed.');
    expect(row.textContent).toContain('The gate failed closed');
    expect(row.textContent).toContain('upstream failure');
    expect(within(screen.getByRole('region', { name: 'Verdict' })).getByRole('img').getAttribute('aria-label')).toBe('Verdict: Held for a person');
  });
});

describe('what comes out', () => {
  const block = () => screen.getByRole('region', { name: 'What the agent or recipient receives' });

  it('shows redacted forward text with removed values and placeholders', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(/vendor update/));
    const out = block();
    const removed = [...out.querySelectorAll('pre del')].map((d) => d.textContent);
    const placed = [...out.querySelectorAll('pre ins')].map((i) => i.textContent);
    expect(removed).toEqual(['removed: +1 202 555 0142', 'removed: 14 March 1985']);
    expect(placed).toEqual(['placeholder: <PHONE>', 'placeholder: <DATE_OF_BIRTH>']);
  });

  it('says nothing is received when the content gate refuses', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(/hidden note/));
    expect(within(block()).getByText('Nothing. The content is quarantined.')).toBeTruthy();
  });

  it('has no block for a cleared action that sends nothing', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(/Run the unit tests/));
    expect(screen.queryByRole('region', { name: 'What the agent or recipient receives' })).toBeNull();
  });
});

describe('the review card and the demo log', () => {
  const stored = () => JSON.parse(localStorage.getItem(AUDIT_KEY) ?? '[]');

  it('shows the card with its facts', async () => {
    stubApi(await recordedResponse());
    await openApp();
    const card = screen.getByRole('region', { name: 'For the person on call' });
    expect(card.textContent).toContain('turn off real-time malware scanning');
    for (const label of ['System', 'Risk', 'Rollback', 'Decision needed']) expect(within(card).getByText(label)).toBeTruthy();
  });

  it('has no card for a cleared scenario', async () => {
    stubApi(await recordedResponse());
    await openApp();
    fireEvent.click(queueRow(/Run the unit tests/));
    expect(screen.queryByRole('region', { name: 'For the person on call' })).toBeNull();
  });

  it('writes decisions to a log that survives a reload, and clears it', async () => {
    stubApi(await recordedResponse());
    await openApp();
    expect(screen.getByText(/This is the demo log/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    fireEvent.click(queueRow(/A refund over/));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(stored().map((e: any) => [e.scenario, e.verdict, e.decision])).toEqual([
      ['A refund over the limit', 'HELD', 'Rejected'],
      ['A printer fix that disables Defender', 'REFUSED', 'Approved once'],
    ]);

    cleanup();
    await openApp();
    const log = screen.getByRole('region', { name: 'Demo log' });
    expect(log.textContent).toContain('A refund over the limit');
    expect(log.textContent).toContain('HELD → Rejected');
    expect(log.querySelector('time')).toBeTruthy();

    fireEvent.click(within(log).getByRole('button', { name: /clear/i }));
    expect(localStorage.getItem(AUDIT_KEY)).toBeNull();
    expect(log.textContent).toContain('No decisions yet');
  });

  it('survives storage holding something unreadable', async () => {
    localStorage.setItem(AUDIT_KEY, '{not json');
    stubApi(await recordedResponse());
    await openApp();
    expect(screen.getByText(/No decisions yet/)).toBeTruthy();
  });
});

describe('loading', () => {
  it('offers another try when the first load fails', async () => {
    const good = await recordedResponse();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    stubApi(good);
    await act(async () => { fireEvent.click(retry); });
    await screen.findByRole('navigation', { name: 'Scenario queue' });
  });
});
