---
name: magi
description: Start or continue a MAGI Cursor run (hostMode `cursor`). Use when the user says magi or /magi. Not CONCLAVE, not `/magi-cli`.
---

# /magi

- If this chat is CONCLAVE (`/conclave`, `camerlengo-8`), stop: tell owner to open a new chat and type `/magi` or `/magi-cli`.
- Read `.cursor/skills/magi/SKILL.md`.
- Run: `node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor --slug <picker slug>`
- Stop unless LEGAL exit 0. Elector slugs (claude/gpt/gemini) are FORBIDDEN as MAGI Cursor arbiter.
- Follow `cursor-host.md` dispatch. Arbiter never implements.
- After implement dispatches, write one JSONL row per implement unit `{vendor, role:"implement"}` to `magi-dispatch-log.jsonl` at the project root (gitignored; do not commit secrets).
- Run the activation check: `node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`.
