# Gatehouse (Clocked Build Challenge entry)

Purpose: a checkpoint between an AI agent and the real world, built on the Clocked APIs. Entry to the Clocked Build Challenge, deadline 2026-11-10 23:59 ET (2026-11-11 13:59 JST).

Contest record (status, brief, submission) lives in `C:\For Claude\contest-pm\contests\1111-clocked-build-challenge\`.

## Layout
- `src/core/` types, Clocked client, verdict policy, the three gates
- `src/cli/` CLI and Claude Code hooks; `eval/` labelled cases; `web/`, `api/`, `src/server/` the review desk
- `src/scenarios/` fictional demo scenarios and policy packs
- `recordings/` responses recorded from the live API
- `docs/plans/` implementation plans; `docs/pm/` PM progress
- `.refs/` local copy of the Clocked API reference, not in git

## Resume
Read `docs/pm/progress-gatehouse.json`, then `npm test`.

## Rules for this repo
The repository is public at submission: only fictional data, no keys. The key is in `.env` (`CLOCKED_API_KEY`), the vault, and the deploy's environment. Commit author is the GitHub noreply address (repo-local git config).
