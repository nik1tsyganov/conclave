#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMatrix } = require('./dispatch-matrix.js');
const { loadProfiles } = require('./seat-policy.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED = [
  '.cursor-plugin/plugin.json',
  '.cursor/skills/magi-cli/SKILL.md',
  '.cursor/skills/magi-cli/references/dispatch-matrix.json',
  '.cursor/skills/magi-cli/references/seat-profiles.json',
  '.cursor/skills/magi-cli/references/brief-rules-block.md',
  '.cursor/skills/magi-cli/references/project-runs.md',
  '.cursor/rules/magi-arbiter.mdc',
  'commands/magi-cli.md',
  'tools/cli-adapters.js',
  'tools/cli-proof.js',
  'tools/cli-rules-stage.js',
  'tools/cli-skill-stage.js',
  'tools/cross-repo-check.js',
  'tools/dispatch-matrix.js',
  'tools/dispatch-run.js',
  'tools/dispatch-evidence.js',
  'tools/plan-seal.js',
  'tools/model-probe.js',
  'tools/probe-evidence.js',
  'tools/vendor-native.js',
  'tools/run-finalize.js',
  'tools/project-run-report.js',
  'tools/panel-tally.js',
  'tools/runtime-paths.js',
  'tools/dispatch-schema.js',
  'tools/magi-cli-preflight.js',
  'tools/magi-vault.js',
  'tools/magi-vault-link.js',
  'tools/magi-vault-sync.js',
  'tools/magi-vault-analyze.js',
  'tools/magi-skill-web.js',
  'skill-sources.json',
  'tools/model-availability.js',
  'tools/seat-policy.js',
  'tools/vendor-binaries.js',
  'site/index.html',
  'site/styles.css',
  'site/magi-core.svg',
  'site/architecture.svg',
];

function main(io = process) {
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    io.stderr.write(`RELEASE_CHECK_FAIL missing: ${missing.join(', ')}\n`);
    return 1;
  }
  const matrix = loadMatrix();
  if (
    matrix.schemaVersion < 3 ||
    !matrix.vendors?.openai?.models?.['gpt-6-astra'] ||
    matrix.vendors?.anthropic?.models?.fable?.canonical !== 'claude-fable-5-1' ||
    !Array.isArray(matrix.classes?.['architecture-planning']?.plan) ||
    !Array.isArray(matrix.classes?.['research-synthesis']?.research)
  ) {
    io.stderr.write('RELEASE_CHECK_FAIL dispatch matrix is stale or incomplete\n');
    return 1;
  }
  const profiles = loadProfiles();
  if (
    profiles.schemaVersion < 6 ||
    profiles.principles?.leafSeat !== true ||
    profiles.principles?.skillsAreAllowListed !== true ||
    profiles.principles?.bridgesAreArbiterOnly !== true ||
    profiles.principles?.proofMustDistinguishRequestedFromObserved !== true ||
    !profiles.roleSkills?.plan ||
    !profiles.roleSkills?.research ||
    (profiles.classSkills?.['agentic-long-run'] || []).length !== 0 ||
    (profiles.classSkills?.['extreme-end-to-end'] || []).length !== 0 ||
    ['loop-engineering', 'harness-engineering'].some((name) => ['baseSkills', 'roleSkills', 'classSkills'].flatMap((key) => Object.values(profiles[key] || {}).flat()).includes(name)) ||
    !['sessionId', 'vendorSideTokens', 'modelObserved', 'effortObserved'].every((field) => profiles.vendors?.anthropic?.proof?.includes(field))
  ) {
    io.stderr.write('RELEASE_CHECK_FAIL seat profiles are stale or not fail-closed\n');
    return 1;
  }
  const template = path.join(ROOT, 'tools', 'templates', 'brief-rules-block.md');
  const check = checkBriefFile(template);
  if (!check.ok) {
    io.stderr.write(`RELEASE_CHECK_FAIL brief template: ${check.missing.join(', ')}\n`);
    return 1;
  }
  io.stdout.write('MAGI CLI RELEASE CHECK HOLDS\n');
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { REQUIRED, main };
