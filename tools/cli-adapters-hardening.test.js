// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { allowedWorkspace, anthropicLaunch, googleLaunch, openaiLaunch } = require('./cli-adapters.js');
const { CLAUDE_RESPONSE_PROTOCOL, CLAUDE_RESPONSE_SCHEMA, validateClaudeResponseLaunch } = require('./vendor-native.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-adapter-'));
  const briefPath = path.join(dir, 'BRIEF.md');
  const seatContractPath = path.join(dir, 'SEAT-CONTRACT.md');
  const skillRoot = path.join(dir, 'skills');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(briefPath, 'ACK test brief\nTask details remain in this file.\n', 'utf8');
  fs.writeFileSync(seatContractPath, 'seat contract', 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, briefPath, seatContractPath, skillRoot };
}

const fakeBins = {
  CONCLAVE_CODEX_BIN: '/opt/conclave/bin/codex',
  CONCLAVE_AGY_BIN: '/opt/conclave/bin/agy',
  CONCLAVE_CLAUDE_BIN: '/opt/conclave/bin/claude',
  CONCLAVE_DEV_ROOT: '/opt/conclave/src',
};

test('workspace authorization is project-root based rather than conclave-repo based', () => {
  assert.strictEqual(allowedWorkspace('/opt/conclave/src/product-a', fakeBins), '/opt/conclave/src/product-a');
  assert.throws(() => allowedWorkspace('/private/elsewhere', fakeBins), /outside CONCLAVE allowed roots/);
});

test('workspace authorization keeps host-native POSIX paths', (t) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-posix-ws-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.strictEqual(allowedWorkspace(root, { CONCLAVE_DEV_ROOT: root }), path.resolve(root));
});

test('OpenAI non-implement roles are read-only while implementer is workspace-write', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gpt-5.6-sol', effort: 'high', capturePath: path.join(f.dir, 'capture.txt'),
    env: fakeBins, mustExistBinary: false,
  };
  for (const role of ['review', 'verify', 'plan', 'research']) assert.ok(openaiLaunch({ ...common, role }).args.includes('read-only'));
  assert.ok(openaiLaunch({ ...common, role: 'implement' }).args.includes('workspace-write'));
});

test('OpenAI checking launches grant each bound evidence directory read access', (t) => {
  const f = fixture(t);
  const evidenceA = path.join(f.dir, 'evidence-a');
  const evidenceB = path.join(f.dir, 'evidence-b');
  fs.mkdirSync(evidenceA);
  fs.mkdirSync(evidenceB);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gpt-5.6-sol', effort: 'high', capturePath: path.join(f.dir, 'capture.txt'),
    env: fakeBins, mustExistBinary: false,
  };
  const launch = openaiLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceA, evidenceB] });
  const profile = launch.args.find(arg => arg.startsWith('permissions.'));
  assert.ok(profile, 'a permissions profile replaces the bare sandbox flag');
  assert.ok(profile.startsWith('permissions.conclave_evidence_read={'), 'whole table replaces inherited named-profile grants');
  assert.match(profile, /extends = ":read-only"/);
  assert.match(profile, /network = \{ enabled = false \}/);
  assert.ok(profile.includes(`${JSON.stringify(launch.evidenceReadDirs[0])} = "read"`), 'first evidence directory is granted read');
  assert.ok(profile.includes(`${JSON.stringify(launch.evidenceReadDirs[1])} = "read"`), 'second evidence directory is granted read');
  assert.ok(!profile.includes('"write"'), 'no write grant without a scratch policy');
  assert.ok(launch.args.includes(`default_permissions=${JSON.stringify('conclave_evidence_read')}`));
  assert.ok(!launch.args.includes('-s'));
  assert.strictEqual(launch.requestedSandbox, 'custom permissions');

  const bare = openaiLaunch({ ...common, role: 'verify' });
  assert.ok(bare.args.includes('-s'), 'a checking seat without evidence keeps the sandbox flag');
  assert.ok(bare.args.includes('read-only'));
  assert.ok(!bare.args.some(arg => arg.startsWith('permissions.')));
  assert.strictEqual(bare.requestedSandbox, 'read-only');
});

