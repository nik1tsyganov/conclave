// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// Launch-failure retry classifier (adopted from Droppy Code Hydra, 2026-09-16;
// R22 amendment of the same date). A dispatch may be re-run under its own id
// only when the child never got going: no tool call was made and the failure
// text carries a recognised never-started signature. Everything else stays a
// terminal FAIL that needs a new dispatch id and a new sealed plan.

const MAX_ATTEMPTS = 3; // the first launch plus two retries
// Signature list confirmed by the owner's delegation on 2026-09-16 ("choose the best path"):
// deliberately narrow; a new signature needs a live failure that reproduced it.

const SIGNATURES = Object.freeze([
  { id: 'network-reconnect', re: /Reconnecting\.\.\. waiting for network/i },
  { id: 'auth-missing', re: /not logged in|not signed in|authentication required|unauthenticated|not logged into/i },
  { id: 'spawn-error', re: /\bENOENT\b|\bEACCES\b|spawn [^\n]* failed/i },
  { id: 'database-locked', re: /database is locked|SQLITE_BUSY/i },
  { id: 'no-answer', re: /did not answer|did not start a session/i },
]);

// A vendor safeguard refusal is a never-started failure too, and it used to sit in the list
// above. It does not belong there: the other signatures are transient — a network blip, a
// locked database — and the same command works on the next attempt. A safeguard classifier
// answers the same way to the same launch every time, so "re-run the same dispatch command"
// is advice that cannot work, and following it spends the bucket three times to learn nothing.
// Measured 2026-09-18: Opus 5 refused a verify seat, and the refusal reproduced on every
// launch carrying the same four flags (--safe-mode, --json-schema, --append-system-prompt and
// a --tools restriction) while Fable passed that identical launch.
const REFUSAL = Object.freeze({ id: 'safeguard-refusal', re: /safeguards flagged this message|"api_refusal_category"/i });

const TOOL_MARKERS = Object.freeze({
  anthropic: /"type":\s*"tool_use"/g,
  openai: /custom_tool_call|function_call|CommandExecution|exec_command/g,
  google: /tool confirmation|tool_confirmation|soft-denying|denied_actions":\s*\[\s*\{|"step_type":\s*"tool"|"tool_name"/gi,
});

function countToolCalls(vendor, text) {
  const re = TOOL_MARKERS[vendor];
  if (!re || !text) return 0;
  return (String(text).match(re) || []).length;
}

// Pure: returns { retryable, signature, reason, toolCalls }.
function classifyLaunchFailure({ code, message = '', vendor, stdout = '', stderr = '', capture = '', nativeLog = '' } = {}) {
  if (code !== 'LAUNCH_FAIL') return { retryable: false, reason: `code ${code || 'unknown'} is terminal`, signature: null, toolCalls: null };
  const text = [message, stderr, stdout, capture, nativeLog].map((t) => String(t || '')).join('\n');
  const toolCalls = countToolCalls(vendor, `${stdout}\n${stderr}\n${capture}\n${nativeLog}`);
  if (toolCalls > 0) return { retryable: false, reason: 'the child made tool calls; the seat ran', signature: null, toolCalls };
  if (REFUSAL.re.test(text)) {
    return {
      retryable: false,
      signature: REFUSAL.id,
      toolCalls,
      reason: 'the vendor refused this launch and will refuse it again: a safeguard classifier answers the same '
        + 'way to the same command. Seal a new plan routing this role to another model, or change the launch.',
    };
  }
  const hit = SIGNATURES.find((s) => s.re.test(text));
  if (!hit) return { retryable: false, reason: 'no never-started signature matched', signature: null, toolCalls };
  return { retryable: true, reason: hit.id, signature: hit.id, toolCalls };
}

function retryDelayMs(attempt, index = 0) {
  // Droppy's stagger: attempt*2 s plus a quarter-slot per parallel sibling.
  return attempt * 2000 + (index % 4) * 500;
}

module.exports = { MAX_ATTEMPTS, REFUSAL, SIGNATURES, classifyLaunchFailure, countToolCalls, retryDelayMs };
