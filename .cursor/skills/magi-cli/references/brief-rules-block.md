# Magi CLI brief RULES block

Every Magi CLI seat brief MUST include the RULES block below. CLI seats cannot
load Cursor plugins; vault standing rules are how they receive MAGI law. The
pointer already forces Read of the brief file and a first-line echo.

Required markers (fail-closed):

- `magi-mode`
- `magi-dispatch`
- `casper_via=agy` (or `VENDOR.md` plus Casper/`agy` card text — `agy.exe` or Casper+agy; not PATH gemini)
- `STANDING.md` or the `magi-cli-rules` path

Check with:

```
node C:\src\magi\tools\cli-brief-rules-check.js --brief <file>
```

`tools/cli-smoke.js` runs the same check before a dry-run, and asserts the
google/`agy` plan includes `--add-dir ...\.claude\skills`.

## RULES

Read `C:\src\ai-ops-vault\projects\magi-cli-rules\STANDING.md` in full before any work. Repeat its first line verbatim before anything else.

This seat follows `magi-mode` and `magi-dispatch`. Casper is `agy` (`casper_via=agy`, `agy.exe`). Magi cannot load Cursor plugins on CLI seats.

Optional vault card: `C:\src\ai-ops-vault\projects\magi-cli-rules\VENDOR.md` plus the Casper/`agy` card also satisfies the Casper marker when `casper_via=agy` is absent.

Recommended (not fail-closed): briefs travel as a file pointer (`cli-pointer`); open with a `receipt.v1` ACK; seat handoff uses `handoff-envelope.v1`.
