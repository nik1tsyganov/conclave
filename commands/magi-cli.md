---
name: magi-cli
description: Start or continue a plan-bound MAGI Cursor CLI run. Not CONCLAVE and not Cursor Task mode.
---

# /magi-cli

If the chat is CONCLAVE, open a separate MAGI chat. From the MAGI runtime root, run `node tools/magi-whoami.js --mode <cursor-cli|synara|claude-code> --slug <hosting session slug>` (for example `--mode cursor-cli --slug cursor-grok-4.6-high-fast`, or `--mode claude-code --slug claude-fable-5-1`); the declaration names the host, and the arbiter is the Jev decision engine from the runtime matrix. Stop unless the declared route is LEGAL. This checks the declaration against the runtime matrix; it does not prove the actual picker. Seats remain native CLIs.

Read the MAGI CLI skill and its co-located `references/cursor-cli.md`, `dispatch-matrix.json`, `seat-profiles.json`, and `brief-rules-block.md`. The run guide contains the complete command arguments and plan-field contract.

For real-project work, follow `references/project-runs.md` in that skill. Bound each attempt and export `project-run-report.js` at every stop, including failures before sealing. Keep the report and TRIAGE outside the product and run evidence.

The Jev decision engine (TypeSafe System One) is the arbiter: it proposes classification, seats, convene, net-benefit and tally distributions and code gates them. The hosting session is non-voting; it composes briefs and complete plans, runs `jev-plan-classify`, dispatches vendor seats, and requests deterministic completion checks. It must not act as a substantive implementation, repair, plan, research, review, verification, or voting seat.

## Prepare

1. Set `MAGI_RULES_ROOT` to the external STANDING v2 / R01–R22 pack. Set `MAGI_VAULT_ROOT` to the ai-ops-vault checkout for telemetry, lean skill sync, and analysis.
2. Run installed `tools/magi-cli-preflight.js`.
3. Check Claude with `claude auth status`. Probe every intended exact model/effort using `model-probe.js --vendor --model --effort --evidence-dir`.
4. Import each native `probe.json` with `model-availability.js --file <availability.json> --probe <probe.json>`.
5. Write the final UTF-8 briefs with concrete scopes and a unique first-line acknowledgment. Hash their exact bytes.

Unknown or unproven model/effort pairs are unavailable. Availability replays hashed native evidence and uses the original probe timestamp. Its default expiry is 60 minutes. Re-importing evidence cannot renew it.

## Seal the complete plan

The plan binds `planId`, `hostMode: cursor-cli` (or `synara` when Synara hosts this arbiter), the arbiter `{vendor: "jev", model: "jev-latest", host: <session slug>}`, and every dispatch entry. Each entry includes `dispatchId`, `unitId`, `class`, `role`, `vendor`, `model`, `effort`, absolute `cwd` and `brief`, `briefSha256`, and relative `writeScope`. Verify/review entries may list absolute `evidenceReadDirs` for non-voting host-helper files.

Non-implementation roles use an empty write scope and remain read-only. Review/verify entries require a different, correct `authorVendor`. Astra requires `escalation: true` and a substantive reason with at least 16 characters and three distinct words.

