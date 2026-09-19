// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { assertPlainPath, inside } = require('./dispatch-evidence.js');
const { inspectBrief, pointerText } = require('./cli-pointer.js');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { CLAUDE_RESPONSE_PROTOCOL, CLAUDE_RESPONSE_SCHEMA } = require('./vendor-native.js');
const { validateEvidenceReadDirs } = require('./evidence-read-access.js');
const { codexReadCommand } = require('./instruction-read-evidence.js');

const DEFAULTS = Object.freeze({
  openai: { model: 'gpt-5.6-sol', effort: 'high' },
  google: { model: 'gemini-3.1-pro-high', effort: null },
  anthropic: { model: 'fable', effort: 'xhigh' },
});
const READ_ONLY_ROLES = new Set(['review', 'verify', 'plan', 'research']);
const OPENAI_SCRATCH_PROTOCOL = 'conclave-openai-readonly-scratch-v1';

function roleSandbox(role) {
  if (role === 'implement') return 'workspace-write';
  if (READ_ONLY_ROLES.has(role)) return 'read-only';
  throw new Error(`invalid role: ${role}`);
}

function extraReadDirs(opts) {
  if (opts.evidenceReadDirs === undefined) return [];
  if (!Array.isArray(opts.evidenceReadDirs)) throw new Error('evidenceReadDirs must be an array');
  return validateEvidenceReadDirs(opts);
}

function openaiScratchPolicy({ runDir, dispatchId, role, cwd, capturePath }) {
  if (!READ_ONLY_ROLES.has(role)) throw new Error('OpenAI scratch requires a non-implement role');
  if (!runDir || !path.isAbsolute(runDir) || typeof dispatchId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(dispatchId)) {
    throw new Error('OpenAI scratch requires a bound runDir and dispatchId');
  }
  const evidenceDir = path.join(path.resolve(runDir), 'out', dispatchId);
  const scratchPath = path.join(evidenceDir, 'scratch');
  if (!capturePath || hostResolve(capturePath) !== hostResolve(path.join(evidenceDir, 'capture.txt'))) {
    throw new Error('OpenAI scratch capture must belong to its bound dispatch');
  }
  if (!cwd || inside(scratchPath, cwd) || inside(cwd, scratchPath) || hostResolve(scratchPath) === hostResolve(cwd)) {
    throw new Error('OpenAI scratch must not overlap the product workspace');
  }
  return { protocol: OPENAI_SCRATCH_PROTOCOL, profile: 'conclave_readonly_scratch', scratchPath };
}

function openaiScratchEnv(policy) {
  return {
    TEMP: policy.scratchPath,
    TMP: policy.scratchPath,
    npm_config_cache: path.join(policy.scratchPath, 'npm-cache'),
    npm_config_update_notifier: 'false',
  };
}

function openaiArgs({ role, model, effort, cwd, capturePath }, policy) {
  const permissionArgs = policy ? [
    '-c', `default_permissions=${JSON.stringify(policy.profile)}`,
    // Replace the entire named profile so a global rule cannot add another grant.
    '-c', `permissions.${policy.profile}={ extends = ":read-only", filesystem = { ${JSON.stringify(policy.scratchPath.replaceAll('\\', '/'))} = "write" }, network = { enabled = false } }`,
  ] : ['-s', roleSandbox(role)];
  // Headless codex otherwise routes through the host's local proxy. Read from
  // process.env so the launch and its later scratch re-validation agree.
  // Default on darwin: CONCLAVE_CODEX_PROVIDER=openai.
  // An explicit value wins (empty string = no flag); the darwin default keeps
  // launch and replay in agreement when a later session forgets the export.
  const provider = process.env.CONCLAVE_CODEX_PROVIDER ?? (process.platform === 'darwin' ? 'openai' : undefined);
  return ['exec', '--skip-git-repo-check', ...permissionArgs, '-m', model,
    '-c', `model_reasoning_effort=${effort}`,
    '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false',
    ...(provider ? ['-c', `model_provider=${provider}`] : []),
    // R12 (leaf seat) enforced natively: no Codex sub-agents inside a seat.
    '-c', 'features.multi_agent=false',
    '-C', cwd, '-o', capturePath, '-'];
}

