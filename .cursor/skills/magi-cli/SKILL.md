---
name: magi-cli
description: Plan-bound MAGI Cursor CLI mode. Grok 4.6 is the non-voting arbiter; OpenAI, Anthropic and Google seats use native CLIs. Not CONCLAVE.
---

# MAGI Cursor CLI

## Identity and authority

From the MAGI runtime root, run `node tools/magi-whoami.js --mode cursor-cli --slug grok-4.6`. Stop unless the declared route is LEGAL. This declaration check uses the runtime matrix; it does not prove the actual picker or host model.

Grok 4.6 coordinates the run. It classifies work, writes briefs and complete plans, invokes the deterministic runtime, and requests finalization and tallying. It never performs substantive implementation, repair, planning, research, review, verification, or voting as a seat.

Read `references/cursor-cli.md` for the complete run procedure, `references/dispatch-matrix.json` for route legality, `references/seat-profiles.json` for capabilities, and `references/brief-rules-block.md` for brief instructions.

For real-project work, follow `references/project-runs.md`: one bounded attempt, explicit stop conditions, and a diagnostic report plus TRIAGE at every stop. `project-run-report.js` revalidates available evidence and writes an external report; it cannot grant activation.

The arbiter retains orchestration, routing, bridge, distribution, assessment, and retrospective work. Leaf seats receive the selected vendor card and role/class skills. Do not load the arbiter's full skill stack into a seat.

## Runtime procedure

1. Set `MAGI_RULES_ROOT` to the external STANDING v2 / R01–R22 pack. Run `tools/magi-cli-preflight.js`.
2. Use `claude auth status` for the Claude login check. Run `model-probe.js --vendor --model --effort --evidence-dir` for every selected exact pair.
3. Import each captured `probe.json` with `model-availability.js --file <availability.json> --probe <probe.json>`. Evidence expires after 60 minutes from its original completion time. Re-imports do not renew it.
4. Finalize the briefs, then write the complete plan with unique dispatch IDs, immutable brief hashes, absolute worktrees, relative scopes, author provenance, and any escalation reason.
5. Run `plan-seal.js --plan <draft.json> --run-dir <new-run-dir> --availability <availability.json>`.
6. Launch each selected entry with `dispatch-run.js --plan <run-dir/dispatch-plan.json> --run-dir <run-dir> --dispatch-id <id> --availability <availability.json> --rules-root <external-v2-pack>`.
7. Run `run-finalize.js --run-dir <run-dir>` and `panel-tally.js --run-dir <run-dir> --unit-id <unit>`.

Unknown or unproven models are unavailable. Every native model/effort pair is probe-gated. Requested/observed mismatch fails. The matrix defines legal routes, not a promise of access.

Changed route, class, author, scope, or brief requires a newly validated complete plan and seal. A graph override or ad-hoc launch flag cannot alter a sealed dispatch.

## Seat roles and permissions

| Role | Product permission | Core work |
|---|---|---|
| implement | Writes only within declared scope | Implementation and testing |
| review | Read-only | Review and minimalism |
| verify | Read-only | Testing and evaluation |
| plan | Read-only | Planning and context |
| research | Read-only | Research and context |

Profiles add `seat-openai`, `seat-anthropic`, or `seat-google` plus applicable class skills. The bundled `seat-skills/` source is the default. Staging creates `skills-manifest.json`; rule staging creates `rules-manifest.json`. Structural preflight checks real files and hashes against the generated `SEAT-CONTRACT.md`.

Every seat is a leaf and cannot delegate. Seats must not edit policy, evidence, receipts, or telemetry. They acknowledge the bound BRIEF first line in the native final response. The STANDING v2 fingerprint is separate.

OpenAI read-only roles use `read-only`; agy uses `--sandbox`. Claude non-implementation roles use the schema 5 `read-only-tools` profile: `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. They inspect authorized files and existing test evidence, but cannot execute shell commands. Provide the needed test reports in their inputs. Claude plan mode requires a separate approval turn and cannot reliably complete unattended leaf verification.

Claude implementation retains `--permission-mode bypassPermissions` with `--safe-mode`. Safe mode disables global customization and hooks while preserving subscription authentication and role permissions. Do not substitute `--bare`, which disables OAuth. The leaf reads authorized context from staged files. Product scope auditing rejects unauthorized writes; it does not sandbox vendor home directories or provide universal hostile-process isolation.

## Review, escalation, and distribution

Review/verify entries require correct `authorVendor` provenance and another vendor. Ordinary implementation approval needs foreign verification and review, with every review returning native APPROVE.

Critical `requiresPanel` classes need `magiConvened: true` and two distinct foreign review/verify vendors on the same unit and worktree. Critical approval requires at least two eligible native APPROVE positions after author recusal.

Astra requires `escalation: true` and a reason with at least 16 characters and three distinct words. Greater capability never increases write scope.

Convened implementation uses `min(3, implementation unit count)` distinct vendors. The 60% cap starts at two units. Planning, research, and review-only panels do not manufacture implementation rows. SLICES defines work and dependencies, not vendor authority.

## Proof and completion

`cli-proof.js` requires native session/usage and observed identity. OpenAI includes sandbox and observed effort. Google requires a successful agy envelope and its exact per-conversation model slug with fused effort. Claude requires structured native success, session, numeric usage, canonical observed model, and session-bound observed effort.

Production Claude dispatches use native `--json-schema`. The complete final report is the native terminal `structured_output.response` string. The runtime checks that unmodified string against the bound BRIEF first line; the text `result` field is not a fallback. Missing or malformed structured output fails. Native identity, status, and scope requirements still apply. Standalone `model-probe.js` challenge output and other vendor formats are unchanged.

Requested-only identity cannot qualify a production dispatch. Missing, conflicting, or changed proof fails. Google uses `casper_via=agy` and the exact staged skill-root grant. No Gemini PAYG fallback is permitted.

Google probes and dispatches pin `--log-file` to `native-cli.log` in a unique evidence directory for that call. Default second-resolution home logs can collide under parallel execution. The collector uses the pinned native log when building the proof log, `vendor.log`.

The runtime commits a transaction only after plan binding, acknowledgment, proof, scope audit, receipts, and idempotent telemetry agree. Failed work remains recorded. Execution PASS is distinct from approval.

Review responses end with exactly one `POSITION: APPROVE`, `POSITION: REJECT`, or `POSITION: ABSTAIN` line. `panel-tally.js` extracts votes from verified native responses. Grok never writes ballots or votes. No model can waive deterministic failure.

`cli-launch.js` and standalone `cli-smoke.js` are transport diagnostics, not production activation paths. Use `npm run check` and the explicit-root `cross-repo-check.js` for offline validation. Native acceptance remains a separate target-machine check.
