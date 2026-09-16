'use strict';
// Launch-failure retry classifier (adopted from Droppy Code Hydra, 2026-09-16;
// R22 amendment of the same date). A dispatch may be re-run under its own id
// only when the child never got going: no tool call was made and the failure
// text carries a recognised never-started signature. Everything else stays a
// terminal FAIL that needs a new dispatch id and a new sealed plan.

const MAX_ATTEMPTS = 3; // the first launch plus two retries

const SIGNATURES = Object.freeze([
  { id: 'safeguard-refusal', re: /safeguards flagged this message/i },
  { id: 'network-reconnect', re: /Reconnecting\.\.\. waiting for network/i },
  { id: 'auth-missing', re: /not logged in|not signed in|authentication required|unauthenticated|not logged into/i },
  { id: 'spawn-error', re: /\bENOENT\b|\bEACCES\b|spawn [^\n]* failed/i },
  { id: 'database-locked', re: /database is locked|SQLITE_BUSY/i },
  { id: 'no-answer', re: /did not answer|did not start a session/i },
]);

const TOOL_MARKERS = Object.freeze({
  anthropic: /"type":\s*"tool_use"/g,
  openai: /custom_tool_call|function_call|CommandExecution|exec_command/g,
  google: /tool_confirmation|Tool confirmation|"step_type":\s*"tool"|RunCommand|ViewFile/g,
});

function countToolCalls(vendor, text) {
  const re = TOOL_MARKERS[vendor];
  if (!re || !text) return 0;
  return (String(text).match(re) || []).length;
}

// Pure: returns { retryable, signature, reason, toolCalls }.
function classifyLaunchFailure({ code, message = '', vendor, stdout = '', stderr = '', capture = '' } = {}) {
  if (code !== 'LAUNCH_FAIL') return { retryable: false, reason: `code ${code || 'unknown'} is terminal`, signature: null, toolCalls: null };
  const text = [message, stderr, stdout, capture].map((t) => String(t || '')).join('\n');
  const toolCalls = countToolCalls(vendor, `${stdout}\n${stderr}\n${capture}`);
  if (toolCalls > 0) return { retryable: false, reason: 'the child made tool calls; the seat ran', signature: null, toolCalls };
  const hit = SIGNATURES.find((s) => s.re.test(text));
  if (!hit) return { retryable: false, reason: 'no never-started signature matched', signature: null, toolCalls };
  return { retryable: true, reason: hit.id, signature: hit.id, toolCalls };
}

function retryDelayMs(attempt, index = 0) {
  // Droppy's stagger: attempt*2 s plus a quarter-slot per parallel sibling.
  return attempt * 2000 + (index % 4) * 500;
}

module.exports = { MAX_ATTEMPTS, SIGNATURES, classifyLaunchFailure, countToolCalls, retryDelayMs };
