# Magi CLI brief RULES block

Paste this STANDING RULES block into every Magi CLI seat brief. Fill
`<paste>`, `<codex|claude|agy>`, and `<name if any>` at dispatch. CLI seats
cannot load Cursor plugins.

Fail-closed: `node C:\src\magi\tools\cli-brief-rules-check.js --brief <file>`.
`tools/cli-smoke.js` runs the same check and asserts google `--add-dir ...\.claude\skills`.

Pack under `briefDir`: `BRIEF.md`, `VENDOR.md` (`casper_via=agy` if google),
`RULES/INDEX.md`, R01..R21 bodies. Pointer may hash `BRIEF.md` + `RULES/INDEX.md`.

```
STANDING RULES (Magi CLI): Read RULES/INDEX.md then R02,R03,R04,R07,R11,R12,R13,R15,R21.
Skills: magi-mode, magi-dispatch, mix-mode. SCOPE: <paste>.
Vendor: <codex|claude|agy> — casper_via=agy if google. Bridges: <name if any>.
MUST: WRITE AUDIT; no C:\src\vault writes; no Gemini PAYG; leaf seat (no fan-out).
COMMS: receipt ACK + handoff envelope.
```
