# R11 — SLICES.md is not a vendor source

| Field | Value |
|---|---|
| id | `R11` |
| applies_to | all |
| role | lead |
| tag | VERIFIED |
| sources | conclave-activation.mdc; conclave-mode; mix-mode projectSlicePolicy |

## MUST

MUST ignore implement/verify vendor columns in project SLICES.md and prose plans. Vendors come from the dispatch matrix and the complete plan's distribution and independence checks. A proposed `vendorOverride` in `graph.json` is not authorization. Every route change must update the complete dispatch plan and pass validation and sealing again. The new sealed plan must bind the exact vendor, model, effort, role, author vendor, probes, and any escalation authorization before `dispatch-run.js` can launch it. An ad-hoc flag or edited graph node cannot override that binding.

## Brief / pack hook

- Index lists this id in the pointer-sized RULES index.
- Body file path (this file) is what seats Read when the brief says `RULES/R11-slices-not-vendors.md`.
