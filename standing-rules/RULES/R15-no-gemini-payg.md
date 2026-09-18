# R15 — No Gemini PAYG / no gemini CLI for CONCLAVE

| Field | Value |
|---|---|
| id | `R15` |
| applies_to | google |
| role | lead |
| tag | VERIFIED |
| sources | cli-gemini.js; CTO STOP F7; user spend rule |

## MUST

MUST NOT install or use `@google/gemini-cli` / Gemini API pay-as-you-go for CONCLAVE Casper. The CONCLAVE google path strips GEMINI_API_KEY and launches agy. Standing: no extra paid tokens outside existing subscriptions.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R15-no-gemini-payg.md`.
