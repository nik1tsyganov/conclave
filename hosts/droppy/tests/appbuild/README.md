# Building and seeing the app without Xcode

**Xcode 26.6 was installed on 2026-09-17, so this is now the fallback rather than
the route.** Build with `xcodebuild` (see `../XCODE.md` for the three gates it
hits on this machine). What follows is how far Command Line Tools alone get,
which turned out to be most of the way, and is still the fastest way to look at
one page without a full build.

## What works

The CLT SDK ships SwiftUI and AppKit, so the whole app compiles and links.

    ./build-app.sh          # needs MODULES=<SwiftTerm modules dir>, W=<prepared source tree>

It produces a 26 MB binary. Wrap it in a bundle with a hand-written
`Info.plist`, ad-hoc sign it, and it launches and draws its window.

Prepare the source tree first with `../typecheck-prep.py`: Command Line Tools
ship no SwiftUI macro plugin, so the four `@Entry` sites have to be expanded by
hand. SwiftTerm comes from its pinned tag; its object files archive into a
static library with `libtool`.

## What does not

- **Asset catalogs.** `actool` is an Xcode tool. `/usr/bin/actool` is only a
  stub that refuses without Xcode, so the bundle carries no images and every
  provider icon is missing.
- **Screenshots.** Capturing a window needs Screen Recording permission, and so
  does the app's own capture harness, which uses ScreenCaptureKit. Not worth
  asking a person to grant in order to look at a page.

## Seeing a page anyway

`render-main.swift` builds a second executable from the same sources, minus the
app's own entry point, and draws a view straight to a PNG with `ImageRenderer`.
No permissions, no window, no screen capture. It runs as a capture run
(`--website-captures <dir>`) so it reads its own defaults suite and storage and
never touches the real settings, library or keychain.

Two things do not survive an image pass, and both are the harness rather than
the app: a `ScrollView` renders empty, so pages are drawn at their natural
height, and AppKit-backed controls (switches, pickers) come out as yellow
placeholders. Text, layout, spacing and colour are real.

Looking at the result is what found the seat summary reading "high building"
rather than "builds at high", and that the row said nothing about how many
skills a seat had been given.

`windows.swift` lists a process's own window ids, so that a screenshot could be
of that window alone rather than of whatever else is on the user's screen. It is
kept for whoever has Screen Recording granted.
