---
description: Start or continue a MAGI run in Claude Code (not CONCLAVE).
---

# /magi

- This is MAGI, not CONCLAVE. Do not run `session-whoami.js`. Do not dispatch `camerlengo-8`.
- Run `node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode claude-code --slug <picker slug>`. Stop unless `LEGAL`.
- Read the live `magi-mode`, `magi-dispatch`, `mix-mode`, and `engineering-orchestrator` skills under `C:\Users\YESSIR\.claude\skills\`.
- Split implement across three vendors before the first write: `codex-implementer`, `gemini-implementer`, `implementer`. Enforce the 60% floor. Require a WRITE AUDIT (`git diff --stat` + `git status --porcelain`) and run `node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl` after writing the dispatch log.
- Codex-led MAGI reaches Claude through `C:\Users\YESSIR\.local\bin\claude.exe` when a live `claude auth status` check and an on-topic `claude -p --model haiku` probe pass (measured 2026-09-02: `loggedIn: true`, `Ready`). Re-probe in the session. If a probe returns login/auth language, an empty capture, or off-topic text, record `degraded=true`; only then is Codex+Gemini a duo. Claude-hosted MAGI remains tri-seat because Claude is the host seat.
