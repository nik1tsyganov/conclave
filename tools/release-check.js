#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMatrix } = require('./dispatch-matrix.js');
const { loadProfiles } = require('./seat-policy.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED = [
  '.cursor-plugin/plugin.json',
  '.cursor/skills/conclave-cli/SKILL.md',
  '.cursor/skills/conclave-cli/references/dispatch-matrix.json',
  '.cursor/skills/conclave-cli/references/seat-profiles.json',
  '.cursor/skills/conclave-cli/references/brief-rules-block.md',
  '.cursor/skills/conclave-cli/references/project-runs.md',
  '.cursor/rules/conclave-arbiter.mdc',
  'commands/conclave-cli.md',
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
  'tools/conclave-cli-preflight.js',
  'tools/conclave-vault.js',
  'tools/conclave-vault-link.js',
  'tools/conclave-vault-sync.js',
  'tools/jev-client.js',
  'tools/jev-arbiter.js',
  'tools/jev-plan-classify.js',
  'tools/panel-tally-jev.js',
  'tools/run-drive.js',
  'tools/launch-retry.js',
  'tools/ledger-row.js',
  'tools/conclave-dashboard.js',
  'tools/conclave-vault-analyze.js',
  'tools/conclave-skill-web.js',
  'skill-sources.json',
  'tools/model-availability.js',
  'tools/seat-policy.js',
  'tools/vendor-binaries.js',
  'site/index.html',
  'site/conclave-core.svg',
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
  io.stdout.write('CONCLAVE CLI RELEASE CHECK HOLDS\n');
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { REQUIRED, main };
