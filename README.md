# MAGI

[![MAGI concept artwork: Melchior, Balthasar, and Casper coordinate work from a shared command room.](site/magi-readme-hero.jpg)](site/magi-readme-hero.jpg)

MAGI coordinates OpenAI, Anthropic, and Google engineering seats through a checked dispatch plan. xAI/Grok 4.6 is the non-voting arbiter. It classifies work, writes briefs, dispatches seats, and requests deterministic checks. Vendor seats perform the substantive work.

> The model proposes. Deterministic policy decides what is legal.

MAGI is not CONCLAVE. `/magi` uses Cursor Task mode. `/magi-cli` uses native vendor CLIs and the runtime in `tools/`.

## System

| Seat | Vendor | Model policy |
|---|---|---|
| Melchior | OpenAI | Astra for coding; Luna for simple mechanical tasks. The arbiter selects medium, high, or xhigh under the matrix policy. |
| Balthasar | Anthropic | Sonnet, Fable, or Opus by role and class. |
| Casper | Google | Flash or Pro catalog routes, with exact native agy slug evidence. |
| Arbiter | xAI | Grok 4.6 high by default; low, medium, high, and xhigh are supported. Fast mode is optional. |

The [dispatch matrix](.cursor/skills/magi-cli/references/dispatch-matrix.json) defines legal combinations. Every selected model/effort pair needs fresh native proof. Catalog membership does not establish current availability. Unknown and unproven pairs are unavailable.

Grok never implements, repairs, plans substantive work, researches, reviews, verifies, or votes as a seat. It cannot waive a deterministic failure.

## Install

From this checkout:

```powershell
node tools/install-plugin.js
```

The installer creates the MAGI Cursor and MAGI Cursor CLI plugins. The CLI plugin carries its tools, policy, templates, and lean `seat-skills/` source. An installed launch does not need this source checkout.

Supply the external standing-rule pack explicitly:

```powershell
$env:MAGI_RULES_ROOT = Join-Path $env:USERPROFILE '.cursor/magi-rules/v2'
$env:MAGI_VAULT_ROOT = 'C:\src\ai-ops-vault'
$env:MAGI_FIELD_LIBRARY_ROOT = 'C:\src\field-library'
$env:MAGI_VAULT_SKILLS_ROOT = 'C:\src\vault-skills'
```

Use the matching STANDING v2 / R01–R22 pack. `MAGI_VAULT_ROOT` is the ai-ops-vault checkout: durable MAGI telemetry, lean seat-skill sync, and analysis. It is not the live rules path. Credentials and availability evidence stay local to the executing host. Use normal binary discovery or the explicit `MAGI_CODEX_BIN`, `MAGI_CLAUDE_BIN`, and `MAGI_AGY_BIN` overrides. Invalid explicit binary paths fail.

## Run a checked plan

The [CLI run guide](.cursor/skills/magi-cli/references/cursor-cli.md) contains the complete command reference and plan fields. Run these tools from either the source or installed runtime root.

For real projects, give Cursor the [project-run handoff](.cursor/skills/magi-cli/references/project-runs.md). It includes a bounded launch prompt and a durable failure-recording process. The rules-path example above uses YESSIR's installed pack; other machines must supply their verified external v2 pack.

1. Check the declared Cursor arbiter route with `node tools/magi-whoami.js --mode cursor-cli --slug grok-4.6`. This checks the declaration, not the actual picker.
2. Run `tools/magi-cli-preflight.js` with the external rules pack.
3. Perform a live check on the executing host. Use `claude auth status` for Claude and native probes for every intended model/effort.
4. Write the complete dispatch plan with immutable brief hashes, roles, worktrees, scopes, author provenance, and any escalation reason.
5. Seal the plan, dispatch its selected entries, then finalize execution and approval.

Example commands for one catalog route and a prepared plan:

First set `MAGI_CAPACITY_RECEIPT` and `MAGI_LEGACY_CAPACITY` to current evidence-backed capacity files. See the CLI run guide for their contract. New native calls fail closed without valid admission. The maintained 29-lesson catalog lives in the existing seat profiles; selected procedures reach leaf contracts automatically.

