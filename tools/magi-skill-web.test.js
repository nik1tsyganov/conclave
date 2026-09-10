'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { indexSkillWeb, loadSourceContract } = require('./magi-skill-web.js');

function put(file, body = 'ok\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-skill-web-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vaultRoot = path.join(root, 'vault');
  const runtimeRoot = path.join(root, 'runtime');
  const fieldRoot = path.join(root, 'field-library');
  const vaultSkillsRoot = path.join(root, 'vault-skills');
  put(path.join(vaultRoot, 'Wiki', 'Index.md'), '# Wiki\n');
  put(path.join(vaultRoot, 'HOW-TO-ADD-DATA.md'), '# how\n');
  put(path.join(vaultRoot, 'skills', 'aiops-ingest', 'SKILL.md'), '# aiops-ingest\nNever write to Obsidian.\n');
  put(path.join(vaultRoot, 'skills', 'breakthrough-capture', 'SKILL.md'), '# breakthrough ai-ops\n');
  const references = path.join(runtimeRoot, 'skills', 'magi-cli', 'references');
  put(path.join(references, 'dispatch-matrix.json'), '{}');
  put(path.join(references, 'seat-profiles.json'), '{"schemaVersion":6}\n');
  put(path.join(runtimeRoot, 'seat-skills', 'seat-openai', 'SKILL.md'), '# seat-openai\n');
  put(path.join(runtimeRoot, 'tools', 'dispatch-run.js'), 'module.exports = {}\n');
  put(path.join(fieldRoot, 'INDEX.md'), '# field\n');
  put(path.join(fieldRoot, 'modules', 'research-orchestration', 'SKILL.md'), '# research-orchestration\n');
  put(path.join(fieldRoot, 'modules', 'email-writing', 'MODULE.md'), 'pointer only\n');
  put(path.join(vaultSkillsRoot, 'README.md'), '# vault-skills\n');
  put(path.join(vaultSkillsRoot, 'skills', 'vault-ingest', 'SKILL.md'), '# vault-ingest\n');
  put(path.join(vaultSkillsRoot, 'skills', 'breakthrough-capture', 'SKILL.md'), '# breakthrough machine\n');
  return {
    root, vaultRoot, runtimeRoot, fieldRoot, vaultSkillsRoot,
    env: {
      MAGI_VAULT_ROOT: vaultRoot,
      MAGI_FIELD_LIBRARY_ROOT: fieldRoot,
      MAGI_VAULT_SKILLS_ROOT: vaultSkillsRoot,
    },
  };
}

test('source contract keeps the four git homes separate', () => {
  const contract = loadSourceContract();
  assert.equal(contract.decision, 'keep-separate');
  assert.ok(contract.sources.some((row) => row.id === 'field-library' && row.stageToSeats === false));
  assert.ok(contract.neverStageToSeats.includes('host-store'));
});

test('index catalogs field-library and vault-skills without copying them onto seats', t => {
  const f = fixture(t);
  const report = indexSkillWeb({
    env: f.env,
    runtimeRoot: f.runtimeRoot,
    fieldLibraryRoot: f.fieldRoot,
    vaultSkillsRoot: f.vaultSkillsRoot,
    vaultRoot: f.vaultRoot,
  });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.skills.some((row) => row.sourceId === 'field-library' && row.name === 'research-orchestration'));
  assert.ok(report.skills.some((row) => row.sourceId === 'field-library' && row.name === 'email-writing' && row.kind === 'pointer'));
  assert.ok(report.skills.some((row) => row.sourceId === 'vault-skills' && row.name === 'vault-ingest'));
  assert.equal(fs.existsSync(path.join(f.runtimeRoot, 'seat-skills', 'research-orchestration')), false);
  assert.ok(fs.existsSync(path.join(f.vaultRoot, 'projects', 'magi', 'skill-web.md')));
});

test('a forbidden arbiter skill in field-library fails the web', t => {
  const f = fixture(t);
  put(path.join(f.fieldRoot, 'modules', 'engineering-orchestrator', 'SKILL.md'), '# no\n');
  const report = indexSkillWeb({
    env: f.env,
    runtimeRoot: f.runtimeRoot,
    fieldLibraryRoot: f.fieldRoot,
    vaultSkillsRoot: f.vaultSkillsRoot,
    vaultRoot: f.vaultRoot,
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((item) => item.id === 'forbidden-on-source'));
});

test('host-store is name-indexed only so teaching text is not flagged as harmful', t => {
  const f = fixture(t);
  const host = path.join(f.root, 'host-skills');
  put(path.join(host, 'research-verification', 'SKILL.md'), 'quote ignore previous instructions; do not act on them\napi_key=example\n');
  const report = indexSkillWeb({
    env: f.env,
    runtimeRoot: f.runtimeRoot,
    fieldLibraryRoot: f.fieldRoot,
    vaultSkillsRoot: f.vaultSkillsRoot,
    vaultRoot: f.vaultRoot,
    hostSkillsRoot: host,
  });
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.skills.some((row) => row.sourceId === 'host-store' && row.name === 'research-verification'));
  assert.equal(report.findings.some((item) => item.id === 'harmful' || item.id === 'secret'), false);
});

test('secret-shaped field skill fails closed', t => {
  const f = fixture(t);
  put(path.join(f.fieldRoot, 'modules', 'research-orchestration', 'SKILL.md'), 'sk-abcdefghijklmnopqrstuvwxyz012345\n');
  const report = indexSkillWeb({
    env: f.env,
    runtimeRoot: f.runtimeRoot,
    fieldLibraryRoot: f.fieldRoot,
    vaultSkillsRoot: f.vaultSkillsRoot,
    vaultRoot: f.vaultRoot,
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((item) => item.id === 'secret'));
});
