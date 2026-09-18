# CONCLAVE for VS Code

An extension that tells VS Code where the CONCLAVE MCP server is, and stops there.

It contributes no command, no view and no tool of its own. VS Code asks the server what it
can do over the protocol, so a tool added, renamed or re-described in this repository appears
in the editor with nothing rebuilt and nothing republished here. That is the reason this is
an MCP server and not a port: there is no second copy of the rules to keep current.

Measured on 2026-09-18, VS Code 1.138, with the extension installed from its own `.vsix` and
no hand-written `mcp.json` entry anywhere:

    Starting server CONCLAVE (this checkout)
    Connection state: Running
    Discovered 10 tools

The chat then answered `conclave_hosts` with six host modes including `vscode` — a host mode
added to the runtime AFTER that `.vsix` was built. The extension holds no list; the editor
learned it from the server, which is the whole promise.

## Where it looks for the server

First hit wins:

1. `conclave.serverPath`, when someone has said where their checkout is. Set and not there is
   an error rather than a fall back — someone who set it meant that copy.
2. `mcp/server.js` under a workspace folder, so working ON the runtime uses the copy being
   edited rather than a published one a version behind.
3. `npx -y conclave-mcp`. No install step and no path to keep current.

All three are measured. A workspace that is a checkout logs `Starting server CONCLAVE (this
checkout)` and `Discovered 10 tools`; a workspace that is not logs `Starting server CONCLAVE`
and `Discovered 6 tools`, because the published package ships the rules without the runtime
and so is rules-only whether or not the flag was passed.

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
