# CONCLAVE over MCP

One stdio server, every host that speaks the protocol: VS Code, Cursor, Zed, Claude Desktop,
Claude Code, the JetBrains IDEs. That is the reason this exists instead of an extension per
editor.

```bash
node mcp/server.js          # stdio, one JSON-RPC message per line
```

Register it the way your host registers any stdio MCP server, with `node` and the absolute
path to `mcp/server.js`.

## Why convening is not one call

A panel takes minutes to tens of minutes. An MCP call is request and response, and hosts time
out long before that. So the run directory is what persists between calls:

1. `conclave_seal` — check a plan against the matrix and seal it. Nothing runs, no vendor is
   called, and a bad route is refused here rather than halfway through a panel.
2. `conclave_drive` — run one phase: implement, verify, review, evidence, finalize.
3. `conclave_attest` — a Claude seat stops at `AWAITING_ATTESTATION`; read its answer and attest
   it, because only the host saw the answer.
4. `conclave_run_report` — read what happened.

Droppy Code solved the same problem a different way: it makes each seat a chat and reports
back as a message when the panel is done. It could, because it owns its own window. A server
that is called through a pipe cannot, so it hands back a run id instead.

## The tools that cost nothing

`conclave_hosts`, `conclave_validate_row` and `conclave_tally` are pure and offline. The second is how a
host built somewhere else checks that its rows are readable here before it writes a run;
Droppy Code's rows were shaped against it. The third is the runtime's own count, not a second
copy of the rule.

## What this does not widen

Every gate still applies, because this calls the same tools rather than reimplementing them:
proof of invocation, the dispatch matrix, the concurrency cap and the attestation stop.

`conclave_drive` is the only call that spends subscription capacity, and it refuses to run without
`"spend": true`. An agent reading a tool list should not be able to start a nine-seat run by
trying things.
