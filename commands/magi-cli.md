---
name: magi-cli
description: Start or continue a code-enforced MAGI Cursor CLI run (hostMode `cursor-cli`). Not CONCLAVE and not `/magi` Task mode.
---

# /magi-cli

- If this chat is CONCLAVE, stop and open a separate MAGI chat.
- Run `magi-whoami --mode cursor-cli --slug <picker slug>`. Stop unless LEGAL.
- The arbiter is xAI Grok 4.6. Grok classifies, writes plans/briefs, launches seats, records lead telemetry and mechanically tallies. It MUST NOT act as an implement, plan, research, review or verify seat; repair product work; or vote.
- Run installed `tools/magi-cli-preflight.js` before planning. Exit 2 is fail-closed.
- Read the MAGI CLI skill plus `references/cursor-cli.md`, `references/dispatch-matrix.json`, `references/seat-profiles.json`, and `references/brief-rules-block.md`.

## 1. Write and validate the dispatch plan

Before any vendor process starts, write `dispatch-plan.json`:

```json
{
  "hostMode": "cursor-cli",
  "arbiter": { "vendor": "xai", "model": "grok-4.6", "effort": "high" },
  "magiConvened": true,
  "dispatches": [
    { "unitId": "api-1", "class": "standard-feature", "role": "implement", "vendor": "openai", "model": "gpt-5.6-terra", "effort": "medium" },
    { "unitId": "architecture", "class": "architecture-planning", "role": "plan", "vendor": "anthropic", "model": "opus", "effort": "high" }
  ]
}
```

Run:

```text
tools/dispatch-matrix.js --plan <dispatch-plan.json> [--availability <availability.json>]
```

Non-zero means STOP. Grok may choose only routes admitted by the matrix.

`high` is the normal arbiter effort. Use `xhigh` only for genuinely contested/high-risk decomposition or routing.

## 2. Seat roles are semantic and permission-scoped

Legal roles are `implement`, `review`, `verify`, `plan`, and `research`.

- `implement` may write only within its assigned worktree/SCOPE.
- `review`, `verify`, `plan`, and `research` are read-only product roles.
- Review/verify cannot be assigned to the vendor that authored the unit.
- Plan/research work is not mislabeled as implementation merely to satisfy distribution rules.

The seat capability set is generated from `seat-profiles.json`. Routing, bridge, orchestration, distribution and retrospective skills are arbiter-only. The seat receives only its role/class allow-list through a staged, hashed skill pack.

## 3. Launch only through the transaction runner

Every seat launches through `tools/dispatch-run.js` with explicit class, role, vendor, model, effort, brief, worktree, dispatch/unit IDs and evidence directory.

Do not call vendor binaries directly for a MAGI seat. `dispatch-run.js` rechecks the matrix, builds the seat contract, stages the minimal skill pack, stages/hashes R01–R21, validates the brief, applies role permissions, captures proof, writes telemetry, and creates receipt/handoff artifacts.

## 4. Model policy

- **OpenAI:** Luna = throughput; Terra = balanced; Sol = frontier; GPT-6 Astra = frontier-plus. Astra is probe-required. On lanes marked `escalationOnly`, the dispatch must include an explicit escalation reason.
- **Anthropic:** Sonnet = balanced; Opus = judgment/review; Fable = long-horizon agentic work. Current Claude text-mode proof confirms the requested alias/effort plus a healthy topical response; it does **not** pretend the vendor-native model identity was observed.
- **Google:** Gemini 3.1 Pro high is the proven deep lane. Gemini 3.8 Flash routes are probe-required until exact agy slugs are observed.

Probe-required availability must be fresh; the runtime defaults to a 60-minute maximum proof age. Record probes with `tools/model-availability.js`. Requested/observed mismatch makes the requested route unavailable.

## 5. Distribution and panels

The ≤60% implementation floor applies when there are at least two implementation units. A single implementation unit is not mathematically rejected by the floor.

When MAGI is convened and implementation work exists, implementation units must be spread across `min(3, numberOfImplementationUnits)` distinct vendors. Thus:

- 1 implement unit → one implementation vendor is legal;
- 2 independent implement units → two vendors;
- 3+ independent implement units → all three vendors where the plan is convened and routes are legal.

A review-only or research/plan panel does not need fake implementation rows. Convening a seat still requires giving that seat real work in the role for which it was convened.

## 6. Standing requirements

- Every seat brief contains the required RULES block with concrete SCOPE, role, vendor, host mode, seat-contract/skill-manifest pointers, proof and communication requirements.
- Google/agy receives the staged per-dispatch skill root, not the full global skill tree as its MAGI capability boundary.
- Claude requires live auth + headless probe before dispatch; degradation is based on current evidence, not stale docs.
- Implement seats produce WRITE AUDIT when required.
- Run `activation-check` on the live implement log and `position-tally` for panel POSITION.
- Deterministic failures cannot be waived by Grok or any seat.
