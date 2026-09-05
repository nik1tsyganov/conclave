# MAGI

MAGI is a **code-enforced, tri-vendor AI engineering system**. OpenAI, Anthropic, and Google occupy the working seats. xAI/Grok 4.6 is the non-voting arbiter: it classifies work, proposes routes, writes briefs, launches seats, records lead telemetry, and performs mechanical tallying. It does **not** act as a substantive implementation, planning, research, review, verification, repair, or voting seat.

> The model proposes. Deterministic policy decides what is legal.

A standalone visual explainer lives in [`site/`](site/). Open [`site/index.html`](site/index.html) directly in a browser.

## System

| Seat | Vendor | Primary strengths | Model strategy |
|---|---|---|---|
| **Melchior** | OpenAI | technical rigor, implementation, debugging, adversarial review | Luna → Terra → Sol → Astra by task difficulty |
| **Balthasar** | Anthropic | judgment, conservative review, safety, long-running agentic implementation | Sonnet / Fable / Opus selected by role |
| **Casper** | Google | context, breadth, synthesis, decorrelated third perspective | Flash → Pro; exact agy-observed slug required |
| **Arbiter** | xAI | classification, routing, brief composition, mechanical orchestration | Grok 4.6 high; xhigh only for contested/high-risk routing |

MAGI is **not CONCLAVE**. CONCLAVE is a separate system with separate host rules.

## Host modes

- `/magi` — Cursor Task mode.
- `/magi-cli` — vendor-CLI mode using Codex CLI, agy, and Claude Code. This mode is the focus of the fail-closed runtime in `tools/`.

## Code-enforced control plane

```text
Grok classifies
    ↓
dispatch-plan.json
    ↓
dispatch-matrix.js          class/vendor/model/effort/probe/escalation/distribution
    ↓
seat-policy.js              semantic role/permissions/skill allow-list/leaf-seat policy
    ↓
cli-skill-stage.js          minimal per-seat staged skill pack + hashes
    ↓
cli-rules-stage.js          versioned standing rules + hashes
    ↓
dispatch-run.js             rechecks policy at the actual launch boundary
    ↓
vendor CLI
    ↓
cli-proof.js                vendor-native proof, with requested/observed identity kept distinct
    ↓
telemetry + receipt + activation + mechanical tally
```

A deterministic failure cannot be waived by Grok or by a seat.

## Routing authority

`.cursor/skills/magi-cli/references/dispatch-matrix.json` is the machine-readable source for legal vendor/model/effort combinations by task class and semantic role.

Current high-level policy:

| Class | Preferred route |
|---|---|
| Architecture / planning | Claude Opus high; Sol / Gemini Pro alternate; Astra only as explicit escalation |
| Standard feature | GPT-5.6 Terra medium |
| Bulk / mechanical | GPT-5.6 Luna medium |
| Difficult debugging | Claude Fable xhigh / GPT-5.6 Sol high |
| Long-running agentic implementation | Claude Fable xhigh |
| Long-context analysis / research synthesis | Gemini Pro |
| Security-sensitive implementation | Opus xhigh with independent cross-vendor review; Astra is an escalation lane |
| Adversarial review | Sol high, Opus high, Gemini Pro; Astra only as explicit escalation |
| Extreme end-to-end implementation | GPT-6 Astra high when fresh probe evidence confirms availability |

Probe-required models are unavailable until the actual CLI proves the exact requested model. Probe records must also be fresh; the runtime default maximum age is 60 minutes. Silent model substitution is failure, not a successful fallback.

Routes marked `escalationOnly` require an explicit escalation flag and reason. Grok cannot spend Astra merely because it prefers a stronger model.

## Seat capability authority

`.cursor/skills/magi-cli/references/seat-profiles.json` defines what each seat may do.

Legal roles are:

- **implement** — scoped product writes; implementation/testing capabilities;
- **review** — read-only review capability;
- **verify** — read-only testing/evaluation capability;
- **plan** — read-only planning/context capability;
- **research** — read-only research/context capability.

Routing, bridge, orchestration, distribution, assessment and retrospective skills are arbiter-only. Seats are leaf workers and cannot sub-dispatch.

