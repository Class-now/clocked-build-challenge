import { Fragment } from 'react';
import type { ActionInput, ContentInput, GateKind, PolicyPack, ReportInput } from '../../../src/core/types.js';
import { segmentText, strongestTone } from '../lib/segments.js';
import type { Evidence } from '../lib/segments.js';

export type GateInput = ActionInput | ContentInput | ReportInput;

interface Marking {
  evidence: Map<string, Evidence[]>;
  activeCheck: string | null;
  onSpan(id: string | null): void;
  onSpanOpen(id: string): void;
}

function Marked({ text, field, marking }: { text: string; field: string; marking: Marking }) {
  const segments = segmentText(text, marking.evidence.get(field) ?? []);
  return (
    <>
      {segments.map((segment, i) => {
        const first = segment.evidence[0];
        if (!first) return <Fragment key={i}>{segment.text}</Fragment>;
        const active = segment.evidence.some((e) => e.checkId === marking.activeCheck);
        const labels = [...new Set(segment.evidence.map((e) => e.span.label).filter(Boolean))].join(', ');
        const titles = [...new Set(segment.evidence.map((e) => e.checkTitle))].join(', ');
        return (
          <mark
            key={i}
            className={`span span--${strongestTone(segment.evidence)}${active ? ' is-active' : ''}`}
            data-check-ids={segment.evidence.map((e) => e.checkId).join(' ')}
            title={`${titles}${labels ? `: ${labels}` : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Evidence for the check "${titles}"${labels ? `, ${labels}` : ''}: ${segment.text}`}
            onMouseEnter={() => marking.onSpan(first.checkId)}
            onMouseLeave={() => marking.onSpan(null)}
            onFocus={() => marking.onSpan(first.checkId)}
            onBlur={() => marking.onSpan(null)}
            onClick={() => marking.onSpanOpen(first.checkId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                marking.onSpanOpen(first.checkId);
              }
            }}
          >
            {segment.text}
          </mark>
        );
      })}
    </>
  );
}

function Field({ label, field, text, marking }: { label: string; field: string; text: string; marking: Marking }) {
  return (
    <div className="field">
      <h4 className="field__label">{label}</h4>
      <pre className="evidence-text"><Marked text={text} field={field} marking={marking} /></pre>
    </div>
  );
}

function PolicyNote({ policy }: { policy: PolicyPack }) {
  return (
    <details className="policy">
      <summary>Policy: {policy.name} ({policy.clauses.length} clauses)</summary>
      <ul>
        {policy.clauses.map((clause) => (
          <li key={clause.id}><span className="tag">{clause.id}</span> {clause.text}</li>
        ))}
      </ul>
      <p>Allowed hosts: <span className="mono">{policy.allowedHosts.join(', ')}</span></p>
    </details>
  );
}

export function Submitted({ gate, input, ...marking }: { gate: GateKind; input: GateInput } & Marking) {
  let fields;
  if (gate === 'action') {
    const i = input as ActionInput;
    fields = (
      <>
        <Field label="Brief" field="brief" text={i.brief} marking={marking} />
        <Field label={`Tool: ${i.tool}${i.outbound ? ' (sends outside)' : ''}`} field="payload" text={i.payload} marking={marking} />
      </>
    );
  } else if (gate === 'content') {
    const i = input as ContentInput;
    fields = (
      <>
        <Field label="Source" field="source" text={i.source} marking={marking} />
        <Field label="Text" field="text" text={i.text} marking={marking} />
      </>
    );
  } else {
    const i = input as ReportInput;
    fields = (
      <>
        <Field label="Brief" field="brief" text={i.brief} marking={marking} />
        <Field label="Report" field="report" text={i.report} marking={marking} />
        <Field label="Changelog" field="changelog" text={i.changelog} marking={marking} />
        {i.toolLogs.map((log) => (
          <Field key={log.id} label={`Tool log: ${log.id}`} field={`toolLogs.${log.id}`} text={log.text} marking={marking} />
        ))}
      </>
    );
  }
  return (
    <>
      {fields}
      <PolicyNote policy={input.policy} />
    </>
  );
}

/** The text a forwarded copy was made from, for the diff. */
export function originalText(gate: GateKind, input: GateInput): string | null {
  if (gate === 'action') return (input as ActionInput).payload;
  if (gate === 'content') return (input as ContentInput).text;
  return null;
}
