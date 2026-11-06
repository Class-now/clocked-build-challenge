import type { EndpointName, GateKind } from '../../../src/core/types.js';

const PLAN: Record<GateKind, { endpoint: EndpointName; note?: string }[]> = {
  action: [
    { endpoint: 'rerank' },
    { endpoint: 'script', note: 'when it is a script' },
    { endpoint: 'extract' },
    { endpoint: 'decide' },
    { endpoint: 'pii', note: 'when it sends something out' },
    { endpoint: 'fill', note: 'when a person must decide' },
  ],
  content: [
    { endpoint: 'pipeline', note: 'one call: injection, then pii' },
    { endpoint: 'decide', note: 'when the content passes' },
  ],
  report: [
    { endpoint: 'grounding' },
    { endpoint: 'compare' },
    { endpoint: 'decide' },
    { endpoint: 'fill', note: 'when a person must decide' },
  ],
};

/** The server answers once, at the end, so this shows what it will call and no progress figures. */
export function RunProgress({ gate }: { gate: GateKind }) {
  return (
    <section className="progress" role="status" aria-label="Running">
      <p className="progress__title">Running at the checkpoint</p>
      <div className="progress__bar" aria-hidden="true" />
      <p className="progress__note">The answer arrives all at once when the last call returns. The server calls, in this order:</p>
      <ol className="progress__steps">
        {PLAN[gate].map((step) => (
          <li key={step.endpoint}>
            <span className="tag">{step.endpoint}</span>
            {step.note && <span className="progress__when"> {step.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