test('OpenAI implement launches carry no evidence profile', (t) => {
  const f = fixture(t);
  const launch = openaiLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gpt-5.6-sol', effort: 'high', role: 'implement',
    capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false,
  });
  assert.ok(launch.args.includes('-s'));
  assert.ok(launch.args.includes('workspace-write'));
  assert.ok(!launch.args.some(arg => arg.startsWith('permissions.')));
  assert.strictEqual(launch.requestedSandbox, 'workspace-write');
});

test('OpenAI checking launch with a scratch policy carries both the write grant and evidence read grants', (t) => {
  const f = fixture(t);
  const runDir = path.join(f.dir, 'run');
  const output = path.join(runDir, 'out', 'd1');
  fs.mkdirSync(output, { recursive: true });
  const briefPath = path.join(output, 'BRIEF.md');
  const seatContractPath = path.join(output, 'SEAT-CONTRACT.md');
  fs.writeFileSync(briefPath, 'ACK test brief\nTask details remain in this file.\n', 'utf8');
  fs.writeFileSync(seatContractPath, 'seat contract', 'utf8');
  const evidence = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidence);
  const launch = openaiLaunch({
    briefPath, seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gpt-5.6-sol', effort: 'high', role: 'verify',
    runDir, dispatchId: 'd1', readonlyScratch: true, capturePath: path.join(output, 'capture.txt'),
    evidenceReadDirs: [evidence], env: fakeBins, mustExistBinary: false,
  });
  const profile = launch.args.find(arg => arg.startsWith('permissions.'));
  assert.ok(profile.startsWith('permissions.conclave_readonly_scratch={'), 'the scratch profile name is kept');
  assert.match(profile, /extends = ":read-only"/);
  assert.match(profile, /network = \{ enabled = false \}/);
  assert.strictEqual((profile.match(/"write"/g) || []).length, 1, 'exactly one write grant');
  assert.ok(profile.includes(`${JSON.stringify(launch.scratchPermissions.scratchPath)} = "write"`), 'the scratch write grant survives');
  assert.ok(profile.includes(`${JSON.stringify(launch.evidenceReadDirs[0])} = "read"`), 'the evidence read grant rides the same profile');
  assert.ok(!launch.args.includes('-s'));
});

test('Google and Claude launches are untouched by the OpenAI evidence profile', (t) => {
  const f = fixture(t);
  const evidence = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidence);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', env: fakeBins, mustExistBinary: false,
  };
  const google = googleLaunch({ ...common, model: 'gemini-3.1-pro-high', role: 'verify', evidenceReadDirs: [evidence] });
  assert.ok(google.args.includes('--sandbox'));
  assert.ok(google.args.includes(google.evidenceReadDirs[0]), 'google still grants via --add-dir');
  assert.ok(!google.args.some(arg => String(arg).startsWith('permissions.')));
  const claude = anthropicLaunch({ ...common, model: 'fable', effort: 'xhigh', role: 'verify', evidenceReadDirs: [evidence] });
  assert.ok(claude.args.includes(claude.evidenceReadDirs[0]), 'claude still grants via --add-dir');
  assert.strictEqual(claude.args[claude.args.indexOf('--allowedTools') + 1], 'Read,Glob,Grep');
  assert.ok(!claude.args.some(arg => String(arg).startsWith('permissions.')));
});

test('Google non-implement roles use sandbox while implementer uses write bypass', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', env: fakeBins, home: '/Users/test', mustExistBinary: false,
  };
  for (const role of ['review', 'verify', 'plan', 'research']) assert.ok(googleLaunch({ ...common, role }).args.includes('--sandbox'));
  assert.ok(googleLaunch({ ...common, role: 'implement' }).args.includes('--dangerously-skip-permissions'));
});

