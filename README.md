# MAGI Cursor Plugin

Original MAGI tri-seat panel (Claude + Codex + Gemini) as a local Cursor plugin.

- **MAGI is not CONCLAVE.** CONCLAVE is a separate plugin with its own host rules. The owner picks CONCLAVE when Cursor model usage remains; `/magi` or `/magi-cli` when running MAGI.
- The Cursor arbiter is an xAI/Grok slug. Use a model picker that shows `cursor-grok-4.6-high-fast` (or another Grok arbiter slug).
- The Grok arbiter routes, briefs, and tallies; it does **not** implement, review, verify, or vote.
- Claude Code still uses the same MAGI policy: run `magi-whoami --mode claude-code` there. This plugin is the Cursor surface.
- `/magi` = MAGI Cursor (hostMode `cursor`): Grok arbiter dispatches via Cursor Task to the wrapper agents.
- `/magi-cli` = MAGI Cursor CLI (hostMode `cursor-cli`): Grok arbiter dispatches via vendor CLIs (`codex.exe`, `agy.exe`) when Cursor Task usage is exhausted. Never Cursor Task to elector slugs in this mode. Claude is not reachable headlessly, so a Codex+Gemini split is a degraded duo.
- Codex-led MAGI is a duo (no headless Claude CLI); it uses the `magi-mode` skill directly. Claude-hosted MAGI is the full tri-seat.
- **MAGI plugin rules are `alwaysApply: true` in every Cursor workspace.** The three rules (`magi-arbiter`, `magi-activation`, `magi-orchestrator`) ship with the plugin and are copied to `~/.cursor/rules/magi-*.mdc` by the installer, matching CONCLAVE's always-on `commit-and-push` user rule. CONCLAVE chats ignore MAGI rules via the first-line discriminator. Do not glob MAGI rules to magi-only trees.

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
5. The arbiter dispatches three Task agents (or CLI seats in `/magi-cli`):
   - `codex-implementer`
   - `gemini-implementer`
   - `implementer` (unreachable in `/magi-cli`; record `degraded=true`)

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
