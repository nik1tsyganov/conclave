# CONCLAVE for VS Code

An extension that tells VS Code where the CONCLAVE MCP server is, and stops there.

It contributes no command, no view and no tool of its own. VS Code asks the server what it
can do over the protocol, so a tool added, renamed or re-described in this repository appears
in the editor with nothing rebuilt and nothing republished here. That is the reason this is
an MCP server and not a port: there is no second copy of the rules to keep current.

Measured on 2026-09-18, VS Code 1.138: `Starting server conclave` → `Connection state:
Running` → `Discovered 10 tools`.

## Where it looks for the server

First hit wins:

1. `conclave.serverPath`, when someone has said where their checkout is. Set and not there is
   an error rather than a fall back — someone who set it meant that copy.
2. `mcp/server.js` under a workspace folder, so working ON the runtime uses the copy being
   edited rather than a published one a version behind.
3. `npx -y conclave-mcp`. No install step and no path to keep current.

`conclave.rulesOnly` serves the six tools that answer from JSON and refuses the four that
drive a run. Leave it off in an editor you want to convene panels from.

## Without the extension

VS Code reads MCP servers from its own `mcp.json` with no extension at all, which is worth
knowing before installing one:

```bash
code --add-mcp '{"name":"conclave","command":"node","args":["<checkout>/mcp/server.js"]}'
```

The extension exists so that nobody has to hold that path, and so a published package can be
picked up by name.

## Building it

    npm install -g @vscode/vsce
    cd hosts/vscode && vsce package

`resolve.test.js` runs with the repository's own suite (`npm test`). Two of its checks are the
promise this directory makes: the extension names no tool and carries no rule, so the editor
can only have learned them from the server.
