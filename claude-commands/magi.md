---
description: Start or continue a MAGI run in Claude Code (not CONCLAVE).
---

# /magi

- This is MAGI, not CONCLAVE. Do not run `session-whoami.js`. Do not dispatch `camerlengo-8`.
- Run `node ~/src/magi/tools/magi-whoami.js --mode claude-code --slug <this session's model slug>`. Stop unless `LEGAL`.
- Read the live `magi-mode`, `mix-mode`, and `engineering-orchestrator` skills under `~/.claude/skills/`.
- Split implement across three vendors before the first write: `codex-implementer`, `gemini-implementer`, `implementer`. Enforce the 60% floor. Require a WRITE AUDIT (`git diff --stat` + `git status --porcelain`). For product work, write the dispatch log under `~/src/magi/projects/<slug>/magi-dispatch-log.jsonl` and pass that path to `node ~/src/magi\tools\activation-check.js`; MAGI-kit work uses `~/src/magi\magi-dispatch-log.jsonl`. See `~/src/magi\projects\README.md` for the policy.
- Codex-led MAGI reaches Claude through `~/.local/bin/claude` when a live `claude auth status` check and an on-topic `claude -p --model haiku` probe pass (measured 2026-09-02: `loggedIn: true`, `Ready`). Re-probe in the session. If a probe returns login/auth language, an empty capture, or off-topic text, record `degraded=true`; only then is Codex+Gemini a duo. Claude-hosted MAGI remains tri-seat because Claude is the host seat.
