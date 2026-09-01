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
