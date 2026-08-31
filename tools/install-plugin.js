#!/usr/bin/env node
'use strict';

/**
 * Install MAGI as a local Cursor plugin.
 *
 * Copies skills, rules, agents, and commands into
 *   ~/.cursor/plugins/local/magi
 * with the folder layout Cursor discovers.
 *
 *   node tools/install-plugin.js
 *
 * Then: Developer: Reload Window, and confirm MAGI under Customize.
 *
 * Exit 0 = installed. Exit 1 = dest missing a required file. Exit 2 = could not run.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(os.homedir(), '.cursor', 'plugins', 'local', 'magi');
const USER_SKILL = path.join(os.homedir(), '.cursor', 'skills', 'magi');

function bail(msg) {
  console.error(`CANNOT RUN: ${msg}`);
  process.exit(2);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) bail(`missing ${src}`);
  fs.cpSync(src, dest, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) bail(`missing ${src}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

try {
  fs.mkdirSync(path.join(os.homedir(), '.cursor', 'plugins', 'local'), { recursive: true });
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  const destManifest = {
    name: 'magi',
    description:
      'Original MAGI tri-seat (Claude + Codex + Gemini). Cursor Grok arbiter routes; it does not implement. Not CONCLAVE.',
    version: '0.1.0',
    author: { name: 'Nikita Tsyganov' },
    repository: 'https://github.com/nik1tsyganov/magi.git',
    license: 'MIT',
    keywords: ['magi', 'multi-vendor', 'cursor', 'dispatch'],
  };

  fs.mkdirSync(path.join(DEST, '.cursor-plugin'), { recursive: true });
  fs.writeFileSync(path.join(DEST, '.cursor-plugin', 'plugin.json'), JSON.stringify(destManifest, null, 2) + '\n');

  copyDir(path.join(ROOT, '.cursor', 'skills'), path.join(DEST, 'skills'));
  copyDir(path.join(ROOT, '.cursor', 'rules'), path.join(DEST, 'rules'));
  copyDir(path.join(ROOT, 'agents'), path.join(DEST, 'agents'));
  copyDir(path.join(ROOT, 'commands'), path.join(DEST, 'commands'));

  if (fs.existsSync(USER_SKILL)) fs.rmSync(USER_SKILL, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi'), USER_SKILL);

  const required = [
    '.cursor-plugin/plugin.json',
    'skills/magi/SKILL.md',
    'skills/magi/references/cursor-host.md',
    'rules/magi-arbiter.mdc',
    'rules/magi-activation.mdc',
    'rules/magi-orchestrator.mdc',
    'commands/magi.md',
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

  const missing = required.filter((rel) => !fs.existsSync(path.join(DEST, rel)));
  if (missing.length) {
    console.error('INSTALL INCOMPLETE — missing:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }

  const installedSkillFiles = [];
  function collectSkillFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectSkillFiles(full);
      else if (entry.name === 'SKILL.md') installedSkillFiles.push(full);
    }
  }
  collectSkillFiles(path.join(DEST, 'skills'));
  if (installedSkillFiles.length !== 1) {
    console.error(`INSTALL INCOMPLETE — expected 1 plugin SKILL.md, found ${installedSkillFiles.length}`);
    process.exit(1);
  }

  console.log(`MAGI plugin installed at ${DEST}`);
  console.log('  skill:  magi + cursor-host reference');
  console.log(`  user:   ${USER_SKILL}`);
  console.log('  rules:  arbiter, activation, orchestrator');
  console.log('  agents: 9 seat briefs');
  console.log('  command: /magi');
  console.log('');
  console.log('Reload the Cursor window (Developer: Reload Window), then open Customize and confirm MAGI.');
  process.exit(0);
} catch (error) {
  bail(error instanceof Error ? error.message : String(error));
}
