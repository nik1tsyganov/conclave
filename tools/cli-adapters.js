'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectBrief, pointerText } = require('./cli-pointer.js');
const { resolveVendorBinary } = require('./vendor-binaries.js');

const DEFAULTS = Object.freeze({
  openai: { model: 'gpt-5.6-sol', effort: 'high' },
  google: { model: 'gemini-3.1-pro-high', effort: null },
  anthropic: { model: 'fable', effort: 'xhigh' },
});
const READ_ONLY_ROLES = new Set(['review', 'verify', 'plan', 'research']);

function roleSandbox(role) {
  if (role === 'implement') return 'workspace-write';
  if (READ_ONLY_ROLES.has(role)) return 'read-only';
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
  if (!opts.seatContractPath) throw new Error('seatContractPath is required');
  if (!opts.skillRoot) throw new Error('skillRoot is required');
  const brief = inspectBrief(opts.briefPath);
  return {
    brief,
    cwd: allowedWorkspace(opts.cwd, opts.env || process.env),
    model: opts.model || DEFAULTS[opts.vendor].model,
    effort: opts.effort || DEFAULTS[opts.vendor].effort,
    role: opts.role,
    seatContractPath: path.resolve(opts.seatContractPath),
    skillRoot: path.resolve(opts.skillRoot),
  };
}

function subscriptionEnv(source = process.env) {
  const env = { ...source };
  for (const key of ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE']) delete env[key];
  return env;
}

function seatContextText(ctx) {
  return `Read ${ctx.seatContractPath} in full before doing any task work. Use only the MAGI-authorized staged skills listed there. The user delegated the task and report format to this bound brief and contract. Native permissions still apply. Your FINAL response must start with the brief's exact first line. Read that line from the bound brief. Do not put a status sentence, introduction, Markdown decoration or confirmation request before that line. Then follow the brief's response format.`;
}

function seatPointerText(ctx) {
  const text = `${pointerText(ctx.brief).trim()} ${seatContextText(ctx)}`;
  if (text.length + 1 > 2000) throw Object.assign(new Error('seat pointer exceeds the 2000-character delivery limit'), { code: 'POINTER_FAIL' });
  return text;
}

function seatPointerFile(ctx) {
  const text = seatPointerText(ctx);
  const file = path.resolve(ctx.brief.briefPath + '.pointer.md');
  fs.writeFileSync(file, `${text}\n`, 'utf8');
  return file;
}

function openaiLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'openai' });
  const pointerFile = seatPointerFile(ctx);
  return {
    vendor: 'openai', role: ctx.role, model: ctx.model, effort: ctx.effort,
    binary: resolveVendorBinary('openai', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args: [
      'exec', '--skip-git-repo-check', '-s', roleSandbox(ctx.role), '-m', ctx.model,
      '-c', `model_reasoning_effort=${ctx.effort}`,
      '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
      '-C', ctx.cwd, '-o', opts.capturePath, '-',
    ],
    cwd: ctx.cwd, env: subscriptionEnv(opts.env), stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'],
    pointerFile, requestedSandbox: roleSandbox(ctx.role), skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
  };
}

function googleLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'google' });
  const env = { ...subscriptionEnv(opts.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE']) delete env[key];
  const nativeLogPath = path.join(path.dirname(opts.capturePath || ctx.seatContractPath), 'native-cli.log');
  const args = ['--model', ctx.model, '--output-format', 'json', '--print-timeout', '20m', '--log-file', nativeLogPath];
  if (ctx.role === 'implement') args.push('--dangerously-skip-permissions'); else args.push('--sandbox');
  const addDirs = [ctx.cwd, path.dirname(ctx.brief.briefPath), ctx.skillRoot, path.dirname(ctx.seatContractPath)];
  if (opts.rulesRoot) addDirs.push(opts.rulesRoot);
  for (const dir of [...new Set(addDirs)]) args.push('--add-dir', dir);
  args.push('-p', seatPointerText(ctx));
  return {
    vendor: 'google', role: ctx.role, model: ctx.model, effort: null,
    binary: resolveVendorBinary('google', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, env, cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'], nativeLogPath, skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
  };
}

function anthropicLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'anthropic' });
  if (ctx.role !== 'implement' && ((opts.reviewPermissionMode && opts.reviewPermissionMode !== 'dontAsk') || (process.env.MAGI_CLAUDE_REVIEW_PERMISSION_MODE && process.env.MAGI_CLAUDE_REVIEW_PERMISSION_MODE !== 'dontAsk'))) throw new Error('read-only Claude roles require dontAsk with read-only tools');
  const pointerFile = seatPointerFile(ctx);
  const permissionMode = ctx.role === 'implement'
    ? 'bypassPermissions'
    : 'dontAsk';
  // Keep authenticated native tools and permissions, but exclude global hooks,
  // plugins and instruction discovery. Leaf context is read from staged files.
  const args = ['-p', '--safe-mode', '--model', ctx.model, '--effort', ctx.effort, '--permission-mode', permissionMode, '--add-dir', ctx.cwd];
  // Native final-response instructions must survive tool-result narration.
  // Append to the native system prompt; never replace its permission controls.
  args.push('--append-system-prompt', seatContextText(ctx));
  if (ctx.role !== 'implement') args.push('--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep');
  const addDirs = [path.dirname(ctx.brief.briefPath), ctx.skillRoot, path.dirname(ctx.seatContractPath)];
  if (opts.rulesRoot) addDirs.push(opts.rulesRoot);
  for (const dir of [...new Set(addDirs)]) {
    if (path.win32.resolve(dir).toLowerCase() !== ctx.cwd.toLowerCase()) args.push('--add-dir', dir);
  }
  args.push('--output-format', 'stream-json', '--verbose');
  return {
    vendor: 'anthropic', role: ctx.role, model: ctx.model, effort: ctx.effort,
    binary: resolveVendorBinary('anthropic', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, cwd: ctx.cwd, env: subscriptionEnv(opts.env), stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'], permissionMode,
    skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
  };
}

function buildLaunch(opts) {
  if (opts.vendor === 'openai') return openaiLaunch(opts);
  if (opts.vendor === 'google') return googleLaunch(opts);
  if (opts.vendor === 'anthropic') return anthropicLaunch(opts);
  throw new Error(`unsupported vendor: ${opts.vendor}`);
}

module.exports = { DEFAULTS, READ_ONLY_ROLES, allowedWorkspace, anthropicLaunch, buildLaunch, googleLaunch, openaiLaunch, roleSandbox, seatPointerFile, seatPointerText, subscriptionEnv };
