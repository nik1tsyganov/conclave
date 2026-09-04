'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const smokePath = path.join(__dirname, 'cli-smoke.js');
const {
  assertGooglePlan,
  assertNoBodyLeak,
  assertOpenaiPlan,
  main,
} = require('./cli-smoke.js');

function rulesMarkers() {
  return 'magi-cli-rules magi-mode magi-dispatch casper_via=agy';
}

function uniqueBody() {
  return `${rulesMarkers()}\nUNIQUE-SMOKE-${crypto.randomUUID()}-`.padEnd(200, 'b');
}

function makeBrief(t, body) {
  const parent = path.join(os.tmpdir(), 'magi-bus');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'magi-smoke-'));
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, body, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return briefPath;
}

function capture() {
  const io = { stdoutText: '', stderrText: '' };
  io.stdout = { write(chunk) { io.stdoutText += chunk; } };
  io.stderr = { write(chunk) { io.stderrText += chunk; } };
  return io;
}

test('smoke passes the current launchers on a 200-char body without spawning a vendor', async (t) => {
  const body = uniqueBody();
  assert.strictEqual(body.length, 200);
  const briefPath = makeBrief(t, body);
  const io = capture();
  let spawned = false;

  const code = await main(
    ['--brief', briefPath, '--cwd', 'C:\\src\\magi'],
    io,
    { spawnFn() { spawned = true; throw new Error('vendor process spawned'); } },
  );

  assert.strictEqual(code, 0, io.stderrText);
  assert.strictEqual(spawned, false, 'dry-run smoke spawned a vendor process');
  assert.deepStrictEqual(JSON.parse(io.stdoutText), {
    ok: true,
    vendors: ['openai', 'google', 'anthropic'],
  });
});

test('the CLI entry prints one JSON report and exits 0', (t) => {
  const briefPath = makeBrief(t, uniqueBody());
  const result = spawnSync(process.execPath, [
    smokePath,
    '--brief', briefPath,
    '--cwd', 'C:\\src\\magi',
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.ok, true);
  assert.deepStrictEqual(report.vendors, ['openai', 'google', 'anthropic']);
});

test('an empty brief exits 2: cli-launch already refuses it', async (t) => {
  const briefPath = makeBrief(t, '');
  const io = capture();

  const code = await main(['--brief', briefPath, '--cwd', 'C:\\src\\magi'], io);

  assert.strictEqual(code, 2, io.stderrText);
  assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
});

test('a missing brief exits 2 with ARGUMENT_ERROR', async () => {
  const io = capture();

  const code = await main([
    '--brief', path.join(os.tmpdir(), 'magi-smoke-missing-brief.md'),
    '--cwd', 'C:\\src\\magi',
  ], io);

  assert.strictEqual(code, 2, io.stderrText);
  assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
});

test('a brief without the RULES markers fails closed before any dry-run', async (t) => {
  const briefPath = makeBrief(t, `UNIQUE-SMOKE-${crypto.randomUUID()}-`.padEnd(200, 'b'));
  const io = capture();
  let spawned = false;

  const code = await main(
    ['--brief', briefPath, '--cwd', 'C:\\src\\magi'],
    io,
    { spawnFn() { spawned = true; throw new Error('vendor process spawned'); } },
  );

  assert.strictEqual(code, 1, io.stderrText);
  assert.strictEqual(spawned, false, 'missing RULES must not reach a vendor spawn');
  assert.match(io.stderrText, /brief missing RULES markers/);
  assert.match(io.stderrText, /magi-cli-rules\|STANDING\.md/);
  assert.match(io.stderrText, /magi-mode/);
  assert.match(io.stderrText, /magi-dispatch/);
  assert.match(io.stderrText, /casper_via=agy\|VENDOR\.md\+agy-card/);
});

test('a missing --brief flag exits 2 with ARGUMENT_ERROR', async () => {
  const io = capture();

  const code = await main(['--cwd', 'C:\\src\\magi'], io);

  assert.strictEqual(code, 2, io.stderrText);
  assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
});

test('a plan argument carrying the brief body is a leak', () => {
  const body = uniqueBody();
  assert.throws(
    () => assertNoBodyLeak('google', { args: ['-p', body] }, body),
    /leaks the brief body into an argument/,
  );
});

test('stdin-file contents carrying the brief body are a leak', (t) => {
  const body = uniqueBody();
  const briefPath = makeBrief(t, body);
  const stdinFile = `${briefPath}.stdin.md`;
  fs.writeFileSync(stdinFile, `prefix ${body} suffix`, 'utf8');

  assert.throws(
    () => assertNoBodyLeak('openai', { args: [], stdinFile }, body),
    /leaks the brief body/,
  );
});

test('an openai plan fails without pointer delivery or when it pipes the brief itself', () => {
  const briefPath = 'C:\\src\\magi\\brief.md';
  assert.throws(
    () => assertOpenaiPlan({ delivery: 'inline', stdinFile: 'C:\\x.pointer.md' }, briefPath),
    /expected "pointer"/,
  );
  assert.throws(
    () => assertOpenaiPlan({ delivery: 'pointer', stdinFile: briefPath }, briefPath),
    /brief path itself/,
  );
});

test('a google -p value equal to the brief body fails; a pointer -p with skills add-dir passes', () => {
  const body = uniqueBody();
  assert.throws(
    () => assertGooglePlan({ args: ['--model', 'gemini-3.1-pro-high', '-p', body] }, body),
    /-p value is the brief body/,
  );
  assertGooglePlan({
    args: ['--add-dir', 'C:\\Users\\YESSIR\\.claude\\skills', '-p', 'Read C:\\brief.md in full.'],
  }, body);
});

test('a google plan without --add-dir ...\\.claude\\skills fails closed', () => {
  const body = uniqueBody();
  assert.throws(
    () => assertGooglePlan({ args: ['-p', 'Read C:\\brief.md in full.'] }, body),
    /missing --add-dir/,
  );
});
