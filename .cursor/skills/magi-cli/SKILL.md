---
name: magi-cli
description: MAGI Cursor CLI mode. Use when the user says magi-cli or /magi-cli. Grok arbiter dispatches via vendor CLIs; never Cursor Task to elector slugs. Not CONCLAVE.
---

# MAGI in Cursor CLI mode (`/magi-cli`)

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
12. `references/cursor-cli.md`
13. `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
14. `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini
15. `C:\Users\YESSIR\.claude\skills\claude-bridge\SKILL.md` when attempting Claude (binary present 2026-09-01; headless auth required)

## MAGI is not CONCLAVE

- Do not run `session-whoami.js` from CONCLAVE.
- Do not dispatch `camerlengo-8`.
- Run `magi-whoami` before activation.

## Cursor hostMode (`cursor-cli`)

- Grok classifies, briefs, dispatches, lead-writes telemetry, tallies.
- All seat dispatches go through vendor CLIs (`codex.exe`, `agy.exe`), never Cursor Task to claude/gpt/gemini slugs.
- Claude is reachable via `C:\Users\YESSIR\.local\bin\claude.exe` when authenticated; until `claude auth login` and an on-topic `-p` probe succeed, a Codex+Gemini split is a degraded duo. Record `degraded=true` and name the reduction reason.
- Any implement/review/vote by the arbiter is FAILED activation.

## Three-vendor implement split (degraded when Claude is unavailable)

Before the first write, split implement across the reachable vendors:

- Intake/cluster A → Codex CLI via `codex.exe`
- Intake/cluster B → Gemini CLI via `agy.exe`
- Intake/cluster C → Claude CLI is at `C:\Users\YESSIR\.local\bin\claude.exe`, auth required; record `degraded=true` and redistribute its work to Codex/Gemini or pause.

Permute if needed; Casper must not be idle.

While capacity-state `distributionBreaker` is tripped, do not give Claude the majority of implement units (Claude is auth-required in this mode; the floor applies to the two reachable vendors until `claude auth login` and an on-topic `-p` probe succeed).

Enforce the 60% floor per vendor.

Each implementer must paste WRITE AUDIT (`git diff --stat` + `git status --porcelain`).

After implement rows, write `magi-dispatch-log.jsonl` at the project root `{vendor, role:"implement"}` (gitignored) and run `node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`. Exit 1 = FAILED activation. Do not use `dispatch-log.pass.jsonl` as a live log.

## Illegal returns

- Do not run `magi-battery.js` or `mix-run.js` under plain node.
- Parse check only: `node C:\Users\YESSIR\.claude\workflows\checks\magi-workflow-cli.mjs`

## Other

- Packs are installed under `~\.cursor\plugins\local\` (cursor-team-kit, superpowers, continual-learning). Use them as defaults per `~\.cursor\rules\cursor-packs.mdc`. They do not replace MAGI dispatch. Continual Learning auto-`AGENTS.md` is forbidden.
- Put the SCOPE block from `engineering-orchestrator` in every seat brief.
