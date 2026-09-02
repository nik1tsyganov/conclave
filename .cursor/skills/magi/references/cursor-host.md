# Cursor host

`/magi` uses native Cursor Task models. For every elector dispatch, set the role
with `subagent_type` and set `model` from this table. Never omit `model`.

| Seat | `subagent_type` by role | Required `model` |
|---|---|---|
| Balthasar (Anthropic) | `implementer` / `reviewer` / `verifier` | `claude-opus-5-thinking-high` |
| Melchior (OpenAI) | `implementer` / `reviewer` / `verifier` | `gpt-5.6-sol-medium` |
| Casper (Google) | `implementer` / `reviewer` / `verifier` | `gemini-3.1-pro` |

In hostMode `cursor`, never Task `codex-implementer`, `gemini-implementer`,
`codex-reviewer`, `gemini-reviewer`, `codex-verifier`, or `gemini-verifier`.
Those agents remain installed for Claude Code and CLI-backed modes.

Proof in this mode is the Cursor Task `model` slug plus the implementer's WRITE
AUDIT. Do not require or claim a CLI session id, conversation id, token count, or
other CLI proof token.

## Per-dispatch host failsafe

Before each Cursor Task to an elector slug, run:

```bash
node C:\src\magi\tools\host-resolver.js
```

Run it again when a Task fails with usage or quota language:

```bash
node C:\src\magi\tools\host-resolver.js --from cursor --error-text "<exact error>"
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

The arbiter writes one JSONL row per dispatched seat to the project's `telemetry/dispatches.jsonl` if the project has a `telemetry` directory; otherwise fall back to `C:\src\magi\telemetry\dispatches.jsonl`. Each row carries at least:

```json
{ "vendor": "anthropic|openai|google", "role": "implement|verify|review", "hostMode": "cursor", "routedBy": "arbiter" }
```

Only the lead writes telemetry; do not let a seat write its own row.

## Activation check

After implement dispatches, the lead writes one JSONL row per implement unit `{vendor, role:"implement"}` to `magi-dispatch-log.jsonl` at the project root (gitignored; do not commit secrets). Then run the activation check:

```bash
node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl
```

`activation-check.js` rejects checked-in fixtures, then calls `hog-check.js` to enforce the 60% vendor floor. Exit 0 = `FLOOR HOLDS`; exit 1 = `FAILED activation`.

## After implement

Cursor Task seats run `check-compiler-errors` and `deslop` when they edited code, and `verification-before-completion` before claiming done.

## Agent discovery

- Claude Code reaches the MAGI seats via wrappers already in `C:\Users\YESSIR\.claude\agents\`.
- Cursor Task uses `implementer`, `reviewer`, and `verifier` from the MAGI plugin `agents/` directory when enabled (copied to `C:\Users\YESSIR\.cursor\plugins\local\magi\agents`). Keep all plugin agents; the CLI wrapper agents still serve other host modes.
