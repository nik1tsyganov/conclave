'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const test = require('node:test');
const { check, main } = require('./magi-cli-preflight.js');
const { FINGERPRINT, FINGERPRINT_V2 } = require('./cli-rules-stage.js');
const { CLI_RUNTIME_TOOLS } = require('./runtime-paths.js');

// Exact installed helper reviewed for the conditional capture preflight exception.
const CAPTURE_HELPER = String.raw`const fs = require("node:fs");
const event = process.argv[2] || "unknown";
let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  const target = process.env.SYNARA_ANTIGRAVITY_EVENTS;
  if (!target) {
    // Match the installed permission policy for inactive PreToolUse hooks.
    // PreInvocation has no injected steps and must not emit a decision.
    process.stdout.write(
      (event === "pre-tool"
        ? '{"decision":"ask"}'
        : "{}") + "\n",
    );
    return;
  }
  let capturedPayload = payload.trim();
  try {
    const input = JSON.parse(capturedPayload);
    const sanitized = {};
    for (const key of ["conversationId", "transcriptPath", "modelName"]) {
      if (typeof input[key] === "string" && input[key].trim()) sanitized[key] = input[key];
    }
    if (Number.isInteger(input.stepIdx) && input.stepIdx >= 0) sanitized.stepIdx = input.stepIdx;
    if (event === "pre-tool") {
      const name = input.toolCall && typeof input.toolCall.name === "string"
        ? input.toolCall.name.trim()
        : "";
      if (name) {
        sanitized.toolCall = {
          name,
          ...(input.toolCall.args && typeof input.toolCall.args === "object"
            ? { args: input.toolCall.args }
            : {}),
        };
      }
    } else if (event === "post-tool") {
      const name = input.toolCall && typeof input.toolCall.name === "string"
        ? input.toolCall.name.trim()
        : "";
      if (name) {
        sanitized.toolCall = {
          name,
          ...(input.toolCall.args && typeof input.toolCall.args === "object"
            ? { args: input.toolCall.args }
            : {}),
        };
      }
      sanitized.failed = typeof input.error === "string" && input.error.trim().length > 0;
      if (typeof input.error === "string" && input.error.trim()) sanitized.error = input.error;
      if (input.toolOutput !== undefined) sanitized.toolOutput = input.toolOutput;
      if (input.result !== undefined) sanitized.result = input.result;
    }
    capturedPayload = JSON.stringify(sanitized);
  } catch {
    capturedPayload = "{}";
  }
  fs.appendFileSync(target, event + "\t" + capturedPayload + "\n");
  if (event === "pre-tool") {
    const decision = process.env.SYNARA_ANTIGRAVITY_HOOK_DECISION === "allow" ? "allow" : "ask";
    process.stdout.write(JSON.stringify({ decision }) + "\n");
  } else if (event === "pre-invocation") {
    // PreInvocation accepts optional injectSteps, not a permission decision.
    process.stdout.write("{}\n");
  } else {
    // Stop and other non-tool hooks: empty object allows the agent to exit.
    // Do not emit decision:"stop" — it is not a recognized stop decision and
    // can hang the print process after the reply is already visible (#465).
    process.stdout.write("{}\n");
  }
});
`;

function conditionalCapture(f) {
  const binary = path.join(f.home, 'AppData', 'Local', 'Programs', 'synara-desktop', 'Synara.exe');
  const helper = path.join(f.home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'capture.cjs');
  put(binary, 'file-only discovery');
  put(helper, CAPTURE_HELPER);
  const hooks = { 'synara-capture': {} };
  for (const [event, argument] of Object.entries({ PreToolUse: 'pre-tool', PostToolUse: 'post-tool', PreInvocation: 'pre-invocation', PostInvocation: 'post-invocation', Stop: 'stop' })) {
    const fallback = event === 'PreToolUse' ? '{"decision":"ask"}' : '{}';
    const command = 'if not defined SYNARA_ANTIGRAVITY_EVENTS (more >nul 2>nul & echo ' + fallback + ') else (set ELECTRON_RUN_AS_NODE=1&& ' + binary + ' ' + helper + ' ' + argument + ')';
    hooks['synara-capture'][event] = event.endsWith('ToolUse') ? [{ matcher: '*', hooks: [{ type: 'command', command }] }] : [{ type: 'command', command }];
  }
  const file = path.join(path.dirname(helper), 'hooks.json');
  put(file, JSON.stringify(hooks));
  f.platform = 'win32';
  return { hooks, file, helper };
}

