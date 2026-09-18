#!/bin/zsh
# Does a save written before Three Brains existed still come back right? This needs the real
# ChatThread, so it pulls in more of Core than the other harness does.
set -u
W=${W:-$HOME/.droppy-code/worktrees/agent-brains-verify/DroppyCode}
OUT=${OUT:-./decode-test}
swiftc -continue-building-after-errors -o "$OUT" \
  "$W/Core/Support/JSONValue.swift" "$W/Core/Support/Text.swift" "$W/Core/Support/Coding.swift" "$W/Core/Support/CaptureRun.swift" \
  "$W/Core/Models/Provider.swift" "$W/Core/Models/Timeline.swift" "$W/Core/Models/FileChangeSummary.swift" \
  "$W/Core/Models/Hydra.swift" "$W/Core/Models/HydraDelegationStream.swift" \
  "$W/Core/Models/Library.swift" "$W/Core/Models/ThreeBrains.swift" "$W/Core/Models/ThreeBrainsBlock.swift" \
  "$W/Core/Models/ThreeBrainsTally.swift" "$W/Core/Models/ThreeBrainsPrompts.swift" "$W/Core/Models/ThreeBrainsSkills.swift" \
  ./stubs.swift ./main.swift || exit 2
"$OUT"
