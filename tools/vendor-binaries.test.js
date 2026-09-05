'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { temporary } = require('./test-fixtures.js');
test('binary precedence is explicit, env, config, discovery, shim, then fail', (t) => {
  const home = temporary(t); const make = (relative) => { const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture'); return file; };
  const shim = make('tools/bin/codex.exe'); const official = make('AppData/Local/Microsoft/WinGet/Links/codex.exe');
  const configured = make('configured.exe'); const env = make('environment.exe'); const explicit = make('explicit.exe');
  const options = { home, env: { MAGI_CODEX_BIN: env }, config: { vendors: { openai: { binary: configured } } }, binary: explicit };
  assert.equal(resolveVendorBinary('openai', options), explicit);
  delete options.binary; assert.equal(resolveVendorBinary('openai', options), env);
  options.env = {}; assert.equal(resolveVendorBinary('openai', options), configured);
  delete options.config; assert.equal(resolveVendorBinary('openai', options), official);
  fs.unlinkSync(official); assert.equal(resolveVendorBinary('openai', options), shim);
  fs.unlinkSync(shim); assert.throws(() => resolveVendorBinary('openai', options), { code: 'BINARY_MISSING' });
});
test('a broken higher-priority override never silently falls back', (t) => {
  const home = temporary(t); const shim = path.join(home, 'tools/bin/agy.exe'); fs.mkdirSync(path.dirname(shim), { recursive: true }); fs.writeFileSync(shim, 'fixture');
  for (const options of [{ binary: path.join(home, 'absent') }, { env: { MAGI_AGY_BIN: path.join(home, 'absent') } }, { config: { vendors: { google: { binary: path.join(home, 'absent') } } } }]) {
    assert.throws(() => resolveVendorBinary('google', { home, env: {}, ...options }), { code: 'BINARY_MISSING' });
  }
  assert.equal(resolveVendorBinary('google', { home, env: {}, binary: shim, configFile: path.join(home, 'absent-config') }), shim);
});
