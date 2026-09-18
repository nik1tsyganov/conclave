# R17 — Derive telemetry from authoritative outcomes

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

The runtime owns one terminal outcome per logical dispatch, including failed attempted work. A successful telemetry row must match its committed transaction, sealed plan entry, native proof and artifact hashes. Separate append operations alone do not establish a successful transaction. run-finalize checks the committed evidence before deciding execution completion and approval. Seats and the arbiter cannot add handwritten success rows to establish activation. Duplicate logical dispatches cannot count twice.

## Runtime source

The matching CONCLAVE release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
