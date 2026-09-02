# Cursor CLI host mode (`cursor-cli`)

`/magi-cli` runs the MAGI panel through vendor CLIs instead of Cursor Task. The Grok arbiter still classifies, briefs, dispatches, records telemetry, and tallies; it does not implement, review, verify, or vote.

## Required reading

- `.cursor/skills/magi/SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-mode\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-dispatch\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
- `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini
- `C:\Users\YESSIR\.claude\skills\claude-bridge\SKILL.md` — binary present 2026-09-01 at `C:\Users\YESSIR\.local\bin\claude.exe`; dispatch with `--model fable --effort xhigh`; headless auth required, see `claude-bridge` operational status

## How the arbiter reaches each seat

| Seat | Vendor | CLI | Path |
|---|---|---|---|
| Melchior (codex) | OpenAI | `codex exec` | `C:\Users\YESSIR\tools\bin\codex.exe` |
| Casper (gemini) | Google | `agy` | `C:\Users\YESSIR\tools\bin\agy.exe` |
| Balthasar (claude) | Anthropic | `claude --model fable --effort xhigh` | `C:\Users\YESSIR\.local\bin\claude.exe` — binary present 2026-09-01; headless auth required, `degraded=true` until an on-topic `-p` probe |

A Codex+Gemini pair is a **duo**, not a full MAGI panel. Record `degraded=true` and name the reduction reason.

## Claude seat model and effort (owner 2026-09-02)

The Magi CLI Claude seat runs **`--model fable --effort xhigh`**. Verified live against `claude.exe --help` on this machine 2026-09-02: `--effort <level>` accepts `low, medium, high, xhigh, max`, and `--model` takes aliases including `fable`.

- The owner said "Extra". **`extra` is not a Claude Code effort name** — the rung below `max` is `xhigh`, so this mode uses `xhigh`.
- **`max` is not the default here.** Effort is a behavioral signal, not a published price multiplier; the extra cost is extra thinking and output volume. Anthropic publishes no multiplier figure, and community reports of 3–5x over `high` are UNVERIFIED — do not quote a number as fact.
- This overlay applies to `hostModes.modes.cursor-cli` only. The global seat `seats.balthasar-2` in `magi-seats.json` still reads model `opus`, effort `high`; changing it is a MAGI DECISION, not a host-mode overlay.
- Auth is still required. Until `claude auth login` and an on-topic `-p` probe succeed, the Claude seat is `degraded=true` with reason `claude auth login required` — Fable at `xhigh` does not change that. A missing login is NOT RUN, never a pass.

## Why a `/magi` session can land here mid-task

`node C:\src\magi\tools\host-resolver.js` decides the host mode. When Cursor Task model usage trips, a `/magi` (`cursor`) session resolves to `cursor-cli` and the panel finishes on vendor CLIs. So this file governs from that point in the same run: re-read the seat table above, and stop issuing Cursor Task calls to elector slugs.

## Mechanics

- Prompt via **stdin**, never as a positional argument. See `codex-bridge` and `gemini-bridge` for the exact recipes — the Codex and Gemini recipes are **unchanged** by the 2026-09-02 Claude overlay.
- Claude dispatch shape: pipe the prompt into `claude -p --model fable --effort xhigh`, capture to a file, then check the capture is non-empty AND on-topic. Mechanics in `claude-bridge`.
- Capture vendor-native proof on every dispatch: Codex `session id` + `tokens used`; Gemini `conversation_id` + `usage` + per-run log slug check; Claude the captured on-topic reply plus the model/effort the dispatch passed.
- Telemetry row must carry `hostMode: cursor-cli` and `routedBy: arbiter`.
- Never omit the WRITE AUDIT (`git diff --stat` + `git status --porcelain`), the 60% vendor floor, or the activation check (`node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl`).
- Every MAGI Gemini `agy` dispatch MUST pass `--add-dir C:\Users\YESSIR\.claude\skills` (and `C:\Users\YESSIR\.claude\docs` if docs are needed). Name `magi-mode` and `magi-dispatch` in the brief. Close stdin after piping the prompt (`agy` hangs if stdin is left open).
- Codex reads `~\.codex\skills\magi-mode` (already mirrored). The brief must name `magi-mode`, `magi-dispatch`, `mix-mode`, the 60% vendor floor, WRITE AUDIT, and `activation-check`.
- Never Cursor Task to claude/gpt/gemini slugs in this mode — that would spend exhausted Cursor model usage.

## Cursor plugin boundary

CLI seats cannot load Cursor plugins. They still run the project's own typecheck, tests, and WRITE AUDIT. The Grok arbiter may use Team Kit in its own Cursor chat after the merge.
