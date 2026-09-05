---
name: magi
description: MAGI in Cursor. Use when the user says magi or /magi. Grok routes Claude+Codex+Gemini. Not CONCLAVE.
---

# MAGI in Cursor

## Select the mode

MAGI is not CONCLAVE. Do not run CONCLAVE's `session-whoami.js` or dispatch `camerlengo-8`.

`/magi` selects native Cursor Tasks with `hostMode: cursor`. `/magi-cli` selects native vendor CLIs with `hostMode: cursor-cli`. Run `magi-whoami` with the selected mode before activation. It checks the declared route, not the actual host model.

## Cursor CLI only

For `cursor-cli`, use the [MAGI CLI skill](../magi-cli/SKILL.md), [CLI run procedure](references/cursor-cli.md), and [brief rules block](references/brief-rules-block.md). The native workflow below does not apply to CLI runs or their leaves.

Grok 4.6 coordinates as the non-voting arbiter. It prepares plans and briefs, dispatches selected entries, and requests deterministic completion checks. Substantive implementation, repair, planning, research, review, verification, and votes belong to vendor seats. The arbiter keeps orchestration, routing, bridges, distribution, assessment, and retrospective skills. Each leaf receives only its staged vendor card and role/class skills.

1. Set `MAGI_RULES_ROOT` to the external STANDING v2 / R01-R22 pack and run the CLI preflight. Use `claude auth status` for the current Claude login check.
2. Select each model and effort from the dispatch matrix. Run `model-probe.js --vendor <vendor> --model <model> --effort <effort> --evidence-dir <new-probe-dir>` for every exact pair, then import its captured `probe.json` with `model-availability.js --file <availability.json> --probe <probe.json>`.
3. Require actual native evidence for every route. Catalog membership and an earlier login check do not prove model access. Unknown, mismatched, or unproven pairs are unavailable. Hashed probe evidence expires 60 minutes after its original completion; re-imports do not renew it.
4. Prepare the complete plan after finalizing and hashing every brief. Bind the plan ID, CLI host/arbiter, all dispatch IDs, unit IDs, roles/classes, vendor/model/effort, absolute worktrees and brief paths, brief hashes, relative write scopes, author provenance, and any escalation reason. Astra always requires a recorded escalation reason.
5. Seal the whole plan with `plan-seal.js --plan <draft.json> --run-dir <new-run-dir> --availability <availability.json>`. Launch only its entries with `dispatch-run.js --plan <run-dir/dispatch-plan.json> --run-dir <run-dir> --dispatch-id <id> --rules-root <external-v2-pack>`.
6. Finalize with `run-finalize.js --run-dir <run-dir>` and activate with `activation-check.js --run-dir <run-dir>`. For panel decisions, use `panel-tally.js --run-dir <run-dir> --unit-id <unit>`. It reads verified native POSITION responses and applies author recusal. No handwritten ballots, manual implementation logs, or arbiter votes can establish CLI approval.

Run these tools from the resolved MAGI source checkout or installed runtime directory. The complete field contracts and commands are in the linked CLI run procedure. A standalone matrix check, vendor command, or smoke result does not seal or activate a production run.

Launch uses the availability evidence pinned by the seal. Omit `--availability` on `dispatch-run`; that optional argument accepts only a byte-identical copy for relocation. A refreshed availability snapshot requires a new complete plan and seal.

Convened implementation requires at least `min(3, implementation unit count)` distinct implementation vendors. Every plan with at least two implementation units has the matrix's 60% maximum vendor share. Plan, research, and review-only runs do not invent implementation rows. Preserve class requirements and foreign author-independent review/verification. Execution PASS and approval remain separate.

SLICES and graphs define work, dependencies, and scope. Their vendor columns or `vendorOverride` fields do not authorize CLI routes. Changes require a revised complete plan, all matrix/availability/independence/distribution/escalation checks, and a new seal.

CLI seats are leaves. They cannot delegate, load Cursor plugins, or edit policy, receipts, evidence, or telemetry. The runtime verifies real staged skill/rule files and hashes. Non-implementation roles are read-only. Claude's `read-only-tools` profile permits file inspection and existing test evidence, not shell execution; provide needed test reports as inputs. Follow the selected native permission profile and scope audit. These controls do not sandbox vendor home directories.

Briefs follow their bound task and generated seat contract. The native final response acknowledges the BRIEF first line. Do not impose benchmark-specific exports or PR files on unrelated work. Runtime-owned proof, acknowledgment, WRITE AUDIT, scope, receipts, and telemetry must agree before completion.

## Native Cursor workflow only

Everything below applies only to an explicitly selected `hostMode: cursor` run. It retains the existing native Task workflow. Its skill stack, distribution, graph overrides, logs, and tally commands cannot override the CLI branch above.

### Required native reading (LIVE files — read from these paths, do not copy)

Read these files in order:

