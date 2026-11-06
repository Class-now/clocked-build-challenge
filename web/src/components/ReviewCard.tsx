import { useState } from 'react';
import type { ReviewCard as Card } from '../../../src/core/types.js';

function known(value: string | null): string {
  return value ?? 'Unknown';
}

function rollback(value: boolean | null): string {
  if (value === null) return 'Unknown';
  return value ? 'Yes, it can be undone' : 'No, it cannot be undone';
}

export function ReviewCard({ card, onDecide }: { card: Card; onDecide(decision: 'Approved once' | 'Rejected'): void }) {
  const [logged, setLogged] = useState<string | null>(null);
  const decide = (decision: 'Approved once' | 'Rejected') => {
    onDecide(decision);
    setLogged(decision);
  };
  return (
    <section className="card" aria-labelledby="card-title">
      <h3 className="section-title" id="card-title">For the person on call</h3>
      <p className="card__summary">{card.summary}</p>
      <dl className="card__facts">
        <div><dt>System</dt><dd>{known(card.affectedSystem)}</dd></div>
        <div><dt>Risk</dt><dd>{known(card.riskLevel)}</dd></div>
        <div><dt>Rollback</dt><dd>{rollback(card.rollbackAvailable)}</dd></div>
        <div><dt>Decision needed</dt><dd>{known(card.requestedDecision)}</dd></div>
      </dl>
      <div className="card__actions">
        <button type="button" className="button" onClick={() => decide('Approved once')}>Approve once</button>
        <button type="button" className="button" onClick={() => decide('Rejected')}>Reject</button>
        <p className="card__note" role="status">
          {logged ? `${logged}: written to the demo log. Nothing ran.` : 'Demo only: these buttons write to the demo log and run nothing.'}
        </p>
      </div>
    </section>
  );
}
