# Cursor CLI host mode (`cursor-cli`)

This run guide is for the Grok arbiter operating the installed MAGI CLI runtime or a source checkout. It covers probes, sealed plans, dispatch, and completion evidence. MAGI is not CONCLAVE.

Run commands from the runtime root, where `tools/` exists. The source checkout stores policy in `.cursor/skills/magi-cli/references/`; the installed plugin stores it in `skills/magi-cli/references/`. Both layouts carry the same tools and lean `seat-skills/` bundle.

## Establish the local prerequisites

From the runtime root, run `node tools/magi-whoami.js --mode cursor-cli --slug grok-4.6`. In a Synara-hosted Grok thread, `--mode synara` is also LEGAL with the same arbiter slug. It compares the declared mode and exact slug with the runtime matrix; it does not prove the actual picker or host model. The command returns `LEGAL` with exit 0, rejects forbidden declarations with exit 1, and rejects missing, duplicate, unknown, or malformed arguments with exit 2. Seats still launch through native `claude.exe` / `codex.exe` / `agy.exe`. Synara is the outer harness; MAGI remains the seat runtime.

Grok 4.6 is the non-voting arbiter. It may classify, compose briefs, seal plans, dispatch, collect evidence, and request deterministic tallies. Substantive implementation, planning, research, verification, review, repair, and votes belong to vendor seats.

Set the external rule-pack path explicitly:

```powershell
$env:MAGI_RULES_ROOT = Join-Path $env:USERPROFILE '.cursor/magi-rules/v2'
$env:MAGI_VAULT_ROOT = 'C:\src\ai-ops-vault'
$env:MAGI_FIELD_LIBRARY_ROOT = 'C:\src\field-library'
$env:MAGI_VAULT_SKILLS_ROOT = 'C:\src\vault-skills'
node tools/magi-cli-preflight.js --rules-root $env:MAGI_RULES_ROOT
```

The active pack is STANDING v2 with `RULES/INDEX.md`, `VENDOR.md`, and exactly R01–R22. Missing or extra rules fail. Required rule files and each bundled `SKILL.md` must contain non-whitespace text. Preflight also checks the required runtime tool files. Native CLI authentication remains local to the machine. `claude auth status` is the Claude login check; the native model probe also verifies its subscription authentication. Never copy credentials from the kit.

`MAGI_VAULT_ROOT` is the ai-ops-vault checkout. It is MAGI's durable data home: telemetry, lean seat-skill mirrors, inbox skills, analysis, and the skill-web catalog. It is not the live rules pack. `run-finalize.js` links `telemetry.jsonl` into the vault when this env is set and the run directory is not a temp test path. After a MAGI skill edit, run `magi-vault-sync.js --push`. New vault skills land in `projects/magi/seat-skills-inbox/`; `magi-vault-sync.js --pull-inbox` copies them into MAGI `seat-skills/`.

Set `MAGI_FIELD_LIBRARY_ROOT` and `MAGI_VAULT_SKILLS_ROOT` so `magi-vault-sync.js --index` can catalog those sibling repos. Do not merge them into MAGI or the vault. Do not stage the host store, vault-skills methods, or field-library modules onto leaf seats. The map is `skill-sources.json`.

The example uses YESSIR's installed external pack. On another machine, supply its actual verified v2 pack. For bounded real-project attempts and failure recording, follow [the project handoff](../../magi-cli/references/project-runs.md).

Binary resolution uses explicit overrides, environment overrides, configured/discovered installations, and known shims. Set `MAGI_CODEX_BIN`, `MAGI_CLAUDE_BIN`, or `MAGI_AGY_BIN` when an explicit binary is needed. An invalid explicit path fails. Preflight file checks do not establish authentication or model availability.

## Probe each exact model and effort

Before a native probe or dispatch, supply `--capacity <receipt.json>` and `--legacy-capacity <capacity-state.json>`, or set `MAGI_CAPACITY_RECEIPT` and `MAGI_LEGACY_CAPACITY` to those absolute paths. The shared `tools/subscription-capacity.js` validator requires a current, positive included-capacity observation for the exact vendor/model/effort, with paid usage disabled. The observation binds its source evidence by SHA256 and maps every applicable legacy bucket. Do not fabricate an observation or renew it by changing its timestamp. Obtain new vendor-native evidence or an explicit current owner report.

