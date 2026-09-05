---
name: magi-cli
description: Start or continue a plan-bound MAGI Cursor CLI run. Not CONCLAVE and not Cursor Task mode.
---

# /magi-cli

If the chat is CONCLAVE, open a separate MAGI chat. Run `magi-whoami --mode cursor-cli --slug <picker slug>`. Stop unless the declared route is LEGAL.

Read the MAGI CLI skill and its co-located `references/cursor-cli.md`, `dispatch-matrix.json`, `seat-profiles.json`, and `brief-rules-block.md`. The run guide contains the complete command arguments and plan-field contract.

For real-project work, follow `references/project-runs.md` in that skill. Bound each attempt and export `project-run-report.js` at every stop, including failures before sealing. Keep the report and TRIAGE outside the product and run evidence.

Grok 4.6 is the non-voting arbiter. It classifies, composes briefs and complete plans, dispatches vendor seats, and requests deterministic completion checks. It must not act as a substantive implementation, repair, plan, research, review, verification, or voting seat.

## Prepare

1. Set `MAGI_RULES_ROOT` to the external STANDING v2 / R01–R22 pack.
2. Run installed `tools/magi-cli-preflight.js`.
3. Check Claude with `claude auth status`. Probe every intended exact model/effort using `model-probe.js --vendor --model --effort --evidence-dir`.
4. Import each native `probe.json` with `model-availability.js --file <availability.json> --probe <probe.json>`.
5. Write the final UTF-8 briefs with concrete scopes and a unique first-line acknowledgment. Hash their exact bytes.

Unknown or unproven model/effort pairs are unavailable. Availability replays hashed native evidence and uses the original probe timestamp. Its default expiry is 60 minutes. Re-importing evidence cannot renew it.

## Seal the complete plan

The plan binds `planId`, `hostMode: cursor-cli`, the xAI/Grok arbiter, and every dispatch entry. Each entry includes `dispatchId`, `unitId`, `class`, `role`, `vendor`, `model`, `effort`, absolute `cwd` and `brief`, `briefSha256`, and relative `writeScope`.

Non-implementation roles use an empty write scope and remain read-only. Review/verify entries require a different, correct `authorVendor`. Astra requires `escalation: true` and a substantive reason with at least 16 characters and three distinct words.

Claude non-implementation roles use the schema 5 `read-only-tools` profile: `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. They can inspect files and existing test evidence, but cannot execute shell commands. Supply the needed evidence in the brief. Plan mode requires a separate approval turn and is not the unattended verification path.

Claude implementation uses `--safe-mode --permission-mode bypassPermissions`. Safe mode excludes global customization and hooks while preserving subscription authentication and role permissions. Do not use `--bare`; it disables OAuth. Product audits do not isolate vendor home directories.

Critical classes require `magiConvened: true` and two distinct foreign review/verify vendors on the same unit and worktree. Implementation vendor count scales as `min(3, implementation units)`; the 60% cap starts at two units. Do not invent implementation rows for read-only panels.

Run `plan-seal.js --plan <draft.json> --run-dir <new-run-dir> --availability <availability.json>`. Stop on failure.

## Dispatch and conclude

Launch each selected entry with:

```text
node tools/dispatch-run.js --plan <run-dir/dispatch-plan.json> --run-dir <run-dir> --dispatch-id <id> --availability <availability.json> --rules-root <external-v2-pack>
```

Route fields come from the sealed entry. Any changed route, author, scope, or brief requires a new complete plan validation and seal. Graph overrides and naked route flags grant no authority.

For each implementation unit, finish implementation, then every planned verifier with native APPROVE, then review. Stop when a check fails. Review cannot use verification from a changed workspace.

The runtime stages the bundled lean vendor card plus role/class skills. The seat reads its generated `SEAT-CONTRACT.md`, staged skills, and hashed rules. Seats are leaves; they cannot delegate, change policy, or edit evidence and telemetry.

Native observed model/effort evidence, brief acknowledgment, scope audit, receipts, and idempotent telemetry must agree. Claude requested-only identity cannot qualify. Google uses agy, `casper_via=agy`, and the exact staged skill-root grant. No Gemini PAYG fallback is allowed.

Every Google probe and dispatch pins `--log-file` to `native-cli.log` in its unique evidence directory. Use that per-run source for proof collection; default second-resolution home logs can collide during parallel calls.

Run `run-finalize.js --run-dir <run-dir>`. Execution PASS is separate from approval. Ordinary implementation approval requires foreign verification and review, with every review returning native APPROVE. Critical approval requires at least two native APPROVE votes after author recusal.

Run `panel-tally.js --run-dir <run-dir> --unit-id <unit>` for receipt-bound panel votes. Each eligible review response must end with exactly one `POSITION: APPROVE`, `POSITION: REJECT`, or `POSITION: ABSTAIN` line. Never handwrite ballots or waive deterministic failure.

The scope audit does not sandbox vendor home directories. Standalone transport smoke results cannot activate production work.
