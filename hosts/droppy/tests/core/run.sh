#!/bin/zsh
# Compiles the Three Brains Core types with the Core support they use, plus the harness,
# and runs it. Trap from the earlier port: a multi-file swiftc stops after the first failed
# batch, so -continue-building-after-errors is mandatory and an injected error must be seen
# before a clean run means anything.
set -u
W=${W:-$HOME/.droppy-code/worktrees/agent-brains-verify/DroppyCode}
OUT=${OUT:-./brains-tests}
swiftc -continue-building-after-errors -o "$OUT" \
  "$W/Core/Support/JSONValue.swift" \
  "$W/Core/Support/Text.swift" \
  "$W/Core/Support/Coding.swift" \
  "$W/Core/Models/Provider.swift" \
  ./stubs.swift \
  "$W/Core/Models/ThreeBrains.swift" \
  "$W/Core/Models/ThreeBrainsBlock.swift" \
  "$W/Core/Models/ThreeBrainsTally.swift" \
  "$W/Core/Models/ThreeBrainsSkills.swift" \
  "$W/Core/Models/ThreeBrainsPrompts.swift" \
  ./main.swift || exit 2
"$OUT"
