'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyzeRows, analyzeVaultTelemetry } = require('./magi-vault-analyze.js');
const { linkRunToVault } = require('./magi-vault-link.js');
const { looksSecret, resolveVaultRoot, vaultLayout } = require('./magi-vault.js');
const { pullInbox, pushSkillsToVault, syncStatus } = require('./magi-vault-sync.js');
const { shouldLinkVault } = require('./run-finalize.js');

function put(file, body = 'ok\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-vault-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vaultRoot = path.join(root, 'vault');
  const runtimeRoot = path.join(root, 'runtime');
  put(path.join(vaultRoot, 'Wiki', 'Index.md'), '# Wiki\n');
  put(path.join(vaultRoot, 'HOW-TO-ADD-DATA.md'), '# how\n');
  const references = path.join(runtimeRoot, 'skills', 'magi-cli', 'references');
  put(path.join(references, 'dispatch-matrix.json'), '{}');
  put(path.join(references, 'seat-profiles.json'), '{"schemaVersion":6,"baseSkills":{"openai":["seat-openai"]}}\n');
  put(path.join(runtimeRoot, 'seat-skills', 'seat-openai', 'SKILL.md'), '# seat-openai\n');
  put(path.join(runtimeRoot, 'tools', 'dispatch-run.js'), 'module.exports = {}\n');
  return { root, vaultRoot, runtimeRoot, env: { MAGI_VAULT_ROOT: vaultRoot } };
}

test('looksSecret catches key-shaped text and resolveVaultRoot stays explicit', t => {
  const f = fixture(t);
  assert.equal(looksSecret('sk-abcdefghijklmnopqrstuvwxyz012345'), true);
  assert.equal(looksSecret('ordinary telemetry note'), false);
  assert.equal(resolveVaultRoot({ env: {} }), null);
  assert.equal(resolveVaultRoot({ env: f.env }), fs.realpathSync.native(f.vaultRoot));
  assert.throws(() => resolveVaultRoot({ env: { MAGI_VAULT_ROOT: f.root } }), /not an ai-ops-vault/);
});

test('tmp run dirs never auto-link even when MAGI_VAULT_ROOT is set', () => {
  assert.equal(shouldLinkVault(path.join(os.tmpdir(), 'magi-run'), { MAGI_VAULT_ROOT: 'C:\\src\\ai-ops-vault' }), false);
  assert.equal(shouldLinkVault(path.join(path.parse(os.tmpdir()).root, 'magi-runs', 'run-001'), { MAGI_VAULT_ROOT: 'C:\\src\\ai-ops-vault' }), true);
  assert.equal(shouldLinkVault(path.join(path.parse(os.tmpdir()).root, 'magi-runs', 'run-001'), {}), false);
  assert.equal(shouldLinkVault(path.join(path.parse(os.tmpdir()).root, 'magi-runs', 'run-001'), { MAGI_VAULT_ROOT: 'C:\\src\\ai-ops-vault', MAGI_VAULT_LINK: '0' }), false);
});

