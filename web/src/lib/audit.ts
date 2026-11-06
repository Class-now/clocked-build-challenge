import type { Verdict } from '../../../src/core/types.js';

export interface AuditEntry {
  time: string;
  scenario: string;
  verdict: Verdict;
  decision: 'Approved once' | 'Rejected';
}

export const AUDIT_KEY = 'gatehouse.demo-log.v1';
const MAX_ENTRIES = 50;

/** Storage can be missing or full, and the demo must carry on without it. */
export function loadAudit(): AuditEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAudit(entries: AuditEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(AUDIT_KEY);
    else localStorage.setItem(AUDIT_KEY, JSON.stringify(entries));
  } catch {
    // The list still works for this page view.
  }
}

export function addEntry(entries: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  return [entry, ...entries].slice(0, MAX_ENTRIES);
}
