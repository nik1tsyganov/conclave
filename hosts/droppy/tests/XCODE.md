# Building Droppy Code with Xcode on this Mac

Xcode 26.6, installed 2026-09-17, already the active developer directory. The
repository's own `AGENTS.md` names the build as the check:

    xcodebuild -project DroppyCode.xcodeproj -scheme DroppyCode -configuration Debug build

On this machine that command stops three times before it compiles anything, and
none of the three is the project's code. In order:

**1. Package plugin trust.** SwiftTerm ships `SwiftTermBuildInfoPlugin`, and
Xcode will not run a package plugin it has not been told to trust. In the app
that is a dialog; from a script it is a flag.

    -skipPackagePluginValidation -skipMacroValidation

**2. Signing.** The project asks for a "Mac Development" certificate for team
`NARHG44L48`, which is the maintainer's, not this Mac's. A local verification
build does not need one:

    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM=

Do not reach for a certificate to get past this. An unsigned build proves the
code compiles, links and carries its assets, which is the whole point of
building it here. A signed build needs the owner's Apple ID in Xcode and is
theirs to make.

**3. The Metal toolchain.** Xcode 26 no longer bundles it, and SwiftTerm has a
shader. 688 MB, no Apple ID needed:

    xcodebuild -downloadComponent MetalToolchain

## The whole command

    xcodebuild -project DroppyCode.xcodeproj -scheme DroppyCode -configuration Debug \
      -derivedDataPath <scratch>/DerivedData \
      -skipPackagePluginValidation -skipMacroValidation \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
      build

Keep the derived data in scratch rather than the default location: the worktree
is one of several and the maintainer's own checkout must not be disturbed.

Two `xcodebuild` invocations at once contend for the project lock and the second
one hangs. Run them one at a time.

## What the build found

`PiSession.swift:359` is the only compile error in the whole app, and without the
fix on `fix/pi-session-usage-typecheck` **the app does not build on Xcode 26.6 at
all**. The `swiftc -typecheck` harness had named exactly that line and nothing
else, so the two agree, and the fix is a prerequisite rather than a tidy-up.

Verified by building `verify/brains-with-fix`, which is `feature/three-brains`
with that one commit cherry-picked: **BUILD SUCCEEDED**, no errors, no warnings,
a 60 MB bundle with a 12 MB compiled asset catalog.

## Seeing a page with its real icons

`appbuild/render-main.swift` draws a view straight to a PNG. Put its executable in
a bundle and copy `Assets.car` out of the built app into that bundle's
`Contents/Resources`, and `Bundle.main` resolves every image, so the page renders
with the real provider marks. Still no screen capture and no permissions.

Two things an image pass cannot draw, both the harness rather than the app: a
`ScrollView` comes out empty, so pages are drawn at their natural height, and
AppKit-backed controls (switches, pickers) come out as yellow placeholders.