test('Claude non-implement roles do not inherit implement bypassPermissions', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh', env: fakeBins, mustExistBinary: false,
  };
  for (const role of ['implement', 'review', 'verify', 'plan', 'research']) {
    const launch = anthropicLaunch({ ...common, role });
    assert.strictEqual(launch.responseProtocol, CLAUDE_RESPONSE_PROTOCOL);
    validateClaudeResponseLaunch(launch);
    assert.deepStrictEqual(JSON.parse(launch.args[launch.args.indexOf('--json-schema') + 1]), CLAUDE_RESPONSE_SCHEMA);
    assert.deepStrictEqual(CLAUDE_RESPONSE_SCHEMA.required, ['response']);
    assert.strictEqual(CLAUDE_RESPONSE_SCHEMA.additionalProperties, false);
    assert.strictEqual(CLAUDE_RESPONSE_SCHEMA.properties.response.type, 'string');
    assert.ok(!JSON.stringify(CLAUDE_RESPONSE_SCHEMA).includes('minLength'));
    assert.strictEqual(launch.permissionMode, role === 'implement' ? 'bypassPermissions' : 'dontAsk');
    assert.ok(launch.args.includes('--safe-mode'), 'global hooks and skills must not override a leaf contract');
    assert.ok(!launch.args.includes('--bare'), 'bare mode disables subscription OAuth');
    assert.ok(!launch.args.includes('--system-prompt'), 'native system controls must remain in place');
    const finalContract = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
    assert.ok(!finalContract.includes('ACK test brief'), 'acknowledgment content stays in the bound brief');
    assert.ok(finalContract.includes("Begin the final response with the brief's exact first line"));
    assert.ok(!finalContract.includes(fs.readFileSync(f.briefPath, 'utf8')), 'the brief body remains on disk');
    assert.ok(!fs.readFileSync(launch.stdinFile, 'utf8').includes('ACK test brief'), 'the pointer carries no brief content');
    assert.ok(!launch.env.ANTHROPIC_API_KEY);
    if (role !== 'implement') {
      // Catches a read-only role regaining the retired --tools restriction (removed 2026-09-19).
      assert.ok(!launch.args.includes('--tools'), 'read-only roles must not carry the retired --tools restriction');
      assert.strictEqual(launch.args[launch.args.indexOf('--allowedTools') + 1], 'Read,Glob,Grep');
      assert.ok(!launch.args.includes('plan'), 'plan mode requires a separate approval turn');
      for (const forbidden of ['bypassPermissions', 'manual', 'auto', 'acceptEdits', 'plan']) assert.throws(() => anthropicLaunch({ ...common, role, reviewPermissionMode: forbidden }), /read-only Claude roles require/);
    }
  }
});

test('every adapter keeps even a single-line brief body out of launch arguments and pointers', (t) => {
  const f = fixture(t);
  const body = 'PRIVATE_BRIEF_CONTENT_727e4df5';
  fs.writeFileSync(f.briefPath, body);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    const launch = build({ ...f, cwd: '/opt/conclave/src/product-a', model: 'fixture', effort: 'high', role: 'implement',
      capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false });
    assert.ok(!launch.args.some(arg => String(arg).includes(body)));
    if (launch.stdinFile) assert.ok(!fs.readFileSync(launch.stdinFile, 'utf8').includes(body));
  }
});

test('Claude pointer and system prompt require a FIRST native Read of the seat contract, not Bash cat', (t) => {
  const f = fixture(t);
  const launch = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh', role: 'implement',
    env: fakeBins, mustExistBinary: false,
  });
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  const system = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
  assert.match(pointer, /FIRST use the Read tool/);
  assert.ok(pointer.includes(f.seatContractPath));
  assert.match(pointer, /Do not cat or Bash instruction files/);
  assert.match(system, /with the Read tool before any task work/);
  assert.match(system, /with the Read tool rather than shell commands/);
  assert.ok(pointer.length <= 2000);
});

test('every adapter requires contract-listed reads before product work and treats missing instructions as blockers', (t) => {
  const f = fixture(t);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    const launch = build({ ...f, cwd: '/opt/conclave/src/product-a', model: 'fixture', effort: 'high', role: 'verify',
      capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false });
    const pointer = launch.stdinFile ? fs.readFileSync(launch.stdinFile, 'utf8') : launch.args[launch.args.indexOf('-p') + 1];
    assert.ok(pointer.includes('Complete every required instruction read in that contract before product work.'));
    assert.ok(pointer.includes('If any required instruction is missing or unreadable, stop and report a blocker.'));
    assert.ok(pointer.length <= 2000);
    if (launch.vendor === 'anthropic') {
      const system = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
      assert.ok(system.includes('Complete every instruction read it lists before product work'));
      // Regression guard: this sentence tripped Opus 5's safeguard classifier on every launch (2026-09-16).
      assert.ok(!/permissions still apply|permissions remain in force/i.test(system));
    }
  }
});

