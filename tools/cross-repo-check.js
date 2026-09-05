#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadProfiles } = require('./seat-policy.js');
const { FINGERPRINT } = require('./cli-rules-stage.js');

const DEFAULT_KIT_ROOT = 'C:\\src\\magi-kit';
const DEFAULT_VAULT_ROOT = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules';

function fail(message) { const e = new Error(message); e.code = 'CROSS_REPO_FAIL'; throw e; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(`cannot read ${file}: ${error.message}`); } }
function sorted(values) { return [...new Set(values)].sort(); }
function same(a, b) { return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b)); }

function check(options = {}) {
  const kitRoot = path.resolve(options.kitRoot || process.env.MAGI_KIT_ROOT || DEFAULT_KIT_ROOT);
  const vaultRoot = path.resolve(options.vaultRoot || process.env.MAGI_RULES_ROOT || DEFAULT_VAULT_ROOT);
  const profiles = loadProfiles(options.seatProfiles);
  const kit = readJson(path.join(kitRoot, 'magi', 'seat-skills.json'));

  const findings = [];
  for (const role of Object.keys(profiles.roleSkills)) {
    const ok = same(profiles.roleSkills[role], kit.roles?.[role] || []);
    findings.push({ check: `kit-role:${role}`, ok });
  }
  for (const className of Object.keys(profiles.classSkills)) {
    const ok = same(profiles.classSkills[className], kit.classes?.[className] || []);
    findings.push({ check: `kit-class:${className}`, ok });
  }
  const forbidden = sorted(profiles.forbiddenSeatSkills || []);
  const kitArbiter = sorted(kit.arbiterOnly || []);
  const missingArbiterPins = forbidden.filter((skill) => !kitArbiter.includes(skill));
  findings.push({ check: 'kit-arbiter-separation', ok: missingArbiterPins.length === 0, observed: missingArbiterPins });

  const standingPath = path.join(vaultRoot, 'STANDING.md');
  let firstLine = null;
  try { firstLine = fs.readFileSync(standingPath, 'utf8').split(/\r?\n/, 1)[0]; } catch {}
  findings.push({ check: 'vault-fingerprint', ok: firstLine === FINGERPRINT, observed: firstLine });

  const rulesDir = path.join(vaultRoot, 'RULES');
  let ruleCount = 0;
  try { ruleCount = fs.readdirSync(rulesDir).filter((name) => /^R\d{2}-.*\.md$/.test(name)).length; } catch {}
  findings.push({ check: 'vault-R01-R21', ok: ruleCount >= 21, observed: ruleCount });

  let briefBlock = '';
  try { briefBlock = fs.readFileSync(path.join(vaultRoot, 'BRIEF-RULES-BLOCK.md'), 'utf8'); } catch {}
  findings.push({ check: 'vault-seat-contract-language', ok: briefBlock.includes('SEAT-CONTRACT.md') && briefBlock.includes('skills/skills-manifest.json') });

  return { ok: findings.every((finding) => finding.ok), kitRoot, vaultRoot, findings };
}

function main(argv = process.argv.slice(2), io = process) {
  const kitIndex = argv.indexOf('--kit-root');
  const vaultIndex = argv.indexOf('--vault-root');
  try {
    const result = check({
      kitRoot: kitIndex === -1 ? undefined : argv[kitIndex + 1],
      vaultRoot: vaultIndex === -1 ? undefined : argv[vaultIndex + 1],
    });
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`${error.code || 'CROSS_REPO_FAIL'}: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { check, main };
