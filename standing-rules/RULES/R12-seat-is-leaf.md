# R12 — A seat is a leaf

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

Do not delegate to another model, spawn a model agent, change routing or make yourself coordinator. The supported runtime refuses nested CONCLAVE dispatch; native Codex multi-agent features and Claude delegation tools are disabled. The staged skill pack contains no bridge/orchestration skills. Enforced natively since 2026-09-16: Claude seats launch with `--disallowedTools Agent,Task`, Codex seats with `features.multi_agent=false`, and a Google seat whose per-run log shows any agy sub-agent tool (`invoke_subagent`, `define_subagent`, `manage_subagents`, `browser_subagent`) fails proof (R18). A run also caps concurrent dispatches (`principles.maxConcurrentDispatches`). Arbitrary same-user shell access cannot be made a complete security perimeter by these flags; use host isolation where that stronger guarantee is required.

Anthropic non-implementation roles use the `read-only-tools` profile. Only Read, Glob and Grep are exposed and allowed. These seats may inspect files and existing test evidence, but cannot execute shell commands. Their briefs must provide the evidence needed for review or verification.

## Runtime source

The matching CONCLAVE release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
