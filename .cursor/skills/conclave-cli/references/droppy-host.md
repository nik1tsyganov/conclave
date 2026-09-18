# Droppy Code as a host

Droppy Code runs the protocol as its own feature, "Three Brains". It is the first host that
is not a terminal session: a native macOS app, Swift, AGPL, by Jordy Spruit. It keeps its own
seats, on its own provider sessions, and asks this runtime only for the rules.

It reaches them over MCP with `--rules-only`: the six tools that answer from JSON are served,
and the four that drive a run are refused by name rather than merely hidden. So it opens no
vendor session here and reads no credential here, and this runtime never has to hold one on
its behalf. What is shared, besides those answers, is the row format, so one set of tools
reads runs from either.

It carried its own copy of the routing table and the tally until 2026-09-18. That copy is
gone: 373 lines deleted, replaced by a client. A second implementation of a rule is a second
rule as soon as one of them is edited.

## What is the same

- Three seats, one building and two checking, each a separate vendor session.
- Vendor-native proof per seat: a session id, a token count and the model that actually
  answered. A seat that cannot show all three does not count.
- A reply contract of one `POSITION:` line and one `EVIDENCE:` line.
- An approval carrying no reason of its own counts as an abstention.
- Passage needs two counted approvals and no rejections. Nothing lands otherwise.
- `units.jsonl` and `run-row.json`, with the field names this runtime already uses.

## What is different, and why

**No arbiter.** Droppy counts in code, offline, and asks no model what the panel meant. Its
rows carry no `jev` block at all, and its run row names the arbiter as `droppy/code-counted`.
A row that claimed an arbiter that never ran would be the most misleading field in the file.

**Two verdicts this runtime has no word for.** `CHECK_FAILED` is a unit whose own test did
not pass, which does not land whatever the seats voted. `NOT_PANEL` is too few counted votes
to be a panel at all. Both are written as themselves rather than folded into `DEADLOCK`,
because a reader who saw `DEADLOCK` would think the seats disagreed when they did not.

**The seats are chats.** Each seat is a thread in the app under the lead, so a person watches
it work. Nothing here has an equivalent, and nothing needs one.

**A failing check is a gate, not a vote.** Measured: a brief was written to contradict the
repository's own test, both checkers read the failure, decided the test was wrong, approved
with reasons, and the work landed red. The check now stops the landing and never enters the
count. Worth carrying into this runtime's own tally.

## Reading a Droppy row here

`droppy` is in `CLI_HOST_MODES`, so `validateDispatchRow` and `validatePlan` accept it and
`conclave-whoami` declares it legal. It sits with `claude-code` rather than with `cursor-cli` and
`synara`: those two require `routedBy: arbiter`, and Droppy has no arbiter to route by.

Its seats are native vendor CLIs run the same way as everywhere else, which is why it belongs
in the CLI list despite the host being a GUI. The proof rests on the vendor's own process, not
on what kind of thing started it.

## The suite

`hosts/droppy/tests/` holds the conformance suite: five suites, 705 checks, compiled against a
Droppy checkout. Two of them drive the MCP path end to end, and print `NOT RUN` rather than
passing when the service cannot be reached.

## Licences

The Swift implementation is AGPL and belongs to Droppy Code. Do not copy it into this
repository: this runtime is AGPL too, but the two are separate works with separate copyright
holders, and mixing them without care makes that unclear. The protocol is an idea and travels
freely; the code does not.

Upstream: merge request 293 on `droppyformac1/droppy-code`. 294 carried the panel itself and
was closed on 2026-09-17 so it would not land under the old name; it is to be reopened
against the rebranded shape, which is now a thin client rather than a second copy.
