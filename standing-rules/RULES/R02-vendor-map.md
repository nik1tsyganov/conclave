# R02 — Three vendors: claude + codex + agy

| Field | Value |
|---|---|
| id | `R02` |
| applies_to | all |
| role | lead |
| tag | VERIFIED |
| sources | cli-gemini.js→agy.exe; BackendEng-CASPER-VAULT10; Research mental-model §1 (accepted) |

## MUST

MUST treat CONCLAVE CLI vendors as openai→`codex`, anthropic→`claude`, google→`agy` (`casper_via=agy`). MUST NOT require or install a `gemini` CLI for Casper. Tag `gemini_skipped_subscription` only as spend/auth constraint, never as missing CONCLAVE vendor.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R02-vendor-map.md`.
