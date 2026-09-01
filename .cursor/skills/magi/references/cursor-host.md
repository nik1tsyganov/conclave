# Cursor host

Cursor Task: `subagent_type` is the MAGI agent stem. Valid stems are the three implementers (`codex-implementer`, `gemini-implementer`, `implementer`) and the verify/review wrappers (`codex-verifier`, `gemini-verifier`, `verifier`, `codex-reviewer`, `gemini-reviewer`, `reviewer`). Never omit model.

Codex high uses CLI `-c model_reasoning_effort=high` when that seat runs via wrapper.

Gemini seated slug `gemini-3.1-pro-high`; Flash is not Casper evidence.

Proof: Codex session id + tokens; Gemini conversation_id + usage + log slug check.

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

## Agent discovery

- Claude Code reaches the MAGI seats via wrappers already in `C:\Users\YESSIR\.claude\agents\` (same stems as the plugin agents).
- Cursor Task uses the MAGI plugin `agents/` directory when the plugin is enabled (copied to `C:\Users\YESSIR\.cursor\plugins\local\magi\agents`). Keep both copies. Do not delete the plugin agents.