`tools/cli-skill-stage.js` copies only the seat's allow-listed skills into the dispatch evidence directory and writes a hash manifest. `dispatch-run.js` writes `SEAT-CONTRACT.md`, points the vendor process at that contract, and records contract/skill-manifest hashes in the receipt.

## Permissions and review independence

- OpenAI implement seats use `workspace-write`; every non-implement role is `read-only`.
- Claude implement seats use the implementation permission path; non-implement roles use plan/read-only behavior.
- Google/agy implement seats use the implementation permission path; non-implement roles use sandbox mode.

A vendor cannot review or verify a unit that same vendor authored.

## Install

```powershell
node C:\src\magi\tools\install-plugin.js
```

The installer creates both local Cursor plugins and copies the MAGI CLI runtime into the installed CLI plugin, including matrix, seat-policy, proof, rules, binary-resolution, skill-staging, and model-availability tooling. The launcher no longer requires `C:\src\magi` merely to execute the installed runtime.

The standing rules pack remains external and versioned under `ai-ops-vault`; set `MAGI_RULES_ROOT` if it is not at the default location.

## `/magi-cli` front door

1. Use a Grok 4.6 Cursor host and run the MAGI identity check.
2. Run `tools/magi-cli-preflight.js`.
3. Classify units and write `dispatch-plan.json`.
4. Validate it:

```powershell
node tools\dispatch-matrix.js --plan dispatch-plan.json --availability availability.json
```

5. Launch every seat only through `dispatch-run.js`:

```powershell
node tools\dispatch-run.js `
  --vendor openai `
  --role implement `
  --class standard-feature `
  --brief C:\path\BRIEF.md `
  --cwd C:\src\product `
  --model gpt-5.6-terra `
  --effort medium `
  --dispatch-id run-001 `
  --unit-id api-001 `
  --evidence-dir C:\path\evidence\api-001
```

The transaction fails before vendor spend if the route, seat profile, required staged skills, or standing rules are invalid.

## Evidence contract

A successful seat produces structured evidence including:

```text
launch.json
seat-profile.json
SEAT-CONTRACT.md
skills/skills-manifest.json
RULES/rules-manifest.json
capture.txt
vendor.log
proof.json
receipt-ack.json
handoff-envelope.json
```

Proof semantics are deliberately explicit:

- **OpenAI/Codex:** session ID, token usage, sandbox, observed model.
- **Google/agy:** conversation ID, usage, response, exact observed model slug from the vendor run log.
- **Anthropic/Claude:** healthy non-empty topical capture plus the requested model/effort. The current text-mode path labels identity evidence `requested-only`; it does not pretend the model identity was independently observed.

## Distribution and panels

The ≤60% implementation floor applies when there are at least **two** implementation units. A one-unit implementation task is therefore legal.

When MAGI is convened and implementation work exists, the plan must use `min(3, number of implementation units)` distinct implementation vendors:

- 1 implementation unit → one implementation vendor;
- 2 independent implementation units → two vendors;
- 3+ independent implementation units → all three vendors when legal routes are available.

Review-only, plan, research, or verification panels do not create fake implementation rows just to satisfy the floor.

Position votes are tallied mechanically with `tools/position-tally.js`; Grok never votes.

## Rules

The standing MAGI CLI rules live in `ai-ops-vault/projects/magi-cli-rules/`. `cli-rules-stage.js` copies the versioned pack beside a dispatch and records hashes. `cli-brief-rules-check.js` verifies the staged pack, concrete scope, seat-contract/skill-manifest references, role semantics, and vendor-specific requirements.

Markdown explains policy. **Executable invariants live in code and machine-readable contracts.**

## Verification

```powershell
npm test
npm run check
npm run check:cross-repo
```

`npm run check` is the repository release gate. `check:cross-repo` compares the MAGI seat contract against `magi-kit` and the `ai-ops-vault` standing rules when all three repositories are available locally.

## Website

The one-shot explanatory site is dependency-free:

```text
site/
  index.html
  styles.css
  magi-core.svg
  architecture.svg
```

The artwork is original project art using a retro-futurist anime command-system visual language; it is not an official Evangelion asset.

## Repository

https://github.com/nik1tsyganov/magi
