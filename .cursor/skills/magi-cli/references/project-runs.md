# MAGI CLI: real-project handoff for Cursor

Use this guide for a small, useful change in an existing project. Keep each attempt bounded. Preserve failures so the next repair addresses measured behavior.

## Start in Cursor

1. Open the intended project. Use Agent mode. Select Grok 4.6 explicitly; disable automatic model selection.
2. Reload Cursor after a MAGI runtime update. The host declaration checker does not attest the actual picker model.
3. Paste the prompt below. Replace the two bracketed fields. If `/magi-cli` is unavailable, attach the installed `commands/magi-cli.md` and this file to the same prompt.

```text
/magi-cli

Read and follow the installed MAGI CLI references/project-runs.md handoff.
Project: [absolute project directory]
Outcome: [one useful change, with a concrete example of the expected behavior]

Act as the non-voting Grok arbiter. Classify, prepare briefs, seal a complete
plan, launch native vendor seats through dispatch-run.js, and collect evidence.
Leave substantive implementation, diagnosis, repair, verification, and review
to the assigned native vendor seats. Do not use Cursor Task agents as vendors.

Start with one implementation unit, one foreign verifier, and one foreign
reviewer. Choose legal model/effort pairs from the installed matrix after
checking included capacity. For an ordinary feature, prefer Sonnet/medium
implementation, Terra/medium test verification, and Gemini Pro/high review,
only if those exact routes remain legal and fresh native probes pass.
For another class, follow its matrix and panel requirements. Do not downgrade it.

Use a new attempt directory outside the product. Preserve existing user changes.
Declare exact file scopes and meaningful acceptance checks before dispatch.
Run implementation, then successful verification, then review, then finalization,
activation-check, and the receipt-bound panel tally. Stop at the first failed
command, missing proof, non-APPROVE position, or failed scope/approval check.

For Claude, launch without topicality flags. Handle AWAITING_ATTESTATION as
the documented inspection checkpoint. Read its response and raw capture,
then accept only that inspected capture with --on-topic --capture-sha256.
This completion must reuse the saved call. Never pre-attest unseen output.

Budget: at most three fresh exact-pair probes and three task dispatches for this
one-unit attempt. Reuse valid unexpired probes where possible. No automatic
fallback, repair loop, repeated battery, extra billing, or framework edits.
If the task cannot fit that bound, narrow it to a useful unit before spending calls.

At every stop, export project-run-report.js, including the failed command output
when applicable. Record a short TRIAGE.md with expected behavior, actual behavior,
the exact command and exit code, evidence paths, and root cause only if proven.
Distinguish project defects, briefing defects, environment/runtime failures,
capacity limits, and unknown causes. NOT_RUN is not a vendor failure.

Finish with changed files, actual test results, the observed native identities,
execution/approval/activation results, and absolute report/evidence paths.
Do not commit, publish, or merge the product change as part of this trial.
```

## Local paths and authority

On YESSIR's machine, the installed runtime is:

```powershell
$magiRuntime = Join-Path $env:USERPROFILE '.cursor/plugins/local/magi-cursor-cli'
$magiRules = Join-Path $env:USERPROFILE '.cursor/magi-rules/v2'
Set-Location -LiteralPath $magiRuntime
node tools/magi-whoami.js --mode cursor-cli --slug grok-4.6
# Synara-hosted arbiter: also LEGAL with --mode synara
node tools/magi-cli-preflight.js --rules-root $magiRules
```

The startup command checks the declared route against the installed matrix. It does not prove the actual Cursor picker.

Use the installed runtime for project work. The old `C:/src/ai-ops-vault` checkout on this machine can carry an earlier rules pack. Do not substitute it for the installed v2 pack. Preflight must prove the STANDING v2 fingerprint and exactly R01–R22.

Read the co-located [CLI command reference](cursor-cli.md), [dispatch matrix](dispatch-matrix.json), [seat profiles](seat-profiles.json), and [brief template](brief-rules-block.md). The command reference governs exact CLI arguments and plan fields. This handoff adds the trial boundary and failure-recording process.

Read `C:/Users/YESSIR/.claude/docs/capacity-state.json` before probes. An exhausted bucket stays blocked until fresh evidence clears it. Do not infer capacity from an old successful call. Do not use API keys, paid credits, or overage. The recorded Opus block also affects any standing Fable-to-Opus fallback. Authentication success alone does not prove included headroom.

