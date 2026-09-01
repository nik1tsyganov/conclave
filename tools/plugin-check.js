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
    'commands/magi.md',
    'commands/magi-cli.md',
    'claude-commands/magi.md',
    'tools/install-plugin.js',
    'tools/plugin-check.js',
    'tools/hog-check.js',
    'tools/hog-check.test.js',
    'tools/activation-check.js',
    'tools/activation-check.test.js',
    'tools/plugin-check.test.js',
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
  for (const s of ['codex.exe', 'agy.exe', 'cursor-cli', 'NOT OPERATIONAL']) {
    if (!cursorCli.includes(s)) {
      console.error(`cursor-cli.md missing required string: ${s}`);
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

  const ruleFiles = [
    '.cursor/rules/magi-arbiter.mdc',
    '.cursor/rules/magi-activation.mdc',
    '.cursor/rules/magi-orchestrator.mdc',
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
    if (!text.includes('CONCLAVE')) {
      console.error(`${rel} missing CONCLAVE ignore discriminator`);
      return 1;
    }
  }

  console.log('PLUGIN CHECK OK');
  return 0;
}

process.exit(check());
