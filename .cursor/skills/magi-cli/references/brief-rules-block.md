# MAGI CLI brief rules block

Include this block after the task-specific acknowledgment line and instructions. Replace all placeholders before sealing the plan.

```text
STANDING RULES: Read RULES-BUNDLE.md first and in full (it carries STANDING.md v2, VENDOR.md, RULES/INDEX.md and R01–R22 verbatim; one read counts for all; do not open the individual rule files before it). Delivery: pointer-only.
SEAT: Read SEAT-CONTRACT.md and skills/skills-manifest.json. Use only the staged skills.
SCOPE: <concrete work or read scope; must agree with the sealed plan>.
ROLE: <implement|review|verify|plan|research>. Non-implementation roles are read-only and do not modify product files.
Vendor: <codex|claude|agy>; casper_via=agy for Google. hostMode: cursor-cli (or synara, claude-code). not CONCLAVE (R20).
MUST: WRITE AUDIT for implement; no private-vault writes (R21); no Gemini PAYG; leaf seat (no fan-out); SLICES are not vendor assignments (R11).
LIVE: Native evidence only (R09). Claude auth + headless probe status is checked by the runtime (R16).
COMMS: receipt ACK is the bound brief first-line acknowledgment. The runtime binds the handoff envelope and artifact hashes in its committed transaction.
TELEMETRY: Derived from verified terminal receipts (R17), not handwritten success rows.
PROOF: R18 vendor-native proof. Model substitution or input tampering fails. No model may waive deterministic failures.
```

The runtime owns staging, hashing, model proof, write auditing and receipt creation. This prose does not grant tools or establish proof by itself. For panel review, end the final response with exactly one POSITION: APPROVE, POSITION: REJECT or POSITION: ABSTAIN line.
