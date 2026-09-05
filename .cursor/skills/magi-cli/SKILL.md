---
name: magi-cli
description: Code-enforced MAGI Cursor CLI mode. Grok 4.6 is the non-voting arbiter; OpenAI, Anthropic and Google seats execute through vendor CLIs. Not CONCLAVE.
---

# MAGI Cursor CLI

## Identity and boundary

Run `magi-whoami --mode cursor-cli --slug <picker slug>` before activation. Stop unless LEGAL.

Grok 4.6 is the arbiter. It may classify, build the graph/dispatch plan, compose briefs, invoke the deterministic runtime, record lead telemetry and mechanically tally. It is **never a seat**: no substantive implementation, planning, research, review, verification, repair or vote.

## Arbiter reading only

The arbiter reads these orchestration surfaces; they are not automatically granted to seats:

1. `engineering-orchestrator`
2. `graph-engineering`
3. `context-engineering`
4. `magi-mode`
5. `magi-dispatch`
6. `mix-mode`
7. `dispatch-efficiency`
8. this skill's `references/cursor-cli.md`, `references/dispatch-matrix.json`, `references/seat-profiles.json`, `references/brief-rules-block.md`
9. the vendor bridge needed for the launch (`codex-bridge`, `gemini-bridge`, or `claude-bridge`)
10. `task-retrospective` only at task close when retrospective work is actually required

Do not preload loop/harness/evaluation/testing/implementation skills into the arbiter just because a future seat may use them. `seat-profiles.json` selects and `cli-skill-stage.js` stages those capabilities for the seat that needs them.

## Front door

1. Run `tools/magi-cli-preflight.js`.
2. Classify each unit into a matrix class and semantic role: `implement`, `review`, `verify`, `plan`, or `research`.
3. Write `dispatch-plan.json` with explicit vendor/model/effort for every seat.
4. Run `tools/dispatch-matrix.js --plan <plan> [--availability <availability.json>]`.
5. Stop on non-zero. Do not route around the validator.
6. Launch each seat only through `tools/dispatch-run.js`.
7. Use structured receipts/proof/telemetry for activation and tally; never hand-wave a failed gate.

## Routing policy

`references/dispatch-matrix.json` is the machine-readable legal route set.

- OpenAI: Luna → Terra → Sol → Astra. Astra is probe-gated; some lanes are escalation-only and require an explicit reason.
- Anthropic: Sonnet for balanced work, Opus for judgment/review/planning, Fable for long-running agentic work.
- Google: Gemini Pro for deep/context work; Flash lanes remain probe-gated until exact agy slugs are observed.
- Probe-gated availability must be fresh (runtime default: 60 minutes) and exact. Requested/observed mismatch is unavailable, never a silent substitution.

The matrix, not Grok preference, decides which vendor/model/effort combinations are legal.

## Seat policy

`references/seat-profiles.json` is the machine-readable seat capability authority.

- `implement`: scoped product writes; implementation + testing skills.
- `review`: read-only; review/minimalism skills.
- `verify`: read-only; testing/evaluation skills.
- `plan`: read-only; context/planning support only.
- `research`: read-only; context/research support only.
- Class-specific extras are additive, e.g. loop/harness for agentic-long-run and auth-security for security-sensitive.
- Routing, bridge, orchestration, distribution, assessment and retrospective skills are arbiter-only.
- Every seat is a leaf. It must not sub-dispatch or delegate to another model/agent.

`dispatch-run.js` writes `SEAT-CONTRACT.md`, stages only the allow-listed skills, hashes that pack, and points the vendor process at the contract.

## Permissions

- OpenAI: implement=`workspace-write`; all non-implement roles=`read-only`.
- Anthropic: implement=`bypassPermissions`; all non-implement roles=`plan`.
- Google/agy: implement=`--dangerously-skip-permissions`; all non-implement roles=`--sandbox`.

A vendor may not review or verify a unit it authored.

## Distribution

The implementation distribution floor is applied to **implementation units only** and only when at least two implementation units exist.

When MAGI is convened and implementation work exists, use `min(3, implementUnitCount)` distinct implementation vendors. A one-unit implementation task is therefore legal; a two-unit task spreads across two vendors; three or more independent units use all three vendors when routes are legal.

Review-only, planning, research and verification panels do not manufacture fake implementation rows to satisfy the floor.

Project slices define units/dependencies/write scope, not vendor assignment. Vendor/model/effort comes from the matrix and live availability.

## Proof

`cli-proof.js` defines what counts:

- Codex: session ID + tokens + sandbox + observed model.
- agy: conversation ID + usage + response + exact observed model from the run log.
- Claude: healthy non-empty topical capture + requested model/effort. The current text-mode path does **not** claim that requested Claude identity was independently observed; proof labels that evidence `requested-only`.

Do not upgrade requested-only identity into observed identity in telemetry, evidence, docs or battery results.

## Rules, telemetry and receipts

Every seat brief uses `references/brief-rules-block.md` with a concrete SCOPE. `dispatch-run.js` stages/hashes the vault R01–R21 pack and the seat skill pack before launch.

A successful transaction produces launch metadata, seat profile/contract, staged-skill manifest, rules manifest, capture/log, proof, telemetry, receipt ACK and handoff envelope. Proof + telemetry + receipt are one completion transaction.

## Claude live gate

Re-run Claude auth and headless probes in the dispatching session. Degradation is based on current evidence, not old documentation. A documented Claude failure may activate the explicit degraded path; do not infer it from stale state.

## Google live gate

Use agy only; no Gemini API PAYG fallback. Pass the staged per-dispatch skill root with `--add-dir`. The full global skill tree is not the MAGI seat capability boundary.

## Verification

After implementation dispatches, run `activation-check` on the live implement log. Tally panel POSITION with `position-tally.js`; never hand-count. Deterministic failures cannot be waived by Grok or a seat.

Use `npm run check` for the repository release gate and `npm run check:cross-repo` when MAGI, magi-kit and ai-ops-vault are all present locally.