function put(file, body = 'fixture\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (Buffer.isBuffer(body)) fs.writeFileSync(file, body);
  else fs.writeFileSync(file, body, 'utf8');
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-preflight-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtimeRoot = path.join(root, 'runtime');
  const rulesRoot = path.join(root, 'rules');
  const home = path.join(root, 'home');
  const references = path.join(runtimeRoot, 'skills', 'magi-cli', 'references');
  const seatProfiles = path.join(references, 'seat-profiles.json');
  const profiles = { arbiterSkills: ['magi-mode'], forbiddenSeatSkills: ['magi-mode'],
    baseSkills: { openai: ['seat-openai'] }, roleSkills: { verify: ['testing'] }, classSkills: {} };
  put(seatProfiles, JSON.stringify(profiles));
  put(path.join(references, 'dispatch-matrix.json'), '{}');
  fs.mkdirSync(path.join(runtimeRoot, 'tools'));
  for (const name of CLI_RUNTIME_TOOLS) put(path.join(runtimeRoot, 'tools', name));
  for (const skill of ['seat-openai', 'testing']) put(path.join(runtimeRoot, 'seat-skills', skill, 'SKILL.md'), 'lean bundled skill');
  put(path.join(home, '.claude', 'skills', 'testing', 'SKILL.md'), 'wrong full home skill');
  put(path.join(rulesRoot, 'STANDING.md'), FINGERPRINT_V2 + '\n');
  put(path.join(rulesRoot, 'VENDOR.md'));
  put(path.join(rulesRoot, 'RULES', 'INDEX.md'));
  for (let n = 1; n <= 22; n += 1) put(path.join(rulesRoot, 'RULES', `R${String(n).padStart(2, '0')}-fixture.md`));
  const env = {};
  for (const name of ['MAGI_CODEX_BIN', 'MAGI_AGY_BIN', 'MAGI_CLAUDE_BIN']) {
    env[name] = path.join(root, 'binaries', `${name}.bin`);
    put(env[name], 'not executable; existence check only');
  }
  return { root, runtimeRoot, rulesRoot, home, env, seatProfiles, profiles };
}
function snapshot(root) {
  const entries = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.push([path.relative(root, full), 'link', fs.readlinkSync(full)]);
      else if (entry.isDirectory()) { entries.push([path.relative(root, full), 'dir']); walk(full); }
      else entries.push([path.relative(root, full), fs.readFileSync(full).toString('base64')]);
    }
  }
  walk(root);
  return entries;
}

test('preflight uses bundled skills and v2 rules with file-only binary discovery', t => {
  const f = fixture(t);
  const before = snapshot(f.root);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    t.mock.method(child, name, () => { throw new Error('preflight must not launch native processes'); });
  }
  const result = check(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.arbiterSkills, ['magi-mode']);
  assert.equal(result.findings.some(row => row.check.startsWith('arbiter-skill:')), false);
  const canonicalRuntimeRoot = fs.realpathSync.native(f.runtimeRoot);
  assert.ok(result.findings.filter(row => row.check.startsWith('seat-skill:')).every(row => row.value.startsWith(canonicalRuntimeRoot + path.sep)));
  assert.deepEqual(result.findings.find(row => row.check === 'rules:R01-R22').observed, Array.from({ length: 22 }, (_, n) => `R${String(n + 1).padStart(2, '0')}`));
  assert.deepEqual(snapshot(f.root), before);
});

test('missing external rules root reports MAGI_RULES_ROOT instead of throwing', t => {
  const f = fixture(t);
  delete f.rulesRoot;
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:root').error, /MAGI_RULES_ROOT/);
});