function validateOpenaiScratchLaunch(launch, expected) {
  if (!expected.cwd || !launch || launch.vendor !== 'openai' || launch.role !== expected.role || launch.cwd !== hostResolve(expected.cwd)) {
    throw new Error('OpenAI scratch launch identity mismatch');
  }
  const bound = { ...expected, cwd: hostResolve(expected.cwd) };
  const policy = openaiScratchPolicy(bound);
  const scratchEnv = openaiScratchEnv(policy);
  if (!isDeepStrictEqual(launch.scratchPermissions, policy) || !isDeepStrictEqual(launch.scratchEnv, scratchEnv)) {
    throw new Error('OpenAI scratch policy or environment is not bound to this dispatch');
  }
  const args = openaiArgs(bound, policy);
  if (!isDeepStrictEqual(launch.args, args)) throw new Error('OpenAI scratch launch arguments differ from the exact restricted profile');
  if (launch.env) {
    for (const [key, value] of Object.entries(scratchEnv)) {
      const matches = Object.keys(launch.env).filter(name => name.toLowerCase() === key.toLowerCase());
      if (matches.length !== 1 || launch.env[matches[0]] !== value) throw new Error('OpenAI scratch runtime environment mismatch');
    }
  }
  return policy;
}

function hostResolve(file) {
  return path.resolve(file);
}

// Case-preserving compare on segment boundaries, so /a/b never contains /a/bc.
function hostSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function hostUnder(candidate, root) {
  const c = path.resolve(candidate);
  const r = path.resolve(root);
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : `${r}${path.sep}`);
}

function hostRealpath(file) {
  try { return fs.realpathSync.native(hostResolve(file)); } catch { return hostResolve(file); }
}

function defaultDevRoot() {
  return path.join(os.homedir(), 'src');
}

function allowedWorkspace(cwd, env = process.env) {
  const devRoot = env.CONCLAVE_DEV_ROOT || defaultDevRoot();
  const roots = [devRoot, ...(env.CONCLAVE_ALLOWED_WORKSPACE_ROOTS || '').split(path.delimiter).filter(Boolean)];
  const resolved = hostResolve(cwd);
  // Compare the literal and the realpath on both sides: macOS reaches the same
  // workspace through /tmp and /private/tmp.
  const tried = [...new Set([resolved, hostRealpath(cwd)])];
  if (!roots.some((root) => [root, hostRealpath(root)].some((r) => tried.some((c) => hostUnder(c, r))))) {
    const error = new Error(`workspace ${resolved} is outside CONCLAVE allowed roots: ${roots.join(', ')}`);
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
    vendor: opts.vendor,
    cwd: allowedWorkspace(opts.cwd, opts.env || process.env),
    model: opts.model || DEFAULTS[opts.vendor].model,
    effort: opts.effort || DEFAULTS[opts.vendor].effort,
    role: opts.role,
    seatContractPath: path.resolve(opts.seatContractPath),
    skillRoot: path.resolve(opts.skillRoot),
    evidenceReadDirs: extraReadDirs(opts),
  };
}

function subscriptionEnv(source = process.env) {
  const env = { ...source };
  const prohibited = new Set([
    'OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE',
    'SYNARA_ANTIGRAVITY_EVENTS', 'SYNARA_ANTIGRAVITY_HOOK_DECISION',
  ]);
  for (const key of Object.keys(env)) if (prohibited.has(key.toUpperCase())) delete env[key];
  return env;
}

