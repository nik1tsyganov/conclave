# MAGI CLI brief RULES block (required)

Paste into every MAGI CLI seat brief. `dispatch-run.js --plan <sealed-plan.json> --run-dir <run-dir> --dispatch-id <id>` consumes the sealed plan and stages the versioned rules pack and the seat's allow-listed skill pack before launch. Routing, bridge, and orchestration skills belong to the arbiter.

```text
STANDING RULES (MAGI CLI): Read staged STANDING.md (trusted v2) and RULES/INDEX.md, then R01–R22. Delivery: pointer-only.
SEAT: Read the generated SEAT-CONTRACT.md at the pointer's exact path and its listed skills/skills-manifest.json before task work. Use only the staged skills listed by that contract.
ACK: The final response begins with the first line of the bound BRIEF.md. The STANDING fingerprint is a separate pack-integrity check.
SCOPE: <replace with the concrete assigned work/read scope; no placeholder>.
ROLE: <implement|review|verify|plan|research>. Every non-implement role is read-only and must not modify product files.
Vendor: <codex|claude|agy> — casper_via=agy for Google. hostMode: cursor-cli. not CONCLAVE.
MUST: WRITE AUDIT when role=implement; no C:\src\vault writes; no Gemini PAYG; leaf seat (no fan-out); SLICES≠vendors (R11).
LIVE: R09 live-check. Claude dispatch requires R16 auth + headless probe status established by the arbiter before launch.
COMMS: The runtime writes the receipt ACK, handoff envelope, and output hashes. TELEMETRY: R17 exactly one runtime-owned row per logical dispatch. Seats must not edit these artifacts.
PROOF: R18 vendor-native proof via cli-proof. Deterministic failures cannot be waived.
PLAN: R22 whole-plan binding and fresh native model/effort probes. Route or escalation changes require a newly validated sealed plan.
```

Production preflight is structural: `cli-brief-rules-check.js` verifies the staged rule and skill files against their manifests, SCOPE must be concrete, role permissions must match the generated seat profile, and vendor-specific requirements must hold. Marker text cannot prove that files exist. `dispatch-run.js` is the seat front door. Standalone `cli-launch.js` / `cli-smoke.js` dry runs are transport diagnostics and cannot activate production work.

SoT: the external `MAGI_RULES_ROOT` standing pack (v2 / R01–R22) plus the generated `SEAT-CONTRACT.md` / `skills-manifest.json` for that dispatch.
