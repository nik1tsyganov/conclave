# Magi CLI brief RULES block

Every Magi CLI seat brief MUST include the RULES block below. CLI seats cannot
load Cursor plugins; vault standing rules are how they receive MAGI law. The
pointer already forces Read of the brief file and a first-line echo.

Required markers (fail-closed): `magi-cli-rules` or the `STANDING.md` path,
plus `magi-mode` and `magi-dispatch`. Check with:

```
node C:\src\magi\tools\cli-brief-rules-check.js --brief <file>
```

`tools/cli-smoke.js` runs the same check before a dry-run.

## RULES

Read `C:\src\ai-ops-vault\projects\magi-cli-rules\STANDING.md` in full before any work. Repeat its first line verbatim before anything else.

This seat follows `magi-mode` and `magi-dispatch`. Casper is `agy` (`agy.exe`). Magi cannot load Cursor plugins on CLI seats.
