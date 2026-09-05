'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { decide } = require('./cli-idle.js');
const { sampleCpuMs } = require('./cli-process.js');

function runLaunch(launch, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnFn = options.spawn || spawn;
    const child = spawnFn(launch.binary, launch.args, {
      cwd: launch.cwd,
      env: launch.env || process.env,
      shell: false,
      stdio: launch.stdio || ['pipe', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    if (options.pidFile) fs.writeFileSync(options.pidFile, `${pid}\n`, 'utf8');
    let stdout = '';
    let stderr = '';
    let settled = false;
    const startedAtMs = Date.now();
    let lastStdioAtMs = startedAtMs;
    let lastCpuAtMs = startedAtMs;
    let lastCpuMs = null;
    let stdioBytes = 0;

    function killRecordedPid() {
      if (!Number.isInteger(pid)) return;
      try { (options.kill || process.kill.bind(process))(pid); } catch {}
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve({ ...result, pid, stdout, stderr });
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      reject(error);
    }
    function collect(which) {
      return (chunk) => {
        const text = chunk.toString('utf8');
        if (which === 'stdout') stdout += text; else stderr += text;
        stdioBytes += Buffer.byteLength(chunk);
        lastStdioAtMs = Date.now();
        if (options[`${which}File`]) fs.appendFileSync(options[`${which}File`], chunk);
      };
    }
    if (child.stdout) child.stdout.on('data', collect('stdout'));
    if (child.stderr) child.stderr.on('data', collect('stderr'));
    child.once('error', fail);

    const stdinMode = (launch.stdio || ['pipe'])[0];
    if (stdinMode !== 'ignore' && launch.stdinFile && child.stdin) {
      const stream = fs.createReadStream(launch.stdinFile);
      stream.once('error', (error) => { killRecordedPid(); fail(error); });
      stream.pipe(child.stdin);
    } else if (stdinMode !== 'ignore' && child.stdin) {
      child.stdin.end();
    }

    const pollMs = options.pollMs ?? 1000;
    const timer = setInterval(() => {
      const nowMs = Date.now();
      const cpuMs = (options.sampleCpuMs || sampleCpuMs)(pid);
      if (typeof cpuMs === 'number' && Number.isFinite(cpuMs)) {
        if (lastCpuMs === null || cpuMs > lastCpuMs) lastCpuAtMs = nowMs;
        lastCpuMs = cpuMs;
      }
      const decision = decide({
        vendor: launch.vendor,
        nowMs,
        startedAtMs,
        lastStdioAtMs,
        stdioBytes,
        cpuMs,
        lastCpuAtMs,
        maxWallMs: options.maxWallMs ?? 2700000,
        idleStdioMs: options.idleStdioMs ?? 180000,
        idleCpuMs: options.idleCpuMs ?? 180000,
      });
      if (decision.action === 'kill') {
        killRecordedPid();
        finish({ ok: false, exitCode: 1, killed: true, killReason: decision.reason });
      }
    }, pollMs);

    child.once('close', (code) => {
      if (settled) return;
      finish({ ok: code === 0, exitCode: code ?? 1, killed: false, killReason: null });
    });
  });
}

module.exports = { runLaunch };
