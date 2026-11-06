# Plan: Gatehouse integrations (Claude Code hooks, CLI, eval, docs)

> Review: tasks-only. The PM reviews the branch before merge.

## Parallel lane note

This is lane `p2-integrations`. Lane `p2-ui` runs at the same time and owns `web/`, `api/`, `vercel.json`, `src/server/`. This lane may write `src/cli/`, `eval/`, `examples/`, `README.md`, `docs/`, `.github/`, `LICENSE`, and may add scripts to `package.json`. Do not change `src/core/` or `src/scenarios/`; if a core bug blocks you, make the smallest fix and mention it in the commit message. Rely only on the types in `src/core/types.ts` and the exports `runGate`, `SCENARIOS`, `POLICY_PACKS`, `THRESHOLDS`, `liveTransport`, `recordingTransport`, `replayTransport`.

## Product

Gatehouse is a checkpoint between an AI agent and the real world, built on Clocked. Read `src/core/types.ts` first. This lane turns it from a demo into something a developer can install in a real agent today. All text in the repository is in English.

## Validation Commands
- `npm run typecheck`
- `npm test`

### Task 1: CLI and Claude Code hooks

`src/cli/gatehouse.ts`, run with `tsx` and exposed as `bin`:

- `gatehouse check <action|content|report> --file input.json [--json]` prints the verdict, reasons and checks. Exit codes: 0 cleared, 10 held, 20 refused, 2 usage error.
- `gatehouse hook pre-tool` reads a Claude Code `PreToolUse` JSON event from stdin (`tool_name`, `tool_input`, `session_id`, `transcript_path`, `cwd`). It maps Bash, Write, Edit, WebFetch and any tool with an external effect to an action input, using `command`, `content`, or the JSON of the input as the payload. Marks a tool as `outbound` when configured in `outboundTools`. Prints:
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"ask"|"deny","permissionDecisionReason":"..."}}`
  with CLEARED to allow, HELD to ask, REFUSED to deny. For CLEARED_REDACTED, allow with `updatedInput` carrying the redacted text in the same field. On any failure of the Clocked service it prints `ask`, never `allow`.
- `gatehouse hook post-tool` reads `PostToolUse` for WebFetch, WebSearch, Read, and configured MCP tools, runs the content gate on `tool_response`, and on REFUSED prints `{"decision":"block","reason":"..."}` with the evidence quoted. On other verdicts it prints `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}` only if there is something to say.
- `gatehouse hook stop` reads `Stop`, takes the last assistant message from `transcript_path` (JSONL) as the report, and uses the tool results in the transcript as logs, capped to the most recent 6 and 4,000 characters each. It takes the changelog from `git diff --stat` in `cwd` if available. REFUSED and HELD print `{"decision":"block","reason":"..."}` listing the unsupported claims so that the agent keeps working. It respects `stop_hook_active` and never blocks twice in a row.
- Config: `gatehouse.config.json` in `cwd`, with `brief`, `policyPack` (built-in id or a path to JSON), `outboundTools`, `skipTools`. Sample in `examples/gatehouse.config.json`. Sample hook settings in `examples/claude-settings.json`. Missing config prints `ask` with a reason saying how to create one.
- Short-circuit: tools in `skipTools` and read-only commands in a small built-in list (`ls`, `pwd`, `git status`, `git diff`) allow without a call, so credits are not spent on them. Each run appends one JSON line to `.gatehouse/audit.jsonl` with time, gate, verdict, reasons and credits, with no raw text.

- [x] Tests feed real-shaped hook events through a fake transport and assert the printed JSON for each verdict, service failure, missing config, `stop_hook_active`, and skip list

### Task 2: A simulated agent run

`gatehouse demo` plays a recorded fictional agent session through the gates with `replayTransport` from `recordings/*.json`. It works with no API key and prints a readable terminal transcript: what the agent tried, each verdict and reason. If recordings are missing it says to run `npm run record`. Add it as `npm run demo`.

- [x] Test with a fixture recording covering output and the missing-recordings message

### Task 3: Eval harness

`eval/cases.json`: 40 labelled fictional cases not used in the scenarios, at least 10 per gate, each with `gate`, `input`, `expected`, `note`. Include hard controls so false positives are measured: routine admin scripts that look scary, a security article quoting an attack, a report with hedged language, a clean `rm` of a build directory, plus subtle attacks: an injection phrased as a polite vendor note, a base64-piped installer, a report whose claim is true of a different test suite.

`eval/run.ts` (`npm run eval`): runs every case with the live transport, saves replies to `eval/recordings/`, writes `eval/results.md` with overall agreement, a confusion matrix per gate, the unsafe-clear count (expected HELD or REFUSED but CLEARED), the false-alarm count (expected CLEARED but REFUSED), total credits, and a list of disagreements. `--replay` recomputes from saved replies with no credits. `--sweep` tries `refuseAt` and `uncertainLow` values from saved replies, without new calls, and prints a table. It is not run in this plan.

- [x] Tests cover the metric calculation and replay mode with a small fixture

### Task 4: README, how-it-works, CI

`README.md`, written for a judge who has two minutes:

1. One sentence, then a link placeholder `LIVE_DEMO_URL` and a screenshot placeholder `docs/img/desk.png`.
2. The problem in three real failure types: an agent running a destructive command, reading a poisoned page, and claiming work it did not do.
3. A table of all nine endpoints plus Pipeline: where each is called, what its output changes. Each row names a concrete effect, for example "Inspect: `malicious` at or above 0.75 refuses the command; evidence lines are highlighted for the reviewer."
4. How uncertainty, missing data and failed requests are handled: the rules from `src/core/policy.ts`.
5. Quick start with no key (`npm run demo`), with a key (`npm run record`), and in Claude Code (settings snippet).
6. Eval results placeholder `EVAL_RESULTS`, with the note that eval runs on fictional data and is not an accuracy guarantee.
7. Credit use: how pipelines, skip lists and caching keep cost low. Limits of the design: a detector is not an enforcement boundary, keep least privilege and sandboxing in place.
8. Credits for third-party work. Built during the challenge window with AI coding tools, per the rules.

Also: `docs/how-it-uses-clocked.md` with one section per endpoint (request fields that matter and why), `.env.example` with `CLOCKED_API_KEY=` and `GATEHOUSE_LIVE=`, MIT `LICENSE` (holder "Gatehouse contributors"), `.github/workflows/ci.yml` running typecheck and test on Node 20 without any secret.

- [ ] Every command in the README exists in `package.json`
- [ ] No text in the repo claims results that have not been measured; placeholders stay as named above

Do NOT implement: web UI, HTTP API, deployment.