test('link appends unique telemetry and marks legacy plan context unmeasured', t => {
  const f = fixture(t);
  const runDir = path.join(f.root, 'run');
  const row = {
    schemaVersion: 2, status: 'PASS', dispatchId: 'd1', unitId: 'u1', role: 'implement', vendor: 'openai',
    capturedBy: 'lead', hostMode: 'cursor-cli', planId: 'p1', planHash: 'abc', proofId: 'proof-1', vendorSideTokens: 12,
  };
  put(path.join(runDir, 'telemetry.jsonl'), `${JSON.stringify(row)}\n`);
  const first = linkRunToVault({ runDir, env: f.env });
  assert.equal(first.appended, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.needsAttention, true);
  assert.ok(first.analysis.findings.some((item) => item.id === 'hog:unmeasured'));
  assert.equal(first.analysis.globalDistribution.status, 'unmeasured');
  const second = linkRunToVault({ runDir, env: f.env });
  assert.equal(second.appended, 0);
  assert.equal(second.skipped, 1);
  const log = fs.readFileSync(vaultLayout(fs.realpathSync.native(f.vaultRoot)).telemetryLog, 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
});

test('secret-shaped telemetry is refused', t => {
  const f = fixture(t);
  const runDir = path.join(f.root, 'run');
  put(path.join(runDir, 'telemetry.jsonl'), `${JSON.stringify({ note: 'sk-abcdefghijklmnopqrstuvwxyz012345' })}\n`);
  assert.throws(() => linkRunToVault({ runDir, env: f.env }), /credential-looking/);
});

test('skill push, inbox pull, and status drift', t => {
  const f = fixture(t);
  const pushed = pushSkillsToVault({ env: f.env, runtimeRoot: f.runtimeRoot });
  assert.deepEqual(pushed.skills, ['seat-openai']);
  let status = syncStatus({ env: f.env, runtimeRoot: f.runtimeRoot });
  assert.equal(status.ok, true);
  put(path.join(f.vaultRoot, 'projects', 'magi', 'seat-skills-inbox', 'testing', 'SKILL.md'), '# testing from vault\n');
  const pulled = pullInbox({ env: f.env, runtimeRoot: f.runtimeRoot });
  assert.deepEqual(pulled.pulled, ['testing']);
  assert.equal(fs.existsSync(path.join(f.runtimeRoot, 'seat-skills', 'testing', 'SKILL.md')), true);
  put(path.join(f.runtimeRoot, 'seat-skills', 'seat-openai', 'SKILL.md'), '# changed in MAGI\n');
  status = syncStatus({ env: f.env, runtimeRoot: f.runtimeRoot });
  assert.equal(status.ok, false);
  assert.ok(status.skillDrift.some((item) => item.skill === 'seat-openai'));
});

test('empty vault telemetry analysis asks for later scoring', t => {
  const f = fixture(t);
  const report = analyzeVaultTelemetry({ env: f.env });
  assert.equal(report.rowCount, 0);
  assert.equal(report.needsAttention, true);
  assert.ok(report.findings.some((item) => item.id === 'capture:zero-rows'));
  assert.equal(analyzeRows([]).needsAttention, true);
});

async function completedPlan(t, options = {}) {
  const { createSealedRun, fakeVendor } = require('./test-fixtures.js');
  const { runDispatch } = require('./dispatch-run.js');
  const run = createSealedRun(t, [
    { unitId: 'first' },
    { unitId: 'second', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
  ], { magiConvened: true, ...options });
  const rows = [];
  for (const entry of run.dispatches) {
    const native = fakeVendor(launch => fs.writeFileSync(path.join(launch.cwd, 'result.txt'), entry.dispatchId));
    rows.push((await runDispatch({ ...run.opts, dispatchId: entry.dispatchId }, native)).telemetry);
  }
  return { run, rows };
}

test('telemetry distribution scores complete two-unit plans separately and leaves the global breaker unmeasured', async t => {
  const first = await completedPlan(t, { planId: 'first-plan' });
  const second = await completedPlan(t, { planId: 'second-plan' });
  const rows = [...first.rows, ...second.rows];
  const original = JSON.stringify(rows);
  const report = analyzeRows(rows);
  assert.equal(report.needsAttention, false);
  assert.equal(report.findings.filter(f => f.id === 'hog:holds').length, 2);
  assert.equal(report.findings.some(f => f.id === 'hog:duplicate'), false);
  assert.equal(report.globalDistribution.status, 'unmeasured');
  assert.equal(JSON.stringify(rows), original);
});

test('telemetry distribution rejects an exact duplicate within a sealed plan', async t => {
  const { rows } = await completedPlan(t);
  const report = analyzeRows([...rows, rows[0]]);
  assert.equal(report.needsAttention, true);
  assert.ok(report.findings.some(f => f.id === 'hog:duplicate' && f.severity === 'fail'));
  assert.equal(report.findings.some(f => f.id === 'hog:holds'), false);
});

test('telemetry distribution cannot score missing, incomplete, or conflicting sealed context as holds', async t => {
  const { run, rows } = await completedPlan(t);
  for (const subset of [rows.slice(0, 1), rows.map(r => ({ ...r, planHash: '0'.repeat(64) }))]) {
    const report = analyzeRows(subset);
    assert.equal(report.needsAttention, true);
    assert.ok(report.findings.some(f => f.id === 'hog:unmeasured'));
    assert.equal(report.findings.some(f => f.id === 'hog:holds'), false);
  }
  fs.rmSync(path.join(run.runDir, 'plan-seal.json'));
  assert.ok(analyzeRows(rows).findings.some(f => f.id === 'hog:unmeasured'));
});

test('telemetry distribution reports a three-unit one-vendor sealed plan as invalid', async t => {
  const { run, rows } = await completedPlan(t);
  const { hashFile, writeJson } = require('./dispatch-evidence.js');
  const planPath = path.join(run.runDir, 'dispatch-plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath));
  plan.dispatches = [0, 1, 2].map(i => ({ ...plan.dispatches[0], dispatchId: `d${i + 1}`, unitId: `unit${i + 1}` }));
  writeJson(planPath, plan);
  const sealPath = path.join(run.runDir, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(sealPath));
  seal.planHash = hashFile(planPath); writeJson(sealPath, seal);
  const invalidRows = plan.dispatches.map(e => ({ ...rows[0], dispatchId: e.dispatchId, unitId: e.unitId, planHash: seal.planHash }));
  const report = analyzeRows(invalidRows);
  assert.equal(report.needsAttention, true);
  assert.ok(report.findings.some(f => f.id === 'hog:plan-invalid' && f.severity === 'fail'));
  assert.equal(report.findings.some(f => f.id === 'hog:holds'), false);
});

test('telemetry capture health counts existing totalTokens but leaves absent Google metrics missing', () => {
  const rows = [
    { vendor: 'openai', vendorSideTokens: 123 },
    { vendor: 'anthropic', vendorSideTokens: 234 },
    { vendor: 'google', vendorSideTokens: null, totalTokens: 345 },
    { vendor: 'google', vendorSideTokens: null },
  ];
  assert.equal(analyzeRows(rows).captureHealth.tokenPresent, 3);
  assert.equal(rows[3].totalTokens, undefined);
});
