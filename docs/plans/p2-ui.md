# Plan: Gatehouse review desk (web UI and demo API)

> Review: tasks-only. The PM reviews the branch before merge.

## Parallel lane note

This is lane `p2-ui`. Lane `p2-integrations` runs at the same time and owns `src/cli/`, `eval/`, `README.md`, `docs/`, `.github/`. This lane may write `web/`, `api/`, `vercel.json`, `src/server/`, and may add scripts and dependencies to `package.json`. Do not change `src/core/` or `src/scenarios/`; if a core bug blocks you, make the smallest fix and mention it in the commit message. Rely only on the types in `src/core/types.ts` and the exports `runGate`, `SCENARIOS`, `POLICY_PACKS`, `liveTransport`, `replayTransport`.

## Product

Gatehouse is a checkpoint between an AI agent and the real world, built on Clocked. Read `src/core/types.ts` and `src/scenarios/index.ts` first. Judges of the Clocked Build Challenge open this page once, for a few minutes. It must explain itself in one screen and work without an account. Judges give 20 of 100 points for implementation and user experience, and need to see how each Clocked output changes what the app does.

## Validation Commands
- `npm run typecheck`
- `npm test`
- `npm run build:web`

### Task 1: Demo API

Vite + React + TypeScript in `web/`, built to `dist/`. Vercel Node functions in `api/`, thin wrappers over `src/server/handlers.ts`, which takes plain request objects so it can be unit tested.

- `GET /api/scenarios` returns scenarios and, for each, the recorded `GateResult` from `recordings/<id>.json` when the file exists. Bundle recordings by importing them through a generated or static index so they work in a serverless function, and handle the folder being empty.
- `POST /api/review` with `{ scenarioId }` or `{ gate, input }` runs the gate live.
  - Reads `CLOCKED_API_KEY`. With no key, or `GATEHOUSE_LIVE=off`, returns 503 `{ code: 'live_off' }`.
  - Limits in `src/server/limits.ts`: 12 live runs per IP per hour in memory, and 400 per server instance per day. Over a limit returns 429 `{ code: 'rate_limited' }`.
  - Input caps: `payload` and `text` 8,000 characters, `brief`, `report`, `changelog` 4,000, logs 6 entries of 4,000. Over a cap returns 413. `policy` must be one of the built-in packs by id, so a visitor cannot grow the request.
  - When every check reports a 402, returns 503 `{ code: 'out_of_credits' }`.
  - Results strip `raw` fields whose content would duplicate personal data the visitor did not type: keep `raw` for scenarios, drop it for custom input.
  - Never logs input text or the key.

- [x] Handler tests cover each status above with a fake transport

### Task 2: The desk

One page. No login. The concept is a border checkpoint ledger: a warm paper background, ink text, ruled lines, a monospaced face for evidence and numbers paired with a characterful serif or grotesque for headings, and verdicts shown as rubber stamps (`CLEARED`, `CLEARED · REDACTED`, `HELD`, `REFUSED`) with slight rotation. Green, amber and red only on verdicts and evidence. Avoid the generic look: no purple gradients, no glass cards, no emoji icons. Self-host fonts through `@fontsource` packages or use system stacks; credit them in `web/CREDITS.md`.

Layout on desktop, in three parts:

1. **Header**: name, one sentence ("Gatehouse stops an AI agent before it runs a bad command, reads a poisoned page, or reports work it did not do."), and a mode switch `Recorded` / `Live` with the credit count of the current run.
2. **Queue (left)**: scenarios grouped by gate, labelled for a person: "Before it acts", "Before it reads", "Before it reports done". Each row shows the title and a small stamp.
3. **Inspection (right)**:
   - The stamp, large, with the reasons in plain words next to it.
   - The input as the agent submitted it (brief, tool, payload, or text, or report and logs), with evidence spans highlighted. Hovering a check highlights its spans, and hovering a span scrolls to its check.
   - The checks as a vertical ledger in the order they ran. Each row: endpoint name as a small tag, `title`, `summary`, then `effect` set apart with a label "Effect on the verdict". Right-aligned model time and credits. A skipped check shows why, greyed. A failed check is visually loud and says the gate failed closed. A disclosure shows the raw JSON.
   - When `forwardText` exists, a block titled "What the agent or recipient receives", with a diff-style view where replaced values are visible as placeholders. When the result is `REFUSED` on the content gate, this block says "Nothing. The content is quarantined."
   - When `reviewCard` exists, a card titled "For the person on call" with summary, system, risk, rollback, and the requested decision, plus `Approve once` and `Reject` buttons. They write to an audit list stored in `localStorage` shown under the queue, with time, scenario, verdict and decision. Clear wording says this is the demo log.

On a narrow screen the queue becomes a horizontal scroller at the top. Keyboard: arrow keys move in the queue, all interactive parts are focusable with a visible focus ring, and stamps have text alternatives. Colour is never the only signal.

The first scenario in the queue, `a-defender`, is selected on load so the first paint shows a `REFUSED` stamp and evidence.

- [ ] Selecting a scenario in recorded mode shows its result with no network call beyond the first load
- [ ] Component tests with Testing Library cover: rendering each verdict, span highlight on hover, failed check rendering, redacted forward text, audit log persisting

### Task 3: Try your own, and every empty and failure state

- A "Write your own" tab with three short forms (action, content, report), each prefilled by a "Start from a scenario" dropdown, a policy pack selector, and a Run button. It shows the checks arriving: since the API returns one response, show an honest indeterminate state listing the endpoints it will call, and no fake progress numbers.
- A line beside the Run button says that text goes to the Clocked API and should be made-up data.
- Live mode failure states, each with a plain sentence and a way forward: `live_off` and `out_of_credits` switch to recorded mode and say why, `rate_limited` says when to retry, 413 names the field that is too long, a network error offers retry. A missing recording shows "not recorded yet" with a live button.
- A short "How the verdict is made" panel, collapsed by default, listing the thresholds imported from `THRESHOLDS` and the rules: uncertain never clears, a failed safety check holds, a benign detector verdict alone authorises nothing.

- [ ] Tests cover each failure code and the panel's values matching `THRESHOLDS`
- [ ] `npm run build:web` passes, and `vercel.json` routes `/api/*` to the functions and everything else to `dist/index.html`

Do NOT implement: hooks, CLI, eval harness, README, deployment commands. Do not add accounts, analytics, or external calls from the browser other than `/api`.
