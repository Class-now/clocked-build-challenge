import { useEffect, useRef, useState } from 'react';
import type { ActionInput, ContentInput, GateKind, GateResult, ReportInput } from '../../src/core/types.js';
import type { ScenarioEntry, ScenariosResponse } from '../../src/server/contract.js';
import { fetchScenarios, runReview } from './api.js';
import type { ReviewBody } from './api.js';
import { AuditLog } from './components/AuditLog.js';
import { HowItWorks } from './components/HowItWorks.js';
import { Inspection } from './components/Inspection.js';
import { Queue, orderQueue } from './components/Queue.js';
import { RunProgress } from './components/RunProgress.js';
import type { GateInput } from './components/Submitted.js';
import { WriteYourOwn } from './components/WriteYourOwn.js';
import { addEntry, loadAudit, saveAudit } from './lib/audit.js';
import type { AuditEntry } from './lib/audit.js';
import { describeFailure } from './lib/failures.js';
import type { FailureNotice } from './lib/failures.js';
import { GATE_LABELS } from './lib/verdicts.js';

export type Mode = 'recorded' | 'live';
type Tab = 'queue' | 'own';
type Notice = FailureNotice & { retry?: () => void };
interface CustomRun { id: number; gate: GateKind; input: GateInput; result: GateResult; }

function runCost(result: GateResult | null): string {
  if (!result) return 'no run shown';
  const { credits, modelMs } = result.totals;
  return `${credits} ${credits === 1 ? 'credit' : 'credits'} · ${modelMs} ms model time`;
}

/** The policy goes by id, so a visitor cannot grow the request with a pack of their own. */
function customBody(gate: GateKind, input: GateInput): ReviewBody {
  const { policy, ...rest } = input as (ActionInput | ContentInput | ReportInput);
  return { gate, input: { ...rest, policy: policy.id } };
}

