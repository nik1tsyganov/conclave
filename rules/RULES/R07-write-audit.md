# R07 — Audit actual worktree changes

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Implementers must describe actual changes and test results. The runtime captures Git diff --stat, Git status --porcelain, file hashes, HEAD and index state and compares before/after snapshots against explicit write scope. Non-implementation roles have empty write scope. No-op implementation and out-of-scope covered writes fail. This is post-run detection, not rollback or a global filesystem sandbox.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