test('explicit environment rules root is supported', t => {
  const f = fixture(t);
  f.env.MAGI_RULES_ROOT = f.rulesRoot;
  delete f.rulesRoot;
  assert.equal(check(f).ok, true);
});

test('unset field-library and vault-skills roots are informational; a bad field-library fails', t => {
  const f = fixture(t);
  const unset = check(f);
  assert.equal(unset.ok, true);
  assert.equal(unset.findings.find(row => row.check === 'skill-web:field-library').value, null);
  assert.equal(unset.findings.find(row => row.check === 'skill-web:vault-skills').value, null);
  f.env.MAGI_FIELD_LIBRARY_ROOT = f.root;
  const bad = check(f);
  assert.equal(bad.ok, false);
  assert.match(bad.findings.find(row => row.check === 'skill-web:field-library').error, /not a field-library/);
});

test('unset MAGI_VAULT_ROOT is informational; a bad vault root fails', t => {
  const f = fixture(t);
  const unset = check(f);
  assert.equal(unset.ok, true);
  assert.equal(unset.findings.find(row => row.check === 'vault:root').value, null);
  f.env.MAGI_VAULT_ROOT = f.root;
  const bad = check(f);
  assert.equal(bad.ok, false);
  assert.match(bad.findings.find(row => row.check === 'vault:root').error, /not an ai-ops-vault/);
});

for (const relative of ['STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', 'RULES/R01-fixture.md', 'RULES/R22-fixture.md']) {
  test(`missing ${relative} fails preflight`, t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.rulesRoot, relative));
    assert.equal(check(f).ok, false);
  });
}

test('v1 rules and duplicate rule IDs cannot pass production preflight', t => {
  const f = fixture(t);
  put(path.join(f.rulesRoot, 'STANDING.md'), FINGERPRINT + '\n');
  assert.equal(check(f).ok, false);
  put(path.join(f.rulesRoot, 'STANDING.md'), FINGERPRINT_V2 + '\n');
  put(path.join(f.rulesRoot, 'RULES', 'R22-duplicate.md'));
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /duplicate.*R22/);
});

test('home skill cannot replace a missing bundled skill or a SKILL.md directory', t => {
  const f = fixture(t);
  const file = path.join(f.runtimeRoot, 'seat-skills', 'testing', 'SKILL.md');
  fs.unlinkSync(file);
  assert.equal(check(f).ok, false);
  fs.mkdirSync(file);
  assert.equal(check(f).ok, false);
});

test('forbidden and unsafe profile skills fail preflight', t => {
  const f = fixture(t);
  for (const name of ['magi-mode', '../testing']) {
    f.profiles.roleSkills.verify = [name];
    put(f.seatProfiles, JSON.stringify(f.profiles));
    assert.equal(check(f).ok, false);
  }
});

test('bundled skill and external rules junctions fail without writes', t => {
  const f = fixture(t);
  const skill = path.join(f.runtimeRoot, 'seat-skills', 'testing');
  const moved = path.join(f.root, 'testing');
  assert.equal(path.dirname(moved), f.root);
  fs.renameSync(skill, moved);
  fs.symlinkSync(moved, skill, 'junction');
  const link = path.join(f.root, 'rules-link');
  fs.symlinkSync(f.rulesRoot, link, 'junction');
  f.rulesRoot = link;
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:root').error, /junction|symlink/);
  assert.match(result.findings.find(row => row.check === 'seat-skill:testing').error, /junction|symlink/);
  assert.deepEqual(snapshot(f.root), before);
});

test('rule directories cannot count as required rule files', t => {
  const f = fixture(t);
  const file = path.join(f.rulesRoot, 'RULES', 'R22-fixture.md');
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /regular file/);
});

test('CLI rejects missing or unknown options with a structured result', () => {
  for (const args of [['--rules-root'], ['--unknown']]) {
    let output = '';
    const status = main(args, { stdout: { write: text => { output += text; } } });
    assert.equal(status, 2);
    assert.equal(JSON.parse(output).ok, false);
  }
});