Suggested external layout:

```text
C:/src/magi-project-runs/<project>/<attempt-id>/
  context.md              objective, project root, starting revision, dirty paths
  commands/               exact arguments, exit codes, UTF-8 stdout and stderr
  probes/                 fresh native exact-pair evidence
  availability.json       imported native evidence, original timestamps
  briefs/                 final hashed briefs
  draft-plan.json
  run/                    created by plan-seal.js; runtime-owned evidence

C:/src/magi-project-issues/<project>-<attempt-id>/
  report.json             generated diagnostic snapshot
  REPORT.md               generated readable findings
  TRIAGE.md               Cursor's evidence-backed classification and next step
```

Use a unique attempt ID. Keep these directories outside all product worktrees. Do not place task notes or test captures in the product unless the declared scope explicitly includes them. Never put credentials in evidence.

## Run one useful unit

Read project instructions and inspect current git state. Choose a clean worktree if existing changes overlap the intended scope. Preserve the user's files and identity. Record the starting revision and working state.

Check the chosen worktree's test prerequisites before spending native calls. Git worktrees do not inherit `node_modules`. Use existing dependency-free checks where they cover the requested behavior. If required tests or browser checks lack their tools, record an environment blocker before dispatch. Do not silently download tools through `npx`, add a dependency link that the scope audit rejects, or label an unprepared worktree a product defect.

Choose one concrete behavior and its acceptance checks. Examples include a reproducible bug fix, one missing input validation case, or one small feature with an observable result. A successful no-op does not test the implementation path.

Prepare all briefs before sealing. Each brief must contain the literal required template blocks, actual rule paths, the correct role/vendor/host values, a unique first-line ACK, and the exact read/write boundary. Hash the finished bytes. Checker entries bind the implementer's vendor, unit, and worktree.

For ordinary feature trials, the three suggested entries are:

| Order | Role / class | Candidate route | Required behavior |
|---|---|---|---|
| 1 | implement / standard-feature | anthropic / sonnet / medium | Make the scoped change and run appropriate checks. |
| 2 | verify / test-verification | openai / gpt-5.6-terra / medium | Independently run suitable non-mutating checks; inspect the resulting files. |
| 3 | review / review-adversarial | google / gemini-3.1-pro-high / fused-high | Read files and captured tests; challenge defects and missing cases. |

The matrix and fresh probes govern actual eligibility. This table does not override them. Google review briefs must request file-read tools and existing test evidence. Do not require RunCommand in its sandbox. Claude read-only seats can use Read/Glob/Grep; they cannot execute test commands. Select checker roles that can perform the required check.

Each generated seat contract names the staged rules and required role skills by absolute path. Before accepting a seat, inspect its report and available native read evidence. Missing or unread required instructions are a blocker, even if the task answer is topical. Preserve that evidence and export the stopped trial; do not let the seat declare those instructions optional.

Use `plan-seal.js` once for the complete plan. Dispatch only sealed entries through `dispatch-run.js`. An implementation unit's review now requires every planned verifier to finish with valid native APPROVE evidence. A changed workspace invalidates the previous verification. Review-only panels have no implementation sequence to satisfy.

Claude returns an `AWAITING_ATTESTATION` checkpoint after the native call and deterministic checks. Its exit code is zero, but `ok` is false because execution has not been accepted. Read the returned `responsePath` and `capturePath`; confirm that the response addresses the bound brief. Then complete the same dispatch with `--on-topic --capture-sha256 <returned captureSha256>`. This does not launch another call or consume another task-dispatch slot. Do not provide either flag before a capture exists. If topicality is uncertain, stop and export the pending report. See the CLI reference for the exact command.

On a successful attempt, run these tools in order, using the same sealed run directory:

```powershell
node tools/run-finalize.js --run-dir $magiRun
node tools/activation-check.js --run-dir $magiRun
node tools/panel-tally.js --run-dir $magiRun --unit-id $magiUnit
```

Check each real exit code before the next command. A dispatch execution PASS alone does not approve the product. A source change after checks requires fresh verification and review in a new plan/run.

## Record every stop

Capture command arguments, exit code, stdout, and stderr for each gate in the external `commands/` directory. Prefer UTF-8 logs. The reporter also reads PowerShell's UTF-16LE logs with a byte-order mark. In Windows PowerShell 5.1, use `$LASTEXITCODE` for native commands; `$?` can be false merely because stderr was written.

