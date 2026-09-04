# Product work tracking

Product repositories such as Hearth and Signal Sim do not mention MAGI. Slice
graphs, distribution-floor notes, telemetry obligations, and
`magi-dispatch-log.jsonl` for product work live under `projects/<slug>/`.

MAGI-kit work may still use `C:\src\magi\magi-dispatch-log.jsonl`, which is
gitignored.

Magi CLI `cli-full` cells for bench-001 are prepared by the vault harness
(`C:\src\ai-ops-vault\projects\bench-001\tools\magi-cli-cell.js`). That
prepare copies fixture `BRIEF.md` onto this repo's cell bus at
`projects/bench-001/cli-full/<task>/work/BRIEF.md` and
`projects/bench-001/cli-full/<task>/seat-briefs/BRIEF.md` so seats Read a
path under `C:\src\magi` (cwd + briefDir `--add-dir`). Do not point seats
at `C:\src\ai-ops-vault\projects\bench-001\fixtures\...\BRIEF.md`. Do not
broaden Claude `--add-dir` to `C:\Users`. Seat-brief MUST lines for
`src/index.js` re-export live in that same prepare writer (skill docs:
magi#6).
