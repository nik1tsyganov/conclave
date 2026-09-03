#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CODEX_BINARY = 'C:\\Users\\YESSIR\\tools\\bin\\codex.exe';
const CODEX_SANDBOX = 'workspace-write';
const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
const DEFAULT_CODEX_EFFORT = 'high';
const DEFAULT_POLL_MS = 1000;
const DEFAULT_MAX_WALL_MS = 2700000;
const DEFAULT_IDLE_STDIO_MS = 180000;
const DEFAULT_IDLE_CPU_MS = 180000;
const SIBLINGS = {
  google: './cli-gemini.js',
  anthropic: './cli-claude.js',
};

function usage() {
  return [
    'Usage: node tools/cli-launch.js [options]',
    '',
    'Options:',
    '  --vendor <openai|google|anthropic>  Vendor to launch (default: openai)',
    '  --brief <file>                     Prompt file sent through stdin',
    '  --cwd <directory>                  Vendor working directory',
    '  --capture <file>                   Final-response capture file',
    '  --model <slug>                     Model override',
    '  --effort <level>                   Reasoning effort (default: high)',
    '  --pid-file <path>                  Write the spawned child PID',
    '  --poll-ms <milliseconds>           Idle-watch interval (default: 1000)',
    '  --max-wall-ms <milliseconds>        Maximum run time (default: 2700000)',
    '  --idle-stdio-ms <milliseconds>      Stdio idle limit (default: 180000)',
    '  --idle-cpu-ms <milliseconds>        CPU idle limit (default: 180000)',
    '  --dry-run                          Print the launch plan without spawning',
    '  --help                             Show this help',
  ].join('\n');
}

function requireValue(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    const error = new Error(`${name} is required`);
    error.code = 'ARGUMENT_ERROR';
    throw error;
  }
  return value;
}

function buildCodexLaunch(options) {
  const brief = requireValue(options.brief, '--brief');
  const cwd = requireValue(options.cwd, '--cwd');
  const capture = requireValue(options.capture, '--capture');
  const model = options.model || DEFAULT_CODEX_MODEL;
  const effort = options.effort || DEFAULT_CODEX_EFFORT;

  return {
    binary: CODEX_BINARY,
    args: [
      'exec',
      '--skip-git-repo-check',
      '-s', CODEX_SANDBOX,
      '-m', model,
      '-c', `model_reasoning_effort=${effort}`,
      '-c', 'memories.use_memories=false',
      '-c', 'memories.generate_memories=false',
      '-C', cwd,
      '-o', capture,
      '-',
    ],
    stdinFile: brief,
    requestedSandbox: CODEX_SANDBOX,
  };
}

