'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readSealedRun, sealPlan } = require('./plan-seal.js');
const { createSealedRun } = require('./test-fixtures.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');
const {
  catalogListsRoute,
  launchOverlay,
  loadCatalog,
  main,
  narrowMatrix,
  normalizeCapabilities,
  remapFableFallback,
} = require('./synara-catalog.js');
const { loadMatrix, routeAllowed } = require('./dispatch-matrix.js');

function capabilitiesFixture() {
  return {
    providers: [
      {
        provider: 'codex',
        models: [
          { slug: 'gpt-5.6-sol', supportedReasoningEfforts: [{ value: 'high' }, { value: 'xhigh' }] },
          { slug: 'gpt-5.6-terra', supportedReasoningEfforts: [{ value: 'medium' }, { value: 'high' }] },
        ],
      },
      {
        provider: 'claudeAgent',
        models: [
          { slug: 'opus', name: 'opus' },
          { slug: 'sonnet', name: 'sonnet' },
        ],
      },
      {
        provider: 'antigravity',
        models: [
          { slug: 'Gemini 3.1 Pro', supportedReasoningEfforts: [{ value: 'high' }] },
        ],
      },
    ],
    targetConstruction: {
      codex: { providerOptions: { reasoningEffort: { valueType: 'string' } } },
      claudeAgent: { providerOptions: { effort: { valueType: 'string' } } },
      antigravity: { providerOptions: { reasoningEffort: { valueType: 'string' } } },
    },
  };
}

