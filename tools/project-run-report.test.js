'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { createReport, main } = require('./project-run-report.js');

function output(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-report-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'report');
}
function fileBytes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? fileBytes(file) : [[file, fs.readFileSync(file).toString('base64')]];
  });
}
function panel(t) {
  return createSealedRun(t, [
    { unitId: 'u1' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'openai' },
    { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' },
  ], { magiConvened: true });
}

test('report revalidates successful evidence without changing any run bytes', async t => {
  const run = panel(t);
  for (const row of run.dispatches) await runDispatch({ ...run.opts, dispatchId: row.dispatchId }, fakeVendor(() => {}, 'ACK fixture\nPOSITION: APPROVE'));
  const before = fileBytes(run.runDir);
  const { report, outputDir } = createReport({ runDir: run.runDir, outputDir: output(t) });
  assert.equal(report.status, 'PASS', JSON.stringify(report.issues));
  assert.equal(report.dispatches.length, 3);
  assert.ok(report.dispatches.every(row => row.nativeId && row.modelObserved));
  assert.deepEqual(report.issues, []);
  assert.deepEqual(fileBytes(run.runDir), before);
  assert.ok(fs.readFileSync(path.join(outputDir, 'REPORT.md'), 'utf8').includes('Diagnostic snapshot, not activation evidence'));
});

test('partial and rejected runs retain NOT_RUN and actual rejection', async t => {
  const run = panel(t);
  await runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeVendor());
  await runDispatch({ ...run.opts, dispatchId: 'd2' }, fakeVendor(() => {}, 'ACK fixture\nPOSITION: REJECT'));
  const { report } = createReport({ runDir: run.runDir, outputDir: output(t), phase: 'verify' });
  assert.equal(report.status, 'NEEDS_ATTENTION');
  assert.equal(report.dispatches[2].status, 'NOT_RUN');
  assert.ok(report.issues.some(row => row.kind === 'approval'));
});

test('corrupt evidence cannot inherit a stale PASS summary', async t => {
  const run = panel(t);
  for (const row of run.dispatches) await runDispatch({ ...run.opts, dispatchId: row.dispatchId }, fakeVendor(() => {}, 'ACK fixture\nPOSITION: APPROVE'));
  fs.writeFileSync(path.join(run.runDir, 'run-summary.json'), JSON.stringify({ ok: true }));
  fs.appendFileSync(path.join(run.runDir, 'out/d1/proof.json'), 'tampered');
  const { report } = createReport({ runDir: run.runDir, outputDir: output(t) });
  assert.equal(report.status, 'NEEDS_ATTENTION');
  assert.equal(report.dispatches[0].status, 'INVALID');
});

test('pre-seal failures preserve captured output and report export returns zero', t => {
  const runDir = path.dirname(output(t));
  const errorFile = path.join(runDir, 'preflight.log');
  fs.writeFileSync(errorFile, 'RULES_SOURCE_MISSING: fixture\n');
  const destination = output(t);
  const projectRoot = path.dirname(output(t));
  const code = main(['--run-dir', runDir, '--output-dir', destination, '--project-root', projectRoot, '--phase', 'preflight', '--error-file', errorFile], { stdout: { write() {} }, stderr: { write() {} } });
  assert.equal(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(destination, 'report.json')));
  assert.equal(report.status, 'NEEDS_ATTENTION');
  assert.equal(report.commandFailure.excerpt, 'RULES_SOURCE_MISSING: fixture\n');
  assert.equal(report.commandFailure.sha256.length, 64);
  assert.equal(fs.readFileSync(errorFile, 'utf8'), report.commandFailure.excerpt);
});

test('reports cannot overwrite an earlier report or write inside product/run/runtime', t => {
  const run = panel(t);
  const destination = output(t);
  createReport({ runDir: run.runDir, outputDir: destination });
  assert.throws(() => createReport({ runDir: run.runDir, outputDir: destination }), /already exists/);
  for (const dir of [run.runDir, run.cwd, __dirname]) {
    const nested = path.join(dir, 'new-issue-report');
    assert.throws(() => createReport({ runDir: run.runDir, outputDir: nested }), /must be outside/);
    assert.equal(fs.existsSync(nested), false);
  }
});

test('PowerShell UTF-16 command output is readable without changing its source bytes', t => {
  const runDir = path.dirname(output(t));
  const errorFile = path.join(runDir, 'stderr.log');
  const bytes = Buffer.from('\uFEFFMissing rules\r\n', 'utf16le');
  fs.writeFileSync(errorFile, bytes);
  const { report } = createReport({ runDir, outputDir: output(t), errorFile, projectRoot: path.dirname(output(t)) });
  assert.equal(report.commandFailure.excerpt, 'Missing rules\r\n');
  assert.deepEqual(fs.readFileSync(errorFile), bytes);
});

test('pre-seal export from a runtime cwd requires and protects the explicit product root', t => {
  const runDir = path.dirname(output(t));
  const projectRoot = path.dirname(output(t));
  const nested = path.join(projectRoot, 'issue-report');
  assert.throws(() => createReport({ runDir, outputDir: output(t) }), /--project-root is required/);
  assert.throws(() => createReport({ runDir, outputDir: nested, projectRoot }), /must be outside/);
  assert.equal(fs.existsSync(nested), false);
  const { report } = createReport({ runDir, outputDir: output(t), projectRoot });
  assert.equal(report.status, 'NEEDS_ATTENTION');
});

test('unknown and duplicate CLI options fail before creating output', () => {
  for (const args of [['--unknown', 'x'], ['--run-dir', 'x', '--run-dir', 'y']]) {
    assert.equal(main(args, { stdout: { write() {} }, stderr: { write() {} } }), 2);
  }
});
