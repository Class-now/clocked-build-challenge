export type Verdict = 'CLEARED' | 'CLEARED_REDACTED' | 'HELD' | 'REFUSED';
export type GateKind = 'action' | 'content' | 'report';
export type EndpointName = 'decide'|'extract'|'fill'|'pii'|'injection'|'script'|'grounding'|'compare'|'rerank'|'pipeline';

/**
 * Evidence inside one input field. `start` and `end` index the field as a JavaScript string,
 * so `text.slice(start, end)` works directly. The API counts Unicode code points; the gates
 * convert. `field` is an input name such as `payload` or `toolLogs.<id>`.
 */
export interface Span { start: number; end: number; quote: string; field: string; label?: string; }

export interface CheckResult {
  id: string;              // stable, e.g. 'script-risk'
  title: string;           // human label, e.g. 'Inspect the script'
  endpoint: EndpointName;
  status: 'ok' | 'failed' | 'skipped';
  outcome: 'pass' | 'uncertain' | 'flag' | 'info';
  summary: string;         // one plain sentence saying what was found
  effect: string;          // one plain sentence saying how this changed the verdict or the output
  score?: number;          // the main probability, 0-1
  spans: Span[];           // evidence, offsets into the named input field
  modelMs?: number;
  credits?: number;
  raw?: unknown;           // endpoint response
  error?: string;
  transformed?: boolean;   // true when this check replaced personal data in the text passed on
}

export interface Reason { checkId: string; severity: 'info'|'hold'|'refuse'; text: string; }

export interface GateResult {
  gate: GateKind;
  verdict: Verdict;
  reasons: Reason[];
  checks: CheckResult[];
  forwardText?: string;    // the text the agent or the recipient may receive
  reviewCard?: ReviewCard; // present when verdict is HELD or REFUSED
  totals: { modelMs: number; credits: number; failedChecks: number };
}

export interface ReviewCard {
  summary: string; affectedSystem: string|null; riskLevel: string|null;
  rollbackAvailable: boolean|null; requestedDecision: string|null;
}

export interface PolicyClause { id: string; title: string; text: string; }
export interface PolicyPack { id: string; name: string; clauses: PolicyClause[]; allowedHosts: string[]; }

export interface ActionInput { brief: string; tool: string; payload: string; outbound?: boolean; policy: PolicyPack; }
export interface ContentInput { source: string; text: string; policy: PolicyPack; }
export interface ReportInput { brief: string; report: string; toolLogs: { id: string; text: string }[]; changelog: string; policy: PolicyPack; }