The receipt must remain valid through the planned call. Ordinary dispatch defaults to 20 minutes; use `--max-wall-ms` for a shorter bound when needed. Receipts have a maximum 30-minute validity window. Missing, stale, changed, exhausted, or mismatched evidence blocks a new launch before staging or native execution. The runner checks the selected vendor's native state and rechecks admission immediately before spawn. These checks validate supplied evidence; they do not independently query every provider's billing system. Completed readback and Claude attestation do not launch a model and need no renewed receipt.

The catalog in `dispatch-matrix.json` defines legal combinations. Catalog membership is not a current availability claim. Every intended model/effort pair needs fresh native evidence in the executing environment. Unknown or unproven pairs are unavailable.

For one catalog route:

```powershell
node tools/model-probe.js --vendor openai --model gpt-6-astra --effort high --evidence-dir C:/src/magi-runs/probes/astra-high
node tools/model-availability.js --file C:/src/magi-runs/availability.json --probe C:/src/magi-runs/probes/astra-high/probe.json
```

Use a new evidence directory for each probe. Repeat for every pair selected by the plan. Google efforts use the matrix's fused names, such as `fused-high`. Probes invoke native CLIs and use included subscription capacity. Offline contract tests do not perform these calls.

A native probe that starts as one catalog model and answers as another after a vendor fallback (for example Fable `[cyber]` falling back to Opus) is FAIL. Remap to a pair whose probe identity matches, or leave that route unavailable. Do not treat the fallback as the requested model. After a Fable identity conflict, run `node tools/synara-catalog.js --remap-probe <probe.json> --catalog <synara-catalog.json>` and probe the suggested Opus pair; never accept the mismatched identity.

When the arbiter is Synara-hosted, snapshot live `synara_capabilities` before sealing:

```powershell
node tools/synara-catalog.js --import C:/src/magi-runs/synara-capabilities.json --out C:/src/magi-runs/synara-catalog.json
```

Pass that file as `--synara-catalog` to `plan-seal.js`. New seals record `synaraCatalogPolicy: diagnostic-only-v1`: the catalog is a hashed diagnostic snapshot and does not restrict native CLI routes. Historical seals without this marker retain their original narrowing. MAGI still requires exact native probes and `cli-proof`. Google fused efforts stay MAGI-side; `launch.json` records both `magiEffort` and the Synara option key (`reasoningEffort` vs `effort`).

By default, a probe creates a scratch workspace under its evidence directory. If you supply `--cwd`, it must already exist and must not contain the evidence directory. Keep both paths outside the runtime. An unconfirmed child exit leaves incomplete scope evidence; inspect the recorded PID and stop before another attempt.

Availability imports replay the hashed native capture and log. Use a separate availability output file; it must not replace the probe, capture, or log. The 60-minute freshness checks use the original probe timestamps. Re-importing a probe does not renew them. Missing, changed, expired, or mismatched native evidence fails.

## Prepare the complete plan

Write each brief as a UTF-8 file. Put its unique acknowledgment line first. Include `brief-rules-block.md` and replace every placeholder before hashing. A final response must begin with that bound BRIEF first line. The STANDING fingerprint is a separate pack check.

Do not brief seats to read MAGI CLI runtime, plugin, vendor-bridge, or dispatcher source. Product work stays in the assigned worktree. Asking Anthropic seats to inspect those internals has triggered `reasoning_extraction` refusals.

Write operator JSON files as UTF-8. A leading UTF-8 BOM from PowerShell 5.1 is accepted; plan hashes still cover the original bytes. UTF-16 and malformed UTF-8 are rejected. Supply each CLI option once; repeated selectors are errors.

