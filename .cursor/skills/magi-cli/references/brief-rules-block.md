# Magi CLI brief RULES block (required)

Paste into every Magi CLI seat brief. Lead copies vault `projects/magi-cli-rules/RULES/` into `<briefDir>/RULES/` first.

```text
STANDING RULES (Magi CLI): Read RULES/INDEX.md then R02,R03,R04,R07,R11,R12,R13,R15,R21.
Skills: magi-mode, magi-dispatch, mix-mode. SCOPE: <paste engineering-orchestrator Pre-dispatch SCOPE>.
Vendor: <codex|claude|agy> — casper_via=agy if google. Bridges: <codex-bridge|claude-bridge|gemini-bridge if any>.
MUST: WRITE AUDIT; no C:\src\vault writes; no Gemini PAYG; leaf seat (no fan-out).
COMMS: receipt ACK + handoff envelope.
hostMode: cursor-cli. Floor: ≤60% per vendor; activation-check on dispatch-log.
```

Fail-closed markers (cli-brief-rules-check.js): magi-mode, magi-dispatch, mix-mode, casper_via=agy (google), RULES/INDEX (or magi-cli-rules/STANDING), WRITE AUDIT or R07.

SoT: ai-ops-vault `projects/magi-cli-rules/RULES/` (R01–R21); Research-CLI-RULES-BRIEF-PIN.md §E.
