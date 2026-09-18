#!/bin/zsh
# The record a panel leaves behind, in the shape the CONCLAVE protocol writes. This compiles the
# Services layer, because `BrainsTelemetry` reads a `BrainsRunner.Outcome`, and asserts the
# two files' contents from outcomes built by hand.
set -u
W=${W:-$HOME/.droppy-code/worktrees/agent-brains-verify/DroppyCode}
PI=${PI:-$W/Services/Providers/PiSession.swift}
OUT=${OUT:-./telemetry-tests}
swiftc -continue-building-after-errors -swift-version 6 -target arm64-apple-macos26.0 \
  -enable-upcoming-feature InferIsolatedConformances \
  -enable-upcoming-feature GlobalActorIsolatedTypesUsability \
  -enable-upcoming-feature NonisolatedNonsendingByDefault \
  -o "$OUT" \
  $W/Core/Support/*.swift $W/Core/Models/*.swift \
  $(ls $W/Services/Providers/*.swift | grep -v PiSession) "$PI" \
  $W/Services/Git/*.swift $W/Services/Store/*.swift $W/Services/MCP/*.swift $W/Services/ThreeBrains/*.swift \
  ./main.swift || exit 2
"$OUT"
