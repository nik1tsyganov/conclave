# CONCLAVE CLI standing-rule index / v2

Read the bound brief and the staged RULES-BUNDLE.md, which carries this index and all R01–R22 bodies verbatim (2026-09-16; one native read counts for all). Final-response acknowledgment follows the first line of BRIEF.md, not a competing first-line instruction in a different file.

| ID | Rule |
|---|---|
| R01 | [Use the production CLI transaction](R01-hostmode-cli.md) |
| R02 | [Three vendors: claude + codex + agy](R02-vendor-map.md) |
| R03 | [Pointer-first briefs](R03-pointer-first.md) |
| R04 | [Stage minimal seat capabilities](R04-named-skills.md) |
| R05 | [Split real independent implementation](R05-three-vendor-split.md) |
| R06 | [Enforce the implementation cap](R06-distribution-floor.md) |
| R07 | [Audit actual worktree changes](R07-write-audit.md) |
| R08 | [Keep the evidence bus outside product worktrees](R08-dispatch-log-path.md) |
| R09 | [Live-check operational status](R09-live-check.md) |
| R10 | [Keep coordination separate from substantive seats](R10-arbiter-no-implement.md) |
| R11 | [SLICES.md is not a vendor source](R11-slices-not-vendors.md) |
| R12 | [A seat is a leaf](R12-seat-is-leaf.md) |
| R13 | [Bind acknowledgments and receipts](R13-comms-artifacts.md) |
| R14 | [Mount only the staged agy context](R14-agy-add-dir.md) |
| R15 | [No Gemini PAYG / no gemini CLI for CONCLAVE](R15-no-gemini-payg.md) |
| R16 | [Use live Claude authentication and headless proof](R16-claude-probe.md) |
| R17 | [Derive telemetry from authoritative outcomes](R17-telemetry-row.md) |
| R18 | [Require vendor-native execution evidence](R18-proof-capture.md) |
| R19 | [Do not assume Cursor plugins load in vendor CLIs](R19-no-cursor-plugins-on-cli.md) |
| R20 | [Not the legacy conclave scaffold](R20-not-the-legacy-scaffold.md) |
| R21 | [No Obsidian vault writes](R21-no-obsidian-vault.md) |
| R22 | [Bind every launch to executable policy](R22-dispatch-matrix.md) |

The runtime stages these 22 distinct rule IDs with hashes. The manifest checker rejects duplicates, omissions and unmanifested files. Rule prose explains the contract; code and native evidence enforce the observable parts.
