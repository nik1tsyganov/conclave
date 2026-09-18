# R20 — MAGI is not CONCLAVE

| Field | Value |
|---|---|
| id | `R20` |
| applies_to | all |
| role | lead |
| tag | VERIFIED |
| sources | magi-cli SKILL.md; magi-*.mdc |

## MUST

MUST NOT run CONCLAVE `session-whoami` or dispatch `camerlengo-8`. Use `magi-whoami`. Ignore CONCLAVE-only rules when in MAGI.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R20-magi-not-conclave.md`.
