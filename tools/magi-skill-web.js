#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { FORBIDDEN_ARBITER_SKILLS, regularFiles } = require('./cli-skill-stage.js');
const { resolveRuntimePaths } = require('./runtime-paths.js');
const { ensureVaultHome, envOf, looksSecret, requireVaultRoot, vaultError } = require('./magi-vault.js');

const HARMFUL_RE = /keylogger|ransomware|credential.?steal|ignore (all )?(previous|prior) instructions|exfiltrat/i;
const POINTER_FILES = Object.freeze(['MODULE.md', 'README.md']);
const SOURCES_FILE = path.resolve(__dirname, '..', 'skill-sources.json');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadSourceContract() {
  return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
}

function listSkillNames(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => (
    entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== '.git'
  )).map((entry) => entry.name).sort();
}

function skillHash(skillRoot) {
  return regularFiles(skillRoot).map((file) => ({
    path: path.relative(skillRoot, file).replaceAll('\\', '/'),
    sha256: digest(file),
  }));
}

function scanSkill(sourceId, skillRoot, name, allowForbidden, scanBodies = true) {
  const findings = [];
  const skillMd = path.join(skillRoot, 'SKILL.md');
  if (!fs.existsSync(skillMd) || !fs.lstatSync(skillMd).isFile()) {
    const pointer = POINTER_FILES.find((file) => fs.existsSync(path.join(skillRoot, file)));
    return { name, sourceId, kind: pointer ? 'pointer' : 'missing-skill', findings: pointer ? [] : [{ id: 'missing-skill', severity: 'fail', detail: `${sourceId}/${name} has no SKILL.md` }] };
  }
  if (!allowForbidden && FORBIDDEN_ARBITER_SKILLS.includes(name)) {
    findings.push({ id: 'forbidden-on-source', severity: 'fail', detail: `arbiter skill ${name} cannot live in ${sourceId}` });
  }
  if (scanBodies) {
    const files = regularFiles(skillRoot);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(skillRoot, file).replaceAll('\\', '/');
      if (looksSecret(text)) findings.push({ id: 'secret', severity: 'fail', detail: `${sourceId}/${name}/${relative} looks like a credential` });
      if (HARMFUL_RE.test(text)) findings.push({ id: 'harmful', severity: 'fail', detail: `${sourceId}/${name}/${relative} matches a harmful-skill pattern` });
      if (path.basename(file) === 'SKILL.md' && !text.trim()) findings.push({ id: 'empty', severity: 'fail', detail: `${sourceId}/${name}/SKILL.md is empty` });
    }
  }
  return { name, sourceId, kind: 'skill', files: skillHash(skillRoot), findings };
}

function resolveOptionalDir(raw, markerFiles) {
  if (!raw) return null;
  const root = path.resolve(raw);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) throw vaultError(`skill-web root is not a directory: ${raw}`);
  for (const relative of markerFiles) {
    if (!fs.existsSync(path.join(root, ...relative.split('/')))) throw vaultError(`skill-web root is missing ${relative}: ${raw}`);
  }
  return root;
}

function resolveSources(options = {}) {
  const env = envOf(options);
  const contract = options.contract || loadSourceContract();
  const magi = resolveRuntimePaths({ root: options.runtimeRoot });
  const vaultRoot = options.vaultRoot || (env.MAGI_VAULT_ROOT ? requireVaultRoot(options) : null);
  return {
    contract,
    magi,
    vaultRoot,
    sources: [
      { id: 'magi-seats', root: magi.seatSkillsRoot, allowForbidden: false },
      { id: 'ai-ops-methods', root: vaultRoot ? path.join(vaultRoot, 'skills') : null, allowForbidden: false },
      { id: 'field-library', root: resolveOptionalDir(options.fieldLibraryRoot || env.MAGI_FIELD_LIBRARY_ROOT, ['INDEX.md', 'modules']), allowForbidden: false, skillDir: 'modules' },
      { id: 'vault-skills', root: resolveOptionalDir(options.vaultSkillsRoot || env.MAGI_VAULT_SKILLS_ROOT, ['README.md', 'skills/vault-ingest/SKILL.md']), allowForbidden: false, skillDir: 'skills' },
      { id: 'host-store', root: resolveOptionalDir(options.hostSkillsRoot || env.MAGI_HOST_SKILLS_ROOT, []), allowForbidden: true, scanBodies: false },
    ],
  };
}

function relatedSources(contract, name) {
  return contract.relatedNames?.[name] || [];
}