```powershell
node tools/model-probe.js --vendor openai --model gpt-6-astra --effort high --evidence-dir C:/magi-runs/probes/astra-high
node tools/model-availability.js --file C:/magi-runs/availability.json --probe C:/magi-runs/probes/astra-high/probe.json
node tools/plan-seal.js --plan C:/magi-runs/draft-plan.json --run-dir C:/magi-runs/run-001 --availability C:/magi-runs/availability.json
node tools/dispatch-run.js --plan C:/magi-runs/run-001/dispatch-plan.json --run-dir C:/magi-runs/run-001 --dispatch-id implement-1 --rules-root $env:MAGI_RULES_ROOT
node tools/run-finalize.js --run-dir C:/magi-runs/run-001
node tools/magi-vault-analyze.js
node tools/panel-tally.js --run-dir C:/magi-runs/run-001 --unit-id api-1
```

Use new probe and run directories. Probe imports replay hashed native evidence. They preserve the original timestamp and expire after 60 minutes. Probe every pair needed by the complete plan before sealing it.

Each launch uses the sealed availability snapshot. An optional `--availability` argument must match that snapshot byte for byte. New probe evidence requires a new plan and seal.

The runner consumes route fields from the sealed entry. It rejects changed class, author, role, model, effort, scope, or brief. A corrected route requires a new complete plan and seal. A SLICES vendor column or edited graph node cannot override it.

## Optional run dashboard

From the source or installed runtime root, open a read-only view of a sealed run:

```powershell
node tools/magi-dashboard.js --run-dir <sealed-run-directory>
```

The command prints a loopback URL with a token fragment. Open that URL in your browser. It uses a random port by default; add `--port <port>` to select one. Press Ctrl+C to stop the dashboard only.

The view shows recorded activity and selectable seat-to-seat handoff routes. New launch-bound handoffs briefly pulse; historical and planned links stay still. It does not check acceptance or launch vendor calls. It excludes prompts, credentials, and raw transcripts. A missing or stopped dashboard does not block native work. See the [CLI run guide](.cursor/skills/magi-cli/references/cursor-cli.md) for details.

## Seat capabilities and scope

[Seat profiles](.cursor/skills/magi-cli/references/seat-profiles.json) select the vendor card, role skills, and domain class extras. Long-run classes add no host loop or harness copies. The runtime stages only those lean files and hashes them.

- `implement` permits product writes only within the declared relative paths.
- `review`, `verify`, `plan`, and `research` are read-only roles.
- Every seat is a leaf. It cannot delegate or change the plan.
- Routing, bridge, distribution, assessment, and orchestration skills belong to the arbiter.

The generated `SEAT-CONTRACT.md` points to the staged skills. Structural checks verify the profile, file paths, contents, and manifests. Skill or rule names in prose do not prove that files exist.

