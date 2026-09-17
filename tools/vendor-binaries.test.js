// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { candidates, resolveVendorBinary } = require('./vendor-binaries.js');
const { temporary } = require('./test-fixtures.js');

function make(home, relative) { const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; }

test('binary precedence is explicit, env, config, then ~/.local/bin', (t) => {
  const home = temporary(t);
  const local = make(home, '.local/bin/codex');
  const configured = make(home, 'configured/codex'); const env = make(home, 'environment/codex'); const explicit = make(home, 'explicit/codex');
  const options = { home, platform: 'darwin', env: { MAGI_CODEX_BIN: env }, config: { vendors: { openai: { binary: configured } } } };
  assert.equal(resolveVendorBinary('openai', { ...options, binary: explicit }), explicit);
  assert.equal(resolveVendorBinary('openai', options), env);
  assert.equal(resolveVendorBinary('openai', { ...options, env: {} }), configured);
  assert.equal(resolveVendorBinary('openai', { home, platform: 'darwin', env: {}, config: {} }), local);
  assert.deepEqual(candidates('openai', { home, platform: 'linux', env: {}, config: {} }), [local]);
  assert.throws(() => resolveVendorBinary('openai', { home: path.join(home, 'empty'), platform: 'linux', env: {}, config: {} }), /No openai CLI binary found/);
});

test('every vendor resolves its own ~/.local/bin name', (t) => {
  const home = temporary(t);
  for (const [vendor, name] of [['openai', 'codex'], ['google', 'agy'], ['anthropic', 'claude']]) {
    const file = make(home, `.local/bin/${name}`);
    assert.equal(resolveVendorBinary(vendor, { home, platform: 'darwin', env: {}, config: {} }), file);
  }
  assert.throws(() => candidates('xai', { home }), /unsupported vendor/);
});

test('a broken higher-priority override never silently falls back', (t) => {
  const home = temporary(t); make(home, '.local/bin/agy');
  assert.throws(() => resolveVendorBinary('google', { home, platform: 'darwin', env: { MAGI_AGY_BIN: path.join(home, 'missing', 'agy') }, config: {} }), /Configured google CLI does not exist/);
  assert.throws(() => resolveVendorBinary('google', { home, platform: 'darwin', env: {}, config: { vendors: { google: { binary: path.join(home, 'missing', 'agy') } } } }), /No google CLI binary found/);
});
