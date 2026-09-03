'use strict';

// Tests for tools/cli-claude.js - the MAGI Claude CLI capture-health recipe.
//
// Launch shape: buildLaunch encodes the MEASURED 2026-09-02 write dispatch
// (PID recorded, files landed):
//   claude.exe -p --model fable --effort xhigh
//     --permission-mode bypassPermissions --add-dir C:\src\magi
//     --output-format text
// with one change (owner, 2026-09-02): the brief BODY never rides stdin or
// argv. buildLaunch writes `<brief>.pointer.md` beside the brief
// (tools/cli-pointer.js) and pipes only that short path+bytes+hash pointer;
// the model Reads the brief file itself through a second --add-dir naming the
// brief's parent, which must sit under C:\src\magi or the magi-bus temp root.
// The bypass is pre-authorized for MAGI implement writes under C:\src\magi
// ONLY, so buildLaunch still refuses an --add-dir cwd outside that root.
//
// Capture health: the 2026-09-02 kill at 31 minutes of 0-byte capture was a
// FALSE HANG - `claude -p` buffers stdout until exit, so a healthy fable/xhigh
// implement runs for ~30 minutes with a 0-byte capture. These tests encode the
// corrected law: 0 bytes on a RUNNING child is OK at any elapsed time; 0 bytes
// AFTER exit (including an idle-watch kill at the 20-minute limit) is
// EMPTY_CAPTURE / FAIL, and files landing never rescues it.
// No test spends a -p model call; the only spawn is `claude.exe --help`,
// skipped when the binary is absent.

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const {
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
} = require('./cli-claude.js');

// Temp briefs live in the two sanctioned zones only; everything created here
// is removed by the after() hook, pointer files included (rmSync recursive).
const cleanupDirs = [];

function makeTempDir(zoneRoot) {
  fs.mkdirSync(zoneRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(zoneRoot, 'cli-claude-test-'));
  cleanupDirs.push(dir);
  return dir;
}

function makeBrief(dir, body, name = 'brief.md') {
  const briefPath = path.join(dir, name);
  fs.writeFileSync(briefPath, body, 'utf8');
  return briefPath;
}

const BODY_NEEDLE = 'BODY-NEEDLE-8c41-NEVER-INLINE';

// Exactly 5000 ASCII chars (= 5000 bytes), needle included: big enough that
// leaking it into argv or the stdin pointer would be unmistakable.
function makeFiveThousandCharBody() {
  let body = 'MARK-CLI-CLAUDE-TEST-BRIEF\n';
  while (body.length < 5000) body += `${BODY_NEEDLE} filler line for the pointer contract test\n`;
  return body.slice(0, 5000);
}

const busTempDir = makeTempDir(MAGI_BUS_ROOT);
const repoTempDir = makeTempDir(path.join(MAGI_ROOT, 'tools'));
const sharedBrief = makeBrief(busTempDir, 'shared brief body for option tests\n', 'shared.md');

