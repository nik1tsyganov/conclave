# R16 — Use live Claude authentication and headless proof

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Before a Claude task, run the native auth-status check. Before admitting a model/effort route, obtain a fresh headless challenge response with canonical native model/session/usage metadata. Do not infer authentication or reachability from old notes. Failed probes leave the route unavailable; do not silently relabel another model or fabricate a degraded success.

Production Claude non-implementation launches use `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`, the schema 5 `read-only-tools` profile. They can read files and existing test evidence, but cannot execute shell commands. Plan mode requires a separate approval turn and cannot reliably complete unattended leaf verification. Implementation launches retain `--permission-mode bypassPermissions` with `--safe-mode`.

Native safe mode disables global customization and hooks while preserving subscription authentication and role permissions. Do not substitute `--bare`, which disables OAuth. These controls do not sandbox vendor home directories.

Production Claude dispatches request native `--json-schema`. Put the complete final report in the schema's `response` string, captured as terminal `structured_output.response`. The runtime checks its unmodified exact bound-BRIEF first line, as required by [R13](R13-comms-artifacts.md). It does not use the text `result` field as a fallback. Missing or malformed structured output fails. Native success, session, canonical model, observed effort, usage, and scope checks remain mandatory. Standalone `model-probe.js` keeps its existing challenge-response format; this production envelope does not change the authentication or model probe.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
