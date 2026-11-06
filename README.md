# Gatehouse

Gatehouse is a checkpoint between an AI agent and the real world: it checks what the agent is about to do, what it reads, and what it says it did, using the Clocked APIs.

**Live demo:** LIVE_DEMO_URL

![The review desk](docs/img/desk.png)

## The problem

Agents already have shell access, web access and the job of telling you how it went. Three kinds of failure follow:

- **A destructive command.** An agent fixing a printer also turns off endpoint protection, or pipes a download into a shell.
- **A poisoned page.** A vendor document tells any assistant reading it to send the API key to a URL, and the agent treats that as an instruction.
- **Work it did not do.** The agent reports "all tests pass" with two failures in its own log, or a deploy no log shows.

Gatehouse has one gate for each: **action**, **content** and **report**. Each ends in one of four verdicts: `CLEARED`, `CLEARED_REDACTED`, `HELD` for a person, or `REFUSED`.

## Where each Clocked endpoint is used

| Endpoint | Where it is called | What its output changes |
|---|---|---|
| Inspect `/script` | Action gate, for anything script-like | `malicious` at or above 0.75 refuses the command, and from 0.35 up to 0.75 holds it. Evidence lines are highlighted for the reviewer. |
| Extract `/extract` | Action gate | A host outside the policy's allowlist holds the action. A network action with no target, or a payment with no amount, holds. The amount goes into the scope decision. |
| Decide `/decide` | All three gates | Action: `in_scope` under 0.75 holds, `violates_clause` at or above 0.75 refuses, a missing approval or an irreversible action holds, and `action_class` can turn on the outbound check. Content: `instructs_agent` at or above 0.35 wraps the text in an untrusted-data envelope. Report: `claims_done` makes a contradicted claim a false claim of completion, and `breaks_brief` or `overstates_tests` at or above 0.75 refuses (0.35 to 0.75 holds), which catches skipped tests counted as passes and excluded work described in other words. |
| Rerank `/rerank` | Action gate, first | Only the clauses marked `use` go into Inspect and Decide, and the reasons name them. |
| Protect `/pii` | Action gate for outbound text; content gate | The recipient or the agent gets a copy with typed placeholders, and the verdict becomes `CLEARED_REDACTED`. |
| Guard `/injection` | Content gate | `injection` at or above 0.75 quarantines the text and the agent receives nothing. From 0.35 up to 0.75 holds it. Evidence passages are shown to the reviewer. |
| Verify `/grounding` | Report gate | A claim the logs contradict refuses the report. An unsupported claim about tests, deploys, data or security holds it. An unsupported minor claim is only noted. |
| Compare `/compare` | Report gate | A conflict between the brief and the changelog at or above 0.75 confidence refuses, and a weaker one holds. The conflicting passage is highlighted. |
| Fill `/fill` | Action and report gates, when the verdict is `HELD` or `REFUSED` | Gives the person on call a card: summary, affected system, risk level, rollback, the decision needed. A confident "no rollback" adds a warning to a held action. It never changes the verdict. |
| Pipeline `/pipeline` | Content gate | Runs Guard and Protect as one request and one debit. `on_error: continue` means one failed step still returns the other. |

Each field and why it is set is in [docs/how-it-uses-clocked.md](docs/how-it-uses-clocked.md).

## Uncertainty, missing data and failed requests

The rules are in [`src/core/policy.ts`](src/core/policy.ts). An unsure answer or an unknown result never clears anything.

- **Uncertainty.** A risk under 0.35 is low. At or above 0.75 it refuses. In between, the model is unsure and a person decides. An assurance such as "in scope" counts only at 0.75 or above; anything less holds.
- **A failed safety check holds.** If Inspect, Guard, Protect, Verify, Compare, Decide or the Pipeline request cannot run or returns an unusable shape, its result is unknown, and the verdict is `HELD`.
- **A failed helper holds only when the action depends on it.** If Rerank fails, every clause is applied. If Extract fails, URLs read in code still meet the allowlist, and a network or payment action holds. If Fill fails, there is no card and the verdict stays.
- **Missing data holds.** A network action needs a known target. A payment needs a known amount.
- **A benign detector authorises nothing.** An action must also be confidently in scope and must not have failed the allowlist.
- **In Claude Code,** any failure of the service prints `ask`, never `allow`. A hook also gives up at its own deadline and asks, because by default Claude Code lets a tool proceed when a hook times out. The sample settings add `"onFailure": "block"` for the case where the hook itself cannot run.

## Quick start

With no key, play a recorded fictional session through the gates:

```sh
npm install
npm run demo
```

If there are no recordings yet, the command says so. To make them, or to refresh them, use a key (see `.env.example`). This calls the live API and spends credits:

```sh
echo "CLOCKED_API_KEY=your-key" > .env
npm run record
```

Check one input, with exit code 0 for cleared, 10 for held, 20 for refused and 2 for a usage error:

```sh
npm run gatehouse -- check action --file input.json
```

