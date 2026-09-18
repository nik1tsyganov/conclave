# Security

## Reporting

Report a vulnerability privately through GitHub's advisory form on this repository
(**Security → Report a vulnerability**), not in a public issue.

Include what you did, what happened, and what you expected. A reproduction against a sealed run
directory is ideal; a description of the gate you think is wrong is enough to start.

## What this runtime treats as a security property

These are the claims worth reporting against. Each is enforced in code and covered by tests.

- **A vote counts only with vendor-native proof** — session, tokens, and the model that actually
  answered. Requested identity never stands in for observed identity.
- **A checking seat's tree is unchanged**, before and after. A missing write audit is a check
  that did not run, and a check that did not run allows nothing.
- **A sealed plan is bound before the first process starts**, hashed together with the matrix
  and seat profiles it was checked against.
- **A seat reads only what it was given** — the staged rules, the staged skills, its brief, its
  worktree, and any evidence directory the plan bound to it.
- **A seat cannot delegate.** Claude seats launch with `--disallowedTools Agent,Task`, Codex
  seats with `features.multi_agent=false`.
- **An unrecognised outcome word reads as a split, never a passage.**

A report that one of these can be defeated is a security report. A report that a model gave a
poor answer is not: the panel does not make a change good, it makes the reasons visible.

## What is out of scope

Arbitrary same-user shell access is not a boundary this runtime claims to hold. Native
permission flags and evidence hashes do not provide hostile-process isolation; use host
isolation where that stronger guarantee is required.
