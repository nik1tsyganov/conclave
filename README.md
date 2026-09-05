# MAGI

MAGI is a **code-enforced, tri-vendor AI engineering system**. OpenAI, Anthropic, and Google occupy the three working seats. xAI/Grok 4.6 is the non-voting arbiter: it classifies work, proposes routes, writes briefs, launches seats, records lead telemetry, and performs mechanical tallying. It does **not** implement, review, verify, repair, or vote.

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

## Two host modes

- `/magi` — Cursor Task mode.
- `/magi-cli` — vendor-CLI mode using Codex CLI, agy, and Claude Code. This mode is the focus of the fail-closed runtime in `tools/`.

## Code-enforced control plane

`/magi-cli` no longer relies on the arbiter remembering a prose routing table.

```text
Grok classifies
    ↓
dispatch-plan.json
    ↓
dispatch-matrix.js          class/vendor/model/effort/probe/distribution policy
    ↓
seat-policy.js              role/permissions/skill allow-list/leaf-seat policy
    ↓
cli-skill-stage.js          minimal per-seat staged skill pack + hashes
    ↓
cli-rules-stage.js          versioned standing rules + hashes
    ↓
dispatch-run.js             rechecks policy at the actual launch boundary
    ↓
vendor CLI
    ↓
cli-proof.js                observed model + vendor-native proof
    ↓
telemetry + receipt + activation + mechanical tally
```

A deterministic failure cannot be waived by Grok or by a seat.

### Routing authority

`.cursor/skills/magi-cli/references/dispatch-matrix.json` is the machine-readable source for legal vendor/model/effort combinations by task class and role. `tools/dispatch-matrix.js` validates a whole plan before any vendor spend, and `tools/dispatch-run.js` validates the individual route again immediately before launch.

Current high-level policy:

| Class | Preferred route |
|---|---|
| Architecture / extreme planning | GPT-6 Astra high/xhigh, then Opus / Gemini Pro |
| Standard feature | GPT-5.6 Terra medium |
| Bulk / mechanical | GPT-5.6 Luna medium |
| Difficult debugging | GPT-5.6 Sol high |
| Long-running agentic implementation | Claude Fable xhigh |
| Long-context analysis / research synthesis | Gemini Pro |
| Security-sensitive | Opus xhigh, Astra xhigh, Gemini Pro panel |
| Adversarial review | Sol/Astra high, Opus high, Gemini Pro |

Probe-required models are **unavailable until the actual CLI proves the exact requested slug**. Silent vendor substitution is a failed route, not a successful fallback.

### Seat capability authority

`.cursor/skills/magi-cli/references/seat-profiles.json` defines what each vendor seat may do:

- legal roles;
- permission profile per role;
- required proof fields;
- base skills;
- role-specific skills;
- class-specific skills;
- forbidden arbiter/orchestration skills;
- leaf-seat / no-subdispatch invariant.

`tools/cli-skill-stage.js` copies only that seat's allow-listed skills into the dispatch evidence directory and writes a hashed manifest. `dispatch-run.js` writes `SEAT-CONTRACT.md`, points the vendor process at that contract, and includes the contract + skill-manifest hashes in the receipt.

Review and verify seats are read-only. A vendor cannot review or verify work authored by the same vendor.

## Install

```powershell
node C:\src\magi\tools\install-plugin.js
```

The installer creates both local Cursor plugins and now copies the MAGI CLI runtime into the installed CLI plugin, including the matrix, seat-policy, proof, rules, binary-resolution, and skill-staging tools. The launcher no longer requires `C:\src\magi` merely to execute installed runtime code.

The standing rules pack is still external and versioned under `ai-ops-vault`; set `MAGI_RULES_ROOT` when it is not at the default location.

Then reload Cursor and enable **MAGI Cursor** and **MAGI Cursor CLI**.

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

The transaction fails before vendor spend if the route, seat profile, required skills, or standing rules are invalid.

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

Vendor-native proof is mandatory:

- **OpenAI/Codex:** session ID, token usage, sandbox, observed model.
- **Google/agy:** conversation ID, usage, response, exact observed model slug.
- **Anthropic/Claude:** non-empty topical capture, requested model/effort evidence contract.

## Distribution and review independence

When MAGI is convened, real implementation work must reach all three available vendors. A seat convened and then starved is failed activation. The implementation distribution floor prevents one vendor from silently receiving more than 60% of eligible independent units when qualified alternatives exist.

No vendor reviews or verifies its own authored unit. Position votes are tallied mechanically with `tools/position-tally.js`; Grok never votes.

## Rules

The standing MAGI CLI rules live in `ai-ops-vault/projects/magi-cli-rules/`. `cli-rules-stage.js` copies the versioned pack beside a dispatch and records hashes. `cli-brief-rules-check.js` verifies the staged pack, concrete scope, correct vendor bridge, and vendor-specific requirements.

Markdown documents explain policy. **Executable invariants live in code and machine-readable contracts.**

## Verification

```powershell
npm test
npm run check
```

`npm run check` is the aggregate release gate for unit tests plus MAGI CLI contract checks.

## Website

The one-shot explanatory site is intentionally dependency-free:

```text
site/
  index.html
  styles.css
  magi-core.svg
  architecture.svg
```

The art is original project artwork using a retro-futurist anime command-system visual language; it is not an official Evangelion asset.

## Repository

https://github.com/nik1tsyganov/magi
