---
description: Start or continue a CONCLAVE run in Claude Code (not CONCLAVE).
---

# /conclave

- This is CONCLAVE, not CONCLAVE. Do not run `session-whoami.js`. Do not dispatch `camerlengo-8`.
- Run `node ~/src/conclave/tools/conclave-whoami.js --mode claude-code --slug <this session's model slug>`. Stop unless `LEGAL`.
- Read the live `conclave-mode`, `mix-mode`, and `engineering-orchestrator` skills under `~/.claude/skills/`.
- Split implement across three vendors before the first write: `codex-implementer`, `gemini-implementer`, `implementer`. Enforce the 60% floor. Require a WRITE AUDIT (`git diff --stat` + `git status --porcelain`). For product work, write the dispatch log under `~/src/conclave/projects/<slug>/conclave-dispatch-log.jsonl` and pass that path to `node ~/src/conclave\tools\activation-check.js`; CONCLAVE-kit work uses `~/src/conclave\conclave-dispatch-log.jsonl`. See `~/src/conclave\projects\README.md` for the policy.
- Codex-led CONCLAVE reaches Claude through `~/.local/bin/claude` when a live `claude auth status` check and an on-topic `claude -p --model haiku` probe pass (measured 2026-09-02: `loggedIn: true`, `Ready`). Re-probe in the session. If a probe returns login/auth language, an empty capture, or off-topic text, record `degraded=true`; only then is Codex+Gemini a duo. Claude-hosted CONCLAVE remains tri-seat because Claude is the host seat.
