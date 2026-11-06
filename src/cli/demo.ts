// `gatehouse demo`: plays a fictional agent session through the gates using recorded replies.
// Nothing here calls the API, so it needs no key and spends no credits.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayTransport, runGate } from '../core/index.js';
import type { ActionInput, ClockedReply, ContentInput, GateResult, ReportInput } from '../core/index.js';
import { SCENARIOS } from '../scenarios/index.js';
import type { Scenario } from '../scenarios/index.js';

const SESSION: { heading: string; ids: string[] }[] = [
  {
    heading: 'A coding agent fixes a rounding bug in acme/checkout',
    ids: ['a-tests', 'c-webpage-injection', 'a-curl-bash', 'a-clean-build', 'a-deploy-friday', 'r-false-tests', 'r-scope-drift', 'r-unsupported', 'r-honest'],
  },
  {
    heading: 'A support agent works through its tickets',
    ids: ['c-ticket-pii', 'a-email-pii', 'a-refund-big', 'a-defender', 'c-security-blog'],
  },
];

const MARK: Record<GateResult['verdict'], string> = {
  CLEARED: 'CLEARED',
  CLEARED_REDACTED: 'CLEARED, with personal data redacted',
  HELD: 'HELD for a person',
  REFUSED: 'REFUSED',
};

const MAX_LINE = 100;
const MAX_EVIDENCE = 2;

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 3)}...` : flat;
}

function attempted(scenario: Scenario): string {
  switch (scenario.gate) {
    case 'action': {
      const input = scenario.input as ActionInput;
      return `runs ${input.tool}: ${shorten(input.payload)}`;
    }
    case 'content': {
      const input = scenario.input as ContentInput;
      return `reads ${input.source}`;
    }
    case 'report': {
      const input = scenario.input as ReportInput;
      return `reports: ${shorten(input.report)}`;
    }
  }
}

function loadReplies(dir: string, id: string): Record<string, ClockedReply> | null {
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const replies = JSON.parse(readFileSync(path, 'utf8'))?.replies;
    return replies !== null && typeof replies === 'object' ? replies : null;
  } catch {
    return null;
  }
}

function missingMessage(dir: string): string {
  return `No recordings found in ${dir}. Run npm run record, with CLOCKED_API_KEY set, to create them.`;
}

/** Returns the transcript, or null when there is nothing to play. */
export async function playDemo(dir: string): Promise<{ text: string } | { error: string }> {
  const lines: string[] = ['Gatehouse demo: a recorded fictional session. No API key is used and no credits are spent.'];
  const skipped: string[] = [];
  const counts: Partial<Record<GateResult['verdict'], number>> = {};
  let played = 0;
  let credits = 0;

  for (const part of SESSION) {
    const start = lines.length;
    lines.push('', `== ${part.heading} ==`);
    let playedInPart = 0;
    for (const id of part.ids) {
      const scenario = SCENARIOS.find((s) => s.id === id);
      const replies = loadReplies(dir, id);
      if (scenario === undefined || replies === null) {
        skipped.push(id);
        continue;
      }
      const result = await runGate(scenario, replayTransport(replies));
      played++;
      playedInPart++;
      credits += result.totals.credits;
      counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;

      lines.push('', `The agent ${attempted(scenario)}`, `  ${scenario.blurb}`, `  -> ${MARK[result.verdict]}`);
      for (const reason of result.reasons.filter((r) => r.severity !== 'info')) lines.push(`     ${reason.text}`);
      const evidence = result.checks.flatMap((c) => c.spans).slice(0, MAX_EVIDENCE);
      for (const span of evidence) lines.push(`     evidence in ${span.field}: "${shorten(span.quote)}"`);
    }
    if (playedInPart === 0) lines.length = start;
  }

  if (played === 0) return { error: missingMessage(dir) };
  const tally = Object.entries(counts).map(([verdict, n]) => `${n} ${verdict}`).join(', ');
  lines.push('', `Played ${played} steps: ${tally}. These steps cost ${credits} credits when they were recorded.`);
  if (skipped.length > 0) lines.push(`Skipped ${skipped.join(', ')}: no recording. Run npm run record to create them.`);
  return { text: lines.join('\n') };
}
