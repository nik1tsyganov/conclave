#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * Verify the CONCLAVE plugin layout from the repo root.
 *
 * Static packaging and documentation checks. This cannot authorize a dispatch.
 */

const fs = require('fs');
const path = require('path');
const { checkBriefText } = require('./cli-brief-rules-check.js');
const {
  SOURCE_SURFACE,
  INSTALLED_CONCLAVE_SURFACE,
  INSTALLED_CONCLAVE_CLI_SURFACE,
  checkManifestSurface,
} = require('./plugin-surface.js');

const ROOT = path.resolve(__dirname, '..');

function containsForbidden(text, needles) {
  const lowerText = text.toLowerCase();
  for (const needle of needles) {
    if (lowerText.includes(needle.toLowerCase())) {
      return needle;
    }
  }
  return null;
}

function checkBriefTemplate(text) {
  // Templates intentionally contain a SCOPE placeholder. Only this static
  // document check fills it; dispatch preflight must reject unfilled scopes.
  const body = text.replace(/^SCOPE: <[^>\r\n]+>\.?$/m, 'SCOPE: static template validation.');
  const missing = new Set();
  for (const vendor of ['openai', 'anthropic', 'google']) {
    for (const role of ['implement', 'review', 'verify', 'plan', 'research']) {
      const result = checkBriefText(body, { role, vendor, requireStructural: true });
      for (const item of result.missing) missing.add(item);
    }
  }
  return { ok: missing.size === 0, missing: [...missing] };
}

