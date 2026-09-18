# R01 — Use the production CLI transaction

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Use hostMode `cursor-cli`, `synara` or `claude-code` (the session that runs the tools; the arbiter is the Jev decision engine, R10). Every production seat is a row in a sealed whole-run plan and launches through `dispatch-run --plan ... --run-dir ... --dispatch-id ...`. Raw vendor commands and historical wrappers are diagnostics; they do not create verified production receipts.

## Runtime source

The matching CONCLAVE release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
