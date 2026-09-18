# R03 — Pointer-first briefs

| Field | Value |
|---|---|
| id | `R03` |
| applies_to | all |
| role | lead+seat |
| tag | VERIFIED |
| sources | cursor-cli.md; cli-pointer / cli-launch |

## MUST

MUST deliver briefs as files. Pointer on stdin/`-p` carries the bound brief path, bytes, hash, and generated seat-contract path (≤2000). Seat MUST read the brief file and generated contract. MUST NOT pipe brief body into argv/stdin. Production launch uses `dispatch-run.js --plan <sealed-plan.json> --run-dir <run-dir> --dispatch-id <id>`; it validates the sealed plan before invoking internal transport adapters. `cli-launch.js` is a transport helper, not an independent production front door. Standalone `cli-smoke.js --brief <file> --cwd <worktree>` is an offline transport diagnostic; it must fail on body leaks and cannot activate production work.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R03-pointer-first.md`.