test('oversized seat pointers fail before a pointer file is written', (t) => {
  const f = fixture(t);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    assert.throws(() => build({ ...f, seatContractPath: '/opt/conclave/src/' + 'x'.repeat(2100), cwd: '/opt/conclave/src/product-a',
      model: 'fixture', effort: 'high', role: 'implement', capturePath: path.join(f.dir, 'capture.txt'),
      env: fakeBins, mustExistBinary: false }), /2000-character delivery limit/);
    assert.ok(!fs.existsSync(f.briefPath + '.pointer.md'));
  }
});

test('Google and Claude launchers mount only staged seat skill root, not full global skill tree', (t) => {
  const f = fixture(t);
  const google = googleLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', role: 'research', env: fakeBins, mustExistBinary: false,
  });
  const claude = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh', role: 'review', env: fakeBins, mustExistBinary: false,
  });
  assert.ok(google.args.includes(path.resolve(f.skillRoot)));
  assert.strictEqual(google.args[google.args.indexOf('--log-file') + 1], path.join(f.dir, 'native-cli.log'));
  assert.strictEqual(google.nativeLogPath, path.join(f.dir, 'native-cli.log'));
  assert.ok(claude.args.includes(path.resolve(f.skillRoot)));
  assert.ok(!google.args.includes('/Users/test/.claude/skills'));
});

test('Google launches drop inherited Synara Antigravity capture environment', (t) => {
  const f = fixture(t);
  const launch = googleLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', role: 'research', mustExistBinary: false,
    env: {
      ...fakeBins,
      SYNARA_ANTIGRAVITY_EVENTS: '/tmp/synara-events.ndjson',
      SYNARA_ANTIGRAVITY_HOOK_DECISION: 'ask',
    },
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(launch.env, 'SYNARA_ANTIGRAVITY_EVENTS'));
  assert.ok(!Object.prototype.hasOwnProperty.call(launch.env, 'SYNARA_ANTIGRAVITY_HOOK_DECISION'));
  assert.strictEqual(launch.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
});

test('Google grants both the spelled and resolved form of a symlinked directory, without duplicates', (t) => {
  const f = fixture(t);
  const real = path.join(f.dir, 'real-workspace');
  fs.mkdirSync(real);
  const link = path.join(f.dir, 'linked-workspace');
  fs.symlinkSync(real, link, 'dir');
  const launch = googleLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: link, model: 'gemini-3.1-pro-high', role: 'verify',
    env: { ...fakeBins, CONCLAVE_DEV_ROOT: link }, mustExistBinary: false,
  });
  const grants = [];
  for (let i = 0; i < launch.args.length; i++) if (launch.args[i] === '--add-dir') grants.push(launch.args[i + 1]);
  const resolved = fs.realpathSync(link);
  assert.notStrictEqual(resolved, link);
  assert.ok(grants.includes(link), 'the spelled path is granted');
  assert.ok(grants.includes(resolved), 'the resolved path is granted');
  assert.strictEqual(new Set(grants).size, grants.length, 'no --add-dir value appears twice');
});

test('Claude verify and review launches carry no --tools restriction but stay read-only', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh', env: fakeBins, mustExistBinary: false,
  };
  for (const role of ['verify', 'review']) {
    const launch = anthropicLaunch({ ...common, role });
    assert.ok(!launch.args.includes('--tools'), 'no --tools element at all');
    assert.strictEqual(launch.args[launch.args.indexOf('--allowedTools') + 1], 'Read,Glob,Grep');
    assert.strictEqual(launch.args[launch.args.indexOf('--disallowedTools') + 1], 'Agent,Task');
    assert.strictEqual(launch.permissionMode, 'dontAsk');
  }
});

