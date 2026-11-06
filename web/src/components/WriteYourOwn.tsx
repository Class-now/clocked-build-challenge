import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ActionInput, ContentInput, GateKind, PolicyPack, ReportInput } from '../../../src/core/types.js';
import type { ScenarioEntry } from '../../../src/server/contract.js';
import { INPUT_CAPS } from '../../../src/server/limits.js';
import { GATE_LABELS, GATE_ORDER } from '../lib/verdicts.js';
import { orderQueue } from './Queue.js';
import type { GateInput } from './Submitted.js';

interface ActionForm { brief: string; tool: string; payload: string; outbound: boolean; }
interface ContentForm { source: string; text: string; }
interface ReportForm { brief: string; report: string; changelog: string; logs: { id: string; text: string }[]; }
interface Forms { action: ActionForm; content: ContentForm; report: ReportForm; }

const SEND_WARNING = 'This text goes to the Clocked API. Use made-up data only.';

function formsFrom(scenario: ScenarioEntry | undefined, forms: Forms): Forms {
  if (!scenario) return forms;
  if (scenario.gate === 'action') {
    const i = scenario.input as ActionInput;
    return { ...forms, action: { brief: i.brief, tool: i.tool, payload: i.payload, outbound: i.outbound === true } };
  }
  if (scenario.gate === 'content') {
    const i = scenario.input as ContentInput;
    return { ...forms, content: { source: i.source, text: i.text } };
  }
  const i = scenario.input as ReportInput;
  return { ...forms, report: { brief: i.brief, report: i.report, changelog: i.changelog, logs: i.toolLogs.map((l) => ({ ...l })) } };
}

