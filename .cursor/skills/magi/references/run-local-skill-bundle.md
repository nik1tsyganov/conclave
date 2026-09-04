# DESIGN: run-local Magi skill bundle (not implemented)

BackendEng ticket (HANDOFF, design-only unless a helper stays under ~50 LOC):
materialize a run-local copy of the MAGI skill surface under the brief
directory and pass `--add-dir <briefDir>` to every Magi CLI vendor so CLI
seats can Read `magi-mode` and `magi-dispatch` without Cursor plugins.

Do **not** implement that copy/add-dir-all-vendors helper in this tree now.

Magi#4 HOLD:

- Claude `--add-dir` stays cwd + briefDir under the pointer zones. Never
  broaden Claude to `C:\Users`.
- Gemini/`agy` binary stays `agy.exe`. `cli-gemini.js` already passes
  `--add-dir C:\Users\YESSIR\.claude\skills`. `cli-smoke.js` asserts that
  grant on the google dry-run plan (DevOps/harness must keep it).
