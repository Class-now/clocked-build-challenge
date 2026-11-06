import type { CheckResult } from '../../../src/core/types.js';
import { isSafetyCheck } from '../../../src/core/policy.js';
import { checkState } from '../lib/verdicts.js';

export const checkDomId = (id: string) => `check-${id}`;

function failureLine(check: CheckResult): string {
  return isSafetyCheck(check)
    ? 'The gate failed closed: a safety check with no answer cannot clear anything.'
    : 'The gate failed closed on anything that depends on this helper.';
}

function cost(check: CheckResult): string | null {
  const parts: string[] = [];
  if (check.modelMs !== undefined) parts.push(`${Math.round(check.modelMs)} ms`);
  if (check.credits !== undefined) parts.push(`${check.credits} ${check.credits === 1 ? 'credit' : 'credits'}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function Ledger({ checks, activeCheck, onActivate }: {
  checks: CheckResult[];
  activeCheck: string | null;
  onActivate(id: string | null): void;
}) {
  return (
    <ol className="ledger">
      {checks.map((check, i) => {
        const state = checkState(check);
        const spent = cost(check);
        return (
          <li
            key={check.id}
            id={checkDomId(check.id)}
            className={`check check--${state.css}${activeCheck === check.id ? ' is-active' : ''}`}
            tabIndex={0}
            onMouseEnter={() => onActivate(check.id)}
            onMouseLeave={() => onActivate(null)}
            onFocus={() => onActivate(check.id)}
            onBlur={() => onActivate(null)}
          >
            <div className="check__line">
              <span className="check__number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <span className="tag">{check.endpoint}</span>
              <span className={`check__state check__state--${state.css}`}>
                {state.word}
              </span>
              {spent && <span className="check__cost">{spent}</span>}
            </div>
            <h4 className="check__title">{check.title}</h4>
            {check.status === 'failed' && (
              <p className="check__failed"><strong>This check failed.</strong> {failureLine(check)}</p>
            )}
            <p className="check__summary">{check.status === 'skipped' ? `Skipped: ${check.summary}` : check.summary}</p>
            <div className="check__effect">
              <span className="check__effect-label">Effect on the verdict</span>
              <p>{check.effect}</p>
            </div>
            {check.raw !== undefined && (
              <details className="check__raw">
                <summary>Raw JSON from {check.endpoint}</summary>
                <pre>{JSON.stringify(check.raw, null, 2)}</pre>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
