# CONCLAVE CLI standing rules

The standing-rules pack a run stages beside every brief. It ships with the
runtime that enforces it, so a clone of this repository can start a run without
finding a pack somewhere else first.

`CONCLAVE_RULES_ROOT` overrides it. Set that to an external pack when the policy
is versioned apart from the code — and if it is set and cannot be read, the run
stops rather than falling back here. Every staged run records the root it used in
`rules-manifest.json`, so which pack governed a run is always answerable.

This pack is **HOW**. Shared brief context is **WHAT**. Runtime code lives beside
it in `nik1tsyganov/conclave`. Lean seat skills live in that repository's
`seat-skills/`, not in archived `magi-kit`.

Start with STANDING.md and RULES/INDEX.md. `BRIEF-RULES-BLOCK.md` defines the same
leaf contract as the CONCLAVE brief template. Each dispatch gets its own staged,
digest-checked rule pack. Do not replace structural checks with grep markers.

The production path is native probe → sealed whole-run plan → role-bound dispatch
→ native evidence and write audit → terminal receipt → reconciliation and
receipt-bound panel tally.

1. `STANDING.md` — v2 fingerprint
2. `RULES/INDEX.md` — R01–R22
3. `VENDOR.md` — openai→codex, anthropic→claude, google→agy; `casper_via=agy`

`INDEX.md` at this folder root is an alias to `RULES/INDEX.md`.

CONCLAVE stages these files next to each brief. It does not load
`projects/bench-001`. That harness is retired. Offline contract checks do not
prove target-machine OAuth, model access, or native flag support.

Run `node check-rules.cjs` from this folder to check the pack is complete: the
fingerprint, R01–R22 present exactly once each, and every body linked from the
index.