test('an incomplete runtime cannot pass startup preflight', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.runtimeRoot, 'tools', 'plan-seal.js'), { force: true });
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'runtime:files').error, /plan-seal\.js/);
  assert.deepEqual(snapshot(f.root), before);
});

test('v2 preflight rejects an additional rule ID', t => {
  const f = fixture(t);
  put(path.join(f.rulesRoot, 'RULES', 'R23-extra.md'));
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /exactly R01-R22/);
});

for (const relative of ['SKILL.md', 'STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', 'RULES/R01-fixture.md', 'RULES/R22-fixture.md']) {
  test(`blank required ${relative} fails preflight without writes`, t => {
    const f = fixture(t);
    const file = relative === 'SKILL.md'
      ? path.join(f.runtimeRoot, 'seat-skills', 'testing', relative)
      : path.join(f.rulesRoot, relative);
    const original = fs.readFileSync(file);
    for (const body of ['', '\ufeff \t\r\n']) {
      fs.writeFileSync(file, body, 'utf8');
      const before = snapshot(f.root);
      assert.equal(check(f).ok, false);
      assert.deepEqual(snapshot(f.root), before);
    }
    fs.writeFileSync(file, original);
    assert.equal(check(f).ok, true);
  });
}

test('absent synara-capture plugin is allowed', t => {
  const f = fixture(t);
  const result = check(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.findings.find(row => row.check === 'google:synara-capture').value, 'absent');
});

test('synara-capture PreToolUse ask fails Google preflight', t => {
  const f = fixture(t);
  put(path.join(f.home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'hooks.json'),
    '{"synara-capture":{"PreToolUse":[{"hooks":[{"command":"echo {\\"decision\\":\\"ask\\"}"}]}]}}');
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'google:synara-capture').error, /emits ask/);
});

test('synara-capture PreToolUse allow passes Google preflight', t => {
  const f = fixture(t);
  put(path.join(f.home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'hooks.json'),
    '{"synara-capture":{"PreToolUse":[{"hooks":[{"command":"echo {\\"decision\\":\\"allow\\"}"}]}]}}');
  assert.equal(check(f).ok, true);
});

test('known conditional capture uses the adapter allow branch without writes or native calls', t => {
  const f = fixture(t);
  const { file } = conditionalCapture(f);
  f.env.SYNARA_ANTIGRAVITY_HOOK_DECISION = 'ask';
  const before = snapshot(f.root);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) t.mock.method(child, name, () => { throw new Error('no native calls'); });
  const result = check(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  const row = result.findings.find(row => row.check === 'google:synara-capture');
  assert.equal(row.status, 'adapter-isolated');
  assert.equal(require('./magi-synara-watch.js').inspectHooks(file, f), null);
  assert.match(row.scope, /diagnostics.*not native proof/i);
  assert.match(row.scope, /runtime.*untested/i);
  assert.equal(f.env.SYNARA_ANTIGRAVITY_HOOK_DECISION, 'ask');
  assert.deepEqual(snapshot(f.root), before);
});

test('malformed capture JSON and hook shapes fail without writes', t => {
  const f = fixture(t);
  const file = path.join(f.home, '.gemini', 'config', 'plugins', 'synara-capture', 'hooks.json');
  for (const body of ['{broken', 'null', '{}', '{"synara-capture":{"PreToolUse":"bad"}}', '{"synara-capture":{"PreToolUse":[{"hooks":[{}]}]}}']) {
    put(file, body);
    const before = snapshot(f.root);
    assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false, body);
    assert.equal(require('./magi-synara-watch.js').inspectHooks(file, f).kind, 'hooks-invalid');
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('conditional capture rejects modified active branches and helpers', t => {
  const f = fixture(t);
  const { hooks, file, helper } = conditionalCapture(f);
  const command = hooks['synara-capture'].PreToolUse[0].hooks[0].command;
  for (const changed of [command.replace('if not defined', 'if defined'), command.replace(' pre-tool)', ' pre-tool & echo {"decision":"ask"})'), command.replace('SYNARA_ANTIGRAVITY_EVENTS', 'OTHER_EVENTS')]) {
    hooks['synara-capture'].PreToolUse[0].hooks[0].command = changed;
    put(file, JSON.stringify(hooks));
    assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false);
  }
  hooks['synara-capture'].PreToolUse[0].hooks[0].command = command;
  put(file, JSON.stringify(hooks));
  put(helper, CAPTURE_HELPER.replace('=== "allow"', '=== "deny"'));
  assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false);
});

