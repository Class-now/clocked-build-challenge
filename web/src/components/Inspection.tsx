import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GateKind, GateResult } from '../../../src/core/types.js';
import { evidenceByField } from '../lib/segments.js';
import { verdictMeaning } from '../lib/verdicts.js';
import { Forward } from './Forward.js';
import { Ledger, checkDomId } from './Ledger.js';
import { ReviewCard } from './ReviewCard.js';
import { Stamp } from './Stamp.js';
import { Submitted, originalText } from './Submitted.js';
import type { GateInput } from './Submitted.js';

const NO_EVIDENCE = new Map();
const HOVER_SCROLL_DELAY_MS = 120;
const SEVERITY_WORD = { refuse: 'Refuses', hold: 'Holds', info: 'Note' } as const;

function scrollToCheck(id: string): HTMLElement | null {
  const row = document.getElementById(checkDomId(id));
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  row?.scrollIntoView?.({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  return row;
}

/** One run shown in full: stamp and reasons, what was submitted, the checks, and what comes out. */
export function Inspection({ gate, input, result, placeholder, onDecide }: {
  gate: GateKind;
  input: GateInput;
  result: GateResult | null;
  /** Shown in place of the verdict and the checks when there is no result. */
  placeholder?: ReactNode;
  onDecide(decision: 'Approved once' | 'Rejected'): void;
}) {
  const [activeCheck, setActiveCheck] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const evidence = useMemo(() => (result ? evidenceByField(result.checks) : NO_EVIDENCE), [result]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onSpan = (id: string | null) => {
    setActiveCheck(id);
    clearTimeout(timer.current);
    if (id) timer.current = setTimeout(() => scrollToCheck(id), HOVER_SCROLL_DELAY_MS);
  };
  const onSpanOpen = (id: string) => {
    clearTimeout(timer.current);
    scrollToCheck(id)?.focus({ preventScroll: true });
  };

  return (
    <div className="inspection">
      {result ? (
        <section className="verdict" aria-label="Verdict">
          <div className="verdict__stamp" key={result.verdict}><Stamp verdict={result.verdict} size="large" /></div>
          <div className="verdict__words">
            <p className="verdict__meaning">{verdictMeaning(gate, result.verdict)}</p>
            {result.reasons.length > 0 ? (
              <ul className="reasons">
                {result.reasons.map((reason, i) => (
                  <li
                    key={i}
                    className={`reason reason--${reason.severity}`}
                    onMouseEnter={() => setActiveCheck(reason.checkId)}
                    onMouseLeave={() => setActiveCheck(null)}
                  >
                    <span className="reason__word">{SEVERITY_WORD[reason.severity]}</span>
                    <span>{reason.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="reasons__none">No check objected.{result.verdict === 'CLEARED_REDACTED' ? ' Personal data was replaced before anything went on.' : ''}</p>
            )}
          </div>
        </section>
      ) : placeholder}

      <div className={`inspection__columns${result ? '' : ' inspection__columns--single'}`}>
        <section className="sheet submitted" aria-labelledby="submitted-title">
          <h3 className="section-title" id="submitted-title">As the agent submitted it</h3>
          <Submitted gate={gate} input={input} evidence={evidence} activeCheck={activeCheck} onSpan={onSpan} onSpanOpen={onSpanOpen} />
        </section>

        {result && (
          <section className="checks" aria-labelledby="checks-title">
            <h3 className="section-title" id="checks-title">The checks, in the order they ran</h3>
            <Ledger checks={result.checks} activeCheck={activeCheck} onActivate={setActiveCheck} />
          </section>
        )}
      </div>

      {result && <Forward result={result} original={originalText(gate, input)} />}
      {result?.reviewCard && <ReviewCard card={result.reviewCard} onDecide={onDecide} />}
    </div>
  );
}
