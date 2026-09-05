# Magi CLI brief RULES block (required)

Paste into every Magi CLI seat brief. `dispatch-run.js` stages the vault rules pack beside the brief and verifies its fingerprint/hashes before any vendor process starts.

```text
STANDING RULES (Magi CLI): Read STANDING.md and RULES/INDEX.md, then R01–R21. Delivery: pointer-only.
Skills: magi-mode, magi-dispatch, mix-mode, engineering-orchestrator, testing, <implement when role=implement>, <codex-bridge|claude-bridge|gemini-bridge for this vendor>.
SCOPE: <replace with concrete engineering-orchestrator Pre-dispatch SCOPE; no placeholder>.
Vendor: <codex|claude|agy> — casper_via=agy for google. hostMode: cursor-cli. not CONCLAVE.
MUST: WRITE AUDIT; no C:\src\vault writes; no Gemini PAYG; leaf seat (no fan-out); SLICES≠vendors (R11).
LIVE: R09 live-check; Claude requires R16 auth + headless probe before dispatch.
COMMS: receipt ACK + handoff envelope + output hashes. TELEMETRY: R17 exactly one arbiter row after dispatch.
PROOF: R18 vendor-native proof via cli-proof. Floor: ≤60% per vendor; activation-check on dispatch-log.
```

Production preflight is structural, not substring-only: the staged `rules-manifest.json` must verify, the SCOPE must be concrete, the correct vendor bridge must be named, and the vendor-specific requirements must hold. Use `node tools/dispatch-run.js ...`; direct `cli-launch.js` is a diagnostic/legacy surface.

SoT: ai-ops-vault `projects/magi-cli-rules/` (STANDING + RULES/R01–R21).
