// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRESHOLDS } from '../../src/core/policy.js';
import { SCENARIOS } from '../../src/scenarios/index.js';
import { INPUT_CAPS } from '../../src/server/limits.js';
import { App } from './App.js';
import { json, recordedResponse, responseWith, stubApi } from './testSupport.js';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openApp = async () => {
  render(<App />);
  await screen.findByRole('navigation', { name: 'Scenario queue' });
};
const openOwn = async () => {
  await openApp();
  fireEvent.click(screen.getByRole('tab', { name: 'Write your own' }));
};
const field = (name: string) => screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement;
const run = () => fireEvent.click(screen.getByRole('button', { name: 'Run' }));
const sentBody = (fetchMock: ReturnType<typeof stubApi>) => {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/review')!;
  return JSON.parse(String(call[1]!.body));
};
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const success = async (id = 'a-defender') => {
  const recording = (await recordedResponse()).scenarios.find((s) => s.id === id)!.recording!;
  return { result: recording.result, scenarioId: id, ranAt: '2026-11-07T00:00:00.000Z' };
};

describe('the Write your own forms', () => {
  it('prefills from the first scenario of the gate', async () => {
    stubApi(responseWith({}));
    await openOwn();
    const defender = SCENARIOS.find((s) => s.id === 'a-defender')!;
    expect(field('Payload').value).toBe((defender.input as { payload: string }).payload);
    expect(screen.getByRole('radio', { name: 'Before it acts' })).toHaveProperty('checked', true);
  });

  it('offers only the scenarios of the chosen gate, and choosing one refills the form and the pack', async () => {
    stubApi(responseWith({}));
    await openOwn();
    fireEvent.click(screen.getByRole('radio', { name: 'Before it reads' }));
    const start = field('Start from a scenario');
    const contents = SCENARIOS.filter((s) => s.gate === 'content');
    expect(within(start as unknown as HTMLElement).getAllByRole('option').map((o) => o.textContent).sort())
      .toEqual(contents.map((s) => s.title).sort());
    const pick = contents[contents.length - 1]!;
    fireEvent.change(start, { target: { value: pick.id } });
    expect(field('Text').value).toBe((pick.input as { text: string }).text);
    expect(field('Policy pack').value).toBe(pick.input.policy.id);
  });

  it('has three different forms', async () => {
    stubApi(responseWith({}));
    await openOwn();
    expect(field('Tool')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Before it reads' }));
    expect(field('Source')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Before it reports done' }));
    expect(field('Changelog')).toBeTruthy();
    expect(field('Tool log 1')).toBeTruthy();
  });

  it('adds tool logs up to the cap and removes them', async () => {
    stubApi(responseWith({}));
    await openOwn();
    fireEvent.click(screen.getByRole('radio', { name: 'Before it reports done' }));
    let guard = 0;
    while (screen.queryByRole('button', { name: 'Add a tool log' }) && guard++ < 10) {
      fireEvent.click(screen.getByRole('button', { name: 'Add a tool log' }));
    }
    expect(screen.getAllByLabelText(/^Tool log \d/)).toHaveLength(INPUT_CAPS.logCount);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tool log 1' }));
    expect(screen.getAllByLabelText(/^Tool log \d/)).toHaveLength(INPUT_CAPS.logCount - 1);
    expect(screen.getByRole('button', { name: 'Add a tool log' })).toBeTruthy();
  });

  it('says beside the Run button that the text goes to the Clocked API and should be made up', async () => {
    stubApi(responseWith({}));
    await openOwn();
    const line = screen.getByRole('button', { name: 'Run' }).parentElement!.textContent!;
    expect(line).toMatch(/goes to the Clocked API/);
    expect(line).toMatch(/made-up data/);
  });

  it('shows the count against the cap and marks a field that is too long', async () => {
    stubApi(responseWith({}));
    await openOwn();
    fireEvent.change(field('Tool'), { target: { value: 'x'.repeat(INPUT_CAPS.tool + 1) } });
    expect(screen.getByText(/101 \/ 100 \(too long\)/)).toBeTruthy();
  });

  it('sends the edited text with the chosen pack by id, and shows the verdict', async () => {
    const answer = await success();
    const scenarios = await recordedResponse();
    const fetchMock = stubApi(scenarios, () => json(200, answer));
    await openOwn();
    const pack = scenarios.packs[1]!;
    fireEvent.change(field('Payload'), { target: { value: 'echo made up' } });
    fireEvent.change(field('Tool'), { target: { value: 'bash' } });
    fireEvent.change(field('Brief'), { target: { value: 'Say hello.' } });
    fireEvent.change(field('Policy pack'), { target: { value: pack.id } });
    run();
    const heading = await screen.findByRole('heading', { name: 'Your run' });
    expect(sentBody(fetchMock)).toEqual({ gate: 'action', input: { brief: 'Say hello.', tool: 'bash', payload: 'echo made up', policy: pack.id } });
    expect(within(heading.parentElement!).getByRole('region', { name: 'Verdict' })).toBeTruthy();
    const { credits } = answer.result.totals;
    expect(screen.getByText('This run').parentElement!.textContent).toContain(`${credits} credit`);
  });

  it('sends a report with its tool logs', async () => {
    const fetchMock = stubApi(responseWith({}), () => json(503, { code: 'live_off' }));
    await openOwn();
    fireEvent.click(screen.getByRole('radio', { name: 'Before it reports done' }));
    run();
    await screen.findByRole('alert');
    const body = sentBody(fetchMock);
    expect(body.gate).toBe('report');
    expect(body.input.toolLogs.length).toBeGreaterThan(0);
    expect(typeof body.input.policy).toBe('string');
  });
});

describe('while a run is in progress', () => {
  const pending = () => {
    let finish!: (response: Response) => void;
    const answer = new Promise<Response>((resolve) => { finish = resolve; });
    return { answer, finish };
  };

  it.each([
    ['Before it acts', ['rerank', 'script', 'extract', 'decide', 'pii', 'fill']],
    ['Before it reads', ['pipeline', 'decide']],
    ['Before it reports done', ['grounding', 'compare', 'decide', 'fill']],
  ])('lists what "%s" will call, with no progress figures', async (gateLabel, endpoints) => {
    const { answer, finish } = pending();
    stubApi(responseWith({}), () => answer);
    await openOwn();
    fireEvent.click(screen.getByRole('radio', { name: gateLabel }));
    run();
    const status = await screen.findByRole('status', { name: 'Running' });
    expect(within(status).getAllByRole('listitem').map((li) => li.querySelector('.tag')!.textContent)).toEqual(endpoints);
    expect(status.textContent).not.toMatch(/\d/);
    expect(within(status).queryByRole('progressbar')).toBeNull();
    expect((screen.getByRole('button', { name: 'Running…' }) as HTMLButtonElement).disabled).toBe(true);
    finish(json(503, { code: 'live_off' }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Running' })).toBeNull());
  });

  it('shows the same state for a scenario run live', async () => {
    const { answer, finish } = pending();
    stubApi(responseWith({}), () => answer);
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Run it live' }));
    expect(await screen.findByRole('status', { name: 'Running' })).toBeTruthy();
    finish(json(200, await success()));
    expect(await screen.findByRole('region', { name: 'Verdict' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run it live again' })).toBeTruthy();
  });
});

describe('live failures', () => {
  const failWith = async (status: number, body: unknown) => {
    const fetchMock = stubApi(responseWith({}), () => json(status, body));
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Run it live' }));
    const alert = await screen.findByRole('alert');
    return { fetchMock, alert };
  };

  it('live_off goes back to recorded and says why', async () => {
    const { alert } = await failWith(503, { code: 'live_off' });
    expect(alert.textContent).toMatch(/Live runs are off/);
    expect(alert.textContent).toMatch(/recordings/);
    expect(pressed('Recorded')).toBe('true');
  });

  it('out_of_credits goes back to recorded and says why', async () => {
    const { alert } = await failWith(503, { code: 'out_of_credits' });
    expect(alert.textContent).toMatch(/used up its Clocked credits/);
    expect(pressed('Recorded')).toBe('true');
  });

  it.each([
    [45, /about 45 seconds/],
    [600, /about 10 minutes/],
    [7200, /about 2 hours/],
  ])('rate_limited with %i seconds says when to retry', async (retryAfterSeconds, words) => {
    const { alert } = await failWith(429, { code: 'rate_limited', retryAfterSeconds });
    expect(alert.textContent).toMatch(words);
    expect(pressed('Live')).toBe('true');
  });

  it.each([
    ['payload', 8000, /The payload is too long.*8,000 characters/],
    ['toolLogs[2].text', 4000, /Tool log 3 is too long.*4,000 characters/],
    ['toolLogs[0].id', 100, /The name of tool log 1 is too long/],
    ['toolLogs', 6, /too many tool logs.*6/],
  ])('413 on %s names the field', async (name, limit, words) => {
    const { alert } = await failWith(413, { code: 'too_long', field: name, limit });
    expect(alert.textContent).toMatch(words);
  });

  it('bad_request lists what to change', async () => {
    const { alert } = await failWith(400, { code: 'bad_request', problems: ['tool is required'] });
    expect(within(alert).getByText('tool is required')).toBeTruthy();
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it.each(['internal', 'unknown_scenario'])('%s gets a plain sentence and a retry', async (code) => {
    const { alert } = await failWith(500, { code });
    expect(alert.textContent).toMatch(/nothing ran/);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a network error offers a retry that repeats the same request', async () => {
    const answer = await success();
    const scenarios = responseWith({});
    let calls = 0;
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/scenarios') return json(200, scenarios);
      calls++;
      if (calls === 1) throw new TypeError('offline');
      return json(200, answer);
    });
    vi.stubGlobal('fetch', fetchMock);
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Run it live' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be reached/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Verdict' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const bodies = fetchMock.mock.calls.filter(([url]) => url === '/api/review').map(([, init]) => init!.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('the failure can be dismissed', async () => {
    const { alert } = await failWith(429, { code: 'rate_limited', retryAfterSeconds: 60 });
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed custom run keeps what was typed', async () => {
    stubApi(responseWith({}), () => json(413, { code: 'too_long', field: 'payload', limit: 8000 }));
    await openOwn();
    fireEvent.change(field('Payload'), { target: { value: 'my words' } });
    run();
    await screen.findByRole('alert');
    expect(field('Payload').value).toBe('my words');
  });

  it('a missing recording says not recorded yet and offers a live run', async () => {
    stubApi(responseWith({}));
    await openApp();
    expect(screen.getAllByText('Not recorded yet').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Run it live' })).toBeTruthy();
  });
});

describe('How the verdict is made', () => {
  const panel = () => screen.getByText('How the verdict is made').closest('details')!;

  it('is collapsed by default', async () => {
    stubApi(responseWith({}));
    await openApp();
    expect(panel().open).toBe(false);
  });

  it('lists every value from THRESHOLDS', async () => {
    stubApi(responseWith({}));
    await openApp();
    const numbers = [...panel().querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(numbers).toEqual([
      `Below ${THRESHOLDS.uncertainLow.toFixed(2)}`,
      `${THRESHOLDS.uncertainLow.toFixed(2)} up to ${THRESHOLDS.refuseAt.toFixed(2)}`,
      `${THRESHOLDS.refuseAt.toFixed(2)} and above`,
      `${THRESHOLDS.instructsAgent.toFixed(2)} and above`,
      `${THRESHOLDS.rollbackConfident.toFixed(2)} and above`,
    ]);
    const shown = new Set(panel().querySelector('dl')!.textContent!.match(/\d\.\d\d/g));
    for (const value of Object.values(THRESHOLDS)) expect(shown.has(value.toFixed(2))).toBe(true);
  });

  it('states the rules', async () => {
    stubApi(responseWith({}));
    await openApp();
    const text = panel().textContent!;
    expect(text).toMatch(/Uncertain never clears/);
    expect(text).toMatch(/A failed safety check holds/);
    expect(text).toMatch(/A benign detector verdict alone authorises nothing/);
  });
});
