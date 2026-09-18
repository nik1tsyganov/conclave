# R19 — Do not assume Cursor plugins load in vendor CLIs

Status: executable contract target; native runtime behavior still requires target-machine validation.

## MUST

The installed runtime ships a lean seat skill source. Only the profile-selected files are staged and pointed to explicitly. Native home stores remain available for non-MAGI workflows and may be visible to vendor runtimes; their visibility is not authorization. Do not load Cursor plugin packs, coordinator bridges or the full global skill set into a leaf seat.

## Runtime source

The matching MAGI release owns the implementation and regression tests. Do not waive a failed check with a prose assertion.
