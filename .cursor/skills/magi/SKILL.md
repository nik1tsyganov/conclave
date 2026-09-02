---
name: magi
description: MAGI in Cursor. Use when the user says magi or /magi. Grok routes Claude+Codex+Gemini. Not CONCLAVE.
---

# MAGI in Cursor

## Required reading (LIVE files — read from these paths, do not copy)

Read these files in order:

1. `C:\Users\YESSIR\.claude\skills\engineering-orchestrator\SKILL.md`
2. `C:\Users\YESSIR\.claude\skills\graph-engineering\SKILL.md`
3. `C:\Users\YESSIR\.claude\skills\loop-engineering\SKILL.md`
4. `C:\Users\YESSIR\.claude\skills\harness-engineering\SKILL.md`
5. `C:\Users\YESSIR\.claude\skills\evaluation-engineering\SKILL.md`
6. `C:\Users\YESSIR\.claude\skills\context-engineering\SKILL.md`
7. `C:\Users\YESSIR\.claude\skills\magi-mode\SKILL.md`
8. `C:\Users\YESSIR\.claude\skills\magi-dispatch\SKILL.md`
9. `C:\Users\YESSIR\.claude\skills\mix-mode\SKILL.md`
10. `C:\Users\YESSIR\.claude\skills\dispatch-efficiency\SKILL.md`
11. `C:\Users\YESSIR\.claude\skills\task-retrospective\SKILL.md`
12. `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
13. `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini
14. `.cursor/skills/magi/references/cursor-cli.md` (used after a host trip)
15. `C:\Users\YESSIR\.claude\skills\claude-bridge\SKILL.md` (needed when tripped)

## MAGI is not CONCLAVE

- Do not run `session-whoami.js` from CONCLAVE.
- Do not dispatch `camerlengo-8`.
- Run `magi-whoami` before activation.

## Cursor hostMode

- `/magi` uses hostMode `cursor`: Grok arbiter dispatches native Cursor Task
  seats. Each Task uses `implementer`, `reviewer`, or `verifier` and MUST set
  `model` to `claude-opus-5-thinking-high`, `gpt-5.6-sol-medium`, or
  `gemini-3.1-pro` for the assigned vendor. Never Task a `codex-*` or `gemini-*`
  CLI wrapper in this mode.
- `/magi-cli` uses hostMode `cursor-cli`: Grok arbiter dispatches via vendor CLIs (`codex.exe`, `agy.exe`, `claude.exe`); never Cursor Task to elector slugs. Claude is reached via `C:\Users\YESSIR\.local\bin\claude.exe` when authenticated; until `claude auth login` and an on-topic `-p` probe succeed, a Codex+Gemini split is a duo.
- Any implement/review/vote by the arbiter is FAILED activation in both Cursor modes.
- Before each Cursor elector Task, and after a Task fails with usage or quota
  language, run `node C:\src\magi\tools\host-resolver.js`. If it trips, send
  remaining seats through `cursor-cli`; do not persist a global mode.

## Three-vendor implement split

Before the first write, split implement across THREE vendors:

- Intake/cluster A → Task `implementer`, model `gpt-5.6-sol-medium`
- B → Task `implementer`, model `gemini-3.1-pro`
- C → Task `implementer`, model `claude-opus-5-thinking-high`

Permute the vendors across implement units; Casper must not be idle. Review and
verification use the same model table with Task `reviewer` and `verifier`.
Review goes to the vendors other than the author. Add the third reviewer only
when the task class or owner marks the review contested.

While capacity-state `distributionBreaker` is tripped, do not give Claude the majority of implement units.

Enforce the 60% floor per vendor.

Each implementer must paste WRITE AUDIT (`git diff --stat` + `git status --porcelain`).

After implement rows, write `magi-dispatch-log.jsonl` at the project root `{vendor, role:"implement"}` (gitignored) and run `node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`. Exit 1 = FAILED activation. Do not use `dispatch-log.pass.jsonl` as a live log.

## Illegal returns

- Do not run `magi-battery.js` or `mix-run.js` under plain node.
- Parse check only: `node C:\Users\YESSIR\.claude\workflows\checks\magi-workflow-cli.mjs`

## Packs (efficiency, not routers)

Cursor Task seats may use these local Cursor plugin packs as efficiency skills; they do not replace MAGI dispatch:

- Team Kit: `check-compiler-errors`, `deslop`, `verify-this`, `control-cli`, `control-ui`, `ci-watcher`, `fix-ci`, `loop-on-ci`
- Superpowers: `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `receiving-code-review`

CLI seats (`cursor-cli`) cannot load Cursor plugins; they run the equivalent project checks directly (typecheck, tests, WRITE AUDIT). The arbiter may use Team Kit in its own Cursor chat after a merge.

Do not use as routers: `using-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `subagent-driven-development`, `brainstorming`, `review-and-ship`, `new-branch-and-pr`, `agents-memory-updater`. Continual Learning remains owner-invoked `/continual-learning` only.

See `~\.cursor\rules\cursor-packs.mdc`.

## Other

- Put the SCOPE block from `engineering-orchestrator` in every seat brief.
