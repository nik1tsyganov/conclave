'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const checkPath = path.join(__dirname, 'cli-brief-rules-check.js');
const {
  STANDING_PATH,
  checkBriefFile,
  checkBriefText,
  formatMissing,
  main,
  missingMarkers,
} = require('./cli-brief-rules-check.js');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATHS = [
  path.join(ROOT, '.cursor', 'skills', 'magi', 'references', 'brief-rules-block.md'),
  path.join(ROOT, '.cursor', 'skills', 'magi-cli', 'references', 'brief-rules-block.md'),
  path.join(ROOT, 'tools', 'templates', 'brief-rules-block.md'),
];

const ALL_MARKER_IDS = [
  'RULES/INDEX|magi-cli-rules|STANDING',
  'magi-mode',
  'magi-dispatch',
  'mix-mode',
  'casper_via=agy|Vendor:',
  'WRITE AUDIT|R07',
];

function legalBrief(overrides = '') {
  return [
    'RULES/INDEX.md magi-mode magi-dispatch mix-mode casper_via=agy WRITE AUDIT',
    overrides,
  ].join(' ').trim();
}

function makeBrief(t, body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-brief-rules-'));
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, body, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return briefPath;
}

function capture() {
  const io = { stdoutText: '', stderrText: '' };
  io.stdout = { write(chunk) { io.stdoutText += chunk; } };
  io.stderr = { write(chunk) { io.stderrText += chunk; } };
  return io;
}

test('a brief with the full RULES marker set passes', () => {
  const result = checkBriefText(legalBrief());
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('a Vendor: line satisfies Casper without casper_via=agy', () => {
  const result = checkBriefText(
    'RULES/INDEX.md magi-mode magi-dispatch mix-mode Vendor: agy WRITE AUDIT',
  );
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('R07 satisfies the WRITE AUDIT marker', () => {
  const result = checkBriefText(
    'RULES/INDEX.md magi-mode magi-dispatch mix-mode casper_via=agy R07',
  );
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('STANDING.md satisfies the pack marker without RULES/INDEX', () => {
  const result = checkBriefText(
    `Read ${STANDING_PATH}. magi-mode magi-dispatch mix-mode casper_via=agy WRITE AUDIT`,
  );
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('magi-cli-rules satisfies the pack marker without RULES/INDEX', () => {
  const result = checkBriefText(
    'magi-cli-rules magi-mode magi-dispatch mix-mode casper_via=agy WRITE AUDIT',
  );
  assert.deepStrictEqual(result, { ok: true, missing: [] });
});

test('PATH gemini does not satisfy casper_via=agy or Vendor:', () => {
  const result = checkBriefText(
    'RULES/INDEX.md magi-mode magi-dispatch mix-mode gemini WRITE AUDIT',
  );
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['casper_via=agy|Vendor:']);
});

test('missing magi-mode is listed', () => {
  const result = checkBriefText('RULES/INDEX.md magi-dispatch mix-mode casper_via=agy WRITE AUDIT');
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['magi-mode']);
});

test('missing magi-dispatch is listed', () => {
  const result = checkBriefText('RULES/INDEX.md magi-mode mix-mode casper_via=agy WRITE AUDIT');
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['magi-dispatch']);
});

test('missing mix-mode is listed', () => {
  const result = checkBriefText('RULES/INDEX.md magi-mode magi-dispatch casper_via=agy WRITE AUDIT');
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['mix-mode']);
});

test('missing RULES/INDEX, magi-cli-rules, and STANDING is listed', () => {
  const result = checkBriefText('magi-mode magi-dispatch mix-mode casper_via=agy WRITE AUDIT');
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.missing, ['RULES/INDEX|magi-cli-rules|STANDING']);
});

test('an empty brief is missing every marker', () => {
  assert.deepStrictEqual(missingMarkers(''), ALL_MARKER_IDS);
});

test('checkBriefFile reads the path and reports missing markers', (t) => {
  const briefPath = makeBrief(t, 'no rules here');
  const result = checkBriefFile(briefPath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.briefPath, path.resolve(briefPath));
  assert.deepStrictEqual(result.missing, ALL_MARKER_IDS);
  assert.match(formatMissing(result.missing), /magi-mode/);
});

test('main exits 0 and prints JSON for a legal brief', (t) => {
  const briefPath = makeBrief(t, legalBrief());
  const io = capture();
  const code = main(['--brief', briefPath], io);
  assert.strictEqual(code, 0, io.stderrText);
  const report = JSON.parse(io.stdoutText);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.brief, path.resolve(briefPath));
});

test('main exits 1 and lists missing markers', (t) => {
  const briefPath = makeBrief(t, 'magi-mode only');
  const io = capture();
  const code = main(['--brief', briefPath], io);
  assert.strictEqual(code, 1, io.stderrText);
  assert.match(io.stderrText, /^RULES_FAIL:/);
  assert.match(io.stderrText, /RULES\/INDEX\|magi-cli-rules\|STANDING/);
  assert.match(io.stderrText, /magi-dispatch/);
  assert.match(io.stderrText, /mix-mode/);
  assert.match(io.stderrText, /casper_via=agy\|Vendor:/);
  assert.match(io.stderrText, /WRITE AUDIT\|R07/);
});

test('a missing --brief flag exits 2 with ARGUMENT_ERROR', () => {
  const io = capture();
  const code = main([], io);
  assert.strictEqual(code, 2, io.stderrText);
  assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
});

test('a missing brief file exits 2 with ARGUMENT_ERROR', () => {
  const io = capture();
  const code = main(['--brief', path.join(os.tmpdir(), 'magi-brief-rules-missing.md')], io);
  assert.strictEqual(code, 2, io.stderrText);
  assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
});

test('the CLI entry prints one JSON report and exits 0', (t) => {
  const briefPath = makeBrief(t, legalBrief());
  const result = spawnSync(process.execPath, [checkPath, '--brief', briefPath], {
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.ok, true);
});

test('shipped RULES templates themselves pass the check', () => {
  for (const templatePath of TEMPLATE_PATHS) {
    const result = checkBriefFile(templatePath);
    assert.strictEqual(result.ok, true, `${templatePath} missing ${result.missing}`);
  }
});