export function App() {
  const [data, setData] = useState<ScenariosResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('recorded');
  const [tab, setTab] = useState<Tab>('queue');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveRuns, setLiveRuns] = useState<Record<string, GateResult>>({});
  const [customRun, setCustomRun] = useState<CustomRun | null>(null);
  const [running, setRunning] = useState<{ gate: GateKind; scenarioId: string | null } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>(loadAudit);
  const noticeRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoadFailed(false);
    fetchScenarios().then(
      (response) => {
        setData(response);
        setSelectedId((current) => current ?? orderQueue(response.scenarios)[0]?.id ?? null);
      },
      () => setLoadFailed(true),
    );
  };
  useEffect(load, []);

  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [notice]);

  const resultFor = (scenario: ScenarioEntry): GateResult | null =>
    mode === 'live' ? liveRuns[scenario.id] ?? null : scenario.recording?.result ?? null;

  const log = (name: string, result: GateResult, decision: AuditEntry['decision']) => {
    const entries = addEntry(audit, { time: new Date().toISOString(), scenario: name, verdict: result.verdict, decision });
    setAudit(entries);
    saveAudit(entries);
  };

  const execute = async (body: ReviewBody, gate: GateKind, scenarioId: string | null, onDone: (result: GateResult) => void): Promise<void> => {
    setMode('live');
    setRunning({ gate, scenarioId });
    setNotice(null);
    const outcome = await runReview(body);
    setRunning(null);
    if (outcome.ok) {
      onDone(outcome.value.result);
      return;
    }
    const failure = describeFailure(outcome.error);
    if (failure.backToRecorded) setMode('recorded');
    setNotice({ ...failure, ...(failure.canRetry ? { retry: () => void execute(body, gate, scenarioId, onDone) } : {}) });
  };

  const runScenario = (scenario: ScenarioEntry) => execute(
    { scenarioId: scenario.id },
    scenario.gate,
    scenario.id,
    (result) => setLiveRuns((runs) => ({ ...runs, [scenario.id]: result })),
  );

  const runCustom = (gate: GateKind, input: GateInput) => execute(
    customBody(gate, input),
    gate,
    null,
    (result) => setCustomRun((last) => ({ id: (last?.id ?? 0) + 1, gate, input, result })),
  );

  const selected = data?.scenarios.find((s) => s.id === selectedId) ?? null;
  const scenarioResult = selected ? resultFor(selected) : null;
  const shownResult = tab === 'own' ? customRun?.result ?? null : scenarioResult;
  const isBusy = running !== null;

  return (
    <div className="desk">
      <header className="masthead">
        <div className="masthead__name">
          <h1 className="wordmark">Gatehouse</h1>
          <p className="masthead__line">Gatehouse stops an AI agent before it runs a bad command, reads a poisoned page, or reports work it did not do.</p>
        </div>
        <div className="masthead__run">
          <div className="mode" role="group" aria-label="Where results come from">
            <button type="button" aria-pressed={mode === 'recorded'} onClick={() => setMode('recorded')}>Recorded</button>
            <button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live</button>
          </div>
          <p className="masthead__cost"><span>This run</span> {runCost(shownResult)}</p>
        </div>
      </header>

      {data?.fakeData && (
        <p className="fake-banner" role="note">Fake development data. None of these results came from the Clocked API.</p>
      )}

      {loadFailed && (
        <div className="notice" role="alert">
          <p>The scenarios could not be loaded, so there is nothing to show yet.</p>
          <button type="button" className="button" onClick={load}>Try again</button>
        </div>
      )}
      {!data && !loadFailed && <p className="loading" role="status">Opening the ledger…</p>}

      {data && (
        <div className="desk__body">
          <Queue
            items={data.scenarios.map((s) => ({ id: s.id, title: s.title, gate: s.gate, verdict: resultFor(s)?.verdict ?? null }))}
            selectedId={tab === 'queue' ? selectedId : null}
            emptyLabel={mode === 'live' ? 'Not run live yet' : 'Not recorded yet'}
            onSelect={(id) => {
              setSelectedId(id);
              setTab('queue');
              setNotice(null);
            }}
          />
          <main className="desk__main">
            <div className="tabs" role="tablist" aria-label="What to look at">
              <button type="button" role="tab" id="tab-queue" aria-selected={tab === 'queue'} aria-controls="panel-queue" onClick={() => setTab('queue')}>Inspection</button>
              <button type="button" role="tab" id="tab-own" aria-selected={tab === 'own'} aria-controls="panel-own" onClick={() => setTab('own')}>Write your own</button>
            </div>

            {notice && (
              <div className="notice" role="alert" ref={noticeRef}>
                <p>{notice.message}</p>
                {notice.details && <ul className="notice__details">{notice.details.map((d) => <li key={d}>{d}</li>)}</ul>}
                <div className="notice__actions">
                  {notice.retry && <button type="button" className="button button--strong" onClick={notice.retry}>Try again</button>}
                  <button type="button" className="button button--quiet" onClick={() => setNotice(null)}>Dismiss</button>
                </div>
              </div>
            )}

            <div role="tabpanel" id="panel-queue" aria-labelledby="tab-queue" hidden={tab !== 'queue'}>
              {selected && (
                <>
                  <header className="scenario-head">
                    <p className="scenario-head__gate">{GATE_LABELS[selected.gate]}</p>
                    <h2 className="scenario-head__title">{selected.title}</h2>
                    <p className="scenario-head__blurb">{selected.blurb}</p>
                    <p className="scenario-head__source">
                      {mode === 'recorded' && selected.recording && `Recorded ${selected.recording.recordedAt.slice(0, 10)}. No request is made when you open it.`}
                      {mode === 'live' && liveRuns[selected.id] && !isBusy && (
                        <button type="button" className="button button--quiet" onClick={() => void runScenario(selected)}>Run it live again</button>
                      )}
                    </p>
                  </header>
                  <Inspection
                    key={`${selected.id}-${mode}`}
                    gate={selected.gate}
                    input={selected.input}
                    result={running?.scenarioId === selected.id ? null : scenarioResult}
                    placeholder={running?.scenarioId === selected.id ? <RunProgress gate={selected.gate} /> : (
                      <section className="pending">
                        <p className="pending__title">{mode === 'live' ? 'Not run live yet' : 'Not recorded yet'}</p>
                        <p className="pending__note">A live run sends this made-up scenario to the Clocked API and spends credits.</p>
                        <div className="pending__actions">
                          <button type="button" className="button button--strong" disabled={isBusy} onClick={() => void runScenario(selected)}>Run it live</button>
                          {mode === 'live' && selected.recording && (
                            <button type="button" className="button" onClick={() => setMode('recorded')}>Show the recording</button>
                          )}
                        </div>
                      </section>
                    )}
                    onDecide={(decision) => {
                      if (scenarioResult) log(selected.title, scenarioResult, decision);
                    }}
                  />
                </>
              )}
            </div>

            <div role="tabpanel" id="panel-own" aria-labelledby="tab-own" hidden={tab !== 'own'}>
              <WriteYourOwn scenarios={data.scenarios} packs={data.packs} running={isBusy} onRun={(gate, input) => void runCustom(gate, input)}>
                {running && running.scenarioId === null && <RunProgress gate={running.gate} />}
                {customRun && !(running && running.scenarioId === null) && (
                  <div className="own__result">
                    <h3 className="section-title">Your run</h3>
                    <Inspection
                      key={customRun.id}
                      gate={customRun.gate}
                      input={customRun.input}
                      result={customRun.result}
                      onDecide={(decision) => log(`Your own: ${GATE_LABELS[customRun.gate]}`, customRun.result, decision)}
                    />
                  </div>
                )}
              </WriteYourOwn>
            </div>

            <HowItWorks />
          </main>
          <AuditLog entries={audit} onClear={() => { setAudit([]); saveAudit([]); }} />
        </div>
      )}
    </div>
  );
}
