import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Claude Code's documentation does not specify the transcript's line format. This reads the
// lines seen in real transcripts and ignores everything else: a line with `type` user or
// assistant, whose `message.content` is a string or a list of blocks.

export const MAX_LOGS = 6;
export const MAX_LOG_CHARS = 4000;

export interface TranscriptRead {
  lastAssistantText: string | null;
  logs: { id: string; text: string }[];
}

function blockText(blocks: any[]): string {
  return blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n');
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? blockText(content) : '';
}

export function readTranscript(path: unknown): TranscriptRead {
  const empty: TranscriptRead = { lastAssistantText: null, logs: [] };
  if (typeof path !== 'string' || path === '') return empty;
  const file = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  if (!existsSync(file)) return empty;

  let lastAssistantText: string | null = null;
  const toolNames = new Map<string, string>();
  const results: { name: string; text: string }[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // A subagent's work is not the main agent's final report.
    if (entry?.isSidechain === true) continue;
    const content = entry?.message?.content;
    if (entry?.type === 'assistant') {
      const text = typeof content === 'string' ? content : Array.isArray(content) ? blockText(content) : '';
      if (text.trim() !== '') lastAssistantText = text;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'tool_use' && typeof block.id === 'string') toolNames.set(block.id, String(block.name ?? 'tool'));
      }
    } else if (entry?.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        const text = resultText(block.content);
        if (text.trim() === '') continue;
        results.push({ name: toolNames.get(block.tool_use_id) ?? 'tool', text: block.is_error === true ? `[tool error]\n${text}` : text });
      }
    }
  }

  return {
    lastAssistantText,
    // The end of a tool's output is where test totals and failures usually are.
    logs: results.slice(-MAX_LOGS).map((r, i) => ({ id: `${r.name}-${i + 1}`, text: r.text.slice(-MAX_LOG_CHARS) })),
  };
}
