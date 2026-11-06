import { THRESHOLDS } from '../../../src/core/policy.js';

const score = (value: number) => value.toFixed(2);

export function HowItWorks() {
  return (
    <details className="how">
      <summary>How the verdict is made</summary>
      <div className="how__body">
        <div>
          <h3 className="section-title">Thresholds</h3>
          <dl className="how__numbers">
            <div>
              <dt>Below {score(THRESHOLDS.uncertainLow)}</dt>
              <dd>A risk score counts as low.</dd>
            </div>
            <div>
              <dt>{score(THRESHOLDS.uncertainLow)} up to {score(THRESHOLDS.refuseAt)}</dt>
              <dd>The model is unsure, so the item goes to a person.</dd>
            </div>
            <div>
              <dt>{score(THRESHOLDS.refuseAt)} and above</dt>
              <dd>A risk is confident enough to refuse, and an assurance such as "in scope" is confident enough to rely on.</dd>
            </div>
            <div>
              <dt>{score(THRESHOLDS.instructsAgent)} and above</dt>
              <dd>Content that may address the assistant is wrapped as untrusted data.</dd>
            </div>
            <div>
              <dt>{score(THRESHOLDS.rollbackConfident)} and above</dt>
              <dd>Only then is a reviewer told that there is no rollback.</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="section-title">Rules</h3>
          <ul className="how__rules">
            <li>Uncertain never clears.</li>
            <li>A failed safety check holds.</li>
            <li>A benign detector verdict alone authorises nothing: an action must also be in scope and pass the allowlist.</li>
            <li>One refusal outweighs everything else, and a hold outweighs a clear.</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