Calculate the final brief hash with:

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath C:/src/magi-runs/briefs/implement.md).Hash.ToLowerInvariant()
```

The plan contains these fields:

| Field | Contract |
|---|---|
| `planId` | Unique safe identifier for the whole run. |
| `hostMode` | `cursor-cli` for plain Cursor Agent, or `synara` when this Grok arbiter is Synara-hosted. |
| `arbiter` | `{"vendor":"xai","model":"grok-4.6","effort":"high"}`; effort supports low, medium, high, and xhigh. High is the default. Fast mode is optional. |
| `magiConvened` | True when a MAGI panel is convened; required for critical classes. |
| `dispatches` | All intended implementation, review, verification, planning, and research entries. |

Each dispatch binds `dispatchId`, `unitId`, `class`, `role`, `vendor`, `model`, `effort`, absolute `cwd`, absolute `brief`, `briefSha256`, and `writeScope`. Use unique dispatch IDs. Use real absolute worktree paths.

An implementation `writeScope` contains concrete relative paths with forward slashes. It cannot contain wildcards, traversal, or `.git`. Non-implementation roles use `writeScope: []`. Their briefs state their read scope.

Review and verify entries require `authorVendor`. It must match the unit's implementation provenance and differ from the reviewing vendor. They use the same unit and product worktree. Ordinary implementation approval needs foreign verification and review, with every review returning native APPROVE. A critical `requiresPanel` class also requires `magiConvened: true` and two distinct foreign review/verify vendors for that unit and worktree.

Ordinary coding routes use the class `codingDefault`: Astra high for standard features, debugging, and long agentic work; Astra xhigh for security-sensitive and extreme end-to-end work; Luna medium for bulk mechanical work. This is an owner-selected policy, not a ranking inferred from the provisional benchmark.

The arbiter selects medium for bounded work with clear acceptance checks, high for interacting changes or uncertain diagnosis, and xhigh for substantial ambiguity or high-consequence changes. Other listed OpenAI coding model/effort choices require a `routingReason` describing the task-specific cause (at least 16 trimmed characters and three distinct words). `escalationReason` is not a substitute. Classify simple work as `bulk-mechanical`; do not silently downgrade a substantive task to Luna. Record an explicit alternative when the preferred pair lacks fresh proof or included capacity.

`chooseRoute` honors an explicit model/effort request without silently switching effort. The plan validator checks legal choices and reasons; it cannot prove that the arbiter classified the task correctly. Fresh exact-pair probes, foreign review, critical panels, distribution, and scope checks still apply. Defaults select coding routes; they do not override the required vendor distribution.

Benchmark and noncoding Astra routes still require `escalation: true` and a substantive `escalationReason` with at least 16 characters and three distinct words. Historical sealed matrix snapshots retain their original rules. A stronger model does not grant broader permissions.

Implementation distribution counts implementation units only. A convened run uses `min(3, implementation unit count)` distinct implementation vendors. The 60% cap starts at two implementation units. Review-only, plan, and research runs do not invent implementation rows.

## Seal and dispatch

Validate and copy the complete draft plan into a new run directory:

```powershell
node tools/plan-seal.js --plan C:/src/magi-runs/draft-plan.json --run-dir C:/src/magi-runs/run-001 --availability C:/src/magi-runs/availability.json
# synara hostMode also requires --synara-catalog <normalized catalog.json>
# optional: --skill-source-root <dir> binds skill bytes into seal schemaVersion 2
```

The seal binds plan bytes, brief hashes, matrix snapshots, seat profiles, and skill-source hashes. New work requires schemaVersion 2. OpenAI checking roles use scoped readonly scratch under `run/out/<dispatchId>/scratch`. Keep the run directory outside product worktrees and the runtime. Known destination collisions fail before copying plan files. Changes require a new complete plan validation and a new run directory. A `vendorOverride` in `graph.json`, a SLICES vendor column, or an ad-hoc route flag grants no authority.

Launch a selected sealed entry:

```powershell
node tools/dispatch-run.js --plan C:/src/magi-runs/run-001/dispatch-plan.json --run-dir C:/src/magi-runs/run-001 --dispatch-id implement-1 --rules-root $env:MAGI_RULES_ROOT
```

Repeat for the remaining dispatch IDs after their real dependencies complete. Route fields come from the sealed entry. Changed class, author, role, model, effort, scope, or brief fails before execution. A duplicate logical dispatch cannot append a second successful telemetry row. Preserve failed evidence; a corrected attempt needs a newly authorized plan/run.

Local input errors rejected before transaction reservation leave that dispatch unstarted. Correct the reported input and check the run state. An existing RUNNING or terminal FAIL transaction must not be reset. Every planned check remains required; agreeing checks from one vendor count as only one panel vote, and conflicting positions block approval.

### Claude: inspect, then attest the returned capture

The initial Claude launch uses the command above without `--on-topic` or `--capture-sha256`. After the child and deterministic checks finish, the command returns exit zero with this checkpoint shape:

```json
{"ok":false,"status":"AWAITING_ATTESTATION","planId":"...","planHash":"...","dispatchId":"...","capturePath":"...","responsePath":"...","captureSha256":"..."}
```

This is an expected inspection checkpoint. It is not execution PASS, approval, or a failed vendor call. Pending work cannot unlock verification, review, finalization, or activation. Read both returned files and judge whether the response addresses the bound brief. Topicality inspection does not replace the independent verification or review seats.

The generated seat contract gives absolute paths to the staged rules and role skills. Seats must read those required files before task work. Relative rule links resolve beside the staged brief, not the product working directory. A seat that reports required files missing or unread must stop and report the blocker; it cannot waive those instructions. Before accepting a product seat, inspect its report and available native read evidence for that failure. A topical response or valid receipt alone does not prove instruction compliance.

Only after that inspection, run the same dispatch command with the returned capture hash:

```powershell
node tools/dispatch-run.js --plan C:/src/magi-runs/run-001/dispatch-plan.json --run-dir C:/src/magi-runs/run-001 --dispatch-id implement-1 --rules-root $env:MAGI_RULES_ROOT --on-topic --capture-sha256 <returned-sha256>
```

This completes the saved transaction without launching another child. It revalidates the capture, protected inputs, scope, workspace, and prerequisite evidence. A mismatched hash or changed evidence cannot qualify. Never supply topicality flags on a first launch: the response does not yet exist to inspect.

Repeating the initial command while pending only returns its checkpoint. If the response is off-topic or uncertain, stop and report the pending state; do not attest it. An actual terminal FAIL remains failed and cannot be repaired by these flags. OpenAI and Google keep their one-step completion. Successful receipt replay remains idempotent.

Launches read the sealed availability snapshot. An optional `--availability` argument must be a byte-identical copy. Refreshing expired probes requires a new complete plan and seal.

The runtime derives capabilities from `seat-profiles.json`. It stages the vendor card (`seat-openai`, `seat-anthropic`, or `seat-google`), role skills, and domain class extras only. Long-run classes add no host loop or harness copies. The bundled lean source is the default. Full home orchestration and bridge skills are not seat capabilities.

Every generated `SEAT-CONTRACT.md` points to the actual `skills/skills-manifest.json`. Rules are copied beside the bound brief with `rules-manifest.json`. `cli-brief-rules-check.js` verifies the generated profile, permissions, pointers, files, and hashes. Skill names in prose cannot establish file existence.

Seats are leaf workers. They must not delegate, change routes, or edit evidence, receipts, or telemetry. Every non-implementation role is read-only. OpenAI uses read-only mode; Google uses sandbox mode. `casper_via=agy` is the Google transport, with the exact staged skill root passed through `--add-dir`. No Gemini PAYG fallback is permitted.

Claude non-implementation seats use the schema 5 `read-only-tools` profile. The runtime supplies `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. These seats inspect authorized files and existing test evidence; they cannot execute shell commands. Provide test reports as explicit inputs. Claude plan mode requires a separate approval turn and cannot reliably finish unattended leaf verification.

