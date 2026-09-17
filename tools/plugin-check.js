#!/usr/bin/env node
'use strict';

/**
 * Verify the MAGI plugin layout from the repo root.
 *
 * Static packaging and documentation checks. This cannot authorize a dispatch.
 */

const fs = require('fs');
const path = require('path');
const { checkBriefText } = require('./cli-brief-rules-check.js');
const {
  SOURCE_SURFACE,
  INSTALLED_MAGI_SURFACE,
  INSTALLED_MAGI_CLI_SURFACE,
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
    '.cursor/skills/magi/SKILL.md',
    '.cursor/skills/magi/references/cursor-host.md',
    '.cursor/skills/magi/references/cursor-cli.md',
    '.cursor/skills/magi/references/brief-rules-block.md',
    '.cursor/skills/magi/references/run-local-skill-bundle.md',
    '.cursor/skills/magi-cli/SKILL.md',
    '.cursor/skills/magi-cli/references/brief-rules-block.md',
    '.cursor/rules/magi-arbiter.mdc',
    '.cursor/rules/magi-activation.mdc',
    '.cursor/rules/magi-orchestrator.mdc',
    '.cursor/rules/live-check.mdc',
    'commands/magi.md',
    'commands/magi-cli.md',
    'claude-commands/magi.md',
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
    'tools/magi-vault.js',
    'tools/magi-vault-link.js',
    'tools/magi-vault-sync.js',
    'tools/magi-vault-analyze.js',
    'tools/magi-vault.test.js',
    'tools/magi-skill-web.js',
    'tools/magi-skill-web.test.js',
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
    'tools/magi-bus-path.js',
    'tools/magi-bus-path.test.js',
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

  const { magiCursorManifest, magiCliManifest } = require('./install-plugin.js');
  const installedMagi = checkManifestSurface(magiCursorManifest(), INSTALLED_MAGI_SURFACE);
  if (!installedMagi.ok) {
    console.error(`install-plugin magi ${installedMagi.error}`);
    return 1;
  }
  const installedCli = checkManifestSurface(magiCliManifest(), INSTALLED_MAGI_CLI_SURFACE);
  if (!installedCli.ok) {
    console.error(`install-plugin magi-cursor-cli ${installedCli.error}`);
    return 1;
  }

  const skill = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi/SKILL.md'), 'utf8');
  const skillStrings = [
    'magi-whoami',
    'engineering-orchestrator',
    'magi-mode',
    'magi-dispatch',
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

  const magiCliSkill = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi-cli/SKILL.md'), 'utf8');
  if (!magiCliSkill.includes('references/cursor-cli.md')) {
    console.error('magi-cli SKILL.md missing required co-located reference: references/cursor-cli.md');
    return 1;
  }
  if (!magiCliSkill.includes('references/brief-rules-block.md')) {
    console.error('magi-cli SKILL.md missing required co-located reference: references/brief-rules-block.md');
    return 1;
  }
  if (magiCliSkill.includes('.cursor/skills/magi/references/cursor-cli.md')) {
    console.error('magi-cli SKILL.md contains stale required-reading path: .cursor/skills/magi/references/cursor-cli.md');
    return 1;
  }
  for (const s of ['cursor-cli', 'magi-whoami']) {
    if (!magiCliSkill.includes(s)) {
      console.error(`magi-cli SKILL.md missing required string: ${s}`);
      return 1;
    }
  }

  const cursorCli = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi/references/cursor-cli.md'), 'utf8');
  const magiCliRef = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi-cli/references/cursor-cli.md'), 'utf8');

  if (cursorCli !== magiCliRef) {
    console.error('cursor-cli.md copies diverge: .cursor/skills/magi/references/cursor-cli.md != .cursor/skills/magi-cli/references/cursor-cli.md');
    return 1;
  }

  const briefRulesMagi = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi/references/brief-rules-block.md'), 'utf8');
  const briefRulesCli = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi-cli/references/brief-rules-block.md'), 'utf8');
  const briefRulesTemplate = fs.readFileSync(path.join(ROOT, 'tools/templates/brief-rules-block.md'), 'utf8');
  if (briefRulesMagi !== briefRulesCli) {
    console.error('brief-rules-block.md copies diverge: magi/references != magi-cli/references');
    return 1;
  }
  if (briefRulesMagi !== briefRulesTemplate) {
    console.error('brief-rules-block.md copies diverge: magi/references != tools/templates');
    return 1;
  }
  const templateCheck = checkBriefTemplate(briefRulesMagi);
  if (!templateCheck.ok) {
    console.error(`brief-rules-block.md violates leaf-seat template contract: ${templateCheck.missing.join(', ')}`);
    return 1;
  }

  const skillBundleDesign = fs.readFileSync(
    path.join(ROOT, '.cursor/skills/magi/references/run-local-skill-bundle.md'),
    'utf8',
  );
  for (const s of ['DESIGN', 'BackendEng', 'HANDOFF', 'not implemented', 'Magi#4', '~/.local/bin/agy']) {
    if (!skillBundleDesign.includes(s)) {
      console.error(`run-local-skill-bundle.md missing required string: ${s}`);
      return 1;
    }
  }


  for (const ref of [cursorCli, magiCliRef]) {
    for (const s of [
      'cursor-cli', 'synara', 'join-manifest', 'dispatch-run.js', '--plan', '--run-dir', '--dispatch-id',
      'dispatch-matrix', 'seat-profiles', 'SEAT-CONTRACT.md', 'skills-manifest.json',
      'rules-manifest.json', 'cli-brief-rules-check.js', 'cli-proof',
      'MAGI_RULES_ROOT', 'MAGI_VAULT_ROOT', 'MAGI_FIELD_LIBRARY_ROOT', 'RULES/INDEX.md', 'casper_via=agy',
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

  const cmd = fs.readFileSync(path.join(ROOT, 'commands/magi.md'), 'utf8');
  if (!cmd.includes('magi-whoami')) {
    console.error('commands/magi.md missing magi-whoami');
    return 1;
  }
  if (!cmd.includes('--mode cursor')) {
    console.error('commands/magi.md missing --mode cursor');
    return 1;
  }

  const cmdCli = fs.readFileSync(path.join(ROOT, 'commands/magi-cli.md'), 'utf8');
  if (!cmdCli.includes('magi-whoami')) {
    console.error('commands/magi-cli.md missing magi-whoami');
    return 1;
  }
  if (!cmdCli.includes('--mode cursor-cli')) {
    console.error('commands/magi-cli.md missing --mode cursor-cli');
    return 1;
  }

  const claudeCmd = fs.readFileSync(path.join(ROOT, 'claude-commands/magi.md'), 'utf8');
  if (!claudeCmd.includes('magi-whoami')) {
    console.error('claude-commands/magi.md missing magi-whoami');
    return 1;
  }
  if (!claudeCmd.includes('claude-code')) {
    console.error('claude-commands/magi.md missing claude-code');
    return 1;
  }

  const cursorHost = fs.readFileSync(path.join(ROOT, '.cursor/skills/magi/references/cursor-host.md'), 'utf8');
  if (!cursorHost.includes('.claude/agents') && !cursorHost.includes('.claude\\agents\\')) {
    console.error('cursor-host.md missing .claude/agents path');
    return 1;
  }
  if (!cursorHost.includes('plugins/local/magi/agents') && !cursorHost.includes('plugins\\local\\magi\\agents')) {
    console.error('cursor-host.md missing plugins/local/magi/agents path');
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
    '.cursor/rules/magi-arbiter.mdc',
    '.cursor/rules/magi-activation.mdc',
    '.cursor/rules/magi-orchestrator.mdc',
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

  const cueDocsTargetA = ['README.md', '.cursor/skills/magi/SKILL.md'];
  const cueDocsTargetB = [
    '.cursor/skills/magi-cli/SKILL.md',
    '.cursor/skills/magi/references/cursor-cli.md',
    '.cursor/skills/magi-cli/references/cursor-cli.md',
    'commands/magi-cli.md',
    'claude-commands/magi.md'
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