test('conditional capture cannot waive an extra ask command or a non-Windows shell', t => {
  const f = fixture(t);
  const { hooks, file } = conditionalCapture(f);
  f.platform = 'linux';
  assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false);
  f.platform = 'win32';
  hooks['synara-capture'].PreToolUse[0].hooks.push({ type: 'command', command: 'echo {"decision":"ask"}' });
  put(file, JSON.stringify(hooks));
  assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false);
});

test('Windows preflight rejects the 22-NUL native sandbox regression without writes', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const state = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  put(state, Buffer.alloc(22));
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /UTF-8 JSON/);
  assert.deepEqual(snapshot(f.root), before);
});

for (const [label, body] of [
  ['empty', ''], ['whitespace only', ' \r\n'], ['truncated', '{"paths":'],
  ['malformed', '{no}'], ['BOM', '\ufeff{}'], ['embedded NUL', '{}\0'],
  ['invalid UTF-8', Buffer.from([0x22, 0xff, 0x22])],
]) {
  test(`Windows preflight rejects ${label} native sandbox state without writes`, t => {
    const f = fixture(t);
    f.platform = 'win32';
    put(path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json'), body);
    const before = snapshot(f.root);
    const result = check(f);
    assert.equal(result.ok, false);
    assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /UTF-8 JSON/);
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('Windows preflight checks JSON syntax without guessing the native state schema', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const file = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  for (const body of ['{}', '{"example":["read path",42,true]}', 'null']) {
    put(file, body);
    const before = snapshot(f.root);
    const result = check(f);
    assert.equal(result.ok, true, JSON.stringify(result));
    const row = result.findings.find(row => row.check === 'sandbox:openai-state');
    assert.equal(row.status, 'syntax-valid');
    assert.match(row.scope, /shell and staged-file access remain untested/);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('absent Windows state is uninitialized and never claims shell readiness', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, true);
  const row = result.findings.find(row => row.check === 'sandbox:openai-state');
  assert.equal(row.status, 'uninitialized');
  assert.match(row.scope, /remain untested/);
  assert.deepEqual(snapshot(f.root), before);
});

test('Windows state uses CODEX_HOME instead of the default home', t => {
  const f = fixture(t);
  f.platform = 'win32';
  f.env.CODEX_HOME = path.join(f.root, 'override');
  const defaultFile = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  const overrideFile = path.join(f.env.CODEX_HOME, '.sandbox', 'deny_read_acl_state.json');
  put(defaultFile, Buffer.alloc(22));
  put(overrideFile, '{}');
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, true);
  assert.equal(result.findings.find(row => row.check === 'sandbox:openai-state').value,
    path.join(fs.realpathSync.native(f.env.CODEX_HOME), '.sandbox', 'deny_read_acl_state.json'));
  assert.deepEqual(snapshot(f.root), before);
  put(defaultFile, '{}');
  put(overrideFile, Buffer.alloc(22));
  assert.equal(check(f).ok, false);
});

test('non-Windows preflight skips corrupt native Windows state', t => {
  const f = fixture(t);
  f.platform = 'linux';
  put(path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json'), Buffer.alloc(22));
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, true);
  assert.equal(result.findings.find(row => row.check === 'sandbox:openai-state').status, 'not-applicable');
  assert.deepEqual(snapshot(f.root), before);
});

test('Windows state rejects directories and files above the bounded read size', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const file = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  fs.mkdirSync(file, { recursive: true });
  let before = snapshot(f.root);
  let result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /regular file/);
  assert.deepEqual(snapshot(f.root), before);
  fs.rmdirSync(file);
  put(file, Buffer.alloc(1024 * 1024 + 1, 0x20));
  before = snapshot(f.root);
  result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /read limit/);
  assert.deepEqual(snapshot(f.root), before);
});