1. `C:\Users\YESSIR\.claude\skills\engineering-orchestrator\SKILL.md`
2. `C:\Users\YESSIR\.claude\skills\graph-engineering\SKILL.md`
3. `C:\Users\YESSIR\.claude\skills\loop-engineering\SKILL.md`
4. `C:\Users\YESSIR\.claude\skills\harness-engineering\SKILL.md`
5. `C:\Users\YESSIR\.claude\skills\evaluation-engineering\SKILL.md`
6. `C:\Users\YESSIR\.claude\skills\context-engineering\SKILL.md`
7. `C:\Users\YESSIR\.claude\skills\magi-mode\SKILL.md`
8. `C:\Users\YESSIR\.claude\skills\magi-dispatch\SKILL.md`
9. `C:\Users\YESSIR\.claude\skills\mix-mode\SKILL.md`
10. `C:\Users\YESSIR\.claude\skills\dispatch-efficiency\SKILL.md`
11. `C:\Users\YESSIR\.claude\skills\task-retrospective\SKILL.md`
12. `C:\Users\YESSIR\.claude\skills\codex-bridge\SKILL.md` when dispatching Codex
13. `C:\Users\YESSIR\.claude\skills\gemini-bridge\SKILL.md` when dispatching Gemini

If the native host check trips into `cursor-cli`, stop using this native branch and follow the CLI procedure above. Do not carry the full native skill stack into CLI leaves.

### Native Cursor Tasks

- `/magi` uses hostMode `cursor`: Grok arbiter dispatches native Cursor Task
  seats. Each Task uses `implementer`, `reviewer`, or `verifier` and MUST set
  `model` to `claude-opus-5-thinking-high`, `gpt-5.6-sol-medium`, or
  `gemini-3.1-pro` for the assigned vendor. Never Task a `codex-*` or `gemini-*`
  CLI wrapper in this mode.
- Any implement/review/vote by the arbiter is FAILED activation in native Cursor mode too.
- Before each Cursor elector Task, and after a Task fails with usage or quota
  language, run `node C:\src\magi\tools\host-resolver.js`. If it trips, send
  remaining seats through the CLI branch above and validate a complete sealed CLI plan before launch; do not persist a global mode.

### Native three-vendor implement split

Before the first write, split implement across THREE vendors:

- Intake/cluster A → Task `implementer`, model `gpt-5.6-sol-medium`
- B → Task `implementer`, model `gemini-3.1-pro`
- C → Task `implementer`, model `claude-opus-5-thinking-high`

Permute the vendors across implement units; Casper must not be idle. Review and
verification use the same model table with Task `reviewer` and `verifier`.
Review goes to the vendors other than the author. Add the third reviewer only
when the task class or owner marks the review contested.

While capacity-state `distributionBreaker` is tripped, do not give Claude the majority of implement units.

Enforce the 60% floor per vendor.

Project slice lists do NOT assign vendors. Ignore any `implement`/`verify` vendor column in a project `SLICES.md` or plan doc: vendors come from the MAGI class table plus the live floor at dispatch, and a project plan never beats the class table. The only valid owner override is `vendorOverride` on that run's `graph.json` node, recorded there — not in a doc. Canonical policy: `mix-mode` → `distributionFloor.projectSlicePolicy`. Pointer only; do not restate or fork it here.

Each implementer must paste WRITE AUDIT (`git diff --stat` + `git status --porcelain`).

After implement rows, write `magi-dispatch-log.jsonl` `{vendor, role:"implement"}` (gitignored) and run `node C:\src\magi\tools\activation-check.js <log path>`. Exit 1 = FAILED activation. Do not use `dispatch-log.pass.jsonl` as a live log.

Log path: product-repo runs write `C:\src\magi\projects\<slug>\magi-dispatch-log.jsonl`, never a log inside the product repo; MAGI-kit work uses `C:\src\magi\magi-dispatch-log.jsonl`. See `C:\src\magi\projects\README.md`.

### Native workflow execution

- Do not run `magi-battery.js` or `mix-run.js` under plain node.
- Parse check only: `node C:\Users\YESSIR\.claude\workflows\checks\magi-workflow-cli.mjs`

### Native packs (efficiency, not routers)

Cursor Task seats may use these local Cursor plugin packs as efficiency skills; they do not replace MAGI dispatch:

- Team Kit: `check-compiler-errors`, `deslop`, `verify-this`, `control-cli`, `control-ui`, `ci-watcher`, `fix-ci`, `loop-on-ci`
- Superpowers: `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `receiving-code-review`

The arbiter may use Team Kit in its own Cursor chat after a merge.

Do not use as routers: `using-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `subagent-driven-development`, `brainstorming`, `review-and-ship`, `new-branch-and-pr`, `agents-memory-updater`. Continual Learning remains owner-invoked `/continual-learning` only.

See `~\.cursor\rules\cursor-packs.mdc`.

### Native POSITION tally

Tally native panel POSITION with `node C:\src\magi\tools\position-tally.js`. Do not hand-count. Passage is `>=2 APPROVE` among eligible electors; `ABSTAIN` never toward passage; counted eligible ballots below 2 is `NOT_PANEL` (`degraded=true`, `quorumFloor`); else `DEADLOCK`. Gate roles (implementer / reviewer / verifier) are advisory. This native tally procedure does not apply to CLI runs.

### Native briefs

- Put the SCOPE block from `engineering-orchestrator` in every seat brief.
