// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, 'host-resolver.js');

function run(args) {
  try {
    const stdout = execSync(`node "${SCRIPT_PATH}" ${args}`, { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('host-resolver', async (t) => {
  await t.test('Default / --from cursor with no error -> cursor, tripped: false', () => {
    const res = run('--from cursor --json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor', tripped: false, reason: 'ok' });
  });

  await t.test('Default (no args) -> cursor, tripped: false', () => {
    const res = run('--json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor', tripped: false, reason: 'ok' });
  });

  await t.test('--from cursor-cli stays cursor-cli even if error is empty', () => {
    const res = run('--from cursor-cli --json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor-cli', tripped: false, reason: 'already-cli' });
  });

  await t.test('--from synara stays synara even if error text would trip cursor', () => {
    const res = run('--from synara --error-text "usage limit" --json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'synara', tripped: false, reason: 'already-synara' });
  });

  await t.test('--force synara trips to synara', () => {
    const res = run('--force synara --json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'synara', tripped: true, reason: 'forced' });
  });

  await t.test('invalid --from banana is rejected', () => {
    const res = run('--from banana --json');
    assert.notEqual(res.status, 0);
    assert.ok((res.stderr || res.stdout).includes('invalid --from'));
  });

  await t.test('--force cursor-cli trips to cursor-cli', () => {
    const res = run('--force cursor-cli --json');
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor-cli', tripped: true, reason: 'forced' });
  });

  await t.test('Error text matching usage/quota language trips', () => {
    const errors = ['usage limit', 'rate limit', 'quota', 'resource_exhausted', 'weekly limit', 'out of usage'];
    for (const errText of errors) {
      const res = run(`--from cursor --error-text "${errText}" --json`);
      assert.strictEqual(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.deepStrictEqual(out, { hostMode: 'cursor-cli', tripped: true, reason: 'cursor-usage-exhausted' }, `Failed on: ${errText}`);
    }
  });

  await t.test('Local failures do NOT trip', () => {
    const errors = ['unknown subagent', 'FORBIDDEN', 'ENOENT', ''];
    for (const errText of errors) {
      const res = run(`--from cursor --error-text "${errText}" --json`);
      assert.strictEqual(res.status, 0);
      const out = JSON.parse(res.stdout);
      assert.deepStrictEqual(out, { hostMode: 'cursor', tripped: false, reason: 'ok' }, `Failed on: ${errText}`);
    }
  });
  
  await t.test('Error file reading', () => {
    const tmpFile = path.join(__dirname, 'tmp-error.txt');
    fs.writeFileSync(tmpFile, 'You have hit your usage limit.');
    const res = run(`--from cursor --error-file "${tmpFile}" --json`);
    fs.unlinkSync(tmpFile);
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor-cli', tripped: true, reason: 'cursor-usage-exhausted' });
  });

  await t.test('Missing required args / unreadable --error-file -> exit 2, stdout contains "not a pass"', () => {
    const res = run('--from cursor --error-file "/does/not/exist/12345.txt"');
    assert.strictEqual(res.status, 2);
    assert.ok(res.stdout.includes('not a pass') || res.stderr.includes('not a pass'));
  });

  await t.test('Missing required args (e.g. --from with no value) -> exit 2', () => {
    const res = run('--from');
    assert.strictEqual(res.status, 2);
    assert.ok(res.stdout.includes('not a pass') || res.stderr.includes('not a pass'));
  });

  await t.test('Invalid --from -> exit 2', () => {
    const res = run('--from other');
    assert.strictEqual(res.status, 2);
    assert.ok(res.stdout.includes('not a pass') || res.stderr.includes('not a pass'));
  });

  await t.test('Invalid --force and unknown flags -> exit 2', () => {
    for (const args of ['--force cursor', '--unknown']) {
      const res = run(args);
      assert.strictEqual(res.status, 2);
      assert.ok(res.stdout.includes('not a pass') || res.stderr.includes('not a pass'));
    }
  });

  await t.test('Human output format', () => {
    const res = run('--from cursor');
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('hostMode: cursor'));
    assert.ok(res.stdout.includes('tripped: false'));
    assert.ok(res.stdout.includes('reason: ok'));
  });

  await t.test('Capacity state file', () => {
    const tmpFile = path.join(__dirname, 'tmp-capacity.json');
    fs.writeFileSync(tmpFile, JSON.stringify({
      buckets: [
        { bucketId: 'cursorTask', status: 'exhausted' }
      ]
    }));
    const res = run(`--from cursor --capacity-state "${tmpFile}" --json`);
    fs.unlinkSync(tmpFile);
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor-cli', tripped: true, reason: 'capacity-exhausted' });
  });

  await t.test('Unrelated exhausted capacity bucket does not trip', () => {
    const tmpFile = path.join(__dirname, 'tmp-capacity-unrelated.json');
    fs.writeFileSync(tmpFile, JSON.stringify({
      buckets: [
        { bucketId: 'claude/weekly-opus', status: 'exhausted' }
      ]
    }));
    const res = run(`--from cursor --capacity-state "${tmpFile}" --json`);
    fs.unlinkSync(tmpFile);
    assert.strictEqual(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.deepStrictEqual(out, { hostMode: 'cursor', tripped: false, reason: 'ok' });
  });

  await t.test('Invalid capacity state JSON -> exit 2', () => {
    const tmpFile = path.join(__dirname, 'tmp-capacity-invalid.json');
    fs.writeFileSync(tmpFile, '{ invalid');
    const res = run(`--from cursor --capacity-state "${tmpFile}" --json`);
    fs.unlinkSync(tmpFile);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stdout.includes('not a pass') || res.stderr.includes('not a pass'));
  });
});
