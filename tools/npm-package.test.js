// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build, NAME } = require('./npm-package.js');

function staged(t) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-npm-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  return build(out);
}

test('the package carries its own name and its own README, never the repository\'s', (t) => {
  const { outDir, manifest } = staged(t);
  assert.equal(manifest.name, NAME);
  const readme = fs.readFileSync(path.join(outDir, 'README.md'), 'utf8');
  const repoReadme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.notEqual(readme, repoReadme);
  // The runtime this package deliberately leaves out must not be described by it.
  for (const leak of ['ai-ops-vault', 'field-library', 'vault-skills', 'CONCLAVE_VAULT_ROOT', 'seat-skills/', 'plan-seal', 'run-drive']) {
    assert.equal(readme.includes(leak), false, `package README names ${leak}`);
  }
});

test('the package contains the server and what it needs, and nothing that drives a run', (t) => {
  const { outDir } = staged(t);
  const files = [];
  (function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(next, `${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
  })(outDir);
  assert.deepEqual(files.sort(), [
    'ADDITIONAL-TERMS.md', 'LICENSE', 'README.md', 'mcp/server.js', 'package.json',
    'tools/conclave-panel.js', 'tools/dispatch-schema.js', 'tools/panel-block.js',
    'tools/panel-routing.js', 'tools/panel-rules.js',
  ]);
  for (const driver of ['plan-seal.js', 'run-drive.js', 'dispatch-run.js', 'model-probe.js']) {
    assert.equal(fs.existsSync(path.join(outDir, 'tools', driver)), false, `${driver} is in the package`);
  }
  assert.equal(fs.existsSync(path.join(outDir, 'standing-rules')), false, 'the standing rules are in the package');
  assert.equal(fs.existsSync(path.join(outDir, 'seat-skills')), false, 'the seat skills are in the package');
});

test('the staged server serves the six rules tools with no flag, because there is no runtime beside it', (t) => {
  const { outDir } = staged(t);
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((message) => JSON.stringify(message)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [path.join(outDir, 'mcp', 'server.js')], { input: messages, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, String(result.error));
  const answers = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const names = answers.find((row) => row.id === 2).result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['conclave_hosts', 'conclave_read_block', 'conclave_read_reply', 'conclave_route', 'conclave_tally', 'conclave_validate_row']);
});

test('the repository itself is marked private, so a publish from the root is not the way out', () => {
  const repo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(repo.private, true);
});
