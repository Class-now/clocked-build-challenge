import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { GateKind, Verdict } from '../../../src/core/types.js';
import { GATE_LABELS, GATE_ORDER } from '../lib/verdicts.js';
import { Stamp } from './Stamp.js';

export interface QueueItem { id: string; title: string; gate: GateKind; verdict: Verdict | null; }

const FIRST_IN_QUEUE = 'a-defender';

/** Groups by gate and puts the opening scenario first, so the first paint shows a refusal. */
export function orderQueue<T extends { id: string; gate: GateKind }>(items: T[]): T[] {
  const lifted = [...items].sort((a, b) => Number(b.id === FIRST_IN_QUEUE) - Number(a.id === FIRST_IN_QUEUE));
  return GATE_ORDER.flatMap((gate) => lifted.filter((item) => item.gate === gate));
}

export function Queue({ items, selectedId, emptyLabel, onSelect }: {
  items: QueueItem[];
  selectedId: string | null;
  emptyLabel: string;
  onSelect(id: string): void;
}) {
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const ordered = orderQueue(items);

  useEffect(() => {
    // Keeps the selected row in view in the horizontal scroller on a phone.
    if (selectedId) rows.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const at = ordered.findIndex((item) => item.id === selectedId);
    const last = ordered.length - 1;
    const target = {
      ArrowDown: Math.min(at + 1, last),
      ArrowRight: Math.min(at + 1, last),
      ArrowUp: Math.max(at - 1, 0),
      ArrowLeft: Math.max(at - 1, 0),
      Home: 0,
      End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = ordered[target];
    if (next) {
      onSelect(next.id);
      rows.current.get(next.id)?.focus();
    }
  };

  return (
    <nav className="queue" aria-label="Scenario queue" onKeyDown={onKeyDown}>
      <h2 className="section-title queue__title">The queue</h2>
      <p className="queue__hint">Arrow keys move through it.</p>
      <div className="queue__groups">
        {GATE_ORDER.map((gate) => (
          <section className="queue__group" key={gate} aria-label={GATE_LABELS[gate]}>
            <h3 className="queue__gate">{GATE_LABELS[gate]}</h3>
            <ul className="queue__rows">
              {ordered.filter((item) => item.gate === gate).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`queue-row${item.id === selectedId ? ' is-selected' : ''}`}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    ref={(el) => {
                      if (el) rows.current.set(item.id, el);
                      else rows.current.delete(item.id);
                    }}
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="queue-row__title">{item.title}</span>
                    {item.verdict ? <Stamp verdict={item.verdict} /> : <span className="queue-row__empty">{emptyLabel}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
