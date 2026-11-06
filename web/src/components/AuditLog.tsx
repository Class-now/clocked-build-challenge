import type { AuditEntry } from '../lib/audit.js';
import { VERDICT_TEXT } from '../lib/verdicts.js';

export function AuditLog({ entries, onClear }: { entries: AuditEntry[]; onClear(): void }) {
  return (
    <section className="audit" aria-labelledby="audit-title">
      <h2 className="section-title" id="audit-title">Demo log</h2>
      <p className="audit__note">This is the demo log. It stays in this browser, and the buttons that fill it run nothing.</p>
      {entries.length === 0 ? (
        <p className="audit__empty">No decisions yet. Approve or reject a held or refused item to add one.</p>
      ) : (
        <>
          <ol className="audit__list">
            {entries.map((entry, i) => (
              <li key={`${entry.time}-${i}`} className="audit__entry">
                <time dateTime={entry.time}>{new Date(entry.time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</time>
                <span className="audit__scenario">{entry.scenario}</span>
                <span className="audit__outcome">{VERDICT_TEXT[entry.verdict].stamp} → {entry.decision}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="button button--quiet" onClick={onClear}>Clear the demo log</button>
        </>
      )}
    </section>
  );
}
