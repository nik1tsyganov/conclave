#!/bin/zsh
# Builds and links Droppy Code without Xcode, to see the interface on screen.
# Command Line Tools have the SwiftUI and AppKit SDKs and can link an app; what they do not
# have is the asset compiler, so this bundle carries no images. Everything else is the real app.
set -u
W=${W:-$HOME/.droppy-code/worktrees/agent-three-brains/DroppyCode}
PI=${PI:-$HOME/.droppy-code/worktrees/agent-pi-usage/DroppyCode/Services/Providers/PiSession.swift}
MODULES=${MODULES:?}
find "$W" -name '*.swift' ! -name 'PiSession.swift' > sources.txt
echo "$PI" >> sources.txt
swiftc -swift-version 6 -target arm64-apple-macos26.0 -O -wmo \
  -enable-upcoming-feature InferIsolatedConformances \
  -enable-upcoming-feature GlobalActorIsolatedTypesUsability \
  -enable-upcoming-feature NonisolatedNonsendingByDefault \
  -I "$MODULES" -L . -lSwiftTerm \
  -import-objc-header "$W/App/Window/DCDisplayCycleGuardedWindow.h" \
  -parse-as-library -o DroppyCode \
  @sources.txt ./dcwindow.o
