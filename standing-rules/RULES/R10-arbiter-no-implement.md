# R10 — Keep coordination separate from substantive seats

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

The arbiter is the Jev decision engine (TypeSafe System One, `dispatch-matrix.json` `arbiter.decisionEngine`, since 2026-09-16; xAI/Grok retired). It proposes classification, seat, convene, net-benefit and tally distributions; deterministic runtime code gates them. The hosting session (hostMode `cursor-cli`, `synara` or `claude-code`, declared by `conclave-whoami`) prepares plans and briefs, runs the tools, invokes authorized entries and reports evidence. Neither the engine nor the host is an implementation, repair, substantive planning/research, review, verification or voting seat. Native worker vendors are OpenAI, Anthropic and Google. A plan records the declared host identity and the Jev classification record; local CLI code cannot independently attest the host's own model picker.

## Runtime source

The matching CONCLAVE release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
