// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveServer } = require('./resolve.js');

const here = (file) => file === '/work/conclave/mcp/server.js' || file === '/somewhere/server.js';

test('a checkout in the workspace beats the published package', () => {
  const server = resolveServer({ workspaceFolders: ['/work/other', '/work/conclave'], exists: here });
  assert.equal(server.kind, 'workspace');
  assert.deepEqual(server.args, ['/work/conclave/mcp/server.js']);
});

test('with no checkout it runs the published package, so there is no path to keep current', () => {
  const server = resolveServer({ workspaceFolders: ['/work/other'], exists: here });
  assert.equal(server.kind, 'published');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'conclave-mcp']);
});

test('a configured path beats both', () => {
  const server = resolveServer({ settingPath: '/somewhere/server.js', workspaceFolders: ['/work/conclave'], exists: here });
  assert.equal(server.kind, 'setting');
  assert.deepEqual(server.args, ['/somewhere/server.js']);
});

test('a configured path that is not there stops, rather than starting a different server', () => {
  assert.throws(
    () => resolveServer({ settingPath: '/gone/server.js', workspaceFolders: ['/work/conclave'], exists: here }),
    (error) => error.code === 'CONCLAVE_SERVER_PATH_MISSING' && /\/gone\/server\.js/.test(error.message),
  );
});

test('rules-only rides on whichever server was picked', () => {
  assert.deepEqual(resolveServer({ workspaceFolders: ['/work/conclave'], exists: here, rulesOnly: true }).args,
    ['/work/conclave/mcp/server.js', '--rules-only']);
  assert.deepEqual(resolveServer({ workspaceFolders: [], exists: here, rulesOnly: true }).args,
    ['-y', 'conclave-mcp', '--rules-only']);
});

// The extension is allowed to know where the server is and nothing else. If a tool name or a
// schema ever appears in it, the "update the runtime, the editor follows" promise is broken.
test('the extension carries no tool name, schema or rule of its own', () => {
  for (const file of ['extension.js', 'resolve.js', 'package.json']) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(/conclave_[a-z_]+/.test(text), false, `${file} names a tool`);
    assert.equal(/inputSchema|POSITION:|EVIDENCE:|PASSAGE|ponens|scrutator|advocatus/.test(text), false, `${file} carries a rule`);
  }
});

test('the manifest contributes the provider the extension registers', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const ids = manifest.contributes.mcpServerDefinitionProviders.map((row) => row.id);
  assert.deepEqual(ids, ['conclave.servers']);
  assert.match(fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8'), /registerMcpServerDefinitionProvider\('conclave\.servers'/);
});