function TextField({ label, value, cap, rows, onChange }: { label: string; value: string; cap: number; rows?: number; onChange(next: string): void }) {
  const over = value.length > cap;
  return (
    <label className="form-field">
      <span className="form-field__top">
        <span className="form-field__label">{label}</span>
        <span className={`form-field__count${over ? ' is-over' : ''}`}>{value.length.toLocaleString('en-US')} / {cap.toLocaleString('en-US')}{over ? ' (too long)' : ''}</span>
      </span>
      {rows
        ? <textarea rows={rows} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        : <input type="text" value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

export function WriteYourOwn({ scenarios, packs, running, onRun, children }: {
  scenarios: ScenarioEntry[];
  packs: PolicyPack[];
  running: boolean;
  onRun(gate: GateKind, input: GateInput): void;
  children?: ReactNode;
}) {
  const ordered = orderQueue(scenarios);
  const firstOf = (gate: GateKind) => ordered.find((s) => s.gate === gate);

  const [gate, setGate] = useState<GateKind>('action');
  const [forms, setForms] = useState<Forms>(() => GATE_ORDER.reduce(
    (built, g) => formsFrom(firstOf(g), built),
    { action: { brief: '', tool: '', payload: '', outbound: false }, content: { source: '', text: '' }, report: { brief: '', report: '', changelog: '', logs: [{ id: 'log-1', text: '' }] } } as Forms,
  ));
  const [startFrom, setStartFrom] = useState<Record<GateKind, string>>(() => ({
    action: firstOf('action')?.id ?? '', content: firstOf('content')?.id ?? '', report: firstOf('report')?.id ?? '',
  }));
  const [policyIds, setPolicyIds] = useState<Record<GateKind, string>>(() => ({
    action: firstOf('action')?.input.policy.id ?? packs[0]?.id ?? '',
    content: firstOf('content')?.input.policy.id ?? packs[0]?.id ?? '',
    report: firstOf('report')?.input.policy.id ?? packs[0]?.id ?? '',
  }));

  const chooseStart = (id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    setStartFrom((current) => ({ ...current, [gate]: id }));
    setForms((current) => formsFrom(scenario, current));
    if (scenario) setPolicyIds((current) => ({ ...current, [gate]: scenario.input.policy.id }));
  };

  const patch = <G extends GateKind>(g: G, change: Partial<Forms[G]>) => {
    setForms((current) => ({ ...current, [g]: { ...current[g], ...change } }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const policy = packs.find((p) => p.id === policyIds[gate]);
    if (!policy) return;
    if (gate === 'action') {
      const { brief, tool, payload, outbound } = forms.action;
      onRun(gate, { brief, tool, payload, policy, ...(outbound ? { outbound } : {}) });
    } else if (gate === 'content') {
      onRun(gate, { ...forms.content, policy });
    } else {
      const { brief, report, changelog, logs } = forms.report;
      onRun(gate, { brief, report, changelog, toolLogs: logs, policy });
    }
  };

  const { action, content, report } = forms;
  return (
    <div className="own">
      <header className="scenario-head">
        <h2 className="scenario-head__title">Write your own</h2>
        <p className="scenario-head__blurb">Hand the checkpoint something of your own. A run calls the Clocked API live.</p>
      </header>

      <form className="sheet own__form" onSubmit={submit}>
        <fieldset className="own__gates">
          <legend className="section-title">Which checkpoint</legend>
          {GATE_ORDER.map((g) => (
            <label key={g} className={`own__gate${gate === g ? ' is-selected' : ''}`}>
              <input type="radio" name="own-gate" checked={gate === g} onChange={() => setGate(g)} />
              {GATE_LABELS[g]}
            </label>
          ))}
        </fieldset>

        <div className="own__selects">
          <label className="form-field">
            <span className="form-field__label">Start from a scenario</span>
            <select value={startFrom[gate]} onChange={(e) => chooseStart(e.target.value)}>
              {ordered.filter((s) => s.gate === gate).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span className="form-field__label">Policy pack</span>
            <select value={policyIds[gate]} onChange={(e) => setPolicyIds((current) => ({ ...current, [gate]: e.target.value }))}>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        {gate === 'action' && (
          <>
            <TextField label="Brief" value={action.brief} cap={INPUT_CAPS.brief} rows={2} onChange={(brief) => patch('action', { brief })} />
            <TextField label="Tool" value={action.tool} cap={INPUT_CAPS.tool} onChange={(tool) => patch('action', { tool })} />
            <TextField label="Payload" value={action.payload} cap={INPUT_CAPS.payload} rows={6} onChange={(payload) => patch('action', { payload })} />
            <label className="own__check">
              <input type="checkbox" checked={action.outbound} onChange={(e) => patch('action', { outbound: e.target.checked })} />
              This action sends something outside
            </label>
          </>
        )}
        {gate === 'content' && (
          <>
            <TextField label="Source" value={content.source} cap={INPUT_CAPS.source} onChange={(source) => patch('content', { source })} />
            <TextField label="Text" value={content.text} cap={INPUT_CAPS.text} rows={8} onChange={(text) => patch('content', { text })} />
          </>
        )}
        {gate === 'report' && (
          <>
            <TextField label="Brief" value={report.brief} cap={INPUT_CAPS.brief} rows={2} onChange={(brief) => patch('report', { brief })} />
            <TextField label="Report" value={report.report} cap={INPUT_CAPS.report} rows={3} onChange={(next) => patch('report', { report: next })} />
            <TextField label="Changelog" value={report.changelog} cap={INPUT_CAPS.changelog} rows={2} onChange={(changelog) => patch('report', { changelog })} />
            {report.logs.map((log, n) => (
              <div className="own__log" key={n}>
                <TextField
                  label={`Tool log ${n + 1}`}
                  value={log.text}
                  cap={INPUT_CAPS.logText}
                  rows={3}
                  onChange={(text) => patch('report', { logs: report.logs.map((l, at) => (at === n ? { ...l, text } : l)) })}
                />
                {report.logs.length > 1 && (
                  <button type="button" className="button button--quiet" onClick={() => patch('report', { logs: report.logs.filter((_, at) => at !== n) })}>
                    Remove tool log {n + 1}
                  </button>
                )}
              </div>
            ))}
            {report.logs.length < INPUT_CAPS.logCount && (
              <button
                type="button"
                className="button button--quiet own__add"
                onClick={() => {
                  const taken = new Set(report.logs.map((l) => l.id));
                  let n = report.logs.length + 1;
                  while (taken.has(`log-${n}`)) n++;
                  patch('report', { logs: [...report.logs, { id: `log-${n}`, text: '' }] });
                }}
              >
                Add a tool log
              </button>
            )}
          </>
        )}

        <div className="own__run">
          <button type="submit" className="button button--strong" disabled={running}>{running ? 'Running…' : 'Run'}</button>
          <p>{SEND_WARNING}</p>
        </div>
      </form>

      {children}
    </div>
  );
}
