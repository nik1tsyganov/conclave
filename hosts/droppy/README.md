# Droppy Code

Droppy Code runs the protocol as its own feature, "Three Brains": a native macOS
app, Swift, AGPL, by Jordy Spruit. It is the first host that is not a terminal
session, and the first that keeps its own seats.

It holds the parts only an app can hold — the window, the chats, the provider
sessions, the checkout copy, the patch — and asks this runtime for the parts that
are rules: which seat builds, which check, what a reply said, and what the votes
add up to. It reaches them over MCP, with `--rules-only`, so the six tools that
answer from JSON are served and the four that drive a run are refused by name.
Nothing it calls opens a vendor session or reads a credential; the app already
holds those and starts its own seats.

Two things stay in Swift on purpose. The block reader must answer while a reply is
still streaming, so the first unit starts while the lead is still writing the
second; a question per token does not belong on a pipe. And readiness — which
vendors are set up on this machine — is drawn synchronously in Settings.

- `tests/` — the conformance suite. Five suites, 708 checks, run against a Droppy
  checkout. Two of them assert the MCP path end to end and print `NOT RUN` rather
  than passing when the service cannot be reached.
- [droppy-host.md](../../.cursor/skills/conclave-cli/references/droppy-host.md) —
  what is the same, what is different, and why its rows carry no `jev` block.

Nothing here is Droppy's source. The suite compiles his files from a checkout and
vendors none of them; the two works are separately owned and separately
copyrighted, and both are AGPL.