function auditWeb(scanned, contract) {
  const findings = [];
  const byName = new Map();
  for (const skill of scanned) {
    findings.push(...skill.findings);
    if (skill.kind !== 'skill') continue;
    const list = byName.get(skill.name) || [];
    list.push(skill);
    byName.set(skill.name, list);
  }
  for (const [name, copies] of byName) {
    if (copies.length < 2) continue;
    const sources = copies.map((item) => item.sourceId).sort();
    const related = relatedSources(contract, name);
    const unexpected = sources.filter((id) => !related.includes(id));
    if (unexpected.length && sources.some((id) => !related.includes(id))) {
      const hashes = new Set(copies.map((item) => JSON.stringify(item.files)));
      if (hashes.size > 1 && related.length === 0) {
        findings.push({ id: 'redundant-unrelated', severity: 'fail', detail: `${name} appears in ${sources.join(', ')} with different bytes and no relatedNames entry` });
      } else if (related.length === 0) {
        findings.push({ id: 'redundant-unrelated', severity: 'attention', detail: `${name} appears in ${sources.join(', ')} with no relatedNames entry` });
      }
    }
    if (related.length && sources.some((id) => !related.includes(id))) {
      findings.push({ id: 'related-name-drift', severity: 'attention', detail: `${name} sources ${sources.join(', ')} differ from catalog ${related.join(', ')}` });
    }
  }
  const leaf = scanned.filter((item) => item.sourceId === 'magi-seats' && item.kind === 'skill').map((item) => item.name);
  for (const skill of scanned.filter((item) => ['field-library', 'vault-skills', 'ai-ops-methods'].includes(item.sourceId) && item.kind === 'skill')) {
    if (leaf.includes(skill.name) && !relatedSources(contract, skill.name).includes('magi-seats')) {
      findings.push({ id: 'field-on-leaf', severity: 'fail', detail: `${skill.sourceId}/${skill.name} collides with a MAGI leaf card` });
    }
  }
  return findings;
}

function indexSkillWeb(options = {}) {
  const resolved = resolveSources(options);
  const scanned = [];
  const sourceStatus = [];
  for (const source of resolved.sources) {
    if (!source.root) {
      sourceStatus.push({ id: source.id, status: 'absent' });
      continue;
    }
    const root = source.skillDir ? path.join(source.root, source.skillDir) : source.root;
    sourceStatus.push({ id: source.id, status: 'present', root });
    for (const name of listSkillNames(root)) scanned.push(scanSkill(source.id, path.join(root, name), name, source.allowForbidden, source.scanBodies !== false));
  }
  const findings = auditWeb(scanned, resolved.contract);
  const report = {
    schemaVersion: 1,
    indexedAt: new Date().toISOString(),
    decision: resolved.contract.decision,
    reason: resolved.contract.reason,
    sources: sourceStatus,
    skills: scanned.map((item) => ({ name: item.name, sourceId: item.sourceId, kind: item.kind, files: item.files ? item.files.length : 0 })),
    findings,
    needsAttention: findings.some((item) => item.severity !== 'ok'),
    ok: !findings.some((item) => item.severity === 'fail'),
  };
  if (options.write !== false && resolved.vaultRoot) {
    const layout = ensureVaultHome(resolved.vaultRoot);
    fs.writeFileSync(layout.skillWebJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(layout.skillWebMd, renderSkillWebMarkdown(report), 'utf8');
    report.skillWebJson = layout.skillWebJson;
    report.skillWebMd = layout.skillWebMd;
  }
  return report;
}

function renderSkillWebMarkdown(report) {
  const lines = [
    '# MAGI skill web',
    '',
    `Indexed at: ${report.indexedAt}`,
    `Merge decision: ${report.decision}`,
    `Needs attention: ${report.needsAttention ? 'yes' : 'no'}`,
    `Ok: ${report.ok ? 'yes' : 'no'}`,
    '',
    report.reason,
    '',
    '## Sources',
    '',
  ];
  for (const source of report.sources) lines.push(`- \`${source.id}\`: ${source.status}${source.root ? ` — ${source.root}` : ''}`);
  lines.push('', '## Skills', '');
  for (const skill of report.skills) lines.push(`- ${skill.sourceId}/${skill.name} (${skill.kind}, ${skill.files} files)`);
  lines.push('', '## Findings', '');
  if (!report.findings.length) lines.push('- none');
  for (const item of report.findings) lines.push(`- \`${item.severity}\` ${item.id} — ${item.detail}`);
  lines.push('', 'Field modules and Obsidian ingest methods stay in their own git repos. This catalog is the link MAGI and the vault read.');
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    if (argv.length) throw vaultError('Usage: magi-skill-web.js');
    const report = indexSkillWeb();
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? (report.needsAttention ? 1 : 0) : 2;
  } catch (error) {
    io.stderr.write(`SKILL_WEB_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {
  HARMFUL_RE,
  SOURCES_FILE,
  auditWeb,
  indexSkillWeb,
  loadSourceContract,
  main,
  renderSkillWebMarkdown,
  scanSkill,
};