Claude non-implementation roles use the schema 5 `read-only-tools` profile: `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. They can inspect files and existing test evidence, but cannot execute shell commands. Supply the needed evidence in the brief. Plan mode requires a separate approval turn and is not the unattended verification path.

Claude implementation uses `--safe-mode --permission-mode bypassPermissions`. Safe mode excludes global customization and hooks while preserving subscription authentication and role permissions. Do not use `--bare`; it disables OAuth. Product audits do not isolate vendor home directories.

Critical classes require `magiConvened: true` and two distinct foreign review/verify vendors on the same unit and worktree. Implementation vendor count scales as `min(3, implementation units)`; the 60% cap starts at two units. Do not invent implementation rows for read-only panels.

Run `plan-seal.js --plan <draft.json> --run-dir <new-run-dir> --availability <availability.json>`. A synara host also requires `--synara-catalog`. Optional `--skill-source-root` binds skill bytes into seal schemaVersion 2. Stop on failure.

## Classify with Jev, then seal

```text
node tools/jev-plan-classify.js --plan <draft-plan.json> --out <record.json> [--provenance <run-parent>/jev-decisions.jsonl]
node tools/plan-seal.js --plan <draft-plan.json> --run-dir <run-dir> --availability <availability.json> --skill-source-root <seat-skills> --jev-classification <record.json> [--class-override <reason>]
```

The record binds each unit's brief hash; the seal refuses when the plan's class is not Jev's choice and sits below the flag gate, unless `--class-override <reason>` records the owner's decision. `--no-jev <reason>` records an explicit opt-out (test fixtures, or an engine outage the owner accepts).

## Drive a run in a few commands (2026-09-16)

```text
node tools/run-drive.js --run-dir <run-dir> --phase implement        # all implement seats in parallel (cap applies)
node tools/run-drive.js --run-dir <run-dir> --attest <id[,id]>       # after reading each response.txt named in the pending list
node tools/run-drive.js --run-dir <run-dir> --phase evidence --tests <tests.json>   # lead-captured test output + diff into every evidenceReadDir
node tools/run-drive.js --run-dir <run-dir> --phase verify           # then --attest for Claude seats
node tools/run-drive.js --run-dir <run-dir> --phase review           # then --attest for Claude seats
node tools/run-drive.js --run-dir <run-dir> --phase finalize         # run-finalize, activation-check, panel-tally and panel-tally-jev per unit
```

`tests.json` maps `unitId` to `{ "command": "..." }` run in the unit's worktree. The driver only sequences `dispatch-run`; every gate, the attestation checkpoint and the concurrency cap are unchanged. Exit 3 means seats await attestation.

## Dispatch and conclude

Launch each selected entry with:

```text
node tools/dispatch-run.js --plan <run-dir/dispatch-plan.json> --run-dir <run-dir> --dispatch-id <id> --availability <availability.json> --rules-root <external-v2-pack>
```

Route fields come from the sealed entry. Any changed route, author, scope, or brief requires a new complete plan validation and seal. Graph overrides and naked route flags grant no authority.

Claude completion has two steps. Its first launch has no topicality flags. After deterministic checks, it returns exit zero with `ok: false`, `status: AWAITING_ATTESTATION`, `capturePath`, `responsePath`, and `captureSha256`. This is an inspection checkpoint, not a failed vendor call or execution PASS. Do not start dependent seats yet.

Read the returned response and raw capture. Check that the response addresses its bound brief. This is a topicality check, not a substitute for foreign correctness verification or review. If it is off-topic or uncertain, stop and export the pending report. Do not attest unseen output.

After inspection, complete the same logical dispatch using the same command plus:

```text
--on-topic --capture-sha256 <exact returned capture SHA-256>
```

Completion revalidates saved evidence and the workspace without another native call. The hash binds the attestation to the response inspected. Repeating a pending launch without flags only reads its checkpoint. Premature attestation fails before launch; changed evidence or workspace cannot be accepted. OpenAI and Google remain one-step dispatches. A terminal FAIL still requires a new plan/run; do not retrofit a failed receipt.

For each implementation unit, finish implementation, then every planned verifier with native APPROVE, then review. Stop when a check fails. Review cannot use verification from a changed workspace.

The runtime stages the bundled lean vendor card plus role/class skills. The seat reads its generated `SEAT-CONTRACT.md`, staged skills, and hashed rules. Seats are leaves; they cannot delegate, change policy, or edit evidence and telemetry.

Native observed model/effort evidence, brief acknowledgment, scope audit, receipts, and idempotent telemetry must agree. Claude requested-only identity cannot qualify. Google uses agy, `casper_via=agy`, and the exact staged skill-root grant. No Gemini PAYG fallback is allowed.

Every Google probe and dispatch pins `--log-file` to `native-cli.log` in its unique evidence directory. Use that per-run source for proof collection; default second-resolution home logs can collide during parallel calls.

Run `run-finalize.js --run-dir <run-dir>`. When `MAGI_VAULT_ROOT` is set, finalize links telemetry into the vault and writes analysis. Execution PASS is separate from approval. Ordinary implementation approval requires foreign verification and review, with every review returning native APPROVE. Critical approval requires at least two native APPROVE votes after author recusal.

Run `panel-tally.js --run-dir <run-dir> --unit-id <unit>` for receipt-bound panel votes. Then run `panel-tally-jev.js --run-dir <run-dir> --unit-id <unit>` (2026-09-16): the Jev decision engine scores each eligible reply for independent evidence (an APPROVE without evidence counts as ABSTAIN) and proposes the panel verdict distribution; code still counts the votes. Output: `<run-dir>/jev-tally-<unit>.json` plus a provenance row. Each eligible review response must end with exactly one `POSITION: APPROVE`, `POSITION: REJECT`, or `POSITION: ABSTAIN` line. Never handwrite ballots or waive deterministic failure.

The scope audit does not sandbox vendor home directories. Standalone transport smoke results cannot activate production work.

## Jev decision engine (2026-09-16)

`dispatch-matrix.json` carries `arbiter.decisionEngine` (engine `jev`, TypeSafe System One). Jev proposes probability distributions; code gates them. The hosting session still runs every tool. The key comes only from `TYPESAFE_API_KEY` (source `~/.config/typesafe/env.sh`); without it every call returns `NOT_RUN` and the deterministic parts still run. Each real call appends one provenance row (request and response SHA-256, usage, model, timestamp; never the key) to the JSONL you name.

- `node tools/jev-arbiter.js classify --brief <file> --routing <mix-mode routing.json> [--provenance <run-dir>/jev-decisions.jsonl] [--repo-facts <text>] [--units <n>]` prints the class distribution and gate (`route` at p >= 0.6, `route-flagged` at 0.4, else `owner`). The module also exports `pickSeats` (deterministic argmax over `decisionMatrix2026-09-16`, margin rule 0.15, never an exhausted bucket from `docs/capacity-state.json`), `conveneThirdFamily` and `netBenefit` (Nouls gated at 0.6), and `tallyPositions` (Score plus one independent-evidence Noul per reply; quorum floor, evidence-less APPROVE counted as ABSTAIN, DEADLOCK rules per the deliberation protocol).
- `node tools/jev-check.js --claims <json> | --receipt <json> [--provenance <jsonl>]` runs deterministic pre-checks first (evidence path exists, quote is a substring, recorded test exited 0), discards failures before Jev sees them, then asks per-claim Nouls and prints a verdict table (`supported`, `contradicted`, `says-nothing`). The lead runs it over seat output; seats never call Jev.

## macOS host notes (2026-09-16, measured)

- `source ~/.config/magi/env.sh` before any tool; it exports `MAGI_CODEX_PROVIDER=openai` (the cpa-gui proxy is normally down; the adapter also defaults to it on darwin).
- Claude and Google checking seats cannot run commands (`read-only-tools`, `--sandbox`); agy soft-denies and returns an empty reply. Capture tests as the lead into `<run-parent>/evidence/<unit>/`, bind `evidenceReadDirs`, and say so in the brief.
- Codex gpt-5.6-terra truncated the last of 31 sequential instruction reads twice; gpt-5.6-sol completed it. Prefer a lane with sol for Codex checking seats until measured otherwise.
- A failed dispatch id needs a new dispatch id in a new sealed run (R22); plan retries as small verify/review-only plans with the same evidence directories.
