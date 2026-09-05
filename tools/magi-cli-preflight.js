#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { DEFAULT_RULES_ROOT, FINGERPRINT } = require('./cli-rules-stage.js');
const { loadProfiles } = require('./seat-policy.js');

function unique(values) { return [...new Set(values)]; }

function requiredSeatSkills(profiles) {
  return unique([
    ...Object.values(profiles.baseSkills || {}).flat(),
    ...Object.values(profiles.roleSkills || {}).flat(),
    ...Object.values(profiles.classSkills || {}).flat(),
  ]);
}

function check(options = {}) {
  const home = options.home || os.homedir();
  const rulesRoot = options.rulesRoot || process.env.MAGI_RULES_ROOT || DEFAULT_RULES_ROOT;
  const profiles = loadProfiles(options.seatProfiles);
  const findings = [];

  for (const vendor of ['openai', 'google', 'anthropic']) {
    try { findings.push({ check: `binary:${vendor}`, ok: true, value: resolveVendorBinary(vendor, { home, env: options.env }) }); }
    catch (error) { findings.push({ check: `binary:${vendor}`, ok: false, error: error.message }); }
  }

  const arbiterSkills = unique(profiles.arbiterSkills || []);
  const seatSkills = requiredSeatSkills(profiles);
  for (const skill of arbiterSkills) {
    const file = path.join(home, '.claude', 'skills', skill, 'SKILL.md');
    findings.push({ check: `arbiter-skill:${skill}`, ok: fs.existsSync(file), value: file });
  }
  for (const skill of seatSkills) {
    const file = path.join(home, '.claude', 'skills', skill, 'SKILL.md');
    findings.push({ check: `seat-skill:${skill}`, ok: fs.existsSync(file), value: file });
  }

  const overlap = seatSkills.filter((skill) => arbiterSkills.includes(skill) && profiles.forbiddenSeatSkills?.includes(skill));
  findings.push({ check: 'skills:arbiter-seat-separation', ok: overlap.length === 0, observed: overlap });

  const standing = path.join(rulesRoot, 'STANDING.md');
  let fingerprint = null;
  try { fingerprint = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0]; } catch {}
  findings.push({ check: 'rules:fingerprint', ok: fingerprint === FINGERPRINT, value: standing, observed: fingerprint });
  const rulesDir = path.join(rulesRoot, 'RULES');
  let ruleCount = 0;
  try { ruleCount = fs.readdirSync(rulesDir).filter((name) => /^R\d{2}-.*\.md$/.test(name)).length; } catch {}
  findings.push({ check: 'rules:R01-R21', ok: ruleCount >= 21, value: rulesDir, observed: ruleCount });

  return { ok: findings.every((f) => f.ok), arbiterSkills, seatSkills, findings };
}

function main(argv = process.argv.slice(2), io = process) {
  const rootIndex = argv.indexOf('--rules-root');
  const profileIndex = argv.indexOf('--seat-profiles');
  const result = check({
    rulesRoot: rootIndex === -1 ? undefined : argv[rootIndex + 1],
    seatProfiles: profileIndex === -1 ? undefined : argv[profileIndex + 1],
  });
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main();
module.exports = { check, main, requiredSeatSkills };
