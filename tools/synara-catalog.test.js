'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sealPlan } = require('./plan-seal.js');
const { createSealedRun } = require('./test-fixtures.js');
const {
  catalogListsRoute,
  launchOverlay,
  loadCatalog,
  main,
  narrowMatrix,
  normalizeCapabilities,
  remapFableFallback,
} = require('./synara-catalog.js');
const { loadMatrix } = require('./dispatch-matrix.js');

function capabilitiesFixture() {
  return {
    providers: [
      {
        provider: 'codex',
        models: [
          { slug: 'gpt-5.6-sol', supportedReasoningEfforts: [{ value: 'high' }, { value: 'xhigh' }] },
          { slug: 'gpt-5.6-sol', supportedReasoningEfforts: [{ value: 'medium' }, { value: 'high' }] },
        ],
      },
      {
        provider: 'claudeAgent',
        models: [
          { slug: 'opus', name: 'opus' },
          { slug: 'opus', name: 'opus' },
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
  assert.throws(() => sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: path.join(run.root, 'banana-run'), availability: run.availability }), /hostMode must be cursor-cli, synara or claude-code/);

  const synaraPlan = JSON.parse(fs.readFileSync(run.planSource, 'utf8'));
  synaraPlan.hostMode = 'synara';
  const synaraSource = path.join(run.root, 'synara-plan.json');
  fs.writeFileSync(synaraSource, JSON.stringify(synaraPlan), 'utf8');
  assert.throws(() => sealPlan({ noJev: 'test fixture', plan: synaraSource, runDir: path.join(run.root, 'missing-catalog'), availability: run.availability }), /synara hostMode requires --synara-catalog/);

  const catalogFile = path.join(run.root, 'capabilities.json');
  fs.writeFileSync(catalogFile, JSON.stringify(capabilitiesFixture()), 'utf8');
  const sealed = sealPlan({ noJev: 'test fixture', plan: synaraSource,
    runDir: path.join(run.root, 'synara-run'),
    availability: run.availability,
    synaraCatalog: catalogFile,
  });
  assert.ok(sealed.synaraCatalogSha256);
  assert.ok(fs.existsSync(path.join(sealed.runDir, 'synara-catalog.json')));
  assert.equal(loadCatalog(path.join(sealed.runDir, 'synara-catalog.json')).vendorMap.google.provider, 'antigravity');
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
