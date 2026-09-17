---
name: magi
description: Start or continue a MAGI Cursor run (hostMode `cursor`). Use when the user says magi or /magi. Not CONCLAVE, not `/magi-cli`.
---

# /magi

- If this chat is CONCLAVE (`/conclave`, `camerlengo-8`), stop: tell owner to open a new chat and type `/magi` or `/magi-cli`.
- Read `.cursor/skills/magi/SKILL.md`.
- Run: `node $HOME\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor --slug <picker slug>`
- Stop unless LEGAL exit 0. Elector slugs (claude/gpt/gemini) are FORBIDDEN as MAGI Cursor arbiter.
- Follow `cursor-host.md` dispatch. Arbiter never implements, reviews, verifies, or votes.
- Before each elector Task, run `node $HOME/src/magi\tools\host-resolver.js`; run it
  again after usage/quota failures with `node $HOME/src/magi\tools\host-resolver.js --from cursor --error-text "<exact error>"`. If it trips, route remaining seats through
  `cursor-cli` without persisting a global mode.
- Dispatch Task `implementer` with required model overrides
  `claude-opus-5-thinking-high`, `gpt-5.6-sol-medium`, and `gemini-3.1-pro`.
  Permute implementation across vendors; Casper must not be idle.
- Use Task `reviewer` and `verifier` with the same model table. Review goes to
  vendors other than the author; add a third reviewer only when contested.
- Never Task `codex-*` or `gemini-*` CLI wrapper agents in hostMode `cursor`.
- After implement dispatches, write one JSONL row per implement unit `{vendor, role:"implement"}` to `magi-dispatch-log.jsonl` (gitignored; do not commit secrets).
- Log path: product-repo runs write `$HOME/src/magi\projects\<slug>\magi-dispatch-log.jsonl`, never a log inside the product repo; MAGI-kit work uses `$HOME/src/magi\magi-dispatch-log.jsonl`. See `$HOME/src/magi\projects\README.md`.
- Run the activation check: `node $HOME/src/magi\tools\activation-check.js <log path>`.
- Tally POSITION with `node $HOME/src/magi\tools\position-tally.js`. Do not hand-count. Passage is `>=2 APPROVE` among eligible electors; `ABSTAIN` never toward passage; counted eligible ballots below 2 is `NOT_PANEL` (`degraded=true`, `quorumFloor`); else `DEADLOCK`.
