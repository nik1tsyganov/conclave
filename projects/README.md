# Product-run notes

These folders are MAGI notes about other products. They are not those
products' source trees and they are not skill repos.

| Slug | Product | What lives here |
|---|---|---|
| `hearth` | `C:\src\discord-clone` | Slice graph (`SLICES.md`) and the gitignored Hearth dispatch log |
| `signal-sim` | `C:\src\signal-sim` | Product pointer only |

Durable MAGI telemetry and the skill-web catalog live in ai-ops-vault
`projects/magi/`, not here. The bench-001 vault harness is retired.

## Reproducible project trials

`tools/project-fixtures.js` generates two dependency-free Node projects in a new
absolute scratch directory whose parent already exists. It never copies fixture
source into this directory.
Use its `generateFixture(project, destination)` export. Each result lists the
protected file hashes, two implementation units, and exact test arguments.

| Project | User behavior | Two writable modules |
|---|---|---|
| `ticket-digest` | Import ticket revisions and print a deterministic work list | Import validation; digest ordering and counts |
| `workshop-roster` | Book limited seats and persist a waiting list | Booking state changes; validated durable storage |

Each generated project has eleven files. Its CLI, contracts, examples, and tests
are fixed. The two source modules contain deliberate faults. Capture the failing
baseline before dispatch. Do not let seats change the acceptance tests.

Use one complete six-dispatch plan per project: two implementations, two foreign
verifications, and two foreign reviews. Serialize both writers in one project
worktree. Check each unit before advancing. Then freeze the product and capture
the complete suite outside it. Checkers inspect those saved results and source.
Run verification before review for each unit. Do not change the product after
verification starts. Arbitrary cross-unit dependencies are not runtime-enforced;
the host must enforce this order.

Follow the [project-run guide](../.cursor/skills/magi-cli/references/project-runs.md)
for capacity, workspace authorization, immutable evidence, finalization, activation,
and receipt-bound tally. A successful generator is preparation, not a native run.
Native execution, product correctness, approval, and host integration are separate
results. Keep failed attempts. A new fixture revision needs a new attempt.

## Structure boundary

`skill-sources.json` owns the source map. Only `seat-skills/` stages to native seats.
Matching names in field-library or host stores do not make those skills duplicates.
Compatibility reference copies remain hash-checked by `plugin-check.js`.
The broad installer excludes tool tests and includes the ownership map; runtime
helpers remain available without the source checkout. Do not delete read manifests
to reduce file counts: staged reads are part of native evidence validation.
