#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { DEFAULT_RULES_ROOT, FINGERPRINT } = require('./cli-rules-stage.js');

const REQUIRED_SKILLS = Object.freeze([
  'engineering-orchestrator', 'graph-engineering', 'loop-engineering', 'harness-engineering',
  'evaluation-engineering', 'context-engineering', 'magi-mode', 'magi-dispatch', 'mix-mode',
  'dispatch-efficiency', 'task-retrospective', 'testing', 'codex-bridge', 'gemini-bridge', 'claude-bridge',
]);

function check(options = {}) {
  const home = options.home || os.homedir();
  const rulesRoot = options.rulesRoot || process.env.MAGI_RULES_ROOT || DEFAULT_RULES_ROOT;
  const findings = [];
  for (const vendor of ['openai', 'google', 'anthropic']) {
    try { findings.push({ check: `binary:${vendor}`, ok: true, value: resolveVendorBinary(vendor, { home, env: options.env }) }); }
    catch (error) { findings.push({ check: `binary:${vendor}`, ok: false, error: error.message }); }
  }
  for (const skill of REQUIRED_SKILLS) {
    const file = path.join(home, '.claude', 'skills', skill, 'SKILL.md');
    findings.push({ check: `skill:${skill}`, ok: fs.existsSync(file), value: file });
  }
  const standing = path.join(rulesRoot, 'STANDING.md');
  let fingerprint = null;
  try { fingerprint = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0]; } catch {}
  findings.push({ check: 'rules:fingerprint', ok: fingerprint === FINGERPRINT, value: standing, observed: fingerprint });
  const rulesDir = path.join(rulesRoot, 'RULES');
  let ruleCount = 0;
  try { ruleCount = fs.readdirSync(rulesDir).filter((name) => /^R\d{2}-.*\.md$/.test(name)).length; } catch {}
  findings.push({ check: 'rules:R01-R21', ok: ruleCount >= 21, value: rulesDir, observed: ruleCount });
  return { ok: findings.every((f) => f.ok), findings };
}

function main(argv = process.argv.slice(2), io = process) {
  const rootIndex = argv.indexOf('--rules-root');
  const result = check({ rulesRoot: rootIndex === -1 ? undefined : argv[rootIndex + 1] });
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main();
module.exports = { REQUIRED_SKILLS, check, main };
