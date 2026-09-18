# R08 — Keep the evidence bus outside product worktrees

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Each run has a distinct evidence directory outside every product worktree. Each planned dispatch has its own immutable attempt directory. Successful/failed terminal receipts are the authority; telemetry and implementation JSONL files are rebuilt projections. Do not use fixture logs or manually written vendor rows as execution provenance.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