function cleanLog(logText) {
  return String(logText).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function parseSandbox(logText) {
  const match = cleanLog(logText).match(/^[ \t]*sandbox[ \t]*:[ \t]*(\S+)[ \t]*$/im);
  return match ? match[1] : null;
}

function parseCodexLog(logText, requestedSandbox = CODEX_SANDBOX) {
  const log = cleanLog(logText);
  const actualSandbox = parseSandbox(log);
  if (actualSandbox !== requestedSandbox) {
    return {
      ok: false,
      code: 'WEDGE',
      requestedSandbox,
      actualSandbox,
    };
  }

  const sessionMatch = log.match(/^[ \t]*session id[ \t]*:[ \t]*(\S+)[ \t]*$/im);
  const tokensMatch = log.match(
    /^[ \t]*tokens used[ \t]*:?[ \t]*(?:\r?\n[ \t]*)?([0-9][0-9,]*)[ \t]*$/im,
  );
  const missing = [];
  if (!sessionMatch) missing.push('session id');
  if (!tokensMatch) missing.push('tokens used');
  if (missing.length > 0) {
    return { ok: false, code: 'PROOF_MISSING', missing };
  }

  return {
    ok: true,
    sandbox: actualSandbox,
    sessionId: sessionMatch[1],
    tokensUsed: Number(tokensMatch[1].replaceAll(',', '')),
  };
}

function loadVendorModule(vendor, requireFn = require) {
  const moduleId = SIBLINGS[vendor];
  if (!moduleId) {
    const error = new Error(`Unsupported vendor: ${vendor}`);
    error.code = 'ARGUMENT_ERROR';
    throw error;
  }

  try {
    return requireFn(moduleId);
  } catch (cause) {
    if (cause && cause.code === 'MODULE_NOT_FOUND') {
      const error = new Error(`${moduleId} is required for --vendor ${vendor}`);
      error.code = 'MODULE_MISSING';
      error.vendor = vendor;
      error.cause = cause;
      throw error;
    }
    throw cause;
  }
}

function loadIdleDecide(requireFn = require) {
  const modulePath = path.join(__dirname, 'cli-idle.js');
  if (!fs.existsSync(modulePath)) return null;

  const idle = requireFn('./cli-idle.js');
  if (!idle || typeof idle.decide !== 'function') {
    const error = new Error('./cli-idle.js must export decide(sample)');
    error.code = 'MODULE_INVALID';
    throw error;
  }
  return idle.decide;
}

function parseMilliseconds(value, flag, allowZero = true) {
  if (!/^\d+$/.test(value)) {
    const error = new Error(`${flag} requires an integer number of milliseconds`);
    error.code = 'ARGUMENT_ERROR';
    throw error;
  }
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || (!allowZero && milliseconds === 0)) {
    const error = new Error(`${flag} requires ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
    error.code = 'ARGUMENT_ERROR';
    throw error;
  }
  return milliseconds;
}

function parseArgs(argv) {
  const options = {
    vendor: 'openai',
    dryRun: false,
    help: false,
    pollMs: DEFAULT_POLL_MS,
    maxWallMs: DEFAULT_MAX_WALL_MS,
    idleStdioMs: DEFAULT_IDLE_STDIO_MS,
    idleCpuMs: DEFAULT_IDLE_CPU_MS,
  };
  const stringFlags = {
    '--vendor': 'vendor',
    '--brief': 'brief',
    '--cwd': 'cwd',
    '--capture': 'capture',
    '--model': 'model',
    '--effort': 'effort',
    '--pid-file': 'pidFile',
  };
  const timeFlags = {
    '--poll-ms': ['pollMs', false],
    '--max-wall-ms': ['maxWallMs', true],
    '--idle-stdio-ms': ['idleStdioMs', true],
    '--idle-cpu-ms': ['idleCpuMs', true],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') {
      options.dryRun = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (stringFlags[flag] || timeFlags[flag]) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        const error = new Error(`${flag} requires a value`);
        error.code = 'ARGUMENT_ERROR';
        throw error;
      }
      if (stringFlags[flag]) {
        options[stringFlags[flag]] = value;
      } else {
        const [name, allowZero] = timeFlags[flag];
        options[name] = parseMilliseconds(value, flag, allowZero);
      }
      index += 1;
    } else {
      const error = new Error(`Unknown option: ${flag}`);
      error.code = 'ARGUMENT_ERROR';
      throw error;
    }
  }
  return options;
}

function printableLaunch(launch) {
  const result = { binary: launch.binary, args: launch.args };
  if (launch.stdinFile) result.stdinFile = launch.stdinFile;
  if (launch.requestedSandbox) result.requestedSandbox = launch.requestedSandbox;
  return result;
}

function runChild(launch, io, inspectCodex = false, dependencies = {}) {
  return new Promise((resolve, reject) => {
    const spawnFn = dependencies.spawnFn || spawn;
    const now = dependencies.now || Date.now;
    const setIntervalFn = dependencies.setInterval || setInterval;
    const clearIntervalFn = dependencies.clearInterval || clearInterval;
    const kill = dependencies.kill || process.kill.bind(process);
    const stdio = launch.stdio || ['pipe', 'pipe', 'pipe'];
    const child = spawnFn(launch.binary, launch.args, {
      cwd: launch.cwd,
      env: launch.env || process.env,
      shell: false,
      stdio,
    });
    launch.pid = child.pid;
    if (dependencies.pidFile) {
      try {
        fs.writeFileSync(dependencies.pidFile, `${child.pid}\n`, 'utf8');
      } catch (error) {
        if (Number.isInteger(child.pid)) {
          try { kill(child.pid); } catch {}
        }
        reject(error);
        return;
      }
    }

    let log = '';
    let wedge = null;
    let watchTimer;
    let settled = false;
    let stdioBytes = 0;
    const startedAtMs = now();
    let lastStdioAtMs = startedAtMs;

    function stopWatch() {
      if (watchTimer !== undefined) {
        clearIntervalFn(watchTimer);
        watchTimer = undefined;
      }
    }

    function finish(code) {
      if (settled) return;
      settled = true;
      stopWatch();
      resolve(code);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      stopWatch();
      reject(error);
    }

    function killPid() {
      if (Number.isInteger(child.pid)) kill(child.pid);
    }

    function collect(writer) {
      return (chunk) => {
        if (writer && typeof writer.write === 'function') writer.write(chunk);
        log += chunk.toString('utf8');
        stdioBytes += Buffer.byteLength(chunk);
        lastStdioAtMs = now();
        if (inspectCodex && !wedge) {
          const actualSandbox = parseSandbox(log);
          if (actualSandbox && actualSandbox !== launch.requestedSandbox) {
            wedge = {
              ok: false,
              code: 'WEDGE',
              requestedSandbox: launch.requestedSandbox,
              actualSandbox,
            };
            stopWatch();
            try { killPid(); } catch {}
          }
        }
      };
    }

    if (child.stdout) child.stdout.on('data', collect(io.stdout));
    if (child.stderr) child.stderr.on('data', collect(io.stderr));
    child.once('error', fail);

    let decide;
    try {
      if (Object.hasOwn(dependencies, 'decide')) {
        decide = dependencies.decide;
      } else {
        const loader = dependencies.loadIdleDecide || loadIdleDecide;
        decide = loader();
      }
    } catch (error) {
      try { killPid(); } catch {}
      fail(error);
      return;
    }

    if (typeof decide === 'function') {
      const poll = () => {
        let decision;
        try {
          decision = decide({
            vendor: dependencies.vendor || 'openai',
            nowMs: now(),
            startedAtMs,
            lastStdioAtMs,
            stdioBytes,
            cpuMs: null,
            lastCpuAtMs: null,
            maxWallMs: dependencies.maxWallMs ?? DEFAULT_MAX_WALL_MS,
            idleStdioMs: dependencies.idleStdioMs ?? DEFAULT_IDLE_STDIO_MS,
            idleCpuMs: dependencies.idleCpuMs ?? DEFAULT_IDLE_CPU_MS,
          });
        } catch (error) {
          try { killPid(); } catch {}
          fail(error);
          return;
        }
        if (decision && decision.action === 'kill') {
          try { killPid(); } catch {}
          io.stderr.write(`IDLE_KILLED pid=${child.pid} reason=${decision.reason}\n`);
          finish(1);
        }
      };
      const timer = setIntervalFn(poll, dependencies.pollMs ?? DEFAULT_POLL_MS);
      watchTimer = timer;
      if (settled) stopWatch();
    }

    const stdinMode = Array.isArray(stdio) ? stdio[0] : stdio;
    if (stdinMode === 'ignore') {
      // The prompt is already buffered in argv for vendors that ignore stdin.
    } else if (launch.stdinFile) {
      const prompt = fs.createReadStream(launch.stdinFile);
      prompt.once('error', (error) => {
        try { killPid(); } catch {}
        fail(error);
      });
      prompt.pipe(child.stdin);
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.once('close', (code) => {
      if (settled) return;
      if (wedge) {
        io.stderr.write(`WEDGE: requested sandbox ${wedge.requestedSandbox}, got ${wedge.actualSandbox}\n`);
        finish(1);
        return;
      }
      if (code !== 0) {
        io.stderr.write(`LAUNCH_FAILED: child exit ${code}\n`);
        finish(1);
        return;
      }
      if (!inspectCodex) {
        finish(0);
        return;
      }

      const proof = parseCodexLog(log, launch.requestedSandbox);
      if (!proof.ok) {
        const detail = proof.code === 'PROOF_MISSING' ? `: ${proof.missing.join(', ')}` : '';
        io.stderr.write(`${proof.code}${detail}\n`);
        finish(1);
        return;
      }
      io.stdout.write(`CODEX_PROOF session id: ${proof.sessionId}; tokens used: ${proof.tokensUsed}\n`);
      finish(0);
    });
  });
}

async function runSiblingVendor(options, io, dependencies = {}) {
  const load = dependencies.loadVendorModule || loadVendorModule;
  const sibling = load(options.vendor);
  if (typeof sibling.main === 'function') {
    return sibling.main(options, io);
  }
  if (typeof sibling.run === 'function') {
    return sibling.run(options, io);
  }
  let launch;
  if (typeof sibling.buildLaunch === 'function') {
    launch = sibling.buildLaunch({
      briefPath: requireValue(options.brief, '--brief'),
      model: options.model,
      effort: options.effort,
      cwd: options.cwd,
    });
  } else if (typeof sibling.buildArgs === 'function') {
    const briefText = fs.readFileSync(requireValue(options.brief, '--brief'), 'utf8');
    launch = sibling.buildArgs(briefText, options.model, { cwd: options.cwd });
  } else {
    const error = new Error(
      `Sibling module for ${options.vendor} has no main, run, buildLaunch, or buildArgs export`,
    );
    error.code = 'MODULE_INVALID';
    throw error;
  }
  if (options.cwd && !launch.cwd) launch.cwd = options.cwd;
  if (options.dryRun) {
    io.stdout.write(`${JSON.stringify(printableLaunch(launch), null, 2)}\n`);
    return 0;
  }
  return runChild(launch, io, false, { ...dependencies, ...options });
}

async function main(argv = process.argv.slice(2), io = process, dependencies = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      io.stdout.write(`${usage()}\n`);
      return 0;
    }

    if (options.vendor !== 'openai') {
      return await runSiblingVendor(options, io, dependencies);
    }

    const launch = buildCodexLaunch(options);
    if (options.dryRun) {
      io.stdout.write(`${JSON.stringify(printableLaunch(launch), null, 2)}\n`);
      return 0;
    }
    return await runChild(launch, io, true, { ...dependencies, ...options });
  } catch (error) {
    const code = error.code || 'LAUNCH_ERROR';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'MODULE_MISSING' || code === 'MODULE_INVALID' || code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  buildCodexLaunch,
  loadVendorModule,
  main,
  parseArgs,
  parseCodexLog,
  runChild,
};
