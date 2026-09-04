#!/usr/bin/env node
'use strict';

/**
 * Verify the MAGI plugin layout from the repo root.
 *
 * Exit 0 iff all required paths exist and the required strings are present.
 */

const fs = require('fs');
const path = require('path');

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

function check() {
  const required = [
    'package.json',
    'README.md',
    '.gitignore',
    '.cursor-plugin/plugin.json',
    '.cursor/skills/magi/SKILL.md',
    '.cursor/skills/magi/references/cursor-host.md',
    '.cursor/skills/magi/references/cursor-cli.md',
    '.cursor/skills/magi-cli/SKILL.md',
    '.cursor/rules/magi-arbiter.mdc',
    '.cursor/rules/magi-activation.mdc',
    '.cursor/rules/magi-orchestrator.mdc',
    '.cursor/rules/live-check.mdc',
    'commands/magi.md',
    'commands/magi-cli.md',
    'claude-commands/magi.md',
    'tools/install-plugin.js',
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
    'tools/cli-launch.js',
    'tools/cli-launch.test.js',
    'tools/cli-smoke.js',
    'tools/cli-smoke.test.js',
    'tools/cli-delivery-fail.test.js',
    'tools/cli-idle.js',
    'tools/cli-idle.test.js',
    'tools/cli-pointer.js',
    'tools/cli-pointer.test.js',
    'tools/cli-claude.js',
    'tools/cli-claude.test.js',
    'tools/cli-gemini.js',
    'tools/cli-gemini.test.js',
    'tools/task-delivery.js',
    'tools/task-delivery.test.js',
    'tools/position-tally.js',
    'tools/position-tally.test.js',
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
    if (!fs.existsSync(path.join(ROOT, rel))) {
      console.error(`MISSING: ${rel}`);
      return 1;
    }
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


  for (const ref of [cursorCli, magiCliRef]) {
    for (const s of ['codex.exe', 'agy.exe', 'cursor-cli', '.local\\bin\\claude.exe', 'fable', 'xhigh', 'telemetry-append.js']) {
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

module.exports = { check, containsForbidden };
