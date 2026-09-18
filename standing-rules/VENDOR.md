# Vendor transports

OpenAI → Codex CLI. Anthropic → Claude Code. Google → agy (`casper_via=agy`). The arbiter is the Jev decision engine (TypeSafe System One); the hosting session is a non-voting coordinator, never a CLI electorate seat (xAI/Grok retired 2026-09-16).

Exact model/effort choices come from the pinned dispatch matrix and native probe evidence. This card must not freeze seats to one model or infer local authentication from historical state.

Anthropic non-implementation seats use the schema 5 `read-only-tools` profile: `--safe-mode --permission-mode dontAsk --tools Read,Glob,Grep --allowedTools Read,Glob,Grep`. They inspect authorized files and existing test evidence; they cannot run shell commands. Claude plan mode requires a separate approval turn and is not the unattended leaf-verification path. Implementation uses `--safe-mode --permission-mode bypassPermissions` with its declared write scope and audit.

Claude safe mode excludes global customization and hooks while preserving subscription authentication and role permissions. Do not use `--bare`; it disables OAuth. Safe mode does not isolate vendor home directories.

Google probes and dispatches pin `--log-file` to `native-cli.log` in their own unique evidence directory. Default home-log names use second-resolution timestamps and can collide during parallel calls.
