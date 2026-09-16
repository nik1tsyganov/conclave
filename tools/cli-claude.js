'use strict';

/**
 * Historical MAGI Claude CLI capture-health diagnostic.
 *
 * Production launches use a sealed plan through dispatch-run.js. This legacy
 * recipe cannot establish production proof or activation. The 2026-09-02
 * incident this file first encoded - a fable/xhigh implement
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
 * The brief BODY never rides stdin or argv: buildLaunch writes
 * `<brief>.pointer.md` beside the brief (tools/cli-pointer.js) and pipes only
 * that short path+bytes+hash pointer; the model Reads the brief file itself.
 * A second --add-dir names the brief's parent directory, which must sit under
 * an authorized workspace or the lead-written MAGI bus temp root - a brief parented
 * anywhere else is refused (never --add-dir C:\Users or a drive root).
 * Never --continue / --resume. The bypass grant is scoped: the cwd --add-dir
 * must stay under C:\src\magi or an explicit MAGI_ALLOWED_WORKSPACE_ROOTS entry.
 */

const path = require('node:path');
const os = require('node:os');
const { containsForbidden } = require('./plugin-check.js');
const { writePointerFile } = require('./cli-pointer.js');
const { canonicalPlainPath } = require('./runtime-paths.js');
const { resolveVendorBinary } = require('./vendor-binaries.js');

const CLAUDE_BIN = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
const DEFAULT_MODEL = 'fable';
// Historical default write grant. Other roots require the existing explicit
// MAGI_ALLOWED_WORKSPACE_ROOTS setting; cwd alone never grants access.
const MAGI_ROOT = process.platform === 'win32' ? 'C:\\src\\magi' : path.join(os.homedir(), 'src', 'magi');
// Where lead-written MAGI bus briefs live. A brief's parent directory must be
// under an authorized workspace or this bus root for the pointer launch to add-dir it.
const MAGI_BUS_ROOT = path.join(os.tmpdir(), 'magi-bus');
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

function nativePath(value) {
  // Never reinterpret an absolute Windows path as a relative POSIX filename.
  if (process.platform !== 'win32' && /^(?:[a-z]:|\\\\)/i.test(value)) return null;
  return canonicalPlainPath(value);
}

function isUnderRoot(candidate, root) {
  if (!candidate || !root) return false;
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveAddDir(cwd, roots) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('cwd must be a non-empty path: --add-dir names the write scope explicitly');
  }
  // Canonicalization resolves short-name aliases and refuses symlink escapes.
  const resolved = nativePath(cwd);
  if (!roots.some(root => isUnderRoot(resolved, root))) {
    throw new Error(
      `--permission-mode bypassPermissions is pre-authorized under ${roots.join(', ') || MAGI_ROOT} only; ` +
        `refusing --add-dir ${resolved || cwd}`
    );
  }
  return resolved;
}

function resolveBriefDir(briefPath, roots) {
  const resolved = nativePath(briefPath);
  const dir = resolved && path.dirname(resolved);
  if (!roots.some(root => isUnderRoot(dir, root))) {
    throw new Error(
      `brief parent ${dir || briefPath} is outside the pointer zones (${roots.join(', ')}); ` +
        'refusing to --add-dir it'
    );
  }
  return { resolved, dir };
}

function buildLaunch(opts = {}) {
  const { briefPath, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, cwd = MAGI_ROOT } = opts;
  if (typeof briefPath !== 'string' || briefPath.length === 0) {
    throw new Error(
      'briefPath is required: the brief travels as a FILE the model Reads; only a short pointer rides stdin'
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
  // --add-dir C:\src\magi --output-format text. Cheap validation and both
  // zone checks run BEFORE any disk write, so a refused launch leaves no
  // pointer file behind.
  const env = opts.env || process.env;
  const roots = [MAGI_ROOT, ...(env.MAGI_ALLOWED_WORKSPACE_ROOTS || '').split(';').filter(Boolean)]
    .map(nativePath).filter(Boolean);
  const addDir = resolveAddDir(cwd, roots);
  const { resolved: resolvedBrief, dir: briefDir } = resolveBriefDir(briefPath, [...roots, nativePath(MAGI_BUS_ROOT)]);
  const binary = resolveVendorBinary('anthropic', {
    binary: opts.binary, env, home: opts.home, config: opts.config, configFile: opts.configFile,
    mustExist: opts.mustExistBinary === true,
  });
  // Only the pointer rides stdin: path + bytes + hash, one short line that
  // closes. The model reaches the brief body through --add-dir and Reads it.
  const pointerPath = writePointerFile(resolvedBrief);
  const args = [
    '-p',
    '--model', model,
    '--effort', effort,
    '--permission-mode', 'bypassPermissions',
    '--add-dir', addDir,
  ];
  if (path.relative(briefDir, addDir) !== '') {
    args.push('--add-dir', briefDir);
  }
  args.push('--output-format', 'text');
  return {
    binary,
    args,
    stdinFile: pointerPath,
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
  MAGI_BUS_ROOT,
  AUTH_NEEDLES,
  buildLaunch,
  assessCapture,
  assessIdleCapture,
  parseProof,
};