test('Windows state reports unreadable files instead of treating them as absent', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const file = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  put(file, '{}');
  const before = snapshot(f.root);
  const originalOpen = fs.openSync;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    if (target === file) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
    return originalOpen(target, ...args);
  });
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /unreadable.*EACCES/);
  t.mock.restoreAll();
  assert.deepEqual(snapshot(f.root), before);
});

test('empty CODEX_HOME uses the default native home', t => {
  const f = fixture(t);
  f.platform = 'win32';
  f.env.CODEX_HOME = '';
  const file = path.join(f.home, '.codex', '.sandbox', 'deny_read_acl_state.json');
  put(file, Buffer.alloc(22));
  const result = check(f);
  assert.equal(result.ok, false);
  assert.ok(result.findings.find(row => row.check === 'sandbox:openai-state').error.includes(file));
});

test('CODEX_HOME must exist as a directory and cannot silently select an absent state', t => {
  const f = fixture(t);
  f.platform = 'win32';
  f.env.CODEX_HOME = path.join(f.root, 'missing-home');
  let before = snapshot(f.root);
  let result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /Invalid CODEX_HOME.*ENOENT/);
  assert.deepEqual(snapshot(f.root), before);
  put(f.env.CODEX_HOME, '{}');
  before = snapshot(f.root);
  result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /existing directory/);
  assert.deepEqual(snapshot(f.root), before);
});

test('MAGI rejects relative and whitespace CODEX_HOME overrides instead of checking the wrong cwd', t => {
  const f = fixture(t);
  f.platform = 'win32';
  for (const override of ['relative-home', '   ']) {
    f.env.CODEX_HOME = override;
    const before = snapshot(f.root);
    const result = check(f);
    assert.equal(result.ok, false);
    assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /fully qualified CODEX_HOME/);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('CODEX_HOME directory aliases resolve to the native canonical home', t => {
  const f = fixture(t);
  f.platform = 'win32';
  const target = path.join(f.root, 'native-home');
  put(path.join(target, '.sandbox', 'deny_read_acl_state.json'), '{}');
  f.env.CODEX_HOME = path.join(f.root, 'home-alias');
  fs.symlinkSync(target, f.env.CODEX_HOME, 'junction');
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.findings.find(row => row.check === 'sandbox:openai-state').value,
    path.join(fs.realpathSync.native(target), '.sandbox', 'deny_read_acl_state.json'));
  assert.deepEqual(snapshot(f.root), before);
});

test('MAGI rejects Windows drive-root-relative CODEX_HOME even when the directory exists', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  f.platform = 'win32';
  const target = path.join(f.root, 'native-home');
  put(path.join(target, '.sandbox', 'deny_read_acl_state.json'), '{}');
  const rootRelative = target.slice(2);
  for (const override of [rootRelative.replaceAll('/', '\\'), rootRelative.replaceAll('\\', '/')]) {
    f.env.CODEX_HOME = override;
    const before = snapshot(f.root);
    const result = check(f);
    assert.equal(result.ok, false);
    assert.match(result.findings.find(row => row.check === 'sandbox:openai-state').error, /fully qualified CODEX_HOME/);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('PreInvocation accepts neutral output and rejects permission decisions', t => {
  const f = fixture(t);
  const file = path.join(f.home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'hooks.json');
  for (const [command, expected] of [['echo {}', true], ['echo {"decision":"allow"}', false], ['echo {"decision":"ask"}', false]]) {
    put(file, JSON.stringify({'synara-capture': {PreInvocation: [{type: 'command', command}]}}));
    assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, expected, command);
  }
});

test('conditional PreInvocation rejects the previous invalid decision fallback', t => {
  const f = fixture(t);
  const { hooks, file } = conditionalCapture(f);
  hooks['synara-capture'].PreInvocation[0].command = hooks['synara-capture'].PreInvocation[0].command.replace('echo {}', 'echo {"decision":"allow"}');
  put(file, JSON.stringify(hooks));
  assert.equal(check(f).findings.find(row => row.check === 'google:synara-capture').ok, false);
});