Claude implementation uses `--safe-mode --permission-mode bypassPermissions` with its declared scope and post-run audit. Native safe mode disables global customization and hooks while preserving subscription authentication and role permissions. Do not use `--bare`; it disables OAuth. Safe mode is not vendor-home isolation.

Production Claude dispatches request a native `--json-schema` envelope. Put the complete final report in the schema's `response` string, exposed by the CLI as terminal `structured_output.response`. The runtime uses that string unchanged and checks its exact bound-BRIEF first line. It does not strip a prefix, generate an acknowledgment, or fall back to the text `result` field. Missing or malformed structured output fails. Native success, session, model, effort, usage, and scope checks still apply. Standalone `model-probe.js` keeps its challenge-response format; other vendor output formats are unchanged.

Google probes and dispatches supply `--log-file <evidence-dir>/native-cli.log`. Each call has a unique evidence directory. Default second-resolution home-log names can collide during parallel calls, so proof collection uses the pinned native file when building `vendor.log`.

## Optional run dashboard

From the source or installed runtime root, start the viewer for a sealed run:

```powershell
node tools/magi-dashboard.js --run-dir <sealed-run-directory>
# Optional: --port <port>
```

Open the printed URL, including its token fragment. The server binds only to loopback and selects a random port by default. The token stays in the browser fragment and authorizes local data requests. Press Ctrl+C to stop the dashboard only; vendor work continues independently.

