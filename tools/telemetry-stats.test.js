// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('missing log file exits with 2', (t) => {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'telemetry-stats.js'),
    '--log',
    path.join(__dirname, 'does-not-exist.jsonl')
  ], { encoding: 'utf8' });
  
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /NO LOG/);
});

test('three implement rows openai/google/anthropic print ~33% each and null totalTokens is not counted as 0', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-test-'));
  const logFile = path.join(tmpDir, 'test-log.jsonl');
  
  const rows = [
    { role: 'implement', vendor: 'openai', totalTokens: 100 },
    { role: 'implement', vendor: 'google', totalTokens: null },
    { role: 'implement', vendor: 'anthropic', totalTokens: 200 }
  ];
  
  fs.writeFileSync(logFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'telemetry-stats.js'),
    '--log',
    logFile,
    '--json'
  ], { encoding: 'utf8' });
  
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  
  assert.strictEqual(out.vendorShare.implement.openai, 1);
  assert.strictEqual(out.vendorShare.implement.google, 1);
  assert.strictEqual(out.vendorShare.implement.anthropic, 1);
  
  // totalTokens sum should be 300, mean should be 150 (since null is skipped)
  assert.strictEqual(out.tokens.totalTokens.count, 2);
  assert.strictEqual(out.tokens.totalTokens.sum, 300);
  assert.strictEqual(out.tokens.totalTokens.mean, 150);
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('null tokens output mean as null and count 0', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-test-'));
  const logFile = path.join(tmpDir, 'test-log.jsonl');
  
  const rows = [
    { role: 'implement', vendor: 'openai', totalTokens: null, vendorSideTokens: null }
  ];
  
  fs.writeFileSync(logFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'telemetry-stats.js'),
    '--log',
    logFile,
    '--json'
  ], { encoding: 'utf8' });
  
  assert.strictEqual(result.status, 0);
  const out = JSON.parse(result.stdout);
  
  assert.strictEqual(out.tokens.totalTokens.count, 0);
  assert.strictEqual(out.tokens.totalTokens.mean, null);
  assert.strictEqual(out.tokens.vendorSideTokens.count, 0);
  assert.strictEqual(out.tokens.vendorSideTokens.mean, null);
  
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
