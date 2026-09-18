#!/bin/zsh
# Typechecks a scratch copy of the whole app, nothing excluded.
#
# Three things this needs that a naive run does not:
#  - SwiftTerm, the project's one package dependency, built from its pinned tag.
#  - The project's own SWIFT_APPROACHABLE_CONCURRENCY=YES, which Xcode turns into three
#    upcoming features. InferIsolatedConformances is the one that matters: without it every
#    @MainActor type conforming to Equatable or Animatable is an error.
#  - -continue-building-after-errors, or a multi-file typecheck stops after the first failed
#    batch and proves nothing about the rest.
cd "$1" || exit 2
MODULES=${MODULES:?set MODULES to the directory holding SwiftTerm.swiftmodule}
find DroppyCode -name '*.swift' > files.txt
swiftc -typecheck -continue-building-after-errors -swift-version 6 -target arm64-apple-macos26.0 \
  -enable-upcoming-feature InferIsolatedConformances \
  -enable-upcoming-feature GlobalActorIsolatedTypesUsability \
  -enable-upcoming-feature NonisolatedNonsendingByDefault \
  -I "$MODULES" \
  -import-objc-header DroppyCode/App/Window/DCDisplayCycleGuardedWindow.h @files.txt 2>&1 \
  | grep -E 'error:' | sed "s|$1/||" | sort -u > errors.txt
wc -l < errors.txt
