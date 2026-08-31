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
10. `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
11. `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini

## MAGI is not CONCLAVE

- Do not run `session-whoami.js` from CONCLAVE.
- Do not dispatch `camerlengo-8`.
- Run `magi-whoami` before activation.

## Cursor hostMode

- Grok classifies, briefs, dispatches, lead-writes telemetry, tallies.
- Any implement/review/vote by the arbiter is FAILED activation.

## Three-vendor implement split

Before the first write, split implement across THREE vendors:

- Intake/cluster A → Task subagent_type `codex-implementer`
- B → `gemini-implementer`
- C → `implementer`

Permute if needed; Casper must not be idle.

While capacity-state `distributionBreaker` is tripped, do not give Claude the majority of implement units.

Enforce the 60% floor per vendor.

Each implementer must paste WRITE AUDIT (`git diff --stat` + `git status --porcelain`).

After implement rows, write `tools/dispatch-log.jsonl` `{vendor, role:"implement"}` (gitignored) and run `node tools/hog-check.js tools/dispatch-log.jsonl`. Exit 1 = FAILED activation. Do not use `dispatch-log.pass.jsonl` as a live log.

## Illegal returns

- Do not run `magi-battery.js` or `mix-run.js` under plain node.
- Parse check only: `node C:\Users\YESSIR\.claude\workflows\checks\magi-workflow-cli.mjs`

## Other

- Do not install Superpowers / Team Kit / Continual Learning packs.
- Put the SCOPE block from `engineering-orchestrator` in every seat brief.
