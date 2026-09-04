---
name: magi-cli
description: Start or continue a MAGI Cursor CLI run (hostMode `cursor-cli`). Use when the user says magi-cli or /magi-cli. Not CONCLAVE, not `/magi` Task mode.
---

# /magi-cli

- If this chat is CONCLAVE (`/conclave`, `camerlengo-8`), stop: tell owner to open a new chat and type `/magi` or `/magi-cli`.
- Run `node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor-cli --slug <picker slug>`. Stop unless LEGAL. Elector slugs are FORBIDDEN as MAGI Cursor CLI arbiter; Grok only.
- Read `.cursor/skills/magi-cli/SKILL.md` and `references/cursor-cli.md`.
- Never Cursor Task to claude/gpt/gemini slugs — this mode spends vendor CLIs only (`codex.exe`, `agy.exe`, `claude.exe`). Grok does not implement.
- Three-vendor split via CLIs; activation-check (`node C:\src\magi\tools\activation-check.js <log path>`) and 60% floor same as `/magi`.
- Log path: product-repo runs write `C:\src\magi\projects\<slug>\magi-dispatch-log.jsonl`, never a log inside the product repo; MAGI-kit work uses `C:\src\magi\magi-dispatch-log.jsonl`. See `C:\src\magi\projects\README.md`.
- Magi CLI dispatches Claude through **`C:\Users\YESSIR\.local\bin\claude.exe -p --model fable --effort xhigh`** (owner 2026-09-02). Live 2026-09-02: `claude auth status` reported `loggedIn: true` (`claude.ai`, Max), and the headless Haiku probe returned `ready`. Re-run both checks in the dispatching session. Only a later probe with login/auth language, an empty capture, or off-topic text sets `degraded=true`; include that probe text and treat Codex+Gemini as a duo. Tally that duo with `node C:\src\magi\tools\position-tally.js --degraded`.
- `extra` is not a Claude Code effort name. Live `--help` lists `low, medium, high, xhigh, max`, so `xhigh` is the rung below `max`. Do not default to `max`; no verified cost multiplier exists for it.
