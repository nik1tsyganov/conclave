# MAGI CLI run guide (macOS, 2026-09-16)

This guide is for the hosting session that operates the installed MAGI CLI runtime or a source checkout. The arbiter is the Jev decision engine named by the runtime matrix; the host (a Cursor chat, a Synara thread, or Claude Code) runs the tools, attests Claude output, and holds no vote. Nothing in this guide creates proof: the runtime's receipts do.

## Identity

```bash
source ~/.config/magi/env.sh
node tools/magi-whoami.js --mode <cursor-cli|synara|claude-code> --slug <this session's model slug>
# examples
node tools/magi-whoami.js --mode cursor-cli --slug cursor-grok-4.6-high-fast
node tools/magi-whoami.js --mode claude-code --slug claude-fable-5-1
```

Stop unless the declaration is LEGAL. It records the host; it is not proof of the picker.

## Environment

`~/.config/magi/env.sh` exports `MAGI_RULES_ROOT` (STANDING v2 + R01–R22 pack), `MAGI_VAULT_ROOT` (ai-ops-vault checkout), `MAGI_FIELD_LIBRARY_ROOT`, `MAGI_VAULT_SKILLS_ROOT`, the three vendor binaries, `MAGI_ALLOWED_WORKSPACE_ROOTS`, and `MAGI_CODEX_PROVIDER=openai`. `TYPESAFE_API_KEY` enables Jev. Run `node tools/magi-cli-preflight.js` once per session. Live check before every run: `claude auth status` must report `loggedIn: true` (subscription, never an API key); a claim of reachability without a same-turn live check is NOT RUN.

## Plan

Draft `draft-plan.json`:

| Field | Value |
|---|---|
| `planId` | unique per run |
| `hostMode` | `cursor-cli`, `synara`, or `claude-code` |
| `arbiter` | `{"vendor":"jev","model":"jev-latest","host":"<session slug>"}` |
| `dispatches[]` | `dispatchId`, `unitId`, `class`, `role`, `vendor`, `model`, `effort`, `cwd` (unit worktree), `brief`, `briefSha256`, `writeScope` (implement) or `authorVendor` + `evidenceReadDirs` (verify/review); Astra rows add `escalation: true` and `escalationReason` |

Briefs are files; the first line is the seat's acknowledgment. Include the brief rules block (`brief-rules-block.md`) and run `node tools/cli-brief-rules-check.js --brief <file> --role <role> --vendor <vendor>`.

## Probe, classify, seal

```bash
node tools/model-probe.js --vendor <openai|anthropic|google> --model <model> --effort <effort> --evidence-dir <probes/name>
node tools/model-availability.js --file <availability.json> --probe <probes/name/probe.json>
node tools/jev-plan-classify.js --plan draft-plan.json --out jev-classify.json --provenance jev-decisions.jsonl
node tools/plan-seal.js --plan draft-plan.json --run-dir <run> --availability <availability.json> --skill-source-root <seat-skills> --jev-classification jev-classify.json
```

Probes expire 60 minutes after they complete. The seal refuses a plan whose class is not Jev's choice and sits below the flag gate unless `--class-override <reason>` records the owner's decision; `--no-jev <reason>` records an explicit opt-out.

## Dispatch

```bash
node tools/run-drive.js --run-dir <run> --phase implement
node tools/run-drive.js --run-dir <run> --attest <id[,id]>        # after reading each pending response.txt
node tools/run-drive.js --run-dir <run> --phase evidence --tests tests.json
node tools/run-drive.js --run-dir <run> --phase verify            # then --attest for Claude seats
node tools/run-drive.js --run-dir <run> --phase review            # then --attest for Claude seats
node tools/run-drive.js --run-dir <run> --phase finalize
```

`tests.json` maps `unitId` to `{ "command": "..." }` run in the unit's worktree; the output and diff land in every `evidenceReadDirs` of that unit, which is what Claude and Gemini checking seats read instead of running commands. Single dispatches remain available through `node tools/dispatch-run.js --plan <run>/dispatch-plan.json --run-dir <run> --dispatch-id <id> --availability <availability.json> --rules-root "$MAGI_RULES_ROOT"`.

A failed dispatch id is terminal and needs a new id in a new sealed run, except a classified launch failure (safeguard refusal at launch, network reconnect loop, missing auth, spawn error), which the runtime marks RETRYABLE for two more attempts under the same id.

## Finalize and observe

`--phase finalize` runs `run-finalize.js` (receipts → telemetry rows per dispatch, unit and run, linked into the vault), `activation-check.js` (execution and approval), `panel-tally.js` and `panel-tally-jev.js` per unit. `node tools/project-run-report.js --run-dir <run> --output-dir <new dir> --phase activation` exports a report. `node tools/magi-dashboard.js --run-dir <run>` serves a read-only local dashboard. `node tools/ledger-row.js --run-dir <run> --task "<label>"` renders the engineering-ledger row.

## Known host hazards

agy headless soft-denies any permission it cannot prompt for (the proof gate names the denied tool); Codex Terra truncated long read sequences and is retired; Opus refuses prescriptive system prompts (the adapter wording is fixed). Details: the run record under `~/.claude/docs/machine-context/reports/`.

## Reference strings the checks expect

Runtime policy lives in `dispatch-matrix.json` and `seat-profiles.json`; each seat reads `SEAT-CONTRACT.md`, `skills-manifest.json` and `rules-manifest.json`, whose staged `RULES/INDEX.md` and rule bodies are bundled into one read. Proof is verified by `cli-proof.js`; briefs are checked by `cli-brief-rules-check.js`; Google seats run `casper_via=agy`. Synara-hosted runs use `hostMode: synara` with a `--synara-catalog` at seal time and a `join-manifest` recorded by the host; Cursor-hosted runs use `hostMode: cursor-cli`.