After success, export a report to a new external directory:

```powershell
node tools/project-run-report.js --run-dir $magiRun --project-root $magiProject --output-dir $magiIssueDir --phase finalize
```

After failure, include the captured failing command output:

```powershell
node tools/project-run-report.js --run-dir $magiRun --project-root $magiProject --output-dir $magiIssueDir --phase dispatch --error-file $magiFailureLog
```

Use the actual failure phase: `preflight`, `probe`, `plan`, `dispatch`, `verify`, `review`, `finalize`, `activation`, or `project`. Set `$magiProject` to the actual product directory. Before a sealed run exists, pass the existing attempt directory as `--run-dir`. Supply `--project-root` when a seal is missing or damaged; unverified plan paths cannot establish the product boundary. Missing or broken seals are recorded as UNVERIFIED. For an activation or project-level failure after otherwise successful dispatches, `--error-file` preserves that failure in the report.

The reporter reads and revalidates evidence. It writes only the new report directory. It never changes receipts, native logs, telemetry, or activation decisions. Exit zero means the export succeeded; inspect the report's `status` separately. `NEEDS_ATTENTION` is expected for failed or incomplete attempts. Existing report directories cannot be overwritten.

An `AWAITING_ATTESTATION` state is incomplete. It is not a provider failure and cannot activate a change. Inspection and hash-bound acceptance are the expected continuation, not a retry. Actual terminal failures keep the original new-attempt rule.

Successful dispatches link their verified evidence directories, including custom locations. Failed or invalid dispatches link the preserved transaction record; its evidence location is not presented as verified. A validated `AWAITING_ATTESTATION` checkpoint links its captured evidence directory without implying approval. Other unfinished dispatches link the run directory.

Add `TRIAGE.md` alongside the generated report with:

```text
Project and requested outcome:
Attempt and sealed plan IDs:
Failure phase:
Exact command and exit code:
Expected behavior:
Actual behavior:
Category: product | brief | environment | runtime | capacity | unknown
Evidence paths:
Native ID/model/effort: observed value or UNPROVEN
Smallest reproduction:
Proposed next action:
Related earlier report paths:
```

The issues directory is the durable queue. Link recurring symptoms to earlier reports; retain each occurrence. Do not call a timeout, denied tool, wrong path, empty capture, or failed wrapper a provider outage without provider evidence. Do not label all pending dispatches as defects.

Give the next repair session the report directory and original run directory. Reproduce first. Fix only the proven cause. Add a relevant regression test, obtain independent verification and review, then run the same project acceptance checks in a fresh attempt. Keep the old failure. Close its TRIAGE entry by linking the passing correction; do not replace its generated report.

## Synara as the outer harness

When this Grok arbiter is hosted in Synara, use `hostMode: synara` and snapshot `synara_capabilities` with `synara-catalog.js` before sealing. Map MAGI vendor names to Synara providers only for catalog checks (`openai`/`codex`, `anthropic`/`claudeAgent`, `google`/`antigravity`). Launch remains `dispatch-run.js`.

Use Synara worktrees as an implement `cwd` when the worktree is already inside MAGI allowed roots. Use `browser_*` only as a host helper after MAGI implement; stage those files with `host-helper-evidence.js` and list the destination on verify/review `evidenceReadDirs`. Never tally a Synara-thread helper as a MAGI `POSITION`. `synara_wait_for_threads` does not join `dispatch-run` PIDs; `magi-synara-watch.js` reports leftover `RUNNING` children and synara-capture `ask` revert without rewriting receipts.

Do not create MAGI seats as Synara threads. Do not substitute Cursor Task elector slugs for seats.

## Scope of this handoff

Start fresh attempts after this update. Implementation-based checker receipts now bind `magi-unit-sequence-v1` prerequisite evidence. Older checker receipts lack that contract and will fail the updated validator. Preserve those historical runs with their original runtime; do not rewrite their receipts or present them as new acceptance.

This guide exercises the installed Cursor CLI runtime. Claude's older engineering-gate bus integration and legacy battery/bus binding work remain separate backlog items. The CLI uses native safe mode and its own sealed-plan, proof, scope, and approval checks. A passing project trial does not close those older systems' issues.

The earlier three-vendor acceptance proves that the CLIs worked on its measured tasks. It does not prove Cursor's current plugin reload state or every real project's tools. Those are the observations these project trials now collect.
