import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGateRequest } from '../core/index.js';
import type { PolicyPack } from '../core/index.js';
import { POLICY_PACKS } from '../scenarios/index.js';

export const CONFIG_FILE = 'gatehouse.config.json';

const HOW_TO_CREATE = `Copy examples/gatehouse.config.json from the Gatehouse repository to ${CONFIG_FILE} in this directory and set "brief" and "policyPack".`;

export interface GatehouseConfig {
  brief: string;
  policy: PolicyPack;
  outboundTools: string[];
  skipTools: string[];
  /** MCP tools whose results go through the content gate, on top of WebFetch, WebSearch and Read. */
  contentTools: string[];
}

export type ConfigResult = { ok: true; config: GatehouseConfig } | { ok: false; reason: string };

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Reads a built-in pack by id, or a JSON file relative to `cwd`. Throws with a plain message. */
export function resolvePolicy(ref: string, cwd: string): PolicyPack {
  const builtIn = (POLICY_PACKS as Record<string, PolicyPack>)[ref];
  if (builtIn) return builtIn;
  const path = resolve(cwd, ref);
  if (!existsSync(path)) {
    throw new Error(`policy pack "${ref}" is neither a built-in id (${Object.keys(POLICY_PACKS).join(', ')}) nor a file`);
  }
  const pack = JSON.parse(readFileSync(path, 'utf8')) as PolicyPack;
  // Checked through the gate's own validator, using a stand-in input around the pack.
  const problems = validateGateRequest({ gate: 'content', input: { source: 'config', text: 'config', policy: pack } });
  if (problems.length > 0) throw new Error(`policy pack "${ref}" is not valid: ${problems.join('; ')}`);
  return pack;
}

export function loadConfig(cwd: string): ConfigResult {
  const path = resolve(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    return { ok: false, reason: `Gatehouse has no ${CONFIG_FILE} in ${cwd}, so nothing was checked. ${HOW_TO_CREATE}` };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof raw.brief !== 'string' || raw.brief.trim() === '') throw new Error('"brief" must be a non-empty string');
    if (typeof raw.policyPack !== 'string' || raw.policyPack.trim() === '') throw new Error('"policyPack" must be a built-in id or a path to JSON');
    return {
      ok: true,
      config: {
        brief: raw.brief,
        policy: resolvePolicy(raw.policyPack, cwd),
        outboundTools: stringList(raw.outboundTools),
        skipTools: stringList(raw.skipTools),
        contentTools: stringList(raw.contentTools),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Gatehouse could not read ${CONFIG_FILE}, so nothing was checked: ${message}. ${HOW_TO_CREATE}` };
  }
}

/** Exact tool name, or a prefix when the entry ends in `*`, such as `mcp__slack__*`. */
export function toolListed(list: readonly string[], tool: string): boolean {
  return list.some((entry) => (entry.endsWith('*') ? tool.startsWith(entry.slice(0, -1)) : entry === tool));
}
