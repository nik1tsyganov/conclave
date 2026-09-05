---
name: harness-engineering
description: Respect execution and artifact boundaries
---

# Respect execution and artifact boundaries

Use only the supplied tools, worktree and evidence pointers. Keep project changes separate from runner-owned proof, rules, skill manifests and receipts. Do not modify your harness, permission configuration, credentials or process environment to gain capabilities. Do not kill unrelated processes or spawn vendor CLIs/agents. Report timeouts, unavailable capabilities, and incomplete evidence. A sandbox flag is not a claim that every global resource is isolated.
