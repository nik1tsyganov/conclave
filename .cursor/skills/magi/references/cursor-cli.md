# Cursor CLI host mode (`cursor-cli`)

`/magi-cli` runs the MAGI panel through vendor CLIs instead of Cursor Task. The Grok arbiter still classifies, briefs, dispatches, records telemetry, and tallies; it does not implement, review, verify, or vote.

## Required reading

- `.cursor/skills/magi/SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-mode\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-dispatch\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
- `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini
- `C:\Users\YESSIR\.claude\skills\claude-bridge\SKILL.md` — binary present 2026-09-01 at `C:\Users\YESSIR\.local\bin\claude.exe`; headless auth required, see `claude-bridge` operational status

## How the arbiter reaches each seat

| Seat | Vendor | CLI | Path |
|---|---|---|---|
| Melchior (codex) | OpenAI | `codex exec` | `C:\Users\YESSIR\tools\bin\codex.exe` |
| Casper (gemini) | Google | `agy` | `C:\Users\YESSIR\tools\bin\agy.exe` |
| Balthasar (claude) | Anthropic | `claude` | `C:\Users\YESSIR\.local\bin\claude.exe` — binary present 2026-09-01; headless auth required, `degraded=true` until an on-topic `-p` probe |

A Codex+Gemini pair is a **duo**, not a full MAGI panel. Record `degraded=true` and name the reduction reason.

## Mechanics

- Prompt via **stdin**, never as a positional argument. See `codex-bridge` and `gemini-bridge` for the exact recipes.
- Capture vendor-native proof on every dispatch: Codex `session id` + `tokens used`; Gemini `conversation_id` + `usage` + per-run log slug check.
- Telemetry row must carry `hostMode: cursor-cli` and `routedBy: arbiter`.
- Never omit the WRITE AUDIT (`git diff --stat` + `git status --porcelain`), the 60% vendor floor, or the activation check (`node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`).
- Every MAGI Gemini `agy` dispatch MUST pass `--add-dir C:\Users\YESSIR\.claude\skills` (and `C:\Users\YESSIR\.claude\docs` if docs are needed). Name `magi-mode` and `magi-dispatch` in the brief. Close stdin after piping the prompt (`agy` hangs if stdin is left open).
- Codex reads `~\.codex\skills\magi-mode` (already mirrored). The brief must name `magi-mode`, `magi-dispatch`, `mix-mode`, the 60% vendor floor, WRITE AUDIT, and `activation-check`.
- Never Cursor Task to claude/gpt/gemini slugs in this mode — that would spend exhausted Cursor model usage.
