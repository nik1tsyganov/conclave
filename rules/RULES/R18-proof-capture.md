# R18 — Require vendor-native execution evidence

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Codex requires a native session ID, token count, sandbox, observed model and observed effort. Google/agy requires a successful envelope with conversation ID, usage, nonempty response and exact per-conversation observed model slug; its effort is fused into that slug. Claude requires structured native success, session, numeric usage, canonical identity from assistant metadata/modelUsage, and session-bound native observed effort. Requested model or effort cannot replace missing observation. Missing, conflicting or changed evidence fails the dispatch.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
