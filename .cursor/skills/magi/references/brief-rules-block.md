# Magi CLI brief RULES block

Every Magi CLI seat brief MUST include the RULES block below. CLI seats cannot
load Cursor plugins; vault standing rules are how they receive MAGI law. The
pointer already forces Read of the brief file and a first-line echo.

Research MUST-name list (authoritative):

- Always name: `magi-mode`, `magi-dispatch`, `engineering-orchestrator` SCOPE
- `mix-mode`: always on Codex briefs; recommended on all seats
- Name the vendor bridge when dispatching that vendor: `codex-bridge` /
  `gemini-bridge` / `claude-bridge`

Pack shape under `briefDir`:

```
BRIEF.md
VENDOR.md          (must carry casper_via=agy)
RULES/INDEX.md
R01.md … R20.md    (rule bodies; R02 vendor map, R14 agy --add-dir skills)
```

The pointer may hash `BRIEF.md` + `RULES/INDEX.md`.

Required markers (fail-closed):

- `magi-mode`
- `magi-dispatch`
- `casper_via=agy`
- `RULES/INDEX.md` or `magi-cli-rules` or `STANDING.md`

Check with:

```
node C:\src\magi\tools\cli-brief-rules-check.js --brief <file>
```

`tools/cli-smoke.js` runs the same check before a dry-run, and asserts the
google/`agy` plan includes `--add-dir ...\.claude\skills` (R14).

## RULES

Read `RULES/INDEX.md` (or `C:\src\ai-ops-vault\projects\magi-cli-rules\STANDING.md`) in full before any work. Repeat its first line verbatim before anything else.

This seat follows `magi-mode` and `magi-dispatch`. Put the SCOPE block from `engineering-orchestrator` in this brief. Casper is `agy` (`casper_via=agy` in `VENDOR.md`). Magi cannot load Cursor plugins on CLI seats.

R02 is the vendor map. R14: every `agy` launch MUST `--add-dir ...\.claude\skills`. Name `mix-mode` on Codex (recommended on all). Name `codex-bridge` / `gemini-bridge` / `claude-bridge` when dispatching that vendor.

Recommended (not fail-closed): briefs travel as a file pointer (`cli-pointer`); open with a `receipt.v1` ACK; seat handoff uses `handoff-envelope.v1`.
