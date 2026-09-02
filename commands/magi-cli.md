---
name: magi-cli
description: Start or continue a MAGI Cursor CLI run (hostMode `cursor-cli`). Use when the user says magi-cli or /magi-cli. Not CONCLAVE, not `/magi` Task mode.
---

# /magi-cli

- If this chat is CONCLAVE (`/conclave`, `camerlengo-8`), stop: tell owner to open a new chat and type `/magi` or `/magi-cli`.
- Run `node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor-cli --slug <picker slug>`. Stop unless LEGAL. Elector slugs are FORBIDDEN as MAGI Cursor CLI arbiter; Grok only.
- Read `.cursor/skills/magi-cli/SKILL.md` and `references/cursor-cli.md`.
- Never Cursor Task to claude/gpt/gemini slugs — this mode spends vendor CLIs only (`codex.exe`, `agy.exe`, `claude.exe`). Grok does not implement.
- Three-vendor split via CLIs; activation-check (`node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`) and 60% floor same as `/magi`.
- Claude CLI is installed at `C:\Users\YESSIR\.local\bin\claude.exe` (binary present 2026-09-01) and dispatches with **`--model fable --effort xhigh`** (owner 2026-09-02); headless auth required. A Codex+Gemini split is a degraded duo until `claude auth login` and an on-topic `-p` probe succeed; record `degraded=true` and name the reduction reason.
- `extra` is not a Claude Code effort name. Live `--help` lists `low, medium, high, xhigh, max`, so `xhigh` is the rung below `max`. Do not default to `max`; no verified cost multiplier exists for it.
