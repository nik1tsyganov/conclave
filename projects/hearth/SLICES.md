> MAGI tracking for `C:\src\discord-clone` (GitHub `nik1tsyganov/discord-clone`), product name Hearth.

# Slices

This file is the GRAPH: slice numbers, the work in each slice, dependencies, the
merge-point gate, and the telemetry obligation. It assigns no vendors.

**Vendors are not written here.** They come from the MAGI class table plus the live
distribution floor evaluated at dispatch. The one valid owner override is explicit and
rare, and it is recorded as `vendorOverride` on that run's `graph.json` node — never as a
column in this file. Canonical policy: `mix-mode` → `distributionFloor.projectSlicePolicy`.

No seat verifies or reviews what that same seat wrote; the lead assigns the verifier at
dispatch from the same table.

| # | slice | depends on |
|---|---|---|
| 1 | schema + migrations (`node:sqlite`), users/servers/channels/messages | — |
| 2 | auth: scrypt registration, login, HttpOnly session cookies, CSRF | 1 |
| 3 | HTTP API: servers, channels, message history, pagination | 1 |
| 4 | realtime: `ws` gateway, presence, typing, fan-out to channel members | 1, 2 |
| 5 | frontend: server/channel list, message pane, composer, live updates | 3, 4 |
| 6 | **merge-point gate**: the assembled app, run end to end | all |

Slice 6 is not optional and is not covered by slices 1–5 being green. Five green
nodes still merge into a broken product; the merged artifact gets its own check.

## Why the floor matters here (historical, 2026-08-29)

Telemetry taken 2026-08-29, before this project started, shows the distribution-floor
circuit breaker **TRIPPED**: across 80 recorded dispatches, `implement` was 90.9% Claude
and **Gemini had ZERO implement-role dispatches** — the "appears only in verify/review"
failure. That is floor EVIDENCE, and it is why a dispatching lead must hand Gemini and
Codex real implement units on this project rather than review scraps. It is not a frozen
vendor grid: the floor is evaluated live at each dispatch, so read this as the reason the
check exists, not as an assignment.

## Telemetry obligation

Every dispatch here is stamped at close:

```bash
node C:/Users/YESSIR/.claude/docs/telemetry/capture.js --stamp --dispatch-id <id> --total-tokens <n> --duration-ms <n> --outcome <state> --findings-accepted <n>
```

Background dispatches do NOT self-record their cost — the PostToolUse hook fires at
launch and writes `async_launched` with null tokens. Foreground dispatches are captured
whole. That asymmetry is the known gap; the stamp closes it by hand, and an unstamped
background row is reported UNMEASURED rather than counted as free.