The viewer reads recorded activity and refreshes it as run files change. It does not launch vendors, dispatch, attest, finalize, or check acceptance. Missing or stopped dashboard files do not block native work. The installer includes this optional viewer separately from mandatory runtime prerequisites.

The view excludes prompts, credentials, and raw transcripts. Recorded states and prerequisite links describe saved evidence; they do not prove live process health, direct peer messaging, or approval. Use the normal native evidence and finalization procedure for acceptance.

Select a task handoff to highlight its source seat, arbiter route, and receiving seat. The detail shows roles, task IDs, launch time, and upstream proof references. Follow latest selects the newest recorded handoff. Planned dependencies use dashed lines; a recorded receiving launch replaces the matching planned link. Recovery attempts keep separate handoff records.

New handoffs pulse briefly only during continuous observation and within 15 seconds of their recorded launch. Initial load, reconnect, resume, old records, and planned links do not pulse. Pause and hidden tabs invalidate pending observation requests. Reduced-motion preferences suppress moving particles. The diagram shows recorded prerequisite use through the arbiter; it does not claim direct seat messaging.

## Read the committed evidence

### Maintained lessons and enforcement

The maintained lesson catalog is `seat-profiles.json` → `operationalLessons.entries`. Its 29 session records carry procedures, delivery selectors, code/test references, and explicit enforcement limits. The original scratch register is historical evidence. New plan seals and installations require the current catalog; the seal binds its bytes with the seat profiles.

The runner selects relevant leaf procedures by role/vendor and inserts them into the required `SEAT-CONTRACT.md`. The existing native instruction-read and hash checks reject results without full contract-read evidence. This is an acceptance check after execution; it does not prevent an early product access. Arbiter and maintainer procedures remain in the policy rather than expanding every leaf brief.

On this machine, `node C:/Users/YESSIR/.claude/docs/tools/lesson-brief.js --fields dispatch,workflow --format md` reads current canonical sources, including the installed policy. Its normal invocation rebuilds in memory; `--index` explicitly chooses an offline snapshot. General listings are not dispatch briefs. To select leaf guidance, add `--delivery seat --role verify --vendor openai` with the actual role/vendor. Arbiter and maintainer work use their corresponding delivery selector. Native host startup pointers provide discovery. MAGI runner checks provide enforcement even when an agent forgets a procedure. They do not constrain arbitrary commands outside MAGI or replace semantic judgment or an OS sandbox.

`cli-proof.js` requires native evidence, separate from requested identity:

| Vendor | Required evidence |
|---|---|
| OpenAI | Session ID, token count, sandbox, observed model, and observed effort. |
| Google/agy | Successful envelope, conversation ID, usage, response, and matching per-conversation native model slug. Effort is fused into that slug. |
| Anthropic | Successful structured native result, session, numeric usage, canonical observed model, and session-bound native observed effort. |