test('catalog overlay maps MAGI vendors and keeps Google fused effort', () => {
  const catalog = normalizeCapabilities(capabilitiesFixture());
  assert.equal(catalog.vendorMap.openai.optionKey, 'reasoningEffort');
  assert.equal(catalog.vendorMap.anthropic.optionKey, 'effort');
  assert.equal(catalogListsRoute(catalog, { vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high' }), true);
  assert.equal(catalogListsRoute(catalog, { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }), false);
  assert.equal(catalogListsRoute(catalog, { vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high' }), true);
  assert.equal(catalogListsRoute(catalog, { vendor: 'anthropic', model: 'fable', effort: 'xhigh' }), false);
  const overlay = launchOverlay(catalog, 'openai', 'gpt-5.6-sol', 'high');
  assert.equal(overlay.synaraProvider, 'codex');
  assert.equal(overlay.synaraOptionKey, 'reasoningEffort');
  assert.equal(overlay.magiEffort, 'high');
});

test('narrowing drops unlisted routes and never invents new ones', () => {
  const catalog = normalizeCapabilities(capabilitiesFixture());
  const { matrix, dropped } = narrowMatrix(loadMatrix(), catalog);
  assert.ok(dropped.some((row) => row.model === 'gpt-6-astra'));
  assert.ok(dropped.some((row) => row.model === 'fable'));
  assert.equal(catalogListsRoute(catalog, { vendor: 'google', model: 'gemini-3.8-flash-high', effort: 'fused-high' }), false);
  assert.ok(!matrix.classes['architecture-planning'].plan.some((row) => row.model === 'gpt-6-astra'));
  assert.ok(matrix.classes['architecture-planning'].plan.some((row) => row.model === 'gpt-5.6-sol'));
});

test('fable cyber fallback remaps to opus only when catalog lists opus', () => {
  const catalog = normalizeCapabilities(capabilitiesFixture());
  const remap = remapFableFallback({
    requestedModel: 'fable',
    observedModel: 'claude-opus-5',
    effort: 'high',
  }, catalog);
  assert.deepEqual(remap.remap, { vendor: 'anthropic', model: 'opus', effort: 'high' });
  assert.match(remap.reason, /Do not accept the mismatched identity/);
  const noConflict = remapFableFallback({ requestedModel: 'fable', observedModel: 'claude-fable-5-1', effort: 'high' }, catalog);
  assert.equal(noConflict.remap, null);
});

test('plan-seal requires a catalog for synara and rejects banana', (t) => {
  const run = createSealedRun(t);
  const plan = JSON.parse(fs.readFileSync(run.planSource, 'utf8'));
  plan.hostMode = 'banana';
  fs.writeFileSync(run.planSource, JSON.stringify(plan), 'utf8');
  assert.throws(() => sealPlan({ plan: run.planSource, runDir: path.join(run.root, 'banana-run'), availability: run.availability }), /hostMode must be cursor-cli or synara/);

  const synaraPlan = JSON.parse(fs.readFileSync(run.planSource, 'utf8'));
  synaraPlan.hostMode = 'synara';
  const synaraSource = path.join(run.root, 'synara-plan.json');
  fs.writeFileSync(synaraSource, JSON.stringify(synaraPlan), 'utf8');
  assert.throws(() => sealPlan({ plan: synaraSource, runDir: path.join(run.root, 'missing-catalog'), availability: run.availability }), /synara hostMode requires --synara-catalog/);

  const catalogFile = path.join(run.root, 'capabilities.json');
  fs.writeFileSync(catalogFile, JSON.stringify(capabilitiesFixture()), 'utf8');
  const sealed = sealPlan({
    plan: synaraSource,
    runDir: path.join(run.root, 'synara-run'),
    availability: run.availability,
    synaraCatalog: catalogFile,
    skillSourceRoot: run.opts.skillSourceRoot,
  });
  assert.ok(sealed.synaraCatalogSha256);
  assert.ok(fs.existsSync(path.join(sealed.runDir, 'synara-catalog.json')));
  assert.equal(loadCatalog(path.join(sealed.runDir, 'synara-catalog.json')).vendorMap.google.provider, 'antigravity');
});

function astraPlan(t, hostMode) {
  const run = createSealedRun(t, [{ class: 'debug-mystery', model: 'gpt-6-astra', effort: 'high',
    escalation: true, escalationReason: 'prior frontier attempt failed the correctness gate' }]);
  const plan = { ...run.planObject, hostMode };
  writeJson(run.planSource, plan);
  const catalog = path.join(run.root, 'capabilities.json');
  writeJson(catalog, capabilitiesFixture());
  return { ...run, plan, sealOptions: { plan: run.planSource, runDir: path.join(run.root, 'catalog-run'),
    availability: run.availability, synaraCatalog: catalog, skillSourceRoot: run.opts.skillSourceRoot } };
}

test('CLI host catalogs keep native Astra routes and remain hash-bound diagnostics', t => {
  for (const hostMode of ['synara', 'cursor-cli']) {
    const run = astraPlan(t, hostMode);
    const sealed = sealPlan(run.sealOptions);
    const saved = readSealedRun(sealed.runDir);
    assert.equal(saved.plan.dispatches[0].model, 'gpt-6-astra');
    assert.ok(saved.matrix.classes['debug-mystery'].implement.some(route => route.model === 'gpt-6-astra'));
    assert.equal(saved.seal.synaraCatalogPolicy, 'diagnostic-only-v1');
    const catalog = path.join(sealed.runDir, 'synara-catalog.json');
    assert.equal(saved.seal.synaraCatalogSha256, hashFile(catalog));
    fs.appendFileSync(catalog, '\n');
    assert.throws(() => readSealedRun(sealed.runDir), /sealed run inputs changed/);
  }
});

test('Synara catalog cannot replace fresh matching native Astra proof', t => {
  for (const mutation of ['missing', 'stale', 'mismatched']) {
    const run = astraPlan(t, 'synara');
    const proof = run.available.vendors.openai.models['gpt-6-astra'].efforts.high;
    if (mutation === 'missing') delete run.available.vendors.openai.models['gpt-6-astra'];
    if (mutation === 'stale') proof.observedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    if (mutation === 'mismatched') proof.observedModel = 'gpt-5.6-sol';
    writeJson(run.availability, run.available);
    writeJson(run.planSource, run.plan);
    assert.throws(() => sealPlan(run.sealOptions), /fresh|proof|observed|available|stale/i);
    assert.equal(fs.existsSync(run.sealOptions.runDir), false);
  }
});

test('Synara seals approved Astra coding defaults without escalation or override reasons', t => {
  const run = astraPlan(t, 'synara');
  for (const key of ['escalation', 'escalationReason', 'routingReason']) delete run.plan.dispatches[0][key];
  writeJson(run.planSource, run.plan);
  const saved = readSealedRun(sealPlan(run.sealOptions).runDir);
  assert.equal(saved.plan.dispatches[0].model, 'gpt-6-astra');
  assert.equal(saved.plan.dispatches[0].effort, 'high');
  assert.notEqual(saved.plan.dispatches[0].escalation, true);
});

test('catalog presence cannot waive legacy, noncoding or benchmark Astra escalation', t => {
  const run = astraPlan(t, 'synara');
  const matrix = loadMatrix();
  const legacy = structuredClone(matrix);
  delete legacy.classes['debug-mystery'].codingDefault;
  const base = { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
  for (const [policy, route] of [
    [legacy, { ...base, class: 'debug-mystery', role: 'implement' }],
    [matrix, { ...base, class: 'architecture-planning', role: 'plan' }],
    [matrix, { ...base, class: 'benchmark-software', role: 'implement' }],
  ]) {
    assert.match(routeAllowed(policy, route, run.available).reason, /escalation-only/);
    assert.match(routeAllowed(policy, { ...route, escalation: true }, run.available).reason, /escalationReason/);
    assert.equal(routeAllowed(policy, { ...route, escalation: true,
      escalationReason: 'Bounded comparison requires the exact frontier route' }, run.available).ok, true);
  }
});

test('historical catalog seals retain route narrowing and reject unknown catalog policies', t => {
  const run = astraPlan(t, 'synara');
  const sealed = sealPlan(run.sealOptions);
  const file = path.join(sealed.runDir, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete seal.synaraCatalogPolicy;
  writeJson(file, seal);
  assert.throws(() => readSealedRun(sealed.runDir), /route not in matrix/);
  seal.synaraCatalogPolicy = 'unknown-policy';
  writeJson(file, seal);
  assert.throws(() => readSealedRun(sealed.runDir), /catalog policy/);
});

test('synara-catalog CLI imports a capabilities snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-catalog-cli-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'caps.json');
  const output = path.join(root, 'catalog.json');
  fs.writeFileSync(input, JSON.stringify(capabilitiesFixture()), 'utf8');
  assert.equal(main(['--import', input, '--out', output]), 0);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).schemaVersion, 1);
});
