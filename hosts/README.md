# Hosts

A host is whatever convenes a panel. The hosting session runs the tools and holds
no vote, so any host is legal, and the runtime does not care what kind of thing
started it.

Most hosts need nothing in this directory: a terminal session drives `tools/`
directly, and an editor that speaks MCP drives `mcp/server.js`. A directory
appears here when a host needs something of its own — an adapter, a conformance
suite, a note about what it does differently.

| Directory | Host | What is here |
|---|---|---|
| `droppy/` | Droppy Code's "Three Brains" | The conformance suite for a host that runs its own seats and asks this runtime only for the rules |
| `vscode/` | VS Code | An optional extension supplying the MCP server definition. `code --add-mcp` does the same in one command; this is for a Marketplace listing and for picking a checkout over the package automatically |

The policy note for each host stays with the runtime policy, under
`.cursor/skills/conclave-cli/references/`, because that is what `conclave-whoami`
and `validateDispatchRow` are written against.