OpenAI non-implementation seats use read-only mode; agy uses sandbox mode. Claude uses the schema 5 `read-only-tools` profile: `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. These Claude seats inspect files and existing test evidence. They cannot run shell commands. Plan mode needs a separate approval turn and cannot reliably finish unattended leaf verification.

Claude implementation uses `--safe-mode --permission-mode bypassPermissions`, with declared product scope and post-run auditing. Safe mode disables global customization and hooks while preserving subscription authentication and role permissions. The production adapter supplies the brief pointer as a positional print-mode query after `--`, ignores stdin, and leaves the native system prompt unchanged. `stream-json` retains native Read events; the JSON schema requires a string response. The verifier checks the exact brief acknowledgment separately. Do not use `--bare`; it disables OAuth. These controls do not sandbox vendor home directories or provide universal hostile-process isolation.

Both `cursor-cli` and `synara` plans dispatch native vendor CLIs. New seals keep the Synara catalog as a hashed diagnostic snapshot, with `synaraCatalogPolicy: diagnostic-only-v1`. The catalog does not limit native CLI routes. MAGI's matrix, fresh native model/effort probes, and escalation checks still authorize each route. Historical seals without this policy marker retain their original catalog narrowing.

## Native evidence and completion

The runtime records requested and observed identity separately.

| Vendor | Required native proof |
|---|---|
| OpenAI | Session, token count, sandbox, observed model, observed effort. |
| Google/agy | Successful envelope, conversation, usage, response, exact per-conversation observed slug with fused effort. |
| Anthropic | Structured native success, session, numeric usage, canonical observed model, session-bound observed effort. |

Missing observation, substitution, artifact changes, or scope violations fail. Requested-only identity cannot qualify a production seat.

Google probes and dispatches pin `--log-file` to `native-cli.log` in their own unique evidence directory. The collector uses that native file when building `vendor.log` for proof. Default second-resolution home logs can collide during parallel calls.

Google child processes also receive a fixed `synara-capture-events.jsonl` destination and an `allow` hook response. This avoids the installed Synara hook's malformed fallback response without changing global hook configuration. The runtime hashes these events as `diagnostic-untrusted`; they never replace native identity, usage, or instruction-read evidence. Non-implementation calls retain `--sandbox`.

A successful committed transaction binds the plan hash, exact entry, brief acknowledgment, native proof, scope audit, receipts, and idempotent telemetry. Duplicate logical dispatches cannot count twice. Failed evidence remains recorded.

Execution PASS and approval are separate. Ordinary implementation approval needs foreign verification and review, with every review returning native APPROVE. Critical classes require a convened plan with two distinct foreign review/verify vendors on the same unit and worktree. Approval then requires at least two eligible native APPROVE votes after author recusal.

`panel-tally.js` extracts exactly one `POSITION: APPROVE|REJECT|ABSTAIN` line from each eligible captured response. It uses the existing position-tally arithmetic. Grok does not supply ballots or vote.

A convened implementation run uses `min(3, implementation unit count)` distinct implementation vendors. The 60% cap starts at two units. Review-only, plan, and research runs do not invent implementation work.

## Verification

```powershell
npm test
node tools/release-check.js
```

`npm run check` combines the unit suite and release check. Current source ownership is in `skill-sources.json`; use `magi-vault-sync.js --status` for the leaf mirror and `--index` for the separate skill catalog. These commands may create directories or write catalog files. See the [project guide](.cursor/skills/magi-cli/references/project-runs.md) for their repository roots.

`npm run check:cross-repo` is archived-kit compatibility validation. It still accepts `MAGI_KIT_ROOT` and `MAGI_RULES_ROOT`, or explicit `--kit-root` and `--vault-root` paths. Its historical skill maps can differ from current MAGI. Preserve and report those failures; do not restore archived skills to make them pass. It also checks v2 rules and leaf template semantics. Current mirror/catalog checks do not replace every historical invariant. Offline success does not establish native authentication, model availability, or full tri-vendor acceptance.

Standalone `cli-smoke.js` checks transport plans using staged inputs. It never invokes a vendor and returns `activationEligible: false`. Production launches use the sealed-plan transaction.

## Website

The dependency-free visual explainer is in [site/](site/). Open [site/index.html](site/index.html) directly in a browser. The command-system visual language does not imply official Evangelion affiliation.

## Repository

[nik1tsyganov/magi](https://github.com/nik1tsyganov/magi) is the only MAGI product repository.

`magi-probe` was an early working-together demo. `magi-kit` was a machine home-store snapshot. Both are archived. Do not clone them as MAGI.

## Layout

| Path | Role |
|---|---|
| `seat-skills/` | Lean leaf cards staged on dispatch |
| `tools/` | Sealed-plan runtime |
| `skill-sources.json` | Map of sibling skill repos; do not merge them |
| `agents/` | Cursor Task hostMode only; CLI install omits this |
| `commands/` / `claude-commands/` | Slash-command entry |
| `telemetry/` | Local MAGI dispatch-row contract |
| `projects/` | Product-run notes (`hearth`, `signal-sim`); not product source |
| `site/` | Visual explainer |
| `.cursor/skills/` | Arbiter MAGI / MAGI CLI skills shipped with this repo |

CONCLAVE is a different product. Keep these git homes separate and index them instead of merging:

- MAGI leaf cards: `seat-skills/`
- MAGI data / analysis: [ai-ops-vault](https://github.com/nik1tsyganov/ai-ops-vault) `projects/magi/`
- Host field modules (including `research-orchestration`): [field-library](https://github.com/nik1tsyganov/field-library)
- Obsidian ingest methods: [vault-skills](https://github.com/nik1tsyganov/vault-skills)
- Live host/arbiter store (`engineering-orchestrator`, bridges): `~/.claude/skills`

Set `MAGI_VAULT_ROOT`, `MAGI_FIELD_LIBRARY_ROOT`, and `MAGI_VAULT_SKILLS_ROOT`, then run `node tools/magi-vault-sync.js --index`.
