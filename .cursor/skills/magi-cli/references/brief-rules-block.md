# Magi CLI brief RULES block

Every Magi CLI seat brief MUST include the RULES block below. CLI seats cannot
load Cursor plugins; vault standing rules are how they receive MAGI law. The
pointer already forces Read of the brief file and a first-line echo.

Required markers (fail-closed): `magi-cli-rules` or the `STANDING.md` path,
`magi-mode`, `magi-dispatch`, `casper_via=agy` or explicit `agy` (Casper is
`agy.exe`, not PATH gemini), plus `pointer` / `receipt` / `envelope`. Check with:

```
node C:\src\magi\tools\cli-brief-rules-check.js --brief <file>
```

`tools/cli-smoke.js` runs the same check before a dry-run.

## RULES

Read `C:\src\ai-ops-vault\projects\magi-cli-rules\STANDING.md` in full before any work. Repeat its first line verbatim before anything else.

This seat follows `magi-mode` and `magi-dispatch`. Casper is `agy` (`casper_via=agy`, `agy.exe`). Magi cannot load Cursor plugins on CLI seats.

Briefs travel as a file pointer (`cli-pointer`). Open with a `receipt.v1` ACK. Seat handoff uses `handoff-envelope.v1`.
