---
name: magi-cli
description: Start or continue a MAGI Cursor CLI run (hostMode `cursor-cli`). Use when the user says magi-cli or /magi-cli. Not CONCLAVE, not `/magi` Task mode.
---

# /magi-cli

- If this chat is CONCLAVE (`/conclave`, `camerlengo-8`), stop: tell owner to open a new chat and type `/magi` or `/magi-cli`.
- Run `magi-whoami --mode cursor-cli --slug <picker slug>`. Stop unless LEGAL. The arbiter is xAI Grok 4.6 only; elector vendors are forbidden as arbiter.
- Grok is not a seat: it classifies, writes the plan/briefs, dispatches, records lead telemetry, and mechanically tallies. It MUST NOT implement, review, verify, repair, or vote.
- Run installed `tools/magi-cli-preflight.js` before planning. Exit 2 is fail-closed: do not spend a seat until vendor binaries, required disk skills, and the standing-rules pack are present.
- Read `.cursor/skills/magi-cli/SKILL.md`, `references/cursor-cli.md`, `references/brief-rules-block.md`, and `references/dispatch-matrix.json`.

## Mandatory dispatch plan

Before the first vendor process starts, write `dispatch-plan.json` containing:

```json
{
  "hostMode": "cursor-cli",
  "arbiter": { "vendor": "xai", "model": "grok-4.6", "effort": "high" },
  "magiConvened": true,
  "dispatches": [
    { "unitId": "...", "class": "standard-feature", "role": "implement", "vendor": "openai", "model": "gpt-5.6-terra", "effort": "medium" }
  ]
}
```

Run `tools/dispatch-matrix.js --plan <dispatch-plan.json> [--availability <availability.json>]`. Stop on non-zero. Grok may choose only routes admitted by the matrix. Use xhigh arbiter effort only for genuinely contested/high-risk routing; high is the normal arbiter effort.

Every seat launches through `tools/dispatch-run.js` with the matrix class, role, vendor, model, effort, brief, worktree, dispatch/unit IDs and evidence dir. Do not call vendor binaries directly for a MAGI seat. `dispatch-run.js` independently rechecks the route, stages and hashes R01–R21, validates the brief, launches with role-aware permissions, captures vendor-native proof, and writes the lead telemetry + receipt/handoff artifacts.

- Every Magi CLI seat brief MUST contain the required RULES block with a concrete SCOPE and the correct vendor bridge. Production preflight is structural; substring-only legacy checks are insufficient.
- Implement seat briefs MUST include the `src/index.js` re-export / `PR_BODY.md` / full fixture `BRIEF.md` requirements when the fixture requires them.
- Never Cursor Task to Claude/GPT/Gemini elector slugs in this mode.
- A convened MAGI run requires real implement work from all three vendors and the ≤60% distribution floor; a starved seat is FAILED activation.
- Review/verify must be cross-vendor relative to the author vendor.
- Google model entries marked `probe-required` in the matrix are unavailable until the exact agy-observed slug is recorded as available. Silent downgrade is failure, not substitution.
- Claude requires the live auth + headless probe before dispatch. A documented failure may activate the explicit degraded duo path; do not infer degradation from stale state.
- Run `activation-check` on the live implement log after implement dispatches and `position-tally` for panel POSITION. Deterministic failures cannot be waived by Grok or any seat.