function check() {
  const required = [
    'package.json',
    'README.md',
    '.gitignore',
    '.cursor-plugin/plugin.json',
    '.cursor/skills/conclave/SKILL.md',
    '.cursor/skills/conclave/references/cursor-host.md',
    '.cursor/skills/conclave/references/cursor-cli.md',
    '.cursor/skills/conclave/references/brief-rules-block.md',
    '.cursor/skills/conclave/references/run-local-skill-bundle.md',
    '.cursor/skills/conclave-cli/SKILL.md',
    '.cursor/skills/conclave-cli/references/brief-rules-block.md',
    '.cursor/rules/conclave-arbiter.mdc',
    '.cursor/rules/conclave-activation.mdc',
    '.cursor/rules/conclave-orchestrator.mdc',
    '.cursor/rules/live-check.mdc',
    'commands/conclave.md',
    'commands/conclave-cli.md',
    'claude-commands/conclave.md',
    'tools/install-plugin.js',
    'tools/install-plugin.test.js',
    'tools/plugin-surface.js',
    'tools/plugin-check.js',
    'tools/host-resolver.js',
    'tools/hog-check.js',
    'tools/hog-check.test.js',
    'tools/activation-check.js',
    'tools/activation-check.test.js',
    'tools/plugin-check.test.js',
    'tools/telemetry-append.js',
    'tools/telemetry-append.test.js',
    'tools/telemetry-stats.js',
    'tools/telemetry-stats.test.js',
    'tools/telemetry-selftest.test.js',
    'tools/conclave-vault.js',
    'tools/conclave-vault-link.js',
    'tools/conclave-vault-sync.js',
    'tools/conclave-vault-analyze.js',
    'tools/conclave-vault.test.js',
    'tools/conclave-skill-web.js',
    'tools/conclave-skill-web.test.js',
    'skill-sources.json',
    'tools/validate-telemetry.js',
    'tools/validate-telemetry.test.js',
    'telemetry/schema.json',
    'tools/cli-smoke.js',
    'tools/cli-smoke.test.js',
    'tools/cli-brief-rules-check.js',
    'tools/cli-brief-rules-check.test.js',
    'tools/templates/brief-rules-block.md',
    'tools/cli-idle.js',
    'tools/cli-idle.test.js',
    'tools/cli-pointer.js',
    'tools/cli-pointer.test.js',
    'tools/task-delivery.js',
    'tools/task-delivery.test.js',
    'tools/position-tally.js',
    'tools/position-tally.test.js',
    'tools/conclave-bus-path.js',
    'tools/conclave-bus-path.test.js',
    'tools/receipt-ack.js',
    'tools/receipt-ack.test.js',
    'tools/handoff-envelope.js',
    'tools/handoff-envelope.test.js',
    'tools/utf8-hash.js',
    'tools/utf8-hash.test.js',
    'telemetry/README.md',
    'tools/dispatch-log.pass.jsonl',
    'tools/dispatch-log.fail.jsonl',
    'agents/implementer.md',
    'agents/verifier.md',
    'agents/reviewer.md',
    'agents/codex-implementer.md',
    'agents/codex-verifier.md',
    'agents/codex-reviewer.md',
    'agents/gemini-implementer.md',
    'agents/gemini-verifier.md',
    'agents/gemini-reviewer.md',
  ];

  for (const rel of required) {
    if (!fs.existsSync(path.join(ROOT, rel)) || !fs.statSync(path.join(ROOT, rel)).isFile()) {
      console.error(`MISSING: ${rel}`);
      return 1;
    }
  }

  const sourceManifestPath = path.join(ROOT, '.cursor-plugin/plugin.json');
  let sourceManifest;
  try {
    sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  } catch (error) {
    console.error(`plugin.json invalid JSON: ${error.message}`);
    return 1;
  }
  const sourceSurface = checkManifestSurface(sourceManifest, SOURCE_SURFACE);
  if (!sourceSurface.ok) {
    console.error(sourceSurface.error);
    return 1;
  }
  for (const rel of Object.values(SOURCE_SURFACE)) {
    const resolved = path.resolve(ROOT, rel);
    if (!fs.existsSync(resolved)) {
      console.error(`plugin.json surface path missing on disk: ${rel}`);
      return 1;
    }
  }

  const { conclaveCursorManifest, conclaveCliManifest } = require('./install-plugin.js');
  const installedConclave = checkManifestSurface(conclaveCursorManifest(), INSTALLED_CONCLAVE_SURFACE);
  if (!installedConclave.ok) {
    console.error(`install-plugin conclave ${installedConclave.error}`);
    return 1;
  }
  const installedCli = checkManifestSurface(conclaveCliManifest(), INSTALLED_CONCLAVE_CLI_SURFACE);
  if (!installedCli.ok) {
    console.error(`install-plugin conclave-cursor-cli ${installedCli.error}`);
    return 1;
  }

  const skill = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave/SKILL.md'), 'utf8');
  const skillStrings = [
    'conclave-whoami',
    'engineering-orchestrator',
    'conclave-mode',
    'conclave-dispatch',
    'mix-mode',
    'dispatch-efficiency',
    'task-retrospective',
    'graph-engineering',
    '60%',
    'activation-check',
    'check-compiler-errors',
    'cursor-packs.mdc',
    'brief-rules-block',
  ];
  for (const s of skillStrings) {
    if (!skill.includes(s)) {
      console.error(`SKILL.md missing required string: ${s}`);
      return 1;
    }
  }

  const conclaveCliSkill = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave-cli/SKILL.md'), 'utf8');
  if (!conclaveCliSkill.includes('references/cursor-cli.md')) {
    console.error('conclave-cli SKILL.md missing required co-located reference: references/cursor-cli.md');
    return 1;
  }
  if (!conclaveCliSkill.includes('references/brief-rules-block.md')) {
    console.error('conclave-cli SKILL.md missing required co-located reference: references/brief-rules-block.md');
    return 1;
  }
  if (conclaveCliSkill.includes('.cursor/skills/conclave/references/cursor-cli.md')) {
    console.error('conclave-cli SKILL.md contains stale required-reading path: .cursor/skills/conclave/references/cursor-cli.md');
    return 1;
  }
  for (const s of ['cursor-cli', 'conclave-whoami']) {
    if (!conclaveCliSkill.includes(s)) {
      console.error(`conclave-cli SKILL.md missing required string: ${s}`);
      return 1;
    }
  }

  const cursorCli = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave/references/cursor-cli.md'), 'utf8');
  const conclaveCliRef = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave-cli/references/cursor-cli.md'), 'utf8');

  if (cursorCli !== conclaveCliRef) {
    console.error('cursor-cli.md copies diverge: .cursor/skills/conclave/references/cursor-cli.md != .cursor/skills/conclave-cli/references/cursor-cli.md');
    return 1;
  }

  const briefRulesConclave = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave/references/brief-rules-block.md'), 'utf8');
  const briefRulesCli = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave-cli/references/brief-rules-block.md'), 'utf8');
  const briefRulesTemplate = fs.readFileSync(path.join(ROOT, 'tools/templates/brief-rules-block.md'), 'utf8');
  if (briefRulesConclave !== briefRulesCli) {
    console.error('brief-rules-block.md copies diverge: conclave/references != conclave-cli/references');
    return 1;
  }
  if (briefRulesConclave !== briefRulesTemplate) {
    console.error('brief-rules-block.md copies diverge: conclave/references != tools/templates');
    return 1;
  }
  const templateCheck = checkBriefTemplate(briefRulesConclave);
  if (!templateCheck.ok) {
    console.error(`brief-rules-block.md violates leaf-seat template contract: ${templateCheck.missing.join(', ')}`);
    return 1;
  }

  const skillBundleDesign = fs.readFileSync(
    path.join(ROOT, '.cursor/skills/conclave/references/run-local-skill-bundle.md'),
    'utf8',
  );
  for (const s of ['DESIGN', 'BackendEng', 'HANDOFF', 'not implemented', 'Conclave#4', '~/.local/bin/agy']) {
    if (!skillBundleDesign.includes(s)) {
      console.error(`run-local-skill-bundle.md missing required string: ${s}`);
      return 1;
    }
  }


  for (const ref of [cursorCli, conclaveCliRef]) {
    for (const s of [
      'cursor-cli', 'synara', 'join-manifest', 'dispatch-run.js', '--plan', '--run-dir', '--dispatch-id',
      'dispatch-matrix', 'seat-profiles', 'SEAT-CONTRACT.md', 'skills-manifest.json',
      'rules-manifest.json', 'cli-brief-rules-check.js', 'cli-proof',
      'CONCLAVE_RULES_ROOT', 'CONCLAVE_VAULT_ROOT', 'CONCLAVE_FIELD_LIBRARY_ROOT', 'RULES/INDEX.md', 'casper_via=agy',
    ]) {
      if (!ref.includes(s)) {
        console.error(`cursor-cli.md missing required string: ${s}`);
        return 1;
      }
    }
    if (!ref.includes('login') && !ref.includes('auth')) {
      console.error('cursor-cli.md missing required auth string: login or auth');
      return 1;
    }
  }

  const cmd = fs.readFileSync(path.join(ROOT, 'commands/conclave.md'), 'utf8');
  if (!cmd.includes('conclave-whoami')) {
    console.error('commands/conclave.md missing conclave-whoami');
    return 1;
  }
  if (!cmd.includes('--mode cursor')) {
    console.error('commands/conclave.md missing --mode cursor');
    return 1;
  }

  const cmdCli = fs.readFileSync(path.join(ROOT, 'commands/conclave-cli.md'), 'utf8');
  if (!cmdCli.includes('conclave-whoami')) {
    console.error('commands/conclave-cli.md missing conclave-whoami');
    return 1;
  }
  if (!cmdCli.includes('--mode cursor-cli')) {
    console.error('commands/conclave-cli.md missing --mode cursor-cli');
    return 1;
  }

  const claudeCmd = fs.readFileSync(path.join(ROOT, 'claude-commands/conclave.md'), 'utf8');
  if (!claudeCmd.includes('conclave-whoami')) {
    console.error('claude-commands/conclave.md missing conclave-whoami');
    return 1;
  }
  if (!claudeCmd.includes('claude-code')) {
    console.error('claude-commands/conclave.md missing claude-code');
    return 1;
  }

  const cursorHost = fs.readFileSync(path.join(ROOT, '.cursor/skills/conclave/references/cursor-host.md'), 'utf8');
  if (!cursorHost.includes('.claude/agents') && !cursorHost.includes('.claude\\agents\\')) {
    console.error('cursor-host.md missing .claude/agents path');
    return 1;
  }
  if (!cursorHost.includes('plugins/local/conclave/agents') && !cursorHost.includes('plugins\\local\\conclave\\agents')) {
    console.error('cursor-host.md missing plugins/local/conclave/agents path');
    return 1;
  }
  for (const s of [
    'claude-opus-5-thinking-high',
    'gpt-5.6-sol-medium',
    'gemini-3.1-pro',
    'host-resolver',
    'telemetry-append.js',
    'telemetry-stats.js',
    'validate-telemetry.js',
  ]) {
    if (!cursorHost.includes(s)) {
      console.error(`cursor-host.md missing required string: ${s}`);
      return 1;
    }
  }

  const ruleFiles = [
    '.cursor/rules/conclave-arbiter.mdc',
    '.cursor/rules/conclave-activation.mdc',
    '.cursor/rules/conclave-orchestrator.mdc',
    '.cursor/rules/live-check.mdc',
  ];
  for (const rel of ruleFiles) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (text.includes('alwaysApply: false')) {
      console.error(`${rel} contains alwaysApply: false`);
      return 1;
    }
    if (!text.includes('alwaysApply: true')) {
      console.error(`${rel} missing alwaysApply: true`);
      return 1;
    }
    if (text.includes('globs:')) {
      console.error(`${rel} contains globs:`);
      return 1;
    }
    if (rel !== '.cursor/rules/live-check.mdc' && !text.includes('CONCLAVE')) {
      console.error(`${rel} missing CONCLAVE ignore discriminator`);
      return 1;
    }
  }

  const forbidAuth = [
    'not logged in',
    'headless auth required',
    'auth required',
    'no headless claude cli exists',
    'until `claude auth login`',
    'until claude auth login'
  ];

  const cueDocsTargetA = ['README.md', '.cursor/skills/conclave/SKILL.md'];
  const cueDocsTargetB = [
    '.cursor/skills/conclave-cli/SKILL.md',
    '.cursor/skills/conclave/references/cursor-cli.md',
    '.cursor/skills/conclave-cli/references/cursor-cli.md',
    'commands/conclave-cli.md',
    'claude-commands/conclave.md'
  ];

  for (const rel of [...cueDocsTargetA, ...cueDocsTargetB]) {
    if (rel === '.cursor/rules/live-check.mdc') continue;
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const matched = containsForbidden(content, forbidAuth);
    if (matched) {
      console.error(`${rel} contains forbidden string: ${matched}`);
      return 1;
    }
  }

  for (const rel of cueDocsTargetA) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lowerContent = content.toLowerCase();
    if (!lowerContent.includes('claude auth status') && !lowerContent.includes('logged in') && !lowerContent.includes('loggedin') && !lowerContent.includes('live check')) {
      console.error(`${rel} missing live-check cue`);
      return 1;
    }
  }

  for (const rel of cueDocsTargetB) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lowerContent = content.toLowerCase();
    if (!lowerContent.includes('claude auth status') && !lowerContent.includes('loggedin') && !lowerContent.includes('live 2026-09-02')) {
      console.error(`${rel} missing live-check cue`);
      return 1;
    }
  }

  console.log('PLUGIN CHECK OK');
  return 0;
}

if (require.main === module) {
  process.exit(check());
}

module.exports = { check, containsForbidden, checkBriefTemplate };
