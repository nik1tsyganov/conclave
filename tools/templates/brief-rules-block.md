# MAGI CLI brief RULES block (required)

Paste into every MAGI CLI seat brief. `dispatch-run.js` stages the versioned rules pack and the seat's allow-listed skill pack before launch. Arbiter-only routing/bridge/orchestration skills are **not** seat skills.

```text
STANDING RULES (MAGI CLI): Read staged STANDING.md and RULES/INDEX.md, then R01–R21. Delivery: pointer-only.
SEAT: Read SEAT-CONTRACT.md and skills/skills-manifest.json before task work. Use only the staged skills listed by that contract.
SCOPE: <replace with the concrete assigned work/read scope; no placeholder>.
ROLE: <implement|review|verify>. Review/verify are read-only and must not modify product files.
Vendor: <codex|claude|agy> — casper_via=agy for Google. hostMode: cursor-cli. not CONCLAVE.
MUST: WRITE AUDIT when role=implement; no C:\src\vault writes; no Gemini PAYG; leaf seat (no fan-out); SLICES≠vendors (R11).
LIVE: R09 live-check. Claude dispatch requires R16 auth + headless probe status established by the arbiter before launch.
COMMS: receipt ACK + handoff envelope + output hashes. TELEMETRY: R17 exactly one arbiter row after dispatch.
PROOF: R18 vendor-native proof via cli-proof. Deterministic failures cannot be waived.
```

Production preflight is structural: the staged rules manifest must verify, SCOPE must be concrete, role permissions must match the seat contract, and vendor-specific requirements must hold. `dispatch-run.js` is the seat front door; direct vendor CLI calls are diagnostic only.

SoT: `ai-ops-vault/projects/magi-cli-rules/` plus the generated `SEAT-CONTRACT.md` / `skills-manifest.json` for that dispatch.
