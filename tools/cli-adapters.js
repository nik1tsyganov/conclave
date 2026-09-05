'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectBrief, writePointerFile, pointerText } = require('./cli-pointer.js');
const { resolveVendorBinary } = require('./vendor-binaries.js');

const DEFAULTS = Object.freeze({
  openai: { model: 'gpt-5.6-sol', effort: 'high' },
  google: { model: 'gemini-3.1-pro-high', effort: null },
  anthropic: { model: 'fable', effort: 'xhigh' },
});

function roleSandbox(role) {
  if (role === 'implement') return 'workspace-write';
  if (role === 'review' || role === 'verify') return 'read-only';
  throw new Error(`invalid role: ${role}`);
}

function windowsUnder(candidate, root) {
  const c = path.win32.resolve(candidate).toLowerCase();
  const r = path.win32.resolve(root).toLowerCase();
  return c === r || c.startsWith(`${r}\\`);
}

function allowedWorkspace(cwd, env = process.env) {
  const devRoot = env.MAGI_DEV_ROOT || 'C:\\src';
  const roots = [devRoot, ...(env.MAGI_ALLOWED_WORKSPACE_ROOTS || '').split(';').filter(Boolean)];
  const resolved = path.win32.resolve(cwd);
  if (!roots.some((root) => windowsUnder(resolved, root))) {
    const error = new Error(`workspace ${resolved} is outside MAGI allowed roots: ${roots.join(', ')}`);
    error.code = 'WORKSPACE_FORBIDDEN';
    throw error;
  }
  return resolved;
}

function base(opts) {
  if (!opts || !opts.briefPath) throw new Error('briefPath is required');
  if (!opts.cwd) throw new Error('cwd is required');
  if (!opts.role) throw new Error('role is required');
  const brief = inspectBrief(opts.briefPath);
  return {
    brief,
    cwd: allowedWorkspace(opts.cwd, opts.env || process.env),
    model: opts.model || DEFAULTS[opts.vendor].model,
    effort: opts.effort || DEFAULTS[opts.vendor].effort,
    role: opts.role,
  };
}

function openaiLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'openai' });
  const pointerFile = writePointerFile(ctx.brief.briefPath);
  return {
    vendor: 'openai', role: ctx.role, model: ctx.model, effort: ctx.effort,
    binary: resolveVendorBinary('openai', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args: [
      'exec', '--skip-git-repo-check', '-s', roleSandbox(ctx.role), '-m', ctx.model,
      '-c', `model_reasoning_effort=${ctx.effort}`,
      '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
      '-C', ctx.cwd, '-o', opts.capturePath, '-',
    ],
    cwd: ctx.cwd, stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'],
    pointerFile, requestedSandbox: roleSandbox(ctx.role),
  };
}

function googleLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'google' });
  const env = { ...(opts.env || process.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE']) delete env[key];
  const args = ['--model', ctx.model, '--output-format', 'json', '--print-timeout', '20m'];
  if (ctx.role === 'implement') args.push('--dangerously-skip-permissions'); else args.push('--sandbox');
  const home = opts.home || os.homedir();
  const addDirs = [path.join(home, '.claude', 'skills'), ctx.cwd, path.dirname(ctx.brief.briefPath)];
  if (opts.rulesRoot) addDirs.push(opts.rulesRoot);
  for (const dir of [...new Set(addDirs)]) args.push('--add-dir', dir);
  args.push('-p', pointerText(ctx.brief).trim());
  return {
    vendor: 'google', role: ctx.role, model: ctx.model, effort: null,
    binary: resolveVendorBinary('google', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, env, cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function anthropicLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'anthropic' });
  const pointerFile = writePointerFile(ctx.brief.briefPath);
  const permissionMode = ctx.role === 'implement'
    ? 'bypassPermissions'
    : (opts.reviewPermissionMode || process.env.MAGI_CLAUDE_REVIEW_PERMISSION_MODE || 'plan');
  const args = ['-p', '--model', ctx.model, '--effort', ctx.effort, '--permission-mode', permissionMode, '--add-dir', ctx.cwd];
  const briefDir = path.win32.dirname(path.win32.resolve(ctx.brief.briefPath));
  if (briefDir.toLowerCase() !== ctx.cwd.toLowerCase()) args.push('--add-dir', briefDir);
  args.push('--output-format', 'text');
  return {
    vendor: 'anthropic', role: ctx.role, model: ctx.model, effort: ctx.effort,
    binary: resolveVendorBinary('anthropic', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, cwd: ctx.cwd, stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'], permissionMode,
  };
}

function buildLaunch(opts) {
  if (opts.vendor === 'openai') return openaiLaunch(opts);
  if (opts.vendor === 'google') return googleLaunch(opts);
  if (opts.vendor === 'anthropic') return anthropicLaunch(opts);
  throw new Error(`unsupported vendor: ${opts.vendor}`);
}

module.exports = { DEFAULTS, allowedWorkspace, anthropicLaunch, buildLaunch, googleLaunch, openaiLaunch, roleSandbox };
