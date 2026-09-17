# Cursor host

`/conclave` uses native Cursor Task models. For every elector dispatch, set the role
with `subagent_type` and set `model` from this table. Never omit `model`.

| Seat | `subagent_type` by role | Required `model` |
|---|---|---|
| Scrutator (Anthropic) | `implementer` / `reviewer` / `verifier` | `claude-opus-5-thinking-high` |
| Ponens (OpenAI) | `implementer` / `reviewer` / `verifier` | `gpt-5.6-sol-medium` |
| Advocatus (Google) | `implementer` / `reviewer` / `verifier` | `gemini-3.1-pro` |

In hostMode `cursor`, never Task `codex-implementer`, `gemini-implementer`,
`codex-reviewer`, `gemini-reviewer`, `codex-verifier`, or `gemini-verifier`.
Those agents remain installed for Claude Code and CLI-backed modes.

Proof in this mode is the Cursor Task `model` slug plus the implementer's WRITE
AUDIT. Do not require or claim a CLI session id, conversation id, token count, or
other CLI proof token.

## Brief delivery

Write each seat's brief to a file first — under the session's conclave-bus
directory or the repo — never into the Task `prompt`. The Task `prompt` carries
only the pointer sentence built by `tools/task-delivery.js`:

```bash
node -e "console.log(require('$HOME/src/conclave/tools/task-delivery.js').buildTaskPrompt(process.argv[1]).prompt)" "<brief path>"
```

`buildTaskPrompt` refuses a missing brief file and an empty (0-byte) brief.
Before dispatch, check the prompt with `assertTaskPrompt(prompt, briefBody,
briefPath)`; it refuses a prompt that contains the brief body (when the body is
over 80 chars), a prompt missing the resolved brief path, and a prompt over
2000 chars. Never paste the brief body into `prompt` — a pasted body drifts
from the file it came from, breaks on quoting, and overflows the Task prompt
window.

## Per-dispatch host failsafe

Before each Cursor Task to an elector slug, run:

```bash
node $HOME/src/conclave\tools\host-resolver.js
```

Run it again when a Task fails with usage or quota language:

```bash
node $HOME/src/conclave\tools\host-resolver.js --from cursor --error-text "<exact error>"
```

If the resolver
trips, route all remaining seats through hostMode `cursor-cli`. Do not persist a
global mode; the decision is per dispatch.

## Multi-vendor review

Review uses the vendors other than the implement author. Permute implementation
across vendors so one vendor does not always implement while the other two only
grade. Add the third reviewer only when the task class or owner marks the review
contested; do not convene a vote-everything panel.

## Lead-written telemetry

The arbiter writes one JSONL row per dispatched seat. When the project has its own `telemetry` directory, the arbiter passes `--log <project>\telemetry\dispatches.jsonl`; otherwise it uses the tool's default, `$HOME/src/conclave\telemetry\dispatches.jsonl` (the tool does not pick a project path by itself). Each row carries at least:

```json
{ "vendor": "anthropic|openai|google", "role": "implement|verify|review", "hostMode": "cursor", "routedBy": "arbiter" }
```

Write and read rows mechanically, never by hand-editing the log:

```bash
node $HOME/src/conclave\tools\telemetry-append.js --row '<json>'
node $HOME/src/conclave\tools\telemetry-stats.js
node $HOME/src/conclave\tools\validate-telemetry.js --log <path>
```

The formal row schema is `telemetry/schema.json`. `validate-telemetry.js` checks that schema. `--adapt` wraps a valid Conclave row for unified ingest; it does not invent a join key toward Conclave hook rows. See `telemetry/README.md`.

`hostMode` and `routedBy` are required; `telemetry-append.js` rejects a row
without them. Token fields (`vendorSideTokens`, `totalTokens`) are a positive
number or `null` — missing telemetry stays absent or `null`, never `0`, and a
`0` is rejected. The default file is `$HOME/src/conclave\telemetry\dispatches.jsonl`
(gitignored; never commit rows); pass `--log <path>` to append to a
project-local `telemetry/dispatches.jsonl` instead. Only the lead writes
telemetry; do not let a seat write its own row. No hook captures dispatches in
Cursor — a row exists only because the lead ran `telemetry-append.js` in the
same turn as the dispatch.

## Activation check

After implement dispatches, the lead writes one JSONL row per implement unit `{vendor, role:"implement"}` to `conclave-dispatch-log.jsonl` (gitignored; do not commit secrets). Then run the activation check:

```bash
node $HOME/src/conclave\tools\activation-check.js <log path>
```

Log path: product-repo runs write `$HOME/src/conclave\projects\<slug>\conclave-dispatch-log.jsonl`, never a log inside the product repo; CONCLAVE-kit work uses `$HOME/src/conclave\conclave-dispatch-log.jsonl`. See `$HOME/src/conclave\projects\README.md`.

`activation-check.js` rejects checked-in fixtures, then calls `hog-check.js` to enforce the 60% vendor floor. Exit 0 = `FLOOR HOLDS`; exit 1 = `FAILED activation`.

## POSITION tally

After the panel returns POSITION ballots, tally them with the shared passage tool. Do not hand-count. Gate-role reviews (implementer / reviewer / verifier) stay advisory.

```bash
node $HOME/src/conclave\tools\position-tally.js --ballots '<json>' --json
```

Passage is `>=2 APPROVE` among eligible electors; `ABSTAIN` never toward passage. Counted eligible ballots below 2 is `NOT_PANEL` (`degraded=true`, `reason=quorumFloor`) — fail closed, shared with CONCLAVE. Else `DEADLOCK`. `--author-vendor` recuses the implement author. `--degraded` is the cursor-cli Claude fail path only. Idle Advocatus is `FAILED activation`, not a duo. See README.md for the CONCLAVE alignment note.

## After implement

Cursor Task seats run `check-compiler-errors` and `deslop` when they edited code, and `verification-before-completion` before claiming done. Seats should `acknowledgeReceipt` (`tools/receipt-ack.js`) before claiming done.

## Agent discovery

- Claude Code reaches the CONCLAVE seats via wrappers already in `$HOME\.claude\agents\`.
- Cursor Task uses `implementer`, `reviewer`, and `verifier` from the CONCLAVE plugin `agents/` directory when enabled (copied to `$HOME\.cursor\plugins\local\conclave\agents`). Keep all plugin agents; the CLI wrapper agents still serve other host modes.
