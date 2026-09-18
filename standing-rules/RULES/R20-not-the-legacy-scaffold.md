# R20 — Not the legacy conclave scaffold

| Field | Value |
|---|---|
| id | `R20` |
| applies_to | all |
| role | lead |
| tag | VERIFIED |
| sources | conclave-cli SKILL.md; conclave-*.mdc |

## MUST

MUST declare the host with `conclave-whoami`. MUST NOT run `session-whoami` or dispatch `camerlengo-8`: both belong to an abandoned scaffold that once held this name, archived as `nik1tsyganov/conclave-legacy`, and neither exists in this runtime. A rule written for that scaffold does not apply here.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R20-not-the-legacy-scaffold.md`.
