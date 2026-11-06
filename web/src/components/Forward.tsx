import type { GateResult } from '../../../src/core/types.js';
import { forwardDiff } from '../lib/forwardDiff.js';

const TITLE = 'What the agent or recipient receives';

export function Forward({ result, original }: { result: GateResult; original: string | null }) {
  if (result.forwardText === undefined) {
    if (result.gate !== 'content') return null;
    if (result.verdict !== 'REFUSED' && result.verdict !== 'HELD') return null;
    return (
      <section className="forward forward--nothing" aria-label={TITLE}>
        <h3 className="section-title">{TITLE}</h3>
        <p className="forward__nothing">
          {result.verdict === 'REFUSED' ? 'Nothing. The content is quarantined.' : 'Nothing yet. The content waits for a person.'}
        </p>
      </section>
    );
  }

  const replaced = result.checks.filter((c) => c.transformed).flatMap((c) => c.spans);
  const parts = original === null ? [{ kind: 'same' as const, text: result.forwardText }] : forwardDiff(original, result.forwardText, replaced);
  const hasReplacement = parts.some((p) => p.kind === 'placeholder');
  return (
    <section className="forward" aria-label={TITLE}>
      <h3 className="section-title">{TITLE}</h3>
      {hasReplacement && (
        <p className="forward__legend">
          <del>struck through</del> never leaves the gate. <ins className="diff-placeholder">Placeholder</ins> takes its place.
        </p>
      )}
      <pre className="evidence-text forward__text">
        {parts.map((part, i) => {
          switch (part.kind) {
            case 'removed':
              return <del key={i} className="diff-removed"><span className="visually-hidden">removed: </span>{part.text}</del>;
            case 'placeholder':
              return <ins key={i} className="diff-placeholder"><span className="visually-hidden">placeholder: </span>{part.text}</ins>;
            case 'added':
              return <ins key={i} className="diff-added"><span className="visually-hidden">added by the gate: </span>{part.text}</ins>;
            default:
              return <span key={i}>{part.text}</span>;
          }
        })}
      </pre>
    </section>
  );
}
