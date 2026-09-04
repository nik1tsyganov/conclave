# Cursor CLI host mode (`cursor-cli`)

`/magi-cli` runs the MAGI panel through vendor CLIs instead of Cursor Task. The Grok arbiter still classifies, briefs, dispatches, records telemetry, and tallies; it does not implement, review, verify, or vote.

## Required reading

- `.cursor/skills/magi/SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-mode\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\magi-dispatch\SKILL.md`
- `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
- `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini
- `C:\Users\YESSIR\.claude\skills\claude-bridge\SKILL.md` — dispatch through `C:\Users\YESSIR\.local\bin\claude.exe -p --model fable --effort xhigh`; run the live auth and headless probes first

## How the arbiter reaches each seat

| Seat | Vendor | CLI | Path |
|---|---|---|---|
| Melchior (codex) | OpenAI | `codex exec` | `C:\Users\YESSIR\tools\bin\codex.exe` |
| Casper (gemini) | Google | `agy` | `C:\Users\YESSIR\tools\bin\agy.exe` |
| Balthasar (claude) | Anthropic | `claude -p --model fable --effort xhigh` | `C:\Users\YESSIR\.local\bin\claude.exe` — reachable; re-run the live auth and headless probes before dispatch |

Live 2026-09-02: `claude auth status` reported `loggedIn: true`, `authMethod: claude.ai`, and `subscriptionType: max`; `claude -p --model haiku` returned `ready`. Re-run both probes in the session that will dispatch. If a later probe returns login/auth language, an empty capture, or off-topic text, record `degraded=true`, include the probe text, and only then treat Codex+Gemini as a **duo**, not a full MAGI panel.

## Claude seat model and effort (owner 2026-09-02)

The Magi CLI Claude seat runs **`--model fable --effort xhigh`**. Verified live against `claude.exe --help` on this machine 2026-09-02: `--effort <level>` accepts `low, medium, high, xhigh, max`, and `--model` takes aliases including `fable`.

- The owner said "Extra". **`extra` is not a Claude Code effort name** — the rung below `max` is `xhigh`, so this mode uses `xhigh`.
- **`max` is not the default here.** Effort is a behavioral signal, not a published price multiplier; the extra cost is extra thinking and output volume. Anthropic publishes no multiplier figure, and community reports of 3–5x over `high` are UNVERIFIED — do not quote a number as fact.
- This overlay applies to `hostModes.modes.cursor-cli` only. The global seat `seats.balthasar-2` in `magi-seats.json` still reads model `opus`, effort `high`; changing it is a MAGI DECISION, not a host-mode overlay.
- The live probes establish reachability for the current session; Fable at `xhigh` does not replace them. If either later probe fails, do not dispatch Claude; activate the documented degraded path and record the captured probe text.

## Why a `/magi` session can land here mid-task

`node C:\src\magi\tools\host-resolver.js` decides the host mode. When Cursor Task model usage trips, a `/magi` (`cursor`) session resolves to `cursor-cli` and the panel finishes on vendor CLIs. So this file governs from that point in the same run: re-read the seat table above, and stop issuing Cursor Task calls to elector slugs.

## Mechanics

- The arbiter launches vendor CLIs through `node C:\src\magi\tools\cli-launch.js` with `--pid-file`, so the child's PID is recorded at spawn. Idle policy lives in `tools/cli-idle.js`: Claude and Gemini buffer stdout until exit, so an empty capture on a running child is **not** a hang at any elapsed time; Codex streams, so its idle stdio can be. Kill only the recorded PID — never by image name.
- Briefs are **files**, never inline payload: `cli-launch.js` / `cli-pointer.js` send only a path+bytes+hash pointer on stdin (or `agy -p`); the vendor reads the brief file itself. See `codex-bridge` and `gemini-bridge` for the exact recipes.
- Before a live Magi CLI seat, run `node C:\src\magi\tools\cli-smoke.js --brief <file> --cwd <cwd>`: it dry-runs all three vendors through `cli-launch.js` (no vendor process spawns, no seat spent) and fails on any brief-body leak into args or stdin files, a non-pointer OpenAI plan, or a google `-p` carrying the body.
- Claude dispatch shape: `tools/cli-claude.js buildLaunch` writes `<brief>.pointer.md` beside the brief and pipes only that pointer into `claude -p --model fable --effort xhigh`; `--add-dir` names `C:\src\magi` plus the brief's parent directory (allowed only under the repo or the `magi-bus` temp root — never `C:\Users` or a drive root). Capture to a file, then check the capture is non-empty AND on-topic. Mechanics in `claude-bridge`.
- Capture vendor-native proof on every dispatch: Codex `session id` + `tokens used`; Gemini `conversation_id` + `usage` + per-run log slug check; Claude the captured on-topic reply plus the model/effort the dispatch passed.
- Telemetry row must carry `hostMode: cursor-cli` and `routedBy: arbiter`.
- Never omit the WRITE AUDIT (`git diff --stat` + `git status --porcelain`), the 60% vendor floor, or the activation check (`node C:\src\magi\tools\activation-check.js <log path>`).
- Log path: product-repo runs write `C:\src\magi\projects\<slug>\magi-dispatch-log.jsonl`, never a log inside the product repo; MAGI-kit work uses `C:\src\magi\magi-dispatch-log.jsonl`. See `C:\src\magi\projects\README.md`.
- Every MAGI Gemini `agy` dispatch MUST pass `--add-dir C:\Users\YESSIR\.claude\skills` (and `C:\Users\YESSIR\.claude\docs` if docs are needed). Name `magi-mode` and `magi-dispatch` in the brief. Close stdin after piping the prompt (`agy` hangs if stdin is left open).
- Codex reads `~\.codex\skills\magi-mode` (already mirrored). The brief must name `magi-mode`, `magi-dispatch`, `mix-mode`, the 60% vendor floor, WRITE AUDIT, and `activation-check`.
- Never Cursor Task to claude/gpt/gemini slugs in this mode — that would spend exhausted Cursor model usage.

After each vendor-CLI dispatch, the arbiter appends exactly one telemetry row with `hostMode: cursor-cli` and `routedBy: arbiter` by running `node C:\src\magi\tools\telemetry-append.js --row '<json>'` in the same turn; seats never write their own rows. The vendor-native proof rides the row — Codex `session id` + `tokens used`, Gemini `conversation_id` + `usage`, Claude the on-topic capture plus the model/effort as dispatched — in the `proofId` / `vendorSideTokens` / `note` fields. A dispatch with no row is invisible to `node C:\src\magi\tools\telemetry-stats.js`, so an unrecorded dispatch is a capture-health finding, never a saving.

Tally POSITION with `node C:\src\magi\tools\position-tally.js`. Do not hand-count. Passage is `>=2 APPROVE` among eligible electors; `ABSTAIN` never toward passage; else `DEADLOCK`. After a documented Claude fail path (`degraded=true` plus the probe text), pass `--degraded` so Claude is ineligible and Codex+Gemini are the duo. Idle Casper is not that path.

## Cursor plugin boundary

CLI seats cannot load Cursor plugins. They still run the project's own typecheck, tests, and WRITE AUDIT. The Grok arbiter may use Team Kit in its own Cursor chat after the merge.
