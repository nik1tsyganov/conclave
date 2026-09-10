# MAGI Telemetry

This directory holds the self-evaluation telemetry log for MAGI Cursor CLI dispatches.

Because Cursor has no capture hook, the Grok arbiter lead-writes a row to `dispatches.jsonl` after every CLI/Task dispatch using `tools/telemetry-append.js`. Sealed CLI runs keep a fail-closed copy inside the run directory. When `MAGI_VAULT_ROOT` is set, `run-finalize.js` also links those rows into `ai-ops-vault/projects/magi/telemetry/dispatches.jsonl` and writes `projects/magi/analysis/latest.md`. That vault copy is the durable MAGI analysis log. Do not treat a disposable run directory as the only copy.

The formal row contract is `telemetry/schema.json`. Validate a row or JSONL log with:

```bash
node tools/validate-telemetry.js --row '<json>'
node tools/validate-telemetry.js --log telemetry/dispatches.jsonl
```

`--adapt` wraps a valid Magi row in the ingest envelope below. It does not rewrite Magi fields into Conclave names.

## Required Fields

As per `cursor-host.md`, each log row must include:
- `vendor`: `anthropic` | `openai` | `google`
- `role`: The seat's role (e.g. implement, verify, review)
- `hostMode`: The host context string
- `routedBy`: `arbiter`

## Adapter contract toward Conclave / unified AI-ops ingest

Magi rows and Conclave/Claude-host hook rows are **different schemas**. Magi is lead-written (`routedBy: arbiter`, optional `capturedBy: lead`). Conclave's hook-fed file is `C:\Users\YESSIR\.claude\docs\telemetry\dispatch-telemetry.jsonl` and is not dual-written here.

Do **not** invent a join key. `vendor`, `role`, `date`, `dispatchId`, `proofId`, token fields, and host mode do not identify a Conclave hook row. Correlating on those values forges a session that was never shared.

| Magi field | Unified ingest | Safe join to Conclave? |
|---|---|---|
| `vendor` | stay on the Magi payload as `magi.vendor` | No. Same vendor string is not a shared session. |
| `role` | stay as `magi.role` | No. Role vocabulary is Magi-native (`implement`/`verify`/`review`). |
| `hostMode` | Magi-only (`cursor` / `cursor-cli`) | No Conclave equivalent in this repo. |
| `routedBy` | Magi-only (`arbiter`) | No. Conclave capture is hook-fed, not arbiter-routed. |
| `capturedBy` | Magi-only (`lead` if present) | No. `lead` and hook capture are different writers. |
| `vendorSideTokens` / `totalTokens` | Magi measured tokens or `null` | No. Missing Magi tokens stay absent/`null`, never `0`, and are not Conclave hook tokens. |
| `date` | UTC calendar date if present | No. A shared calendar day is not a shared run. |
| extra properties (`task`, `dispatchId`, `proofId`, `note`, …) | preserved on the Magi payload | No. Extra keys are Magi-local unless a later owner map names them. |

Adapter envelope (`validate-telemetry.js --adapt`):

```json
{
  "schemaId": "magi-dispatch/v1",
  "sourceSystem": "magi",
  "correlationPolicy": "none",
  "joinKeys": [],
  "payload": { "vendor": "openai", "role": "implement", "hostMode": "cursor-cli", "routedBy": "arbiter" }
}
```

Unified ingest stores this envelope next to Conclave rows keyed by `schemaId` + `sourceSystem`. A later owner-supplied map may add named field copies; it must not add a join key that this repo does not already have.

## Handoff envelope (not a dispatch row)

Seat-to-seat durability uses `handoff-envelope.v1` via `tools/handoff-envelope.js`, appended to `handoffs.jsonl` (gitignored). `telemetry/schema.json` stays the dispatch-row contract only; do not validate handoff rows with `validate-telemetry.js`.

Cursor Task returns via chat reply only. There is no Task capture module (unlike Magi CLI `--capture`). Receipt ACKs and handoff rows exist only because `acknowledgeReceipt` / `recordHandoff` write a file. Do not invent a Task capture hook.

Receipt ACKs (`receipt.v1`, `tools/receipt-ack.js`) prove a seat opened the pointer brief (first-line echo + SHA-256) for hostMode `cursor` and `cursor-cli`. They are not dispatch rows and are not Conclave join keys. Pointer delivery remains `cli-pointer.js` / `task-delivery.js`.

`briefSha256` / `outputSha256s` are UTF-8 SHA-256 (`tools/utf8-hash.js`: decode the file as UTF-8, strip one leading U+FEFF, then hash that string as UTF-8). That is the Conclave-aligned encoding. `cli-pointer.js` still hashes the raw buffer for pointer identity (BOM bytes included).

## Self-Evaluation Questions

This telemetry exists to answer these self-eval questions:
- **Vendor implement share:** Are we relying too heavily on one vendor for implementation?
- **Idle seat:** Are seats being dispatched but returning without capturing work?
- **proofPresent rate:** How often does a verification step actually include a verifiable proof?
- **null-token rate:** Are we dropping token tracking on dispatches?

## Critical Notes

- **NOT the Claude-host log:** This log is strictly for MAGI Cursor self-eval and is NOT the Claude-host file `C:\Users\YESSIR\.claude\docs\telemetry\dispatch-telemetry.jsonl`. Do not dual-write to that file (it is hook-fed).
- **Operational Status:** Do not claim operational status (logged in, quota) from memory. `Live-check.mdc` applies.
