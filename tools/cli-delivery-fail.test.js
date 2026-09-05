'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const launcherPath = path.join(__dirname, 'cli-launch.js');
const uniqueBriefBody = `UNIQUE-DELIVERY-FAIL-${'body-content-'.repeat(20)}`;

function makeBrief(t, directory, body = uniqueBriefBody) {
  const briefPath = path.join(directory, 'brief.md');
  fs.writeFileSync(briefPath, body, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return briefPath;
}

function assertBodyAbsent(launch, briefBody) {
  assert.ok(
    !JSON.stringify(launch.args).includes(briefBody),
    'dry-run arguments contain the brief body',
  );
  if (launch.pointerFile || launch.stdinFile) {
    const pointerFile = launch.pointerFile || launch.stdinFile;
    assert.ok(
      !fs.readFileSync(pointerFile, 'utf8').includes(briefBody),
      'pointer-file contents contain the brief body',
    );
  }
}

test('OpenAI launch plans keep the brief body out of arguments and pointer files', (t) => {
  const { buildCodexLaunch } = require('./cli-launch.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-delivery-openai-'));
  const briefPath = makeBrief(t, directory);

  const launch = buildCodexLaunch({
    brief: briefPath,
    cwd: directory,
    capture: path.join(directory, 'capture.txt'),
  });

  assertBodyAbsent(launch, uniqueBriefBody);
  assert.throws(
    () => assertBodyAbsent(
      { ...launch, args: [...launch.args, uniqueBriefBody] },
      uniqueBriefBody,
    ),
    /arguments contain the brief body/,
  );
  fs.appendFileSync(launch.pointerFile, uniqueBriefBody, 'utf8');
  assert.throws(
    () => assertBodyAbsent(launch, uniqueBriefBody),
    /pointer-file contents contain the brief body/,
  );
});

for (const vendor of ['google', 'anthropic']) {
  test(`${vendor} dry-run keeps the brief body out of arguments and pointer files`, (t) => {
    const parent = vendor === 'anthropic'
      ? path.join(os.tmpdir(), 'magi-bus')
      : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const directory = fs.mkdtempSync(path.join(parent, `magi-delivery-${vendor}-`));
    const briefPath = makeBrief(t, directory);

    const result = spawnSync(process.execPath, [
      launcherPath,
      '--vendor', vendor,
      '--brief', briefPath,
      '--cwd', directory,
      '--dry-run',
    ], { encoding: 'utf8', env: { ...process.env, MAGI_ALLOWED_WORKSPACE_ROOTS: directory }, windowsHide: true });

    assert.strictEqual(result.status, 0, result.stderr);
    const launch = JSON.parse(result.stdout);
    assertBodyAbsent(launch, uniqueBriefBody);
    assert.throws(
      () => assertBodyAbsent(
        { ...launch, args: [...launch.args, uniqueBriefBody] },
        uniqueBriefBody,
      ),
      /arguments contain the brief body/,
    );
  });
}

test('a missing brief returns ARGUMENT_ERROR before any vendor module or process starts', async () => {
  const { main } = require('./cli-launch.js');
  const missing = path.join(os.tmpdir(), 'magi-delivery-missing-brief.md');

  for (const vendor of ['openai', 'google', 'anthropic']) {
    let loaded = false;
    let spawned = false;
    let stderr = '';
    const code = await main(
      [
        '--vendor', vendor,
        '--brief', missing,
        '--cwd', os.tmpdir(),
        '--capture', path.join(os.tmpdir(), 'unused-capture.txt'),
      ],
      {
        stdout: { write() {} },
        stderr: { write(chunk) { stderr += chunk; } },
      },
      {
        loadVendorModule() { loaded = true; throw new Error('vendor module loaded'); },
        spawnFn() { spawned = true; throw new Error('vendor process spawned'); },
      },
    );

    assert.strictEqual(code, 2, `${vendor}: ${stderr}`);
    assert.match(stderr, /^ARGUMENT_ERROR:/, vendor);
    assert.strictEqual(loaded, false, `${vendor} loaded its module`);
    assert.strictEqual(spawned, false, `${vendor} spawned a process`);
  }
});

test('an empty brief returns ARGUMENT_ERROR before any vendor module or process starts', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-delivery-empty-'));
  const briefPath = makeBrief(t, directory, '');
  const { main } = require('./cli-launch.js');

  for (const vendor of ['openai', 'google', 'anthropic']) {
    let loaded = false;
    let spawned = false;
    let stderr = '';
    const code = await main(
      [
        '--vendor', vendor,
        '--brief', briefPath,
        '--cwd', directory,
        '--capture', path.join(directory, 'unused-capture.txt'),
      ],
      {
        stdout: { write() {} },
        stderr: { write(chunk) { stderr += chunk; } },
      },
      {
        loadVendorModule() { loaded = true; throw new Error('vendor module loaded'); },
        spawnFn() { spawned = true; throw new Error('vendor process spawned'); },
      },
    );

    assert.strictEqual(code, 2, `${vendor}: ${stderr}`);
    assert.match(stderr, /^ARGUMENT_ERROR:/, vendor);
    assert.strictEqual(loaded, false, `${vendor} loaded its module`);
    assert.strictEqual(spawned, false, `${vendor} spawned a process`);
  }
  assert.strictEqual(fs.existsSync(`${briefPath}.pointer.md`), false);
});

test('OpenAI pointer preparation rejects an empty brief', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-delivery-empty-openai-'));
  const briefPath = makeBrief(t, directory, '');
  const { buildCodexLaunch } = require('./cli-launch.js');

  assert.throws(
    () => buildCodexLaunch({
      brief: briefPath,
      cwd: directory,
      capture: path.join(directory, 'capture.txt'),
    }),
    (error) => error.code === 'ARGUMENT_ERROR' && /empty/.test(error.message),
  );
  assert.strictEqual(fs.existsSync(`${briefPath}.pointer.md`), false);
});

test('PowerShell NativeCommandError wrapping does not hide the Codex sandbox header', () => {
  const { parseCodexLog } = require('./cli-launch.js');
  const log = [
    'node : OpenAI Codex v0.146.1',
    'At C:\\tmp\\ps-script.ps1:1 char:1',
    '--------',
    'sandbox: workspace-write [workdir, /tmp, $TMPDIR]',
    'session id: 01a12345-6789-abcd-ef01-23456789abcd',
    '--------',
    'const launch = {',
    '  sandbox: actualSandbox,',
    '};',
    'tokens used',
    '123',
  ].join('\r\n');

  assert.deepStrictEqual(parseCodexLog(log, 'workspace-write'), {
    ok: true,
    sandbox: 'workspace-write',
    sessionId: '01a12345-6789-abcd-ef01-23456789abcd',
    tokensUsed: 123,
  });
});

test('a pointer file containing the brief body is rejected as a body leak', (t) => {
  const { assertPointerLaunch } = require('./cli-pointer.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-delivery-pointer-'));
  const briefPath = makeBrief(t, directory);
  const pointerPath = `${briefPath}.pointer.md`;
  fs.writeFileSync(pointerPath, uniqueBriefBody, 'utf8');

  assert.throws(
    () => assertPointerLaunch(
      fs.readFileSync(pointerPath, 'utf8'),
      uniqueBriefBody,
      briefPath,
    ),
    /contains brief body/,
  );
});
