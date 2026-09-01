#!/usr/bin/env node
'use strict';

/**
 * MAGI activation gate.
 *
 * 1. Reads a live dispatch log (default: tools/dispatch-log.jsonl).
 * 2. Rejects the checked-in pass/fail fixtures as not a live activation.
 * 3. Forwards the log to hog-check.js and exits with its status.
 *
 * Exit codes:
 *   0  FLOOR HOLDS
 *   1  FAILED activation, or the input is a fixture log
 *   2  Could not run / no live log
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('tools/dispatch-log.jsonl');

if (!fs.existsSync(inputPath)) {
  console.error('NO LIVE LOG');
  process.exit(2);
}

const inputText = fs.readFileSync(inputPath, 'utf8');
const passFixture = fs.readFileSync(path.join(__dirname, 'dispatch-log.pass.jsonl'), 'utf8');
const failFixture = fs.readFileSync(path.join(__dirname, 'dispatch-log.fail.jsonl'), 'utf8');

const inputTrimmed = inputText.trim();
const passTrimmed = passFixture.trim();
const failTrimmed = failFixture.trim();

if (
  inputText === passFixture ||
  inputText === failFixture ||
  inputTrimmed === passTrimmed ||
  inputTrimmed === failTrimmed
) {
  console.error('FIXTURE LOG — NOT AN ACTIVATION');
  process.exit(1);
}

const hogCheckPath = path.join(__dirname, 'hog-check.js');
const result = spawnSync(process.execPath, [hogCheckPath, inputPath], { encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
