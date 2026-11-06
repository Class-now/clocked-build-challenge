# How Gatehouse uses Clocked

One section per endpoint: the request fields that matter, and why. The calling code is in `src/core/gates/`. Calls go one at a time, with an `Idempotency-Key` that stays the same across retries of one logical request. Offsets from the API count Unicode code points, and the gates convert them to JavaScript string offsets before any evidence is shown.

## Inspect: `/script`

Called by the action gate when the tool is a shell or the payload looks like a script.

- `script`: the payload, unchanged.
- `instructions`: the approved brief and the clauses Rerank selected. A command that is routine in one job is out of place in another, so the reading needs the job.
- `evidence: true`: the lines behind the score become the highlights a reviewer sees.

Gatehouse reads `malicious` against its own thresholds, not the endpoint's `verdict`, so that an unsure score holds instead of being rounded to one side.

## Extract: `/extract`

Called by the action gate on every action.

- `fields.hosts`, `fields.file_paths`, `fields.recipients`: `list: true` with `max_items: 32`. Paths are requested separately so that a path is not mistaken for a host.
- `fields.amount`: `normalize: 'money'`, so the scope decision sees a typed reading next to the written one.
- `instructions`: says to copy values exactly as written.

URLs are also read in code and meet the allowlist either way, so a value the model misses, or a failed request, cannot get a host past it.

## Decide: `/decide`

Called by all three gates, with different questions.

- Action gate: `state` holds the brief, the tool, the payload and the extracted amount. `instructions` holds the applicable clauses. `questions` has `in_scope`, `violates_clause` and `needs_approval` (`noul`, for a probability), `reversibility` (`score`, with three named levels) and `action_class` (`choice`, with a description of each class).
- Content gate: `instructs_agent` (`noul`, with `threshold: 0.35`). `state` is the redacted copy, so raw values are not sent twice.
- Report gate: `claims_done` (`noul`), over the brief and the report.

`violates_clause` and `needs_approval` are separate questions so that "forbidden" can refuse and "allowed once approved" can hold.

## Rerank: `/rerank`

Called first by the action gate.

- `query`: the tool and the payload, cut to the 4,000-character limit so that a long payload cannot fail the action.
- `context`: the brief.
- `documents`: the policy clauses, with `id`, `title` and `text`.

Gatehouse uses each result's `action`: only `use` clauses go on. That keeps later requests short, and it lets reasons name the clauses that applied. If the request fails, every clause goes on.

## Protect: `/pii`

Called by the action gate for outbound text, and by the content gate inside the Pipeline.

- `text`: the payload or the content.
- `anonymize: 'replace'`: typed placeholders keep the text readable for whoever receives it.

A result with findings must carry `anonymized_text` containing none of the found values, or the check fails closed.

## Guard: `/injection`

Called by the content gate inside the Pipeline.

- `source: 'content'`: says the text is retrieved data rather than a message from the operator.
- `instructions`: names the policy and the agent's rules, and says that text which quotes or explains an attack in order to inform the reader is not itself an injection. This is what lets a security article through.

`injection` is read against Gatehouse's thresholds. `evidence` gives the quoted passages for the reviewer.

## Verify: `/grounding`

Called by the report gate.

- `documents`: the tool logs, each with an `id`, so that evidence can point at one log.
- `answer`: the agent's final report.
- `question`: the brief, which adds `answers_question`: under 0.75 holds.
- `evidence: 'all'`: every claim gets its passage, not only the failing ones.
- `instructions`: says to judge only against the logs, and that a log which does not mention something does not establish it.

Each claim's `verdict` drives the result. A `contradicted` claim refuses, unless its probability is below the refuse line, when it holds. `not_stated` holds on a material subject such as tests, deploys, data or security, and is a note otherwise.

## Compare: `/compare`

Called by the report gate.

- `documents`: the brief and the changelog, with ids that the conflict passages refer back to.
- `instructions`: says the brief is the approved scope, and that work the brief asks for is not a conflict.

A listed conflict's `confidence` decides between refusing and holding. With no listed conflict, a `conflicting` relation or probability holds.

## Fill: `/fill`

Called by the action and report gates when the verdict so far is `HELD` or `REFUSED`.

- `text`: the brief, the action or the report, and the reasons, with personal data already redacted if any was found.
- `fields`: `summary` and `requested_decision` (`generate`, with `max_tokens`), `affected_system` (`extract`), `risk_level` (`score`, with levels) and `rollback_available` (`yes_no`).
- `instructions`: says to use only this record and to state unknowns as unknown.

The card is help for a person and never changes a verdict. A `rollback_available` of no adds a warning to a held action only at 0.75 confidence or above, because "there is no rollback" is a strong thing to tell someone.

## Pipeline: `/pipeline`

Called by the content gate.

- `text`: the content, which every step reads.
- `steps`: `injection`, then `pii`.
- `on_error: 'continue'`: one failed step still returns the other, so each check can report on its own.

A pipeline is one debit for all its steps, so Gatehouse shows the cost on the first check only. Reading both results in one request also means a redacted copy is ready as soon as Guard passes.
