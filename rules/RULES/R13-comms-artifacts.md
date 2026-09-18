# R13 — Bind acknowledgments and receipts

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Every final response starts with the first line of its bound BRIEF.md. The runtime records the copied brief, generated seat contract, rules/skill manifests, native capture, proof and write audit. It commits the authoritative outcome under the sealed run's .magi-dispatches directory after all success artifacts and telemetry agree. The transaction binds the exact plan entry, plan hash, receipt ACK, handoff envelope and artifact hashes. A failed invocation remains recorded. A duplicate logical dispatch cannot create a second successful telemetry row.

For production Claude, the complete final report is the native terminal `structured_output.response` string from `--json-schema`. The runtime checks that unmodified string's exact bound-BRIEF first line. The text `result` field is not a fallback; missing or malformed structured output fails. All native proof, status, and scope requirements still apply. See [R16](R16-claude-probe.md) for the production/probe boundary. Other vendor output formats are unchanged.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
