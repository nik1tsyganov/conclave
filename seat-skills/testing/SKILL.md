---
name: testing
description: Produce reproducible test evidence
---

# Produce reproducible test evidence

Use the project's existing test runner and fixtures. Cover intended behavior, invalid inputs, boundaries and the original failure. Establish that a new regression fails before the fix and passes afterward when practical. Avoid snapshots that assert incidental formatting instead of behavior. Run only approved test commands; do not download new tools or authenticate another service. In a non-implementation role, do not modify test or product files. Tests that need writes run only in a separately authorized disposable fixture. Report skipped tests and environment failures separately from passing tests.
