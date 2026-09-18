#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
/// Assembles the publishable package into a directory of its own, and prints what is in it.
///
/// `npm publish` from the repository root would carry the root README whatever `files` says —
/// npm always includes it — and that README describes the driver, the environment it needs and
/// the sibling repositories it reads. None of that belongs in a package whose whole purpose is
/// to hand a host the rules without the runtime. Staging is also the only way to give the
/// package a name of its own while the repository keeps its.
///
///   node tools/npm-package.js --out <dir>
///   npm publish <dir> --access public

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NAME = 'conclave-mcp';

/// The server and what it requires, resolved rather than listed by hand.
const FILES = Object.freeze([
  'mcp/server.js',
  'tools/dispatch-schema.js',
  'tools/panel-rules.js',
  'tools/panel-routing.js',
  'tools/panel-block.js',
  'tools/conclave-panel.js',
  'LICENSE',
  'ADDITIONAL-TERMS.md',
]);

function build(outDir) {
  const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const relative of FILES) {
    const from = path.join(ROOT, relative);
    if (!fs.existsSync(from)) throw new Error(`the package is missing ${relative}`);
    const to = path.join(outDir, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  // The package's own README, not the repository's.
  fs.copyFileSync(path.join(ROOT, 'mcp', 'PACKAGE.md'), path.join(outDir, 'README.md'));

  const manifest = {
    name: NAME,
    version: repo.version,
    description: 'The rules of a tri-vendor review panel, over MCP: read a lead\'s block, route it, read a seat\'s reply, count the votes. Answers from JSON; calls no vendor and reads no credential.',
    type: repo.type,
    bin: { 'conclave-mcp': 'mcp/server.js', 'conclave-panel': 'tools/conclave-panel.js' },
    files: [...FILES],
    keywords: ['mcp', 'model-context-protocol', 'code-review', 'multi-vendor', 'conclave'],
    engines: { node: '>=20' },
    author: repo.author,
    license: repo.license,
    // The shape npm wants, so publishing corrects nothing and warns about nothing.
    repository: { type: 'git', url: 'git+https://github.com/nik1tsyganov/conclave.git' },
    homepage: 'https://github.com/nik1tsyganov/conclave',
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { outDir, manifest, files: [...FILES, 'README.md', 'package.json'].sort() };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const at = argv.indexOf('--out');
    if (at === -1 || !argv[at + 1]) throw new Error('Usage: npm-package --out <dir>');
    const result = build(path.resolve(argv[at + 1]));
    io.stdout.write(`${JSON.stringify({ ok: true, name: result.manifest.name, version: result.manifest.version, out: result.outDir, files: result.files }, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`NPM_PACKAGE_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { FILES, NAME, build };
