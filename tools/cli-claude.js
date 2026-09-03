'use strict';

/**
 * MAGI Claude CLI capture-health recipe (cursor-cli host mode).
 *
 * Executable form of .cursor/skills/magi/references/cursor-cli.md. The
 * 2026-09-02 incident this file first encoded - a fable/xhigh implement
 * dispatch killed at 31 minutes of 0-byte capture - was a FALSE HANG:
 * `claude -p` buffers stdout until exit, so a healthy long implement shows
 * 0 capture bytes the whole time it runs. Empty capture is a verdict about
 * an EXITED process (or one decide() already killed for wall/idle-cpu in
 * tools/cli-idle.js), never a liveness signal on a running one.
 *
 * On-topic judgment stays with the arbiter: code proves the post-exit
 * capture is non-empty and free of login/auth language; the proof carries
 * the capture so the arbiter can judge topicality.
 *
 * buildLaunch encodes the MEASURED 2026-09-02 write dispatch (PID recorded,
 * files landed) so permission-mode and --add-dir are code, not a
 * hand-composed wrapper:
 *   claude.exe -p --model fable --effort xhigh
 *     --permission-mode bypassPermissions --add-dir C:\src\magi
 *     --output-format text
 * Prompt via stdin from a brief FILE. Never --continue / --resume. The
 * bypass grant is scoped: --add-dir must stay under C:\src\magi.
 */

const path = require('node:path');
const { containsForbidden } = require('./plugin-check.js');

const CLAUDE_BIN = 'C:\\Users\\YESSIR\\.local\\bin\\claude.exe';
const DEFAULT_MODEL = 'fable';
// The only root --permission-mode bypassPermissions is pre-authorized for
// (owner grant, 2026-09-02): MAGI implement writes under C:\src\magi.
const MAGI_ROOT = 'C:\\src\\magi';
// Claude Code effort levels per `claude.exe --help` (verified live 2026-09-02).
// The owner's "Extra" is not one of them - the rung below max is xhigh - and
// the cursor-cli overlay pins xhigh: max is NOT the default here.
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_EFFORT = 'xhigh';
// Compatibility export only: no longer a kill trigger for this vendor.
// Kill policy (wall clock, idle-cpu, Codex idle-stdio) lives in cli-idle.js.
const IDLE_LIMIT_MS = 20 * 60 * 1000;
const AUTH_NEEDLES = ['not logged in', 'please run /login', 'auth required'];

function assertEffort(effort) {
  if (!CLAUDE_EFFORTS.includes(effort)) {
    throw new Error(
      `"${effort}" is not a Claude Code effort level (valid: ${CLAUDE_EFFORTS.join(', ')})`
    );
  }
}

function resolveAddDir(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('cwd must be a non-empty path: --add-dir names the write scope explicitly');
  }
  // Resolve before checking so traversal ("..") cannot smuggle the add-dir
  // outside the pre-authorized root; emit the resolved form so the string
  // checked and the string dispatched are the same one. Windows paths compare
  // case-insensitively.
  const resolved = path.win32.resolve(cwd);
  const lower = resolved.toLowerCase();
  const root = MAGI_ROOT.toLowerCase();
  if (lower !== root && !lower.startsWith(root + '\\')) {
    throw new Error(
      `--permission-mode bypassPermissions is pre-authorized under ${MAGI_ROOT} only; ` +
        `refusing --add-dir ${resolved}`
    );
  }
  return resolved;
}

function buildLaunch(opts = {}) {
  const { briefPath, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, cwd = MAGI_ROOT } = opts;
  if (typeof briefPath !== 'string' || briefPath.length === 0) {
    throw new Error(
      'briefPath is required: the prompt travels as a file over stdin, never as argv bytes'
    );
  }
  assertEffort(effort);
  if (opts.continue || opts.resume) {
    throw new Error('fresh run only: --continue / --resume are never part of a MAGI dispatch');
  }
  if ('bypassPermissions' in opts) {
    // The old contract read this flag; under the new one both values would
    // silently mean something different, so any use of it fails loudly.
    throw new Error(
      'bypassPermissions option retired: the measured write dispatch always runs ' +
        `--permission-mode bypassPermissions, scoped by --add-dir under ${MAGI_ROOT}`
    );
  }
  // The measured 2026-09-02 MAGI write dispatch (PID recorded, files landed):
  // -p --model fable --effort xhigh --permission-mode bypassPermissions
  // --add-dir C:\src\magi --output-format text, prompt via stdin from a file.
  const args = [
    '-p',
    '--model', model,
    '--effort', effort,
    '--permission-mode', 'bypassPermissions',
    '--add-dir', resolveAddDir(cwd),
    '--output-format', 'text',
  ];
  return {
    binary: CLAUDE_BIN,
    args,
    stdinFile: briefPath,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
}

function assessCapture(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      verdict: 'FAIL',
      reason: 'empty capture: no bytes is never success, even after files landed',
    };
  }
  const needle = containsForbidden(text, AUTH_NEEDLES);
  if (needle) {
    return { verdict: 'FAIL', reason: `auth language in capture: "${needle}"` };
  }
  return { verdict: 'PASS', reason: null };
}

function assessIdleCapture(opts = {}) {
  const { byteLength, runningMs, running = true } = opts;
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength)) {
    throw new Error('byteLength must be a finite number');
  }
  if (typeof runningMs !== 'number' || !Number.isFinite(runningMs)) {
    throw new Error('runningMs must be a finite number');
  }
  if (typeof running !== 'boolean') {
    throw new Error('running must be a boolean: a string here could kill a live process');
  }
  // `claude -p` buffers stdout until exit: 0 bytes on a RUNNING child is
  // healthy at any elapsed time (the 2026-09-02 31-minute kill was a false
  // hang). Wall-clock and idle-cpu kills belong to cli-idle.js decide().
  if (running) {
    return { verdict: 'OK', reason: null };
  }
  if (byteLength === 0) {
    return {
      verdict: 'EMPTY_CAPTURE',
      reason: `process exited after ${runningMs} ms with 0 capture bytes: record FAIL - files landing never rescues it`,
    };
  }
  return { verdict: 'OK', reason: null };
}

function parseProof(opts = {}) {
  const { captureText, model, effort } = opts;
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('model is required: proof records the model as dispatched');
  }
  if (typeof effort !== 'string' || effort.length === 0) {
    throw new Error('effort is required: proof records the effort as dispatched');
  }
  assertEffort(effort);
  const health = assessCapture(captureText);
  if (health.verdict !== 'PASS') {
    return { ok: false, reason: health.reason };
  }
  // This recipe captures no vendor-side token count from Claude: null means
  // unmeasured. Never 0 - telemetry-append rejects 0 as invented data.
  // Vendor vocabulary is company names (telemetry-append.js: anthropic/openai/google).
  return {
    ok: true,
    proof: {
      vendor: 'anthropic',
      model,
      effort,
      capture: captureText,
      vendorSideTokens: null,
    },
  };
}

module.exports = {
  CLAUDE_BIN,
  CLAUDE_EFFORTS,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  IDLE_LIMIT_MS,
  MAGI_ROOT,
  AUTH_NEEDLES,
  buildLaunch,
  assessCapture,
  assessIdleCapture,
  parseProof,
};
