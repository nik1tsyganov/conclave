# Type-checking the whole app without Xcode

Xcode 26.6 was installed on 2026-09-17, so `xcodebuild` is the check now and
this page is the fallback: it is what to do on a machine that has only Command
Line Tools, and it is still the fastest way to get an answer about one file.
A whole-app `swiftc -typecheck` is only worth anything if it is set up the way
the real build is. Three things matter.

**SwiftTerm.** The project's one package dependency, pinned to 1.20.0 in
`Package.resolved`. Three files import it, and without it they cannot be
compiled at all. Build it once:

    git clone https://github.com/migueldeicaza/SwiftTerm.git
    cd SwiftTerm && git checkout v1.20.0 && swift build -c release --product SwiftTerm

and point `MODULES` at `.build/arm64-apple-macosx/release/Modules`.

**The project's own concurrency settings.** `project.pbxproj` sets
`SWIFT_APPROACHABLE_CONCURRENCY = YES`, which Xcode turns into three upcoming
features. `InferIsolatedConformances` is the one that matters here: without it
every `@MainActor` type conforming to `Equatable` or `Animatable` is an error.

**`-continue-building-after-errors`.** Without it a multi-file typecheck stops
after the first failed batch and tells you nothing about the rest.

**`@Entry`.** Command Line Tools ship no SwiftUI macro plugin, so the four
`@Entry` sites cannot expand. `typecheck-prep.py` rewrites them by hand in a
scratch copy. Use `nonisolated(unsafe) static let defaultValue`: a plain `static
let` of a non-Sendable type is itself an error, and that error is the harness's,
not the app's.

## Running it

    cp -R <worktree>/DroppyCode /tmp/tc/ && python3 typecheck-prep.py /tmp/tc
    MODULES=<swiftterm modules> ./typecheck.sh /tmp/tc

## What it said, 2026-09-17

Set up this way, `upstream/main` at `9bb0b63a4` reports **one** error, and it is
real: `PiSession.swift:359` adds four fallback pairs in one expression and the
expression type checker gives up on it. Branch `fix/pi-session-usage-typecheck`
names each part, which is what the diagnostic asks for, and the whole app then
reports **zero**.

Getting this wrong is expensive in a misleading way. An earlier run of the same
check, with the three SwiftTerm files excluded and no concurrency flags, reported
40 errors. Thirty-eight of them were the harness: symbols missing because of the
excluded files, `Animatable` and `Equatable` conformances that only fail without
`InferIsolatedConformances`, an availability error from targeting the wrong macOS
version, and one error from a hand-expanded `@Entry`. Two more were expressions
the solver gave up on only because so many symbols around them were missing. A
harness that reports 40 errors it invented is worse than no harness, because it
buries the one that is real.