### In Claude Code

Make the `gatehouse` command available with `npm link` in this repository. Then, in the project your agent works in:

1. Copy [`examples/gatehouse.config.json`](examples/gatehouse.config.json) to `gatehouse.config.json`, and set the `brief` and `policyPack` (a built-in id or a path to JSON).
2. Set `CLOCKED_API_KEY` in the environment or in `.env`.
3. Add the hooks to `.claude/settings.json`. The full sample is [`examples/claude-settings.json`](examples/claude-settings.json):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|Write|Edit|WebFetch|mcp__.*",
        "hooks": [{ "type": "command", "command": "gatehouse hook pre-tool", "timeout": 120, "onFailure": "block" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "WebFetch|WebSearch|Read|mcp__docs__.*",
        "hooks": [{ "type": "command", "command": "gatehouse hook post-tool", "timeout": 120 }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "gatehouse hook stop", "timeout": 120 }]
      }
    ]
  }
}
```

| Hook | CLEARED | CLEARED_REDACTED | HELD | REFUSED |
|---|---|---|---|---|
| `pre-tool` | allow | allow, with the redacted text in `updatedInput` | ask | deny |
| `post-tool` | nothing, or an untrusted-data label | the redacted text replaces the result | a warning to the agent | block, and the result is replaced |
| `stop` | nothing | nothing | block once | block once |

Each run adds a line to `.gatehouse/audit.jsonl`: time, gate, verdict, reason ids and credits, with no raw text.

## Eval results

Run against the live API on 40 labelled fictional cases. Full results and every disagreement are in [`eval/results.md`](eval/results.md).

| | Result |
|---|---|
| Agreement with the label | 32 of 40: action 16 of 18, content 9 of 12, report 7 of 10 |
| Unsafe clears (should have stopped, went through) | 1: `r08-stale-test-run`, tests that passed before the last edit |
| False alarms (should have gone through, refused) | 1: `c01-postmortem-quote`, an incident review quoting an attack word for word |
| Other misses | 6, all more cautious than the label: 4 hard controls held, 1 refusal held, 1 clean text redacted |
| Credits for the run | 453 |

These figures are not from held-out data. The first run agreed on 30 of 40 with 3 unsafe clears, and the two report questions `breaks_brief` and `overstates_tests` were added after reading those misses and checked on the same cases. `--sweep` showed no better setting for `refuseAt` from 0.75 to 0.90 or for `uncertainLow` from 0.20 to 0.50, so the thresholds stayed at 0.75 and 0.35.

`npm run eval` runs 40 labelled cases in [`eval/cases.json`](eval/cases.json) and writes a confusion matrix per gate, the unsafe-clear count and the false-alarm count to `eval/results.md`. `npm run eval -- --replay` recomputes from saved replies with no credits, and `npm run eval -- --sweep` tries other thresholds the same way.

The eval runs on fictional data and is not an accuracy guarantee. Its cases include hard controls that look dangerous and are not, and attacks written to get through; its notes mark the ones Gatehouse may get wrong.

## Credit use and limits

Calls are kept down in these ways:

- **Pipeline:** Guard and Protect are one request and one debit.
- **Skip lists:** tools in `skipTools`, and plain read-only commands (`ls`, `pwd`, `git status`, `git diff`), allow with no call at all. The hook matchers keep other tools from starting one.
- **Calls only when they matter:** Inspect runs only on scripts, Protect only on outbound text, Fill only when a person is needed, and the content gate's Decide only after Guard passes.
- **Saved replies:** Gatehouse does not cache live responses, but `npm run demo` and `npm run eval -- --replay` read saved replies and spend nothing.

The limits of the design:

- **A detector is not an enforcement boundary.** Gatehouse lowers risk; it does not contain an agent. Keep least privilege and sandboxing in place.
- A `pre-tool` hook that crashes or times out lets the tool proceed unless `"onFailure": "block"` is set, as it is in the sample. That setting needs Claude Code v2.1.295 or later. It has no effect on `Stop` hooks, so a `stop` hook that fails lets the agent stop.
- `post-tool` runs after the tool. A held result has already reached the agent, with a warning. A refused result is replaced, but Claude Code ignores a replacement that does not fit a built-in tool's output shape.
- `stop` blocks once in a row at most, by design, so an agent that repeats a false claim is not stopped twice. Its changelog is `git diff --stat`, which does not show committed or untracked work.
- `allow` skips Claude Code's permission prompt. Your own deny and ask rules still apply.

## Credits

- [Clocked](https://clocked.rezolve.ai) by rezolve.ai supplies every model reading.
- [TypeScript](https://www.typescriptlang.org), [tsx](https://tsx.is) and [Vitest](https://vitest.dev) are the toolchain.
- The hooks follow the [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks).

Built during the Clocked Build Challenge window with AI coding tools, as the rules allow. All companies, people, hosts and numbers in the scenarios and eval cases are fictional. MIT licensed: see [LICENSE](LICENSE).