test('Google checking seats with captured evidence are pointed at it and warned off running commands', (t) => {
  const f = fixture(t);
  const evidenceDir = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', env: fakeBins, mustExistBinary: false,
  };
  const checking = googleLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir] });
  const prompt = checking.args[checking.args.indexOf('-p') + 1];
  assert.ok(prompt.includes(checking.evidenceReadDirs[0]), 'the absolute evidence directory is named');
  assert.ok(prompt.includes('test-output.txt'));
  assert.ok(prompt.includes('diff.txt'));
  assert.match(prompt, /run nothing yourself/);
  assert.ok(prompt.includes('voids your result'), 'the consequence of running a command is stated');

  const implement = googleLaunch({ ...common, role: 'implement' });
  const implementPrompt = implement.args[implement.args.indexOf('-p') + 1];
  assert.ok(!implementPrompt.includes('run nothing yourself'), 'implement seats keep their working pointers');

  const bare = googleLaunch({ ...common, role: 'review' });
  const barePrompt = bare.args[bare.args.indexOf('-p') + 1];
  assert.ok(!barePrompt.includes('run nothing yourself'), 'a checking seat without captured evidence is unchanged');

  for (const build of [openaiLaunch, anthropicLaunch]) {
    const other = build({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir], capturePath: path.join(f.dir, 'capture.txt') });
    const otherPointer = fs.readFileSync(other.stdinFile, 'utf8');
    assert.ok(!otherPointer.includes('run nothing yourself'), `${other.vendor} pointer is unchanged`);
  }
});

test('Google seats get the same explicit first-read recipe the other vendors get', (t) => {
  const f = fixture(t);
  const evidenceDir = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', env: fakeBins, mustExistBinary: false,
  };
  const checking = googleLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir] });
  const prompt = checking.args[checking.args.indexOf('-p') + 1];
  assert.ok(prompt.includes(`FIRST use the view_file tool with AbsolutePath exactly ${f.seatContractPath} and no other tool.`));
  assert.ok(prompt.includes("Then use that contract's exact one-file view_file recipes."));
  assert.ok(prompt.indexOf('FIRST use the view_file tool') < prompt.indexOf('Only after every required instruction read is complete'),
    'the recipe leads the pointer; the evidence note stays at the end');

  // dispatch-run.js runs verifyInstructionReadEvidence on every dispatch with no role
  // branch, so builders face the same gate and need the same recipe.
  const implement = googleLaunch({ ...common, role: 'implement' });
  const implementPrompt = implement.args[implement.args.indexOf('-p') + 1];
  assert.ok(implementPrompt.includes(`FIRST use the view_file tool with AbsolutePath exactly ${f.seatContractPath} and no other tool.`));

  const openai = openaiLaunch({ ...common, role: 'verify', effort: 'high', capturePath: path.join(f.dir, 'capture.txt') });
  assert.ok(fs.readFileSync(openai.stdinFile, 'utf8').includes('FIRST use the exec code tool with exactly this JavaScript:'), 'openai recipe is unchanged');
  const claude = anthropicLaunch({ ...common, role: 'verify', effort: 'xhigh', capturePath: path.join(f.dir, 'capture.txt') });
  assert.ok(fs.readFileSync(claude.stdinFile, 'utf8').includes('FIRST use the Read tool with file_path exactly'), 'anthropic recipe is unchanged');
});

test('Google checking pointer with evidence wording stays within the 2000-character limit', (t) => {
  const f = fixture(t);
  const long = 'segment-' + 'x'.repeat(24);
  const briefDir = path.join(f.dir, long, long);
  fs.mkdirSync(briefDir, { recursive: true });
  const briefPath = path.join(briefDir, 'BRIEF.md');
  const seatContractPath = path.join(briefDir, 'SEAT-CONTRACT.md');
  fs.writeFileSync(briefPath, 'ACK test brief\nTask details remain in this file.\n', 'utf8');
  fs.writeFileSync(seatContractPath, 'seat contract', 'utf8');
  const launch = googleLaunch({
    briefPath, seatContractPath, skillRoot: f.skillRoot,
    cwd: path.join('/opt/conclave/src', long, 'worktree'),
    model: 'gemini-3.1-pro-high', role: 'review',
    evidenceReadDirs: [path.join('/opt/conclave/runs', long, 'out', long)],
    env: fakeBins, mustExistBinary: false,
  });
  const prompt = launch.args[launch.args.indexOf('-p') + 1];
  assert.ok(prompt.length <= 2000);
  assert.ok(prompt.indexOf('FIRST use the view_file tool') < prompt.indexOf('Only after every required instruction read is complete'),
    'the recipe leads and the evidence note trails even with long absolute paths');
});

