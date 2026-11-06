import { useEffect, useState } from 'react';
import type { GateResult } from '../../src/core/types.js';
import type { ScenarioEntry, ScenariosResponse } from '../../src/server/contract.js';
import { fetchScenarios, runReview } from './api.js';
import { AuditLog } from './components/AuditLog.js';
import { Inspection } from './components/Inspection.js';
import { Queue, orderQueue } from './components/Queue.js';
import { addEntry, loadAudit, saveAudit } from './lib/audit.js';
import type { AuditEntry } from './lib/audit.js';
import { GATE_LABELS } from './lib/verdicts.js';

export type Mode = 'recorded' | 'live';

function runCost(result: GateResult | null): string {
  if (!result) return 'No run shown';
  const { credits, modelMs } = result.totals;
  return `${credits} ${credits === 1 ? 'credit' : 'credits'} · ${modelMs} ms model time`;
}

export function App() {
  const [data, setData] = useState<ScenariosResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('recorded');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveRuns, setLiveRuns] = useState<Record<string, GateResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>(loadAudit);

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

  const resultFor = (scenario: ScenarioEntry): GateResult | null =>
    mode === 'live' ? liveRuns[scenario.id] ?? null : scenario.recording?.result ?? null;

  const updateAudit = (entries: AuditEntry[]) => {
    setAudit(entries);
    saveAudit(entries);
  };

  const runLive = async (scenario: ScenarioEntry) => {
    setMode('live');
    setRunning(scenario.id);
    setFailure(null);
    const outcome = await runReview({ scenarioId: scenario.id });
    setRunning(null);
    if (outcome.ok) setLiveRuns((runs) => ({ ...runs, [scenario.id]: outcome.value.result }));
    else setFailure(outcome.error.code);
  };

  const selected = data?.scenarios.find((s) => s.id === selectedId) ?? null;
  const shown = selected ? resultFor(selected) : null;

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
          <p className="masthead__cost"><span>This run</span> {runCost(shown)}</p>
        </div>
      </header>

      {data?.fakeData && (
        <p className="fake-banner" role="note">Fake development data. None of these results came from the Clocked API.</p>
      )}

      {loadFailed && (
        <div className="notice" role="alert">
          <p>The scenarios could not be loaded.</p>
          <button type="button" className="button" onClick={load}>Try again</button>
        </div>
      )}
      {!data && !loadFailed && <p className="loading" role="status">Opening the ledger…</p>}

      {data && (
        <div className="desk__body">
          <Queue
            items={data.scenarios.map((s) => ({ id: s.id, title: s.title, gate: s.gate, verdict: resultFor(s)?.verdict ?? null }))}
            selectedId={selectedId}
            emptyLabel={mode === 'live' ? 'Not run yet' : 'Not recorded yet'}
            onSelect={setSelectedId}
          />
          <main className="desk__main">
            {selected && (
              <>
                <header className="scenario-head">
                  <p className="scenario-head__gate">{GATE_LABELS[selected.gate]}</p>
                  <h2 className="scenario-head__title">{selected.title}</h2>
                  <p className="scenario-head__blurb">{selected.blurb}</p>
                </header>
                <Inspection
                  key={`${selected.id}-${mode}`}
                  gate={selected.gate}
                  input={selected.input}
                  result={shown}
                  placeholder={(
                    <section className="pending">
                      <p className="pending__title">{mode === 'live' ? 'Not run live yet' : 'Not recorded yet'}</p>
                      {running === selected.id
                        ? <p role="status">Running…</p>
                        : <button type="button" className="button button--strong" onClick={() => void runLive(selected)}>Run it live</button>}
                      {failure && <p role="alert">Live run failed: {failure}</p>}
                    </section>
                  )}
                  onDecide={(decision) => {
                    if (!shown) return;
                    updateAudit(addEntry(audit, { time: new Date().toISOString(), scenario: selected.title, verdict: shown.verdict, decision }));
                  }}
                />
              </>
            )}
          </main>
          <AuditLog entries={audit} onClear={() => updateAudit([])} />
        </div>
      )}
    </div>
  );
}