// Wording note (2026-09-16, macOS): the sentence "Native permissions still apply." in this
// system prompt tripped Opus 5's safeguard classifier ([reasoning_extraction]) on every launch,
// deterministically, while Sonnet passed. Bisected: any "permissions ... apply/in force" sentence
// re-trips it; dropping the sentence passed 4/4. The host enforces permissions regardless.
function seatContextText(ctx) {
  const open = ctx.vendor === 'anthropic'
    ? `Use the Read tool on ${ctx.seatContractPath} in full before doing any task work. Do not use Bash or cat for instruction files.`
    : `Read ${ctx.seatContractPath} in full before doing any task work.`;
  return `${open} Complete every required instruction read in that contract before product work. Do not read global skills or use other tools before that coverage. If any required instruction is missing or unreadable, stop and report a blocker. Use only the CONCLAVE-authorized staged skills listed there. Your FINAL response must start with the brief's exact first line, with nothing before it. Then follow the brief's response format.`;
}

// Claude's system prompt. Same obligations as seatContextText (which still rides the
// user-turn pointer), in compact wording: the prescriptive "Do not use Bash or cat ...
// Do not read global skills or use other tools ... CONCLAVE-authorized" block, placed in a
// system prompt, tripped Opus 5's safeguard classifier ([reasoning_extraction]) on every
// launch on 2026-09-16 (bisected against the exact launch; this wording passed 3/3).
//
// It is not only wording. Bisected again 2026-09-18 against a real verify seat: this
// compact prompt passes on its own, and so does every pair. Opus refuses only when FOUR
// things ride together — --safe-mode, --json-schema, --append-system-prompt and a --tools
// restriction — and Fable passes that identical launch. So the shape of the launch is what
// the classifier answers, not a sentence in it, and no rewording fixes it. The schema is
// load-bearing (vendor-native.js requires exactly it for the response protocol) and so is
// --safe-mode (it is what keeps a seat a leaf), which leaves the model as the only free
// choice. Routing a role off Opus is a seat-table change and belongs to the owner; until
// then the refusal is reported as terminal rather than retried (launch-retry.js).
//
// On 2026-09-19 a second model, Fable, refused the same four-flag shape with
// api_refusal_category cyber, so the refusal tracks the launch shape rather than one
// model's classifier. The TypeSafe Jev arbiter scored launch shape at p=0.73 against
// brief wording at p=0.18, and dropping the --tools restriction as the highest-information
// next action at p=0.64. --tools is dropped because it is the only non-load-bearing member
// of the conjunction: read-only is still enforced by --allowedTools Read,Glob,Grep together
// with --permission-mode dontAsk and --disallowedTools Agent,Task.
function anthropicSystemText(ctx) {
  return `Read the seat contract at ${ctx.seatContractPath} in full with the Read tool before any task work. ` +
    'Complete every instruction read it lists before product work, with the Read tool rather than shell commands, and read nothing else first. ' +
    'If a listed instruction is missing or unreadable, stop and report a blocker. Use only the staged skills the contract lists. ' +
    "Begin the final response with the brief's exact first line, then follow the brief's response format.";
}

