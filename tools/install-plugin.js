#!/usr/bin/env node
'use strict';

/**
 * Install MAGI as local Cursor plugins.
 *
 * Installs TWO plugins:
 *   ~/.cursor/plugins/local/magi            — MAGI Cursor (hostMode `cursor`, native Task models)
 *   ~/.cursor/plugins/local/magi-cursor-cli — MAGI Cursor CLI (hostMode `cursor-cli`, vendor CLIs)
 *
 *   node tools/install-plugin.js
 *
 * Then: Developer: Reload Window, and enable both MAGI Cursor and MAGI Cursor CLI under Customize.
 *
 * Exit 0 = installed. Exit 1 = dest missing a required file. Exit 2 = could not run.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(os.homedir(), '.cursor', 'plugins', 'local');
const MAGI_DEST = path.join(PLUGINS_DIR, 'magi');
const MAGI_CLI_DEST = path.join(PLUGINS_DIR, 'magi-cursor-cli');
const USER_SKILL_MAGI = path.join(os.homedir(), '.cursor', 'skills', 'magi');
const USER_SKILL_MAGI_CLI = path.join(os.homedir(), '.cursor', 'skills', 'magi-cli');
const USER_RULES_DIR = path.join(os.homedir(), '.cursor', 'rules');
const CLAUDE_CMD_DIR = path.join(os.homedir(), '.claude', 'commands');

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

function ensureClean(dest) {
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
}

function writeManifest(dest, manifest) {
  fs.mkdirSync(path.join(dest, '.cursor-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dest, '.cursor-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function installMagiCursor() {
  ensureClean(MAGI_DEST);

  writeManifest(MAGI_DEST, {
    name: 'magi',
    displayName: 'MAGI Cursor',
    description:
      'Original MAGI tri-seat (Claude + Codex + Gemini). Cursor Grok arbiter routes; it does not implement. Not CONCLAVE.',
    version: '0.1.0',
    author: { name: 'Nikita Tsyganov' },
    repository: 'https://github.com/nik1tsyganov/magi.git',
    license: 'MIT',
    keywords: ['magi', 'multi-vendor', 'cursor', 'dispatch'],
  });

  copyDir(path.join(ROOT, '.cursor', 'skills'), path.join(MAGI_DEST, 'skills'));
  copyDir(path.join(ROOT, '.cursor', 'rules'), path.join(MAGI_DEST, 'rules'));
  copyDir(path.join(ROOT, 'agents'), path.join(MAGI_DEST, 'agents'));
  copyDir(path.join(ROOT, 'tools'), path.join(MAGI_DEST, 'tools'));

  fs.mkdirSync(path.join(MAGI_DEST, 'commands'), { recursive: true });
  copyFile(path.join(ROOT, 'commands', 'magi.md'), path.join(MAGI_DEST, 'commands', 'magi.md'));
  copyFile(path.join(ROOT, 'commands', 'magi-cli.md'), path.join(MAGI_DEST, 'commands', 'magi-cli.md'));
}

function installMagiCursorCli() {
  ensureClean(MAGI_CLI_DEST);

  writeManifest(MAGI_CLI_DEST, {
    name: 'magi-cursor-cli',
    displayName: 'MAGI Cursor CLI',
    description:
      'Grok arbiter + vendor CLIs (codex.exe, agy.exe) when Cursor Task usage is exhausted. Not CONCLAVE.',
    version: '0.1.0',
    author: { name: 'Nikita Tsyganov' },
    repository: 'https://github.com/nik1tsyganov/magi.git',
    license: 'MIT',
    keywords: ['magi', 'magi-cli', 'multi-vendor', 'cursor', 'cli'],
  });

  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi-cli'), path.join(MAGI_CLI_DEST, 'skills', 'magi-cli'));
  copyDir(path.join(ROOT, '.cursor', 'rules'), path.join(MAGI_CLI_DEST, 'rules'));
  copyFile(path.join(ROOT, 'commands', 'magi-cli.md'), path.join(MAGI_CLI_DEST, 'commands', 'magi-cli.md'));

  fs.mkdirSync(path.join(MAGI_CLI_DEST, 'tools'), { recursive: true });
  for (const tool of [
    'hog-check.js',
    'hog-check.test.js',
    'activation-check.js',
    'activation-check.test.js',
    'dispatch-log.pass.jsonl',
    'dispatch-log.fail.jsonl',
    'host-resolver.js',
    'host-resolver.test.js',
    'position-tally.js',
    'position-tally.test.js',
  ]) {
    copyFile(path.join(ROOT, 'tools', tool), path.join(MAGI_CLI_DEST, 'tools', tool));
  }
}

function installUserGlobals() {
  fs.mkdirSync(USER_RULES_DIR, { recursive: true });
  for (const ruleFile of ['magi-arbiter.mdc', 'magi-activation.mdc', 'magi-orchestrator.mdc', 'live-check.mdc']) {
    const src = path.join(ROOT, '.cursor', 'rules', ruleFile);
    const dst = path.join(USER_RULES_DIR, ruleFile);
    copyFile(src, dst);
    if (!fs.existsSync(dst)) {
      console.error(`INSTALL INCOMPLETE — user rule missing: ${dst}`);
      process.exit(1);
    }
  }
  console.log(`MAGI user rules installed at ${USER_RULES_DIR}`);

  copyFile(path.join(ROOT, 'claude-commands', 'magi.md'), path.join(CLAUDE_CMD_DIR, 'magi.md'));
  if (!fs.existsSync(path.join(CLAUDE_CMD_DIR, 'magi.md'))) {
    console.error('INSTALL INCOMPLETE — claude command missing');
    process.exit(1);
  }

  if (fs.existsSync(USER_SKILL_MAGI)) fs.rmSync(USER_SKILL_MAGI, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi'), USER_SKILL_MAGI);

  if (fs.existsSync(USER_SKILL_MAGI_CLI)) fs.rmSync(USER_SKILL_MAGI_CLI, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi-cli'), USER_SKILL_MAGI_CLI);
}

function checkMagi() {
  const required = [
    '.cursor-plugin/plugin.json',
    'skills/magi/SKILL.md',
    'skills/magi/references/cursor-host.md',
    'rules/magi-arbiter.mdc',
    'rules/magi-activation.mdc',
    'rules/magi-orchestrator.mdc',
    'rules/live-check.mdc',
    'commands/magi.md',
    'commands/magi-cli.md',
    'tools/hog-check.js',
    'tools/activation-check.js',
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
  const missing = required.filter((rel) => !fs.existsSync(path.join(MAGI_DEST, rel)));
  if (missing.length) {
    console.error('INSTALL INCOMPLETE — magi missing:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }
}

function checkMagiCli() {
  const required = [
    '.cursor-plugin/plugin.json',
    'skills/magi-cli/SKILL.md',
    'skills/magi-cli/references/cursor-cli.md',
    'rules/magi-arbiter.mdc',
    'rules/magi-activation.mdc',
    'rules/magi-orchestrator.mdc',
    'rules/live-check.mdc',
    'commands/magi-cli.md',
    'tools/hog-check.js',
    'tools/activation-check.js',
    'tools/position-tally.js',
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(MAGI_CLI_DEST, rel)));
  if (missing.length) {
    console.error('INSTALL INCOMPLETE — magi-cursor-cli missing:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }
  if (fs.existsSync(path.join(MAGI_CLI_DEST, 'agents'))) {
    console.error('INSTALL INCOMPLETE — magi-cursor-cli must not have an agents/ directory');
    process.exit(1);
  }
}

try {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  installMagiCursor();
  installMagiCursorCli();
  installUserGlobals();

  checkMagi();
  checkMagiCli();

  console.log(`MAGI Cursor plugin installed at ${MAGI_DEST}`);
  console.log('  skill:  magi + cursor-host + cursor-cli reference');
  console.log('  user:   ' + USER_SKILL_MAGI);
  console.log('  rules:  arbiter, activation, orchestrator, live-check (plugin + ~/.cursor/rules)');
  console.log('  agents: 9 seat briefs');
  console.log('  commands: /magi, /magi-cli');
  console.log('');
  console.log(`MAGI Cursor CLI plugin installed at ${MAGI_CLI_DEST}`);
  console.log('  skill:  magi-cli + cursor-cli reference');
  console.log('  user:   ' + USER_SKILL_MAGI_CLI);
  console.log('  rules:  arbiter, activation, orchestrator, live-check');
  console.log('  agents: none (CLI mode)');
  console.log('  command: /magi-cli');
  console.log('');
  console.log('Reload the Cursor window (Developer: Reload Window), then open Customize and enable both MAGI Cursor and MAGI Cursor CLI.');
  process.exit(0);
} catch (error) {
  bail(error instanceof Error ? error.message : String(error));
}
