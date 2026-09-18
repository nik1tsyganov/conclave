#!/bin/zsh
# The App layer of Three Brains, driven for real.
#
# Everything else here tests the Core types or the Services runner. This compiles the WHOLE
# app, minus its own `@main`, and drives `AppModel` and `ThreadRuntime` through the same calls
# a live chat makes: a turn is rehearsed, an assistant reply carrying a `brains` block is fed
# in as provider events, and the turn ends. That is what calls the block reader, the router,
# the refusal path and the round limit, none of which any other suite reaches.
#
# It runs as a capture run (`--website-captures <dir>`), so it keeps to its own defaults suite
# and storage folder and never touches the real settings, library or keychain.
#
# Xcode's swiftc expands the SwiftUI macros, so this builds from the worktree as it is. With
# Command Line Tools alone it would need ../typecheck-prep.py first.
set -u
W=${W:-$HOME/.droppy-code/worktrees/agent-brains-verify/DroppyCode}
# A build scratch that outlives one session. Override SCRATCH to point at an existing one.
SCRATCH=${SCRATCH:-$HOME/.local/scratch/droppy-brains-build}
MODULES=${MODULES:-$SCRATCH/DerivedData/Build/Products/Debug}
DEPS=${DEPS:-$SCRATCH/appbuild}
OUT=${OUT:-./applayer-tests}

if [[ ! -d "$MODULES/SwiftTerm.swiftmodule" || ! -f "$DEPS/libSwiftTerm.a" || ! -f "$DEPS/dcwindow.o" ]]; then
  print -u2 "NOT RUN: needs SwiftTerm built (xcodebuild once) and $DEPS/{libSwiftTerm.a,dcwindow.o}."
  print -u2 "  MODULES=$MODULES"
  print -u2 "  DEPS=$DEPS"
  exit 3
fi

find "$W" -name '*.swift' ! -name 'DroppyCodeApp.swift' > sources.txt
xcrun swiftc -swift-version 6 -target arm64-apple-macos26.0 -wmo \
  -enable-upcoming-feature InferIsolatedConformances \
  -enable-upcoming-feature GlobalActorIsolatedTypesUsability \
  -enable-upcoming-feature NonisolatedNonsendingByDefault \
  -I "$MODULES" -L "$DEPS" -lSwiftTerm \
  -import-objc-header "$W/App/Window/DCDisplayCycleGuardedWindow.h" \
  -parse-as-library -o "$OUT" \
  @sources.txt ./main.swift "$DEPS/dcwindow.o" || exit 2

run=$(mktemp -d)
trap 'rm -rf "$run"' EXIT
# `--live` adds one real unit through the app's own path: three CLI turns of subscription
# capacity. Without it nothing here starts a vendor session.
"./$OUT" --website-captures "$run" "$@"