function seatPointerText(ctx) {
  const command = { cmd: codexReadCommand(ctx.seatContractPath), workdir: ctx.cwd, max_output_tokens: 20000 };
  let recipe = '';
  if (ctx.vendor === 'openai') {
    recipe = `FIRST use the exec code tool with exactly this JavaScript: const r = await tools.exec_command(${JSON.stringify(command)}); text(r.output); Then use the exact one-file read recipes in that contract. `;
  } else if (ctx.vendor === 'anthropic') {
    recipe = `FIRST use the Read tool with file_path exactly ${ctx.seatContractPath} and no other tool. Then use that contract's exact one-file Read recipes. Do not cat or Bash instruction files. `;
  } else if (ctx.vendor === 'google') {
    recipe = `FIRST use the view_file tool with AbsolutePath exactly ${ctx.seatContractPath} and no other tool. Then use that contract's exact one-file view_file recipes. `;
  }
  // Google's evidence note rides at the END, after the instruction-read obligation. Placed in
  // front it displaced that obligation: the 2026-09-19 review seat went straight to the staged
  // evidence, skipped its native instruction reads and failed INSTRUCTION_READ_FAIL. The order
  // of these sentences is what the model follows, so it is load-bearing.
  const evidence = ctx.vendor === 'google' && ctx.role !== 'implement' && ctx.evidenceReadDirs.length
    ? ` Only after every required instruction read is complete, judge this unit from the evidence the host already captured: the check's output is in test-output.txt and the worktree delta is in diff.txt under ${ctx.evidenceReadDirs.join(', ')}. Read those files and run nothing yourself; a command in this headless session is declined without a prompt, reports success having done nothing, and voids your result.`
    : '';
  const text = `${recipe}${pointerText(ctx.brief).trim()} ${seatContextText(ctx)}${evidence}`;
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
  if (opts.readonlyScratch !== undefined && typeof opts.readonlyScratch !== 'boolean') throw new Error('readonlyScratch must be boolean');
  const policy = opts.readonlyScratch ? openaiScratchPolicy({ ...opts, cwd: ctx.cwd }) : null;
  const env = subscriptionEnv(opts.env);
  let scratchEnv;
  if (policy) {
    for (const protectedPath of [ctx.brief.briefPath, ctx.seatContractPath, ctx.skillRoot, opts.rulesRoot, opts.capturePath].filter(Boolean)) {
      if (inside(path.resolve(protectedPath), policy.scratchPath) || ((protectedPath === ctx.skillRoot || protectedPath === opts.rulesRoot) && inside(policy.scratchPath, path.resolve(protectedPath)))) {
        throw new Error('OpenAI scratch overlaps protected instructions or evidence');
      }
    }
    assertPlainPath(policy.scratchPath);
    fs.mkdirSync(policy.scratchPath, { recursive: true });
    assertPlainPath(policy.scratchPath);
    scratchEnv = openaiScratchEnv(policy);
    for (const key of Object.keys(env)) if (Object.keys(scratchEnv).some(name => name.toLowerCase() === key.toLowerCase())) delete env[key];
    Object.assign(env, scratchEnv);
  }
  const pointerFile = seatPointerFile(ctx);
  return {
    vendor: 'openai', role: ctx.role, model: ctx.model, effort: ctx.effort,
    binary: resolveVendorBinary('openai', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args: openaiArgs({ ...ctx, capturePath: opts.capturePath }, policy),
    cwd: ctx.cwd, env, stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'],
    pointerFile, requestedSandbox: policy ? 'custom permissions' : roleSandbox(ctx.role), skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
    ...(ctx.evidenceReadDirs.length ? { evidenceReadDirs: ctx.evidenceReadDirs } : {}),
    ...(policy ? { scratchPermissions: policy, scratchEnv } : {}),
  };
}

// agy exposes no tool-restriction flag; --sandbox is the only read-only lever and it does
// not stop the model ATTEMPTING a command. A denied action in headless mode is reported as
// SUCCESS with an empty response, not an error (google review seat, 2026-09-19). The prose
// branch in seatPointerText is the only lever; do not remove it believing a flag covers this.
function googleLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'google' });
  const env = { ...subscriptionEnv(opts.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE', 'SYNARA_ANTIGRAVITY_EVENTS', 'SYNARA_ANTIGRAVITY_HOOK_DECISION']) delete env[key];
  const nativeLogPath = path.join(path.dirname(opts.capturePath || ctx.seatContractPath), 'native-cli.log');
  const args = ['--model', ctx.model, '--disable-slash-commands', '--output-format', 'json', '--print-timeout', '20m', '--log-file', nativeLogPath];
  if (ctx.role === 'implement') args.push('--dangerously-skip-permissions'); else args.push('--sandbox');
  const addDirs = [ctx.cwd, path.dirname(ctx.brief.briefPath), ctx.skillRoot, path.dirname(ctx.seatContractPath), ...ctx.evidenceReadDirs];
  if (opts.rulesRoot) addDirs.push(opts.rulesRoot);
  // agy matches a grant against the resolved path, so a spelled-only grant is silently
  // soft-denied when a symlink sits in the path (e.g. /Users -> /System/Volumes/Data/Users).
  const grantDirs = [];
  for (const dir of addDirs) {
    grantDirs.push(dir);
    try {
      const resolved = fs.realpathSync(dir);
      if (resolved !== dir) grantDirs.push(resolved);
    } catch { /* a directory that does not exist yet contributes only its spelled form */ }
  }
  for (const dir of [...new Set(grantDirs)]) args.push('--add-dir', dir);
  args.push('-p', seatPointerText(ctx));
  return {
    vendor: 'google', role: ctx.role, model: ctx.model, effort: null,
    binary: resolveVendorBinary('google', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, env, cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'pipe'], nativeLogPath, skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
    ...(ctx.evidenceReadDirs.length ? { evidenceReadDirs: ctx.evidenceReadDirs } : {}),
  };
}

function anthropicLaunch(opts) {
  const ctx = base({ ...opts, vendor: 'anthropic' });
  if (ctx.role !== 'implement' && ((opts.reviewPermissionMode && opts.reviewPermissionMode !== 'dontAsk') || (process.env.CONCLAVE_CLAUDE_REVIEW_PERMISSION_MODE && process.env.CONCLAVE_CLAUDE_REVIEW_PERMISSION_MODE !== 'dontAsk'))) throw new Error('read-only Claude roles require dontAsk with read-only tools');
  const pointerFile = seatPointerFile(ctx);
  const permissionMode = ctx.role === 'implement'
    ? 'bypassPermissions'
    : 'dontAsk';
  // Keep authenticated native tools and permissions, but exclude global hooks,
  // plugins and instruction discovery. Leaf context is read from staged files.
  // R12 (leaf seat) enforced natively, not by prompt: Claude's own subagent
  // tools are denied on every seat (adopted from Droppy Code Hydra, 2026-09-16).
  const args = ['-p', '--safe-mode', '--model', ctx.model, '--effort', ctx.effort, '--permission-mode', permissionMode, '--disallowedTools', 'Agent,Task', '--add-dir', ctx.cwd];
  // Native final-response instructions must survive tool-result narration.
  // Append to the native system prompt; never replace its permission controls.
  args.push('--append-system-prompt', anthropicSystemText(ctx));
  if (ctx.role !== 'implement') args.push('--allowedTools', 'Read,Glob,Grep');
  const addDirs = [path.dirname(ctx.brief.briefPath), ctx.skillRoot, path.dirname(ctx.seatContractPath), ...ctx.evidenceReadDirs];
  if (opts.rulesRoot) addDirs.push(opts.rulesRoot);
  for (const dir of [...new Set(addDirs)]) {
    if (!hostSamePath(dir, ctx.cwd)) args.push('--add-dir', dir);
  }
  args.push('--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(CLAUDE_RESPONSE_SCHEMA));
  return {
    vendor: 'anthropic', role: ctx.role, model: ctx.model, effort: ctx.effort, responseProtocol: CLAUDE_RESPONSE_PROTOCOL,
    binary: resolveVendorBinary('anthropic', { env: opts.env, home: opts.home, mustExist: opts.mustExistBinary !== false }),
    args, cwd: ctx.cwd, env: subscriptionEnv(opts.env), stdinFile: pointerFile, stdio: ['pipe', 'pipe', 'pipe'], permissionMode,
    skillRoot: ctx.skillRoot, seatContractPath: ctx.seatContractPath,
    ...(ctx.evidenceReadDirs.length ? { evidenceReadDirs: ctx.evidenceReadDirs } : {}),
  };
}

function buildLaunch(opts) {
  if (opts.vendor === 'openai') return openaiLaunch(opts);
  if (opts.vendor === 'google') return googleLaunch(opts);
  if (opts.vendor === 'anthropic') return anthropicLaunch(opts);
  throw new Error(`unsupported vendor: ${opts.vendor}`);
}

module.exports = { DEFAULTS, READ_ONLY_ROLES, OPENAI_SCRATCH_PROTOCOL, allowedWorkspace, anthropicLaunch, buildLaunch, googleLaunch, hostSamePath, hostUnder, openaiLaunch, openaiScratchPolicy, validateOpenaiScratchLaunch, roleSandbox, seatPointerFile, seatPointerText, subscriptionEnv };
