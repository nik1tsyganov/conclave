# DESIGN: run-local Conclave skill bundle (not implemented)

BackendEng ticket (HANDOFF, design-only unless a helper stays under ~50 LOC):
materialize a run-local copy of the CONCLAVE skill surface under the brief
directory and pass `--add-dir <briefDir>` to every Conclave CLI vendor so CLI
seats can Read `conclave-mode` and `conclave-dispatch` without Cursor plugins.

Authoritative pack under `briefDir` (Research handoff): `BRIEF.md`,
`VENDOR.md` (`casper_via=agy`), `RULES/INDEX.md`, and R01..R21 bodies.
The pointer may hash `BRIEF.md` + `RULES/INDEX.md`. Materializing that
pack into the brief dir is still this ticket — do **not** implement the
copy/add-dir-all-vendors helper in this tree now.

Conclave#4 HOLD:

- Claude `--add-dir` stays cwd + briefDir under the pointer zones. Never
  broaden Claude to the whole home directory.
- Gemini/`agy` binary is `~/.local/bin/agy` (`CONCLAVE_AGY_BIN` overrides). The runtime already passes
  `--add-dir $HOME\.claude\skills`. `cli-smoke.js` asserts that
  grant on the google dry-run plan (DevOps/harness must keep it).
