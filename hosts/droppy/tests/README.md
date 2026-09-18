# Three Brains harness

The Droppy Code repository has no test target and the build is its check
(`DroppyCode/AGENTS.md`). This harness stands in for one: it compiles Droppy's
own sources and asserts their behaviour, against the worktree at
`~/.droppy-code/worktrees/agent-brains-verify`. Set `W` to point it elsewhere.

    ./run-all.sh

Five suites, 705 checks as of 2026-09-18, all passing. The live tier below is
separate and is not counted here.

| Suite | Checks | What it compiles | What it is for |
|---|---|---|---|
| `core` | 537 | Core models | Blocks, effort, skills, verdict lines, the prompts |
| `decode` | 54 | Core plus the real `ChatThread` | What a stored thread does across builds |
| `diffshape` | 7 | nothing; it runs git | The shape of the command that captures a change |
| `telemetry` | 60 | Core and Services | The two record files a panel writes |
| `applayer` | 47 | the whole app, minus its `@main` | A lead's reply, routed over MCP, to a seat starting |

A sixth number sits outside that table: `applayer --live` adds a real panel and
one real unit. It is not part of `run-all.sh` and is not counted above.

## Why the count fell

It was 3,860 on 2026-09-17. Most of that tested the routing table and the tally,
and both now live in this repository rather than in Swift: the app asks the MCP
server instead of carrying a second copy. The checks did not go away — they are
`tools/panel-rules.test.js` and `tools/panel-routing.test.js` here, where the
rules are. What is left in Swift is what only Swift can answer.

## The suites

`core/` covers block parsing whole and as it streams, and that the two agree on
every prefix; field synonyms; a second fenced block in the same reply; unit id
defaulting and uniqueness; effort, across every published vendor scale, both
roles, chosen and unchosen, including the two-rung scale that is the whole reason
the rule is not Hydra's verbatim; which skills a seat is given; reading a verdict
back; seat storage round-trips; what a checker is given to look at and how a long
diff is cut; and the prompts, including that the example block inside the lead's
policy parses, that the reply template does not itself read as a vote, and that a
vote written into a builder's diff is not a vote.

`decode/` checks that a thread saved before this change decodes with the feature
off and its Hydra settings intact, that an older project and a whole older
library decode, that a seat thread round-trips with its vote, that a receipt whose
status cannot be read comes back as failed rather than as a completed seat whose
vote would count, and that a verdict card survives a save while a build that
cannot read one drops the card and keeps the rest of the transcript.

`diffshape/` is a shell suite, because the thing it checks is a git command and
not Swift: that the capture sees a file the builder ADDED, that plain
`git diff <tree>` still cannot, that the app's own evidence folder and staged
skill links stay out of it, and that the copy's own index is left alone.

`telemetry/` builds the record from outcomes made by hand and checks every field
CONCLAVE reads by name, that a vendor reporting no tokens writes null rather than
zero, that the two outcomes this runtime has no word for are written as
themselves, that the run row is built from the unit rows so the two cannot
disagree, and that both files parse back.

`applayer/` drives the app itself. It compiles every source file except
`DroppyCodeApp.swift`, puts its own `@main` in that file's place, and runs as a
capture run so it keeps to its own defaults suite and storage folder. It rehearses
a turn on a real `ThreadRuntime`, feeds an assistant reply carrying a `brains`
block in as provider events, and lets the turn end, which is what calls the block
reader, the router, the refusal path and the round limit. It then calls
`AppModel.makeSession` to spawn seat chats for real, without starting a session,
and replays events into one.

Two of its checks are the whole point of this directory. One sets no checkout and
asserts the lead is told the rules service is missing rather than left waiting.
The other sets the checkout and asserts routing comes back: the client really
spawned `mcp/server.js`, shook hands and got its units back routed. That second
one prints `NOT RUN` rather than passing when the server cannot be reached, so a
moved checkout is visible instead of silent. It reads `CONCLAVE_CHECKOUT`, and
defaults to `~/src/conclave`.

Nothing in `run-all.sh` spends a vendor turn: the project folder is deliberately
not a git repository, so no copy can be made and the run stops at the last point
before a CLI would start.

`./applayer/run.sh --live` adds one real unit through `AppModel.runBrainsUnits` on
a real git checkout, with real vendors: three CLI turns of subscription capacity.
It is the only thing that sees a seat's chat fill, a card reach the lead's
timeline, a report come back as a turn and the record written by the app rather
than by a harness. `run-all.sh` never passes `--live`.

## What `applayer` needs built first

Xcode's `swiftc` expands the SwiftUI macros, so `applayer` builds from the
worktree as it is; with Command Line Tools alone it would need
`typecheck-prep.py` first. It also needs SwiftTerm and one Objective-C file built
once. Without them it exits 3 and says so, which `run-all.sh` treats as "cannot
run here" rather than as a failure.

    B=~/.local/scratch/droppy-brains-build
    W=~/.droppy-code/worktrees/agent-brains-verify

    # 1. Any xcodebuild run produces the SwiftTerm module. See XCODE.md for the
    #    three gates this hits on a machine that is not the maintainer's.
    cd "$W" && xcodebuild -project DroppyCode.xcodeproj -scheme DroppyCode \
      -configuration Debug -derivedDataPath "$B/DerivedData" \
      -skipPackagePluginValidation -skipMacroValidation \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
      DEVELOPMENT_TEAM= build

    # 2. Archive its objects, and compile the window subclass.
    mkdir -p "$B/appbuild"
    find "$B/DerivedData" -name '*.o' -path '*SwiftTerm*' -print0 \
      | xargs -0 libtool -static -o "$B/appbuild/libSwiftTerm.a"
    xcrun clang -c "$W/DroppyCode/App/Window/DCDisplayCycleGuardedWindow.m" \
      -o "$B/appbuild/dcwindow.o" -fobjc-arc -target arm64-apple-macos26.0 \
      -I "$W/DroppyCode/App/Window"

`SCRATCH` points at `$B` and can be overridden. `TYPECHECK.md` beside this file
covers a third check, a whole-app `swiftc -typecheck`, which needs its own setup
to mean anything.

## Stubs and licence

Each of `core/` and `decode/` has a `stubs.swift` of stand-ins for types the files
under test mention but do not use: `FileEdit`, because `Text.swift` hangs its
diff-stats type off it, and `PanelDockCorner`. They are field lists, written here
so the harness links; no Droppy implementation is copied into this repository.
Droppy Code is AGPL and Jordy Spruit's; this runtime is AGPL and Nikita
Tsyganov's. The harness compiles his sources from a checkout and vendors none of
them.

## Before trusting a clean run

Inject an error into one of the files under test and confirm the harness reports
it and exits non-zero. A multi-file `swiftc` stops after the first failed batch,
which is why `run.sh` passes `-continue-building-after-errors`.
