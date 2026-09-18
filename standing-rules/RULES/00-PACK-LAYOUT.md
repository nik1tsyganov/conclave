# Rule pack layout

The canonical source contains STANDING.md, VENDOR.md, RULES/INDEX.md and exactly one R01–R22 body. Optional native pins and this layout document travel with the pack. Each dispatch receives its own staged copy beside BRIEF.md and a rules-manifest.json with exact relative paths and SHA-256 digests.

CONCLAVE stages `STANDING.md`, `VENDOR.md`, and `RULES/` into the brief directory, from this folder by default or from `CONCLAVE_RULES_ROOT` when that is set.

Do not add a bench harness or a run-local skill bundle here. Do not stage into the source directory, follow symlinks, reuse a previous attempt directory, or expose the original vault as a writable adapter mount. Source/destination overlap is rejected.