An unknown, missing, or conflicting observation fails. Requested-only Claude identity cannot qualify a production dispatch. A catalog alias such as `opus` is compared with its canonical observed identity.

The per-dispatch evidence includes `launch.json`, `plan-binding.json`, the copied brief, `seat-profile.json`, `SEAT-CONTRACT.md`, both manifests, `capture.txt`, `vendor.log`, `proof.json`, `scope-audit.json`, `receipt-ack.json`, and `handoff-envelope.json`. The committed transaction binds these artifacts and their hashes to the plan entry, requested/observed identity, changed-file evidence, and idempotent telemetry.

A scope audit rejects product writes outside the declared scope. It does not sandbox vendor home directories or provide universal hostile-process isolation. Local native configuration remains a host responsibility.

## Finalize execution and approval

After the planned dependencies and checks complete:

```powershell
node tools/run-finalize.js --run-dir C:/src/magi-runs/run-001
node tools/magi-vault-analyze.js
node tools/magi-vault-sync.js --status
node tools/magi-vault-sync.js --index
node tools/panel-tally.js --run-dir C:/src/magi-runs/run-001 --unit-id api-1
```

Execution PASS and approval are separate results. A successful implementation alone is insufficient for approval. Ordinary approval requires foreign verification and review, with every review returning native APPROVE. For critical units, the finalizer requires at least two eligible native APPROVE positions after author recusal.

Review responses contain exactly one final `POSITION: APPROVE`, `POSITION: REJECT`, or `POSITION: ABSTAIN` line. `panel-tally.js` reads these votes from verified captured responses and uses the existing position-tally arithmetic. Handwritten ballots and a model's own tally cannot activate work. Grok never votes.

`cli-launch.js` is an internal/legacy transport helper. Standalone `cli-smoke.js` builds offline pointer-delivery plans from staged inputs; its `activationEligible` result is false. Neither is a production activation path.

## Synara host helpers (not seats)

Synara worktrees, `browser_*`, wait, interrupt, and diagnose are harness helpers. They are not MAGI seats.

- Point an implement `cwd` at a Synara worktree that already sits under `MAGI_DEV_ROOT` or `MAGI_ALLOWED_WORKSPACE_ROOTS`. Confirm it with `node tools/host-helper-worktree.js --cwd <worktree> --out <binding.json>`. Launch remains `dispatch-run.js`.
- After a MAGI implement, run host `browser_*` checks and stage the files with `node tools/host-helper-evidence.js --run-dir <sealed-run> --label <id> --from <evidence-dir>`. Put that destination on verify/review `evidenceReadDirs`. Those directories are extra reads, never a MAGI `POSITION`.
- `synara_wait_for_threads` joins Synara threads only. It does not join `dispatch-run` child PIDs. For parallel MAGI seats, launch each `dispatch-run.js` yourself, then record and wait:

```powershell
node tools/magi-synara-watch.js --record-join --run-dir C:/src/magi-runs/run-001 --dispatch-id implement-1 --dispatch-id verify-1
node tools/magi-synara-watch.js --wait --run-dir C:/src/magi-runs/run-001 --dispatch-id implement-1 --dispatch-id verify-1
```

That writes `join-manifest.json` and joins MAGI transactions only. The periodic `magi-synara-watch.js --run-roots` scan also reads those manifests for leftover `RUNNING` children and synara-capture `ask` revert. The watchdog notifies; it never rewrites a receipt to PASS.
- Do not create Casper, Balthasar, or Melchior as Synara threads. Do not substitute Cursor Task elector slugs for seats.

## Offline checks

From the MAGI source checkout:

```powershell
npm test
node tools/release-check.js
# Optional archived-kit compatibility check; see README validation limits:
node tools/cross-repo-check.js --kit-root C:/src/magi-kit --vault-root $env:MAGI_RULES_ROOT
```

Cross-repository checks compare complete base/role/class/forbidden skill contracts, the bundled skill bytes, STANDING v2, the exact indexed R01–R22 inventory, and the leaf brief template. Run them against the intended local checkouts. Their success does not prove native authentication, model access, permission support, or complete tri-vendor operation.
