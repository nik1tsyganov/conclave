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
    '.cursor/rules/magi-arbiter.mdc',
    '.cursor/rules/magi-activation.mdc',
    '.cursor/rules/magi-orchestrator.mdc',
    'commands/magi.md',
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

  const cmd = fs.readFileSync(path.join(ROOT, 'commands/magi.md'), 'utf8');
  if (!cmd.includes('magi-whoami')) {
    console.error('commands/magi.md missing magi-whoami');
    return 1;
  }

  console.log('PLUGIN CHECK OK');
  return 0;
}

process.exit(check());
