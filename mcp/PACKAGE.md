# conclave-mcp

The rules of a tri-vendor review panel, over the Model Context Protocol.

One seat builds a unit; two others check it in sessions of their own; the votes are counted in
code. This package is the counting, not the running: it takes JSON, applies a rule and answers.
It calls no model, reads no credential, writes no file and spawns nothing.

Your host already has your logins and runs the sessions. What it usually lacks is a second
implementation of the rules — so it asks for one instead of carrying a copy that drifts.

```bash
npx conclave-mcp
```

## In an editor

VS Code:

```bash
code --add-mcp '{"name":"conclave","command":"npx","args":["-y","conclave-mcp"]}'
```

Claude Code:

```bash
claude mcp add conclave -- npx -y conclave-mcp
```

Cursor, Zed, Claude Desktop and the JetBrains IDEs take the same stdio command in their own
MCP configuration.

## What it answers

| Tool | Question |
|---|---|
| `conclave_read_block` | What units did the lead ask for? |
| `conclave_route` | Who should build each one, and who should check it? |
| `conclave_read_reply` | What did this seat say, and is its evidence a reason? |
| `conclave_tally` | What do the replies add up to? |
| `conclave_validate_row` | Would this telemetry row be accepted? |
| `conclave_hosts` | Which hosts may declare a run? |

Every one is deterministic and offline. Ask the server for the rest: the schemas and their
descriptions come over `tools/list`, so a host that reads them needs nothing written here.

## The rules worth knowing before you call it

- **Two reasoned approvals carry a unit.** An approval with no reason of its own counts as an
  abstention, because agreement is not evidence.
- **A vote counts only from a seat that proved itself**: its vendor session, its token count,
  and the model that actually answered. A seat that cannot show all three does not count.
- **A checker's write audit must show an unchanged tree.** A missing audit is a check that did
  not run, and a check that did not run allows nothing.
- **A unit whose own check failed does not land**, whatever the seats voted. The check is a
  gate; it never joins the count.
- **A security-sensitive unit needs three.**

## Running a panel

Driving real seats is not in this package. It needs vendor CLIs, a sealed plan and evidence
capture, and it belongs to a host that has them. The four tools that do it are refused here
by name.

## Licence

CONCLAVE by Nikita Tsyganov. Copyright (c) 2026 Nikita Tsyganov.

GNU Affero General Public License v3.0 only, with additional terms under section 7. See
`LICENSE` and `ADDITIONAL-TERMS.md`. Running a modified version over a network obliges you to
offer its source to those who use it.