after(() => {
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('constants: binary path, cursor-cli overlay defaults, idle limit, magi + bus roots', () => {
  assert.strictEqual(CLAUDE_BIN, 'C:\\Users\\YESSIR\\.local\\bin\\claude.exe');
  assert.strictEqual(DEFAULT_MODEL, 'fable');
  assert.strictEqual(DEFAULT_EFFORT, 'xhigh');
  assert.strictEqual(IDLE_LIMIT_MS, 20 * 60 * 1000);
  assert.strictEqual(MAGI_ROOT, 'C:\\src\\magi');
  assert.strictEqual(MAGI_BUS_ROOT, 'C:\\Users\\YESSIR\\AppData\\Local\\Temp\\magi-bus');
  assert.deepStrictEqual(CLAUDE_EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.ok(AUTH_NEEDLES.length >= 3);
});

test('buildLaunch: default args are the measured write dispatch, pointer (not body) via stdin', () => {
  const briefPath = makeBrief(busTempDir, makeFiveThousandCharBody(), 'measured.md');
  const launch = buildLaunch({ briefPath });
  assert.strictEqual(launch.binary, CLAUDE_BIN);
  assert.deepStrictEqual(launch.args, [
    '-p',
    '--model', 'fable',
    '--effort', 'xhigh',
    '--permission-mode', 'bypassPermissions',
    '--add-dir', 'C:\\src\\magi',
    '--add-dir', busTempDir,
    '--output-format', 'text',
  ]);
  assert.strictEqual(launch.stdinFile, `${briefPath}.pointer.md`);
  assert.deepStrictEqual(launch.stdio, ['pipe', 'pipe', 'pipe']);
});

test('buildLaunch: stdinFile content is the exact cli-pointer contract line', () => {
  const body = makeFiveThousandCharBody();
  const briefPath = makeBrief(busTempDir, body, 'pointer-contract.md');
  const launch = buildLaunch({ briefPath });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(briefPath)).digest('hex');
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  assert.strictEqual(
    pointer,
    `Read ${briefPath} in full. Bytes: 5000. SHA-256: ${sha}. ` +
      'Follow it. Repeat its first line verbatim before anything else.\n'
  );
  // The pointer is SHORT and closes: it never carries the body.
  assert.ok(pointer.length < 300, `pointer must stay short, got ${pointer.length} chars`);
  assert.ok(!pointer.includes(BODY_NEEDLE), 'pointer must not contain the brief body');
});

test('buildLaunch: args never contain the brief body - payload travels as a file', () => {
  const body = makeFiveThousandCharBody();
  const briefPath = makeBrief(busTempDir, body, 'no-inline.md');
  const launch = buildLaunch({ briefPath });
  for (const arg of launch.args) {
    assert.ok(!arg.includes(BODY_NEEDLE), `arg must not carry body bytes: ${arg.slice(0, 60)}`);
  }
  assert.ok(!launch.args.join(' ').includes(body));
});

test('buildLaunch: first --add-dir is the magi root, second is the brief parent', () => {
  const briefPath = makeBrief(busTempDir, makeFiveThousandCharBody(), 'add-dirs.md');
  const launch = buildLaunch({ briefPath });
  const first = launch.args.indexOf('--add-dir');
  assert.notStrictEqual(first, -1);
  assert.strictEqual(launch.args[first + 1], MAGI_ROOT);
  const second = launch.args.indexOf('--add-dir', first + 2);
  assert.notStrictEqual(second, -1);
  assert.strictEqual(launch.args[second + 1], busTempDir);
});

test('buildLaunch: a brief under the repo also gets its parent as a second --add-dir', () => {
  const briefPath = makeBrief(repoTempDir, 'repo-zone brief body\n');
  const launch = buildLaunch({ briefPath });
  const first = launch.args.indexOf('--add-dir');
  assert.strictEqual(launch.args[first + 1], MAGI_ROOT);
  const second = launch.args.indexOf('--add-dir', first + 2);
  assert.strictEqual(launch.args[second + 1], repoTempDir);
});

test('buildLaunch: brief parent equal to the cwd --add-dir is not duplicated', () => {
  const briefPath = makeBrief(repoTempDir, 'dedupe brief body\n', 'dedupe.md');
  const launch = buildLaunch({ briefPath, cwd: repoTempDir });
  const occurrences = launch.args.filter((a) => a === '--add-dir').length;
  assert.strictEqual(occurrences, 1);
  assert.strictEqual(launch.args[launch.args.indexOf('--add-dir') + 1], repoTempDir);
});

test('buildLaunch: brief parents outside repo and magi-bus are refused', () => {
  for (const briefPath of [
    'C:\\Users\\YESSIR\\Desktop\\brief.md',
    'C:\\Users\\brief.md',
    'C:\\brief.md',
    path.join(os.tmpdir(), 'brief.md'), // plain temp, not the bus
    `${MAGI_BUS_ROOT}-evil\\brief.md`, // prefix trap on the bus root
    'C:\\src\\magistrate\\brief.md', // prefix trap on the repo root
    `${MAGI_BUS_ROOT}\\..\\brief.md`, // traversal back out of the bus
  ]) {
    assert.throws(
      () => buildLaunch({ briefPath }),
      /outside the pointer zones/,
      `brief ${briefPath} must be refused`
    );
  }
});

test('buildLaunch: a missing brief in a valid zone throws instead of pointing at nothing', () => {
  assert.throws(() => buildLaunch({ briefPath: path.join(busTempDir, 'missing.md') }), /ENOENT/);
});

test('buildLaunch: a refused launch writes no pointer file', () => {
  const briefPath = makeBrief(busTempDir, 'refused launch body\n', 'refused.md');
  assert.throws(() => buildLaunch({ briefPath, continue: true }), /fresh run/);
  assert.ok(!fs.existsSync(`${briefPath}.pointer.md`), 'pointer must not exist after a refusal');
});

test('buildLaunch: --add-dir carries opts.cwd, resolved, when given', () => {
  const launch = buildLaunch({ briefPath: sharedBrief, cwd: 'C:\\src\\magi\\out' });
  const i = launch.args.indexOf('--add-dir');
  assert.notStrictEqual(i, -1);
  assert.strictEqual(launch.args[i + 1], 'C:\\src\\magi\\out');
});

test('buildLaunch: --add-dir cwd outside C:\\src\\magi is refused - bypass is scoped', () => {
  for (const cwd of [
    'C:\\src\\signal-sim',
    'C:\\src\\magi\\..\\signal-sim',
    'C:\\src\\magistrate', // prefix trap: starts with the root's characters
    'C:\\',
    'C:\\Users\\YESSIR',
  ]) {
    assert.throws(
      () => buildLaunch({ briefPath: sharedBrief, cwd }),
      /pre-authorized under C:\\src\\magi only/,
      `cwd ${cwd} must be refused`
    );
  }
});

test('buildLaunch: --add-dir accepts the root case-insensitively and after traversal back in', () => {
  for (const cwd of ['c:\\SRC\\magi', 'C:\\src\\magi\\', 'C:\\src\\magi\\out\\..']) {
    const launch = buildLaunch({ briefPath: sharedBrief, cwd });
    assert.ok(launch.args.includes('--add-dir'), `cwd ${cwd} must be dispatchable`);
  }
});

test('buildLaunch: permission mode is the measured --permission-mode, never the dangerous flag', () => {
  const launch = buildLaunch({ briefPath: sharedBrief });
  const i = launch.args.indexOf('--permission-mode');
  assert.notStrictEqual(i, -1);
  assert.strictEqual(launch.args[i + 1], 'bypassPermissions');
  assert.ok(!launch.args.includes('--dangerously-skip-permissions'));
});

test('buildLaunch: retired bypassPermissions option throws instead of drifting silently', () => {
  // Old contract: default = no bypass, bypassPermissions:true = dangerous flag.
  // New contract: --permission-mode bypassPermissions is always on (pre-authorized).
  // A caller still passing the old option - either value - gets a loud error,
  // never a silently different permission semantic.
  assert.throws(() => buildLaunch({ briefPath: sharedBrief, bypassPermissions: true }), /retired/);
  assert.throws(() => buildLaunch({ briefPath: sharedBrief, bypassPermissions: false }), /retired/);
});

test('buildLaunch: fresh run - no --continue / --resume, ever', () => {
  const launch = buildLaunch({ briefPath: sharedBrief, model: 'fable', effort: 'xhigh' });
  for (const banned of ['--continue', '--resume', '-c', '-r']) {
    assert.ok(!launch.args.includes(banned), `args must not include ${banned}`);
  }
  assert.throws(() => buildLaunch({ briefPath: sharedBrief, continue: true }), /fresh run/);
  assert.throws(() => buildLaunch({ briefPath: sharedBrief, resume: 'abc123' }), /fresh run/);
});

test('buildLaunch: rejects effort "extra" - not a Claude Code level', () => {
  assert.throws(
    () => buildLaunch({ briefPath: sharedBrief, effort: 'extra' }),
    /not a Claude Code effort/
  );
});

test('buildLaunch: omitted effort lands on xhigh, never defaults to max', () => {
  const launch = buildLaunch({ briefPath: sharedBrief });
  assert.ok(launch.args.includes('xhigh'));
  assert.ok(!launch.args.includes('max'));
});

test('buildLaunch: accepts every documented Claude Code effort level', () => {
  for (const effort of CLAUDE_EFFORTS) {
    const launch = buildLaunch({ briefPath: sharedBrief, effort });
    assert.ok(launch.args.includes(effort), `effort ${effort} must be dispatchable`);
  }
});

test('buildLaunch: requires a brief file path', () => {
  assert.throws(() => buildLaunch(), /briefPath/);
  assert.throws(() => buildLaunch({}), /briefPath/);
  assert.throws(() => buildLaunch({ briefPath: '' }), /briefPath/);
});

test('assessCapture: empty capture is FAIL, never success', () => {
  assert.strictEqual(assessCapture('').verdict, 'FAIL');
  assert.strictEqual(assessCapture('   \n\t  ').verdict, 'FAIL');
  assert.strictEqual(assessCapture(null).verdict, 'FAIL');
  assert.strictEqual(assessCapture(undefined).verdict, 'FAIL');
});

test('assessCapture: login/auth language is FAIL, case-insensitive', () => {
  const samples = [
    'Not logged in',
    'NOT LOGGED IN - run claude auth login',
    'Please run /login',
    'please run /login to continue',
    'AUTH REQUIRED',
    'Error: headless auth required before dispatch',
  ];
  for (const s of samples) {
    const res = assessCapture(s);
    assert.strictEqual(res.verdict, 'FAIL', `expected FAIL for: ${s}`);
    assert.match(res.reason, /auth/i);
  }
});

test('assessCapture: non-empty on-topic text is PASS', () => {
  const res = assessCapture('The diff adds assessCapture and its tests; all checks pass.');
  assert.strictEqual(res.verdict, 'PASS');
  assert.strictEqual(res.reason, null);
});

test('assessCapture: innocent mention of login/auth words is not a failure', () => {
  const res = assessCapture('The login page renders and the auth middleware has tests.');
  assert.strictEqual(res.verdict, 'PASS');
});

test('assessIdleCapture: 0 bytes at 31 minutes WHILE RUNNING is OK (the kill was a false hang)', () => {
  const res = assessIdleCapture({ byteLength: 0, runningMs: 31 * 60 * 1000, running: true });
  assert.strictEqual(res.verdict, 'OK');
});

test('assessIdleCapture: running child is OK at any elapsed time - stdout buffers until exit', () => {
  for (const runningMs of [20 * 60 * 1000 - 1, 20 * 60 * 1000, 31 * 60 * 1000, 3 * 60 * 60 * 1000]) {
    assert.strictEqual(
      assessIdleCapture({ byteLength: 0, runningMs }).verdict,
      'OK',
      `0 bytes at ${runningMs} ms while running must be OK`
    );
  }
});

test('assessIdleCapture: 0 bytes AFTER exit is EMPTY_CAPTURE / FAIL', () => {
  const res = assessIdleCapture({ byteLength: 0, runningMs: 90 * 1000, running: false });
  assert.strictEqual(res.verdict, 'EMPTY_CAPTURE');
  assert.match(res.reason, /FAIL/);
});

test('assessIdleCapture: idle-watch kill at the 20-minute limit with 0 bytes is EMPTY_CAPTURE', () => {
  // The idle-watch (cli-idle.js) kills by PID; once the child is DOWN, a
  // 0-byte capture at IDLE_LIMIT_MS is EMPTY_CAPTURE - files landing never
  // rescues it.
  const res = assessIdleCapture({ byteLength: 0, runningMs: IDLE_LIMIT_MS, running: false });
  assert.strictEqual(res.verdict, 'EMPTY_CAPTURE');
  assert.match(res.reason, /files landing never rescues it/);
});

test('assessIdleCapture: output present is never EMPTY_CAPTURE, running or exited', () => {
  assert.strictEqual(
    assessIdleCapture({ byteLength: 1, runningMs: 31 * 60 * 1000, running: true }).verdict,
    'OK'
  );
  assert.strictEqual(
    assessIdleCapture({ byteLength: 1, runningMs: 31 * 60 * 1000, running: false }).verdict,
    'OK'
  );
});

test('assessIdleCapture: idleLimitMs never trips a running child', () => {
  assert.strictEqual(
    assessIdleCapture({ byteLength: 0, runningMs: 600, idleLimitMs: 500 }).verdict,
    'OK'
  );
});

test('assessIdleCapture: garbage input throws instead of reading as OK', () => {
  assert.throws(() => assessIdleCapture(), /byteLength/);
  assert.throws(() => assessIdleCapture({}), /byteLength/);
  assert.throws(() => assessIdleCapture({ byteLength: 0 }), /runningMs/);
  assert.throws(() => assessIdleCapture({ byteLength: '0', runningMs: 1000 }), /byteLength/);
  assert.throws(
    () => assessIdleCapture({ byteLength: 0, runningMs: 1000, running: 'false' }),
    /running must be a boolean/
  );
});

test('parseProof: proof is the on-topic capture + model/effort as dispatched', () => {
  const capture = 'Implemented cli-claude.js; the test suite passes.';
  const res = parseProof({ captureText: capture, model: 'fable', effort: 'xhigh' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.proof.vendor, 'anthropic');
  assert.strictEqual(res.proof.model, 'fable');
  assert.strictEqual(res.proof.effort, 'xhigh');
  assert.strictEqual(res.proof.capture, capture);
});

test('parseProof: vendorSideTokens is null - unmeasured, never an invented 0', () => {
  const res = parseProof({ captureText: 'on-topic answer', model: 'fable', effort: 'xhigh' });
  assert.notStrictEqual(res.proof.vendorSideTokens, 0);
  assert.strictEqual(res.proof.vendorSideTokens, null);
});

test('parseProof: empty capture yields no proof - files landing cannot rescue it', () => {
  const res = parseProof({ captureText: '', model: 'fable', effort: 'xhigh' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.proof, undefined);
  assert.match(res.reason, /empty/i);
});

test('parseProof: auth-language capture yields no proof', () => {
  const res = parseProof({ captureText: 'Please run /login', model: 'fable', effort: 'xhigh' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.proof, undefined);
});

test('parseProof: requires the dispatched model and a real effort level', () => {
  assert.throws(() => parseProof({ captureText: 'ok' }), /model/);
  assert.throws(() => parseProof({ captureText: 'ok', model: 'fable' }), /effort/);
  assert.throws(
    () => parseProof({ captureText: 'ok', model: 'fable', effort: 'extra' }),
    /not a Claude Code effort/
  );
});

test(
  'live: claude.exe --help answers with the flags the recipe uses',
  { skip: fs.existsSync('C:\\Users\\YESSIR\\.local\\bin\\claude.exe') ? false : 'claude.exe not present' },
  () => {
    const r = spawnSync(CLAUDE_BIN, ['--help'], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.length > 0, '--help stdout must not be empty');
    assert.match(r.stdout, /--model/);
    assert.match(r.stdout, /--effort/);
    assert.match(r.stdout, /--permission-mode/);
    assert.match(r.stdout, /--add-dir/);
    assert.match(r.stdout, /--output-format/);
    assert.strictEqual(assessCapture(r.stdout).verdict, 'PASS');
  }
);
