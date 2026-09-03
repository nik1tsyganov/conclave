# MAGI Cursor Plugin

Original MAGI tri-seat panel (Claude + Codex + Gemini) as a local Cursor plugin.

- **MAGI is not CONCLAVE.** CONCLAVE is a separate plugin with its own host rules. The owner picks CONCLAVE when Cursor model usage remains; `/magi` or `/magi-cli` when running MAGI.
- The Cursor arbiter is an xAI/Grok slug. Use a model picker that shows `cursor-grok-4.6-high-fast` (or another Grok arbiter slug).
- The Grok arbiter routes, briefs, and tallies; it does **not** implement, review, verify, or vote.
- Claude Code still uses the same MAGI policy: run `magi-whoami --mode claude-code` there. This plugin is the Cursor surface.
- `/magi` = MAGI Cursor (hostMode `cursor`): Grok arbiter dispatches native
  Cursor Task seats through `implementer`, `reviewer`, and `verifier`, always
  with the frontier model override for that vendor:
  `claude-opus-5-thinking-high`, `gpt-5.6-sol-medium`, or `gemini-3.1-pro`.
  It does not use the `codex-*` or `gemini-*` CLI wrappers.
- `/magi-cli` = MAGI Cursor CLI (hostMode `cursor-cli`): Grok arbiter dispatches via vendor CLIs (`codex.exe`, `agy.exe`, `claude.exe`) when Cursor Task usage is exhausted. Never Cursor Task to elector slugs in this mode. Magi CLI dispatches Claude through `C:\Users\YESSIR\.local\bin\claude.exe -p --model fable --effort xhigh`. Live 2026-09-02: `claude auth status` reported `loggedIn: true` (`claude.ai`, Max), and the headless Haiku probe returned `ready`. Re-run both checks in the dispatching session.
- Codex-led MAGI can reach Claude at that command. If a later probe returns login/auth language, an empty capture, or off-topic text, record `degraded=true` with the probe text; only then is Codex+Gemini a duo. Claude-hosted MAGI is the full tri-seat.
- **MAGI plugin rules are `alwaysApply: true` in every Cursor workspace.** Four rules (`magi-arbiter`, `magi-activation`, `magi-orchestrator`, and `live-check`) ship with the plugin and are copied to `~/.cursor/rules/` by the installer, matching CONCLAVE's always-on `commit-and-push` user rule. The three named MAGI rules ignore CONCLAVE chats via the first-line discriminator; `live-check` applies everywhere. Do not glob MAGI rules to magi-only trees.

## Installation

```bash
node C:\src\magi\tools\install-plugin.js
```

Then in Cursor: **Developer: Reload Window**, open **Customize**, and enable both **MAGI Cursor** and **MAGI Cursor CLI**.

## Starting a MAGI session

1. Open a **new** Cursor chat that is **not** `/conclave` and not the session that created this plugin.
2. Make sure the chat is on a Grok arbiter slug (e.g., `cursor-grok-4.6-high-fast`).
3. Type `/magi` for Cursor Task mode, or `/magi-cli` for vendor-CLI mode.
4. Verify the host slug:
   ```bash
   # For /magi:
   node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor --slug cursor-grok-4.6-high-fast
   # For /magi-cli:
   node C:\Users\YESSIR\.claude\skills\magi-mode\references\magi-whoami.js --mode cursor-cli --slug cursor-grok-4.6-high-fast
   ```
   The command must report `LEGAL`. If it does not, stop.
5. In `/magi`, the arbiter dispatches Task `implementer` three times, once with
   each frontier model above, and permutes vendors across implement units.
   Review and verification use Task `reviewer` and `verifier` with the same
   required model overrides. In `/magi-cli`, the arbiter uses vendor CLIs.

## Launch

Run `node tools/cli-launch.js --help` for the vendor-CLI launch options.
The idle watch — when a silent vendor child is a hang and when it is not — lives in `tools/cli-launch.js` and `tools/cli-idle.js`.

## After implement dispatches

Each implementer pastes a WRITE AUDIT (`git diff --stat` + `git status --porcelain`).

The lead writes a JSONL row per implement unit `{vendor, role:"implement"}` to `magi-dispatch-log.jsonl` at the project root (gitignored; do not commit secrets).

Then run the activation check:

```bash
node C:\src\magi\tools\activation-check.js magi-dispatch-log.jsonl
```

`activation-check.js` rejects the checked-in fixtures, then calls `hog-check.js` to enforce the 60% vendor floor. Exit 0 means `FLOOR HOLDS`; exit 1 means `FAILED activation`.

## Agent discovery

- Claude Code reaches the MAGI seats via wrapper agents already installed in `C:\Users\YESSIR\.claude\agents\` (same stems as the plugin agents).
- Cursor Task uses the MAGI Cursor plugin `agents/` directory when the plugin is enabled (copied to `C:\Users\YESSIR\.cursor\plugins\local\magi\agents`). Keep both copies. Do not delete the plugin agents.
- `/magi-cli` uses vendor CLIs (`C:\Users\YESSIR\tools\bin\codex.exe`, `C:\Users\YESSIR\tools\bin\agy.exe`) and does not use the wrapper agents.

## magi-probe playbooks

- [RUN-IN-CURSOR.md](C:\src\magi-probe\RUN-IN-CURSOR.md)
- [RUN-IN-CLAUDE.md](C:\src\magi-probe\RUN-IN-CLAUDE.md)

## Repository

- https://github.com/nik1tsyganov/magi
