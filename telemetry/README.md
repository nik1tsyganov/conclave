# MAGI Telemetry

This directory holds the self-evaluation telemetry log for MAGI Cursor CLI dispatches.

Because Cursor has no capture hook, the Grok arbiter lead-writes a row to `dispatches.jsonl` after every CLI/Task dispatch using `tools/telemetry-append.js`. 

## Required Fields

As per `cursor-host.md`, each log row must include:
- `vendor`: `anthropic` | `openai` | `google`
- `role`: The seat's role (e.g. implement, verify, review)
- `hostMode`: The host context string
- `routedBy`: `arbiter`

## Self-Evaluation Questions

This telemetry exists to answer these self-eval questions:
- **Vendor implement share:** Are we relying too heavily on one vendor for implementation?
- **Idle seat:** Are seats being dispatched but returning without capturing work?
- **proofPresent rate:** How often does a verification step actually include a verifiable proof?
- **null-token rate:** Are we dropping token tracking on dispatches?

## Critical Notes

- **NOT the Claude-host log:** This log is strictly for MAGI Cursor self-eval and is NOT the Claude-host file `C:\Users\YESSIR\.claude\docs\telemetry\dispatch-telemetry.jsonl`. Do not dual-write to that file (it is hook-fed).
- **Operational Status:** Do not claim operational status (logged in, quota) from memory. `Live-check.mdc` applies.