// The general shape of "do not run anything": a run/execute verb under a negation, or a
// run verb applied to nothing. Derived from what seatPointerText emits today ("Read those
// files and run nothing yourself; ..."), but deliberately not that literal sentence, so a
// reworded vendor-neutral prohibition still fails these tests. The negation must sit
// immediately before the verb, so legitimate pointer wording ("Do not read global skills
// or use other tools", "FIRST use the exec code tool") cannot satisfy it by accident.
const COMMAND_PROHIBITION = /\b(?:run|execute|invoke|launch)\s+(?:nothing|no\b|not\b)|\b(?:do not|don't|never|must not|avoid|refrain from|without)\s+(?:run|running|execute|executing|invoke|invoking|launch|launching)\b/i;

test('the run-nothing evidence note is emitted only for Google checking seats with captured evidence', (t) => {
  const f = fixture(t);
  const evidenceDir = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gemini-3.1-pro-high', env: fakeBins, mustExistBinary: false,
  };
  // agy declines a headless command without a prompt and reports success, so this seat
  // must be told to judge from host-captured evidence and run nothing (2026-09-19).
  const checking = googleLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir] });
  const prompt = checking.args[checking.args.indexOf('-p') + 1];
  assert.ok(prompt.includes(evidenceDir), 'the evidence directory is named');
  assert.ok(prompt.includes('test-output.txt') && prompt.includes('diff.txt'), 'the captured evidence files are named');
  assert.match(prompt, COMMAND_PROHIBITION, 'the google checking seat is told not to run anything');
});

test('the run-nothing evidence note never reaches an OpenAI checking seat', (t) => {
  const f = fixture(t);
  const evidenceDir = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'gpt-5.6-sol', effort: 'high',
    capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false,
  };
  // Reason this pin exists: on 2026-09-19 an OpenAI verify seat read a vendor-neutral
  // run-nothing note as a ban on its exec tool - which IS its file-read mechanism - and
  // abstained without inspecting anything, blocking the unit from quorum. A vendor-neutral
  // note silently disables this seat, so this test must keep failing any such change.
  const launch = openaiLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir] });
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  assert.ok(!COMMAND_PROHIBITION.test(pointer), 'no instruction forbidding commands reaches the OpenAI seat');
  assert.ok(pointer.includes('FIRST use the exec code tool'), 'the exec read mechanism instruction survives');

  // Teeth check: the same matcher must catch the note the product emits for google today,
  // so the assertion above cannot pass vacuously through an over-narrow pattern.
  const google = googleLaunch({ ...common, model: 'gemini-3.1-pro-high', role: 'verify', evidenceReadDirs: [evidenceDir] });
  assert.match(google.args[google.args.indexOf('-p') + 1], COMMAND_PROHIBITION);
});

test('the run-nothing evidence note never reaches an Anthropic checking seat', (t) => {
  const f = fixture(t);
  const evidenceDir = path.join(f.dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh',
    capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false,
  };
  // Claude reads with the Read tool, so the note would not break it, but the pinned rule
  // is that the note is scoped to the one vendor that requires it (google). The same
  // 2026-09-19 abstention is what a vendor-neutral wording would risk elsewhere.
  const launch = anthropicLaunch({ ...common, role: 'verify', evidenceReadDirs: [evidenceDir] });
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  assert.ok(!COMMAND_PROHIBITION.test(pointer), 'no instruction forbidding commands reaches the Anthropic seat');

  const google = googleLaunch({ ...common, model: 'gemini-3.1-pro-high', role: 'verify', evidenceReadDirs: [evidenceDir] });
  assert.match(google.args[google.args.indexOf('-p') + 1], COMMAND_PROHIBITION, 'the matcher still has teeth');
});

test('Claude implement launch is unchanged: bypassPermissions and no tool restriction', (t) => {
  const f = fixture(t);
  const launch = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: '/opt/conclave/src/product-a', model: 'fable', effort: 'xhigh', role: 'implement',
    env: fakeBins, mustExistBinary: false,
  });
  assert.ok(!launch.args.includes('--allowedTools'));
  assert.ok(!launch.args.includes('--tools'));
  assert.strictEqual(launch.permissionMode, 'bypassPermissions');
  assert.strictEqual(launch.args[launch.args.indexOf('--permission-mode') + 1], 'bypassPermissions');
});
