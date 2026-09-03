'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const launcherPath = path.join(__dirname, 'cli-launch.js');

test('buildCodexLaunch sends a short disk pointer through stdin', (t) => {
  const { buildCodexLaunch } = require('./cli-launch.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-cli-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const briefPath = path.join(directory, 'brief.md');
  const briefBody = Array.from(
    { length: 5000 },
    (_, index) => String.fromCharCode(0x1000 + index),
  ).join('');
  fs.writeFileSync(briefPath, briefBody, 'utf8');

  const launch = buildCodexLaunch({
    brief: briefPath,
    cwd: 'C:\\src\\magi',
    capture: 'C:\\tmp\\capture.txt',
  });
  const resolvedBriefPath = path.resolve(briefPath);
  const pointerFile = `${resolvedBriefPath}.pointer.md`;
  const pointer = fs.readFileSync(pointerFile, 'utf8');

  assert.strictEqual(launch.binary, 'C:\\Users\\YESSIR\\tools\\bin\\codex.exe');
  assert.strictEqual(launch.delivery, 'pointer');
  assert.strictEqual(launch.briefPath, resolvedBriefPath);
  assert.strictEqual(launch.pointerFile, pointerFile);
  assert.strictEqual(launch.stdinFile, pointerFile);
  assert.strictEqual(launch.bytes, Buffer.byteLength(briefBody, 'utf8'));
  assert.match(pointer, new RegExp(resolvedBriefPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(pointer, /Bytes: \d+/);
  assert.match(pointer, /SHA-256: [a-f0-9]{64}/);
  assert.ok(!pointer.includes(briefBody));
  assert.deepStrictEqual(launch.args, [
    'exec',
    '--skip-git-repo-check',
    '-s', 'workspace-write',
    '-m', 'gpt-5.6-sol',
    '-c', 'model_reasoning_effort=high',
    '-c', 'memories.use_memories=false',
    '-c', 'memories.generate_memories=false',
    '-C', 'C:\\src\\magi',
    '-o', 'C:\\tmp\\capture.txt',
    '-',
  ]);
  assert.strictEqual(launch.args.at(-1), '-');
  assert.ok(!launch.args.includes(briefBody));
});

test('buildCodexLaunch rejects a missing brief as an argument error', () => {
  const { buildCodexLaunch } = require('./cli-launch.js');

  assert.throws(
    () => buildCodexLaunch({
      brief: path.join(os.tmpdir(), 'magi-cli-launch-missing-brief.md'),
      cwd: 'C:\\src\\magi',
      capture: 'C:\\tmp\\capture.txt',
    }),
    (error) => error.code === 'ARGUMENT_ERROR',
  );
});

function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write(chunk) { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

test('runChild records the spawned PID and writes the requested pid file', async (t) => {
  const { runChild } = require('./cli-launch.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-cli-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const pidFile = path.join(directory, 'child.pid');
  const child = fakeChild(24680);
  const launch = { binary: 'vendor.exe', args: [] };
  const output = captureIo();

  const result = runChild(launch, output.io, false, {
    pidFile,
    vendor: 'google',
    spawnFn() {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
    loadIdleDecide() { return null; },
  });

  assert.strictEqual(await result, 0);
  assert.strictEqual(launch.pid, 24680);
  assert.strictEqual(fs.readFileSync(pidFile, 'utf8'), '24680\n');
});

test('runChild kills only the recorded PID when cli-idle decides idle-stdio', async () => {
  const { runChild } = require('./cli-launch.js');
  const child = fakeChild(13579);
  const launch = { binary: 'codex.exe', args: [], requestedSandbox: 'workspace-write' };
  const output = captureIo();
  let tick;
  let killedPid;
  let sample;

  const result = runChild(
    launch,
    output.io,
    false,
    {
      vendor: 'openai',
      now: () => 1000,
      decide(value) {
        sample = value;
        return { action: 'kill', reason: 'idle-stdio', killMethod: 'pid-only' };
      },
      spawnFn() { return child; },
      setInterval(callback, milliseconds) {
        assert.strictEqual(milliseconds, 1000);
        tick = callback;
        return 99;
      },
      clearInterval() {},
      kill(pid) { killedPid = pid; },
    },
  );

  tick();

  assert.strictEqual(await result, 1);
  assert.strictEqual(launch.pid, 13579);
  assert.strictEqual(killedPid, 13579);
  assert.strictEqual(sample.vendor, 'openai');
  assert.strictEqual(sample.cpuMs, null);
  assert.strictEqual(output.stderr(), 'IDLE_KILLED pid=13579 reason=idle-stdio\n');
});

test('runChild keeps the Codex sandbox wedge kill on the recorded PID', async () => {
  const { runChild } = require('./cli-launch.js');
  const child = fakeChild(11223);
  const output = captureIo();
  let killedPid;

  const result = runChild(
    { binary: 'codex.exe', args: [], requestedSandbox: 'workspace-write' },
    output.io,
    true,
    {
      vendor: 'openai',
      spawnFn() { return child; },
      loadIdleDecide() { return null; },
      kill(pid) { killedPid = pid; },
    },
  );

  child.stderr.write([
    'OpenAI Codex v0.146.1',
    '--------',
    'sandbox: read-only',
    '--------',
    '',
  ].join('\n'));
  child.emit('close', null);

  assert.strictEqual(await result, 1);
  assert.strictEqual(killedPid, 11223);
  assert.strictEqual(
    output.stderr(),
    [
      'OpenAI Codex v0.146.1',
      '--------',
      'sandbox: read-only',
      '--------',
      'WEDGE: requested sandbox workspace-write, got read-only',
      '',
    ].join('\n'),
  );
});

test('runChild ignores sandbox-like text after the Codex banner header', async () => {
  const { runChild } = require('./cli-launch.js');
  const child = fakeChild(11224);
  const output = captureIo();
  let killedPid;

  const result = runChild(
    { binary: 'codex.exe', args: [], requestedSandbox: 'workspace-write' },
    output.io,
    true,
    {
      vendor: 'openai',
      spawnFn() { return child; },
      loadIdleDecide() { return null; },
      kill(pid) { killedPid = pid; },
    },
  );

  child.stderr.write([
    'OpenAI Codex v0.146.1',
    '--------',
    'sandbox: workspace-write [workdir, /tmp, $TMPDIR]',
    'session id: 01a12345-6789-abcd-ef01-23456789abcd',
    '--------',
    'const launch = {',
    '  sandbox: actualSandbox,',
    '};',
    'tokens used',
    '99',
    '',
  ].join('\n'));
  child.emit('close', 0);

  assert.strictEqual(await result, 0);
  assert.strictEqual(killedPid, undefined);
  assert.match(output.stdout(), /CODEX_PROOF session id: .*; tokens used: 99/);
  assert.doesNotMatch(output.stderr(), /WEDGE:/);
});

test('runChild does not pipe a brief when the vendor ignores stdin', async () => {
  const { runChild } = require('./cli-launch.js');
  const child = fakeChild(97531);
  child.stdin = null;
  const output = captureIo();
  let spawnOptions;

  const result = runChild(
    {
      binary: 'agy.exe',
      args: ['-p', 'brief already buffered in argv'],
      stdinFile: 'C:\\path\\that-must-not-be-read.md',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    output.io,
    false,
    {
      vendor: 'google',
      spawnFn(binary, args, options) {
        spawnOptions = options;
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
      loadIdleDecide() { return null; },
    },
  );

  assert.strictEqual(await result, 0);
  assert.deepStrictEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe']);
});

test('runChild lets a silent buffered vendor continue below the wall limit', async () => {
  const { runChild } = require('./cli-launch.js');
  const child = fakeChild(86420);
  child.stdin = null;
  const output = captureIo();
  const times = [0, 2000];
  let tick;
  let killedPid;

  const result = runChild(
    { binary: 'agy.exe', args: [], stdio: ['ignore', 'pipe', 'pipe'] },
    output.io,
    false,
    {
      vendor: 'google',
      now: () => times.shift(),
      maxWallMs: 5000,
      idleStdioMs: 1000,
      idleCpuMs: 1000,
      spawnFn() { return child; },
      setInterval(callback) {
        tick = callback;
        return 77;
      },
      clearInterval() {},
      kill(pid) { killedPid = pid; },
    },
  );

  tick();
  child.emit('close', 0);

  assert.strictEqual(await result, 0);
  assert.strictEqual(killedPid, undefined);
  assert.strictEqual(output.stderr(), '');
});

test('parseArgs maps PID and idle-watch flags with documented defaults', () => {
  const { parseArgs } = require('./cli-launch.js');

  assert.deepStrictEqual(parseArgs([]), {
    vendor: 'openai',
    dryRun: false,
    help: false,
    pollMs: 1000,
    maxWallMs: 2700000,
    idleStdioMs: 180000,
    idleCpuMs: 180000,
  });
  assert.deepStrictEqual(
    parseArgs([
      '--pid-file', 'C:\\tmp\\child.pid',
      '--poll-ms', '25',
      '--max-wall-ms', '50',
      '--idle-stdio-ms', '75',
      '--idle-cpu-ms', '100',
    ]),
    {
      vendor: 'openai',
      dryRun: false,
      help: false,
      pidFile: 'C:\\tmp\\child.pid',
      pollMs: 25,
      maxWallMs: 50,
      idleStdioMs: 75,
      idleCpuMs: 100,
    },
  );
});

test('parseCodexLog accepts matching sandbox and complete proof', () => {
  const { parseCodexLog } = require('./cli-launch.js');
  const log = [
    'OpenAI Codex v0.146.1',
    '--------',
    'sandbox: workspace-write [workdir, /tmp, $TMPDIR]',
    'session id: 01a12345-6789-abcd-ef01-23456789abcd',
    '--------',
    'const launch = {',
    '  sandbox: actualSandbox,',
    '};',
    'tokens used',
    '12,345',
  ].join('\r\n');

  assert.deepStrictEqual(parseCodexLog(log, 'workspace-write'), {
    ok: true,
    sandbox: 'workspace-write',
    sessionId: '01a12345-6789-abcd-ef01-23456789abcd',
    tokensUsed: 12345,
  });
});

test('parseCodexLog rejects a read-only sandbox as WEDGE', () => {
  const { parseCodexLog } = require('./cli-launch.js');
  const log = [
    'sandbox: read-only',
    'session id: 01a12345-6789-abcd-ef01-23456789abcd',
    'tokens used: 42',
  ].join('\n');

  assert.deepStrictEqual(parseCodexLog(log, 'workspace-write'), {
    ok: false,
    code: 'WEDGE',
    requestedSandbox: 'workspace-write',
    actualSandbox: 'read-only',
  });
});

test('parseCodexLog fails when vendor-native proof is incomplete', () => {
  const { parseCodexLog } = require('./cli-launch.js');

  assert.deepStrictEqual(
    parseCodexLog('sandbox: workspace-write\nsession id: abc', 'workspace-write'),
    { ok: false, code: 'PROOF_MISSING', missing: ['tokens used'] },
  );
  assert.deepStrictEqual(
    parseCodexLog('sandbox: workspace-write\ntokens used\n9', 'workspace-write'),
    { ok: false, code: 'PROOF_MISSING', missing: ['session id'] },
  );
});

test('loadVendorModule reports MODULE_MISSING for an absent sibling', () => {
  const { loadVendorModule } = require('./cli-launch.js');
  const missing = new Error('not found');
  missing.code = 'MODULE_NOT_FOUND';

  assert.throws(
    () => loadVendorModule('anthropic', () => { throw missing; }),
    (error) => error.code === 'MODULE_MISSING' && error.vendor === 'anthropic',
  );
});

test('CLI exits 2 with MODULE_MISSING when a requested sibling is absent', async () => {
  const { main } = require('./cli-launch.js');
  let stderr = '';
  const io = {
    stdout: { write() {} },
    stderr: { write(chunk) { stderr += chunk; } },
  };
  const missing = new Error('./cli-gemini.js is required for --vendor google');
  missing.code = 'MODULE_MISSING';

  const code = await main(
    ['--vendor', 'google', '--brief', 'unused'],
    io,
    { loadVendorModule() { throw missing; } },
  );

  assert.strictEqual(code, 2);
  assert.match(stderr, /^MODULE_MISSING:/);
});

test('CLI delegates anthropic dry-runs to the sibling buildLaunch export', async () => {
  const { main } = require('./cli-launch.js');
  let stdout = '';
  let received;
  const io = {
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write() {} },
  };
  const sibling = {
    buildLaunch(options) {
      received = options;
      return { binary: 'claude.exe', args: ['-p'], stdinFile: options.briefPath };
    },
  };

  const code = await main(
    [
      '--vendor', 'anthropic',
      '--brief', 'C:\\tmp\\brief.md',
      '--cwd', 'C:\\src\\magi',
      '--model', 'fable',
      '--effort', 'xhigh',
      '--dry-run',
    ],
    io,
    { loadVendorModule() { return sibling; } },
  );

  assert.strictEqual(code, 0);
  assert.deepStrictEqual(received, {
    briefPath: 'C:\\tmp\\brief.md',
    model: 'fable',
    effort: 'xhigh',
    cwd: 'C:\\src\\magi',
  });
  assert.strictEqual(JSON.parse(stdout).stdinFile, 'C:\\tmp\\brief.md');
});

test('CLI passes cwd to a sibling buildArgs export', async (t) => {
  const { main } = require('./cli-launch.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-cli-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, 'test brief', 'utf8');
  let received;
  const io = {
    stdout: { write() {} },
    stderr: { write() {} },
  };
  const sibling = {
    buildArgs(...args) {
      received = args;
      return { binary: 'vendor.exe', args: [] };
    },
  };

  const code = await main(
    [
      '--vendor', 'google',
      '--brief', briefPath,
      '--cwd', directory,
      '--model', 'gemini-test',
      '--dry-run',
    ],
    io,
    { loadVendorModule() { return sibling; } },
  );

  assert.strictEqual(code, 0);
  assert.deepStrictEqual(received, ['test brief', 'gemini-test', { cwd: directory }]);
});

test('CLI uses sibling env and falls back to the requested cwd', async () => {
  const { main } = require('./cli-launch.js');
  const child = fakeChild();
  const env = { TEST_VENDOR_ENV: 'kept' };
  let spawnOptions;
  const output = captureIo();

  const result = main(
    [
      '--vendor', 'anthropic',
      '--brief', 'brief.md',
      '--cwd', 'C:\\src\\requested',
    ],
    output.io,
    {
      loadVendorModule() {
        return {
          buildLaunch() {
            return { binary: 'vendor.exe', args: [], env };
          },
        };
      },
      spawnFn(binary, args, options) {
        spawnOptions = options;
        queueMicrotask(() => child.emit('close', 0));
        return child;
      },
      loadIdleDecide() { return null; },
    },
  );

  assert.strictEqual(await result, 0);
  assert.strictEqual(spawnOptions.cwd, 'C:\\src\\requested');
  assert.strictEqual(spawnOptions.env, env);
});

test('google dry-run uses the sibling model flag without spawning a vendor', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-cli-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, 'consumer dry-run brief', 'utf8');

  const result = spawnSync(process.execPath, [
    launcherPath,
    '--vendor', 'google',
    '--brief', briefPath,
    '--cwd', directory,
    '--model', 'gemini-3.1-pro-high',
    '--dry-run',
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 0, result.stderr);
  const launch = JSON.parse(result.stdout);
  assert.ok(launch.args.includes('--model'));
  assert.ok(!launch.args.includes('-m'));
  assert.ok(launch.args.includes(directory));
});

test('CLI dry-run prints pointer delivery without spawning Codex', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-cli-launch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, 'dry-run brief', 'utf8');

  const result = spawnSync(process.execPath, [
    launcherPath,
    '--vendor', 'openai',
    '--brief', briefPath,
    '--cwd', 'C:\\src\\magi',
    '--capture', 'C:\\tmp\\capture.txt',
    '--dry-run',
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 0, result.stderr);
  const launch = JSON.parse(result.stdout);
  assert.strictEqual(launch.binary, 'C:\\Users\\YESSIR\\tools\\bin\\codex.exe');
  assert.strictEqual(launch.delivery, 'pointer');
  assert.strictEqual(launch.briefPath, path.resolve(briefPath));
  assert.strictEqual(launch.pointerFile, `${path.resolve(briefPath)}.pointer.md`);
  assert.strictEqual(launch.stdinFile, launch.pointerFile);
  assert.strictEqual(launch.bytes, Buffer.byteLength('dry-run brief'));
  assert.strictEqual(launch.args.at(-1), '-');
  assert.ok(launch.args.includes('memories.use_memories=false'));
  assert.ok(launch.args.includes('memories.generate_memories=false'));
});
