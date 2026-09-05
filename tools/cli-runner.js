'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { decide } = require('./cli-idle.js');
const { sampleCpuMs, terminateProcessTree } = require('./cli-process.js');
const { assertPlainPath } = require('./dispatch-evidence.js');

function runLaunch(launch, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(Object.assign(new Error('dispatch cancelled before launch'), { code: 'CANCELLED' })); return; }
    const spawnFn = options.spawn || spawn;
    const child = spawnFn(launch.binary, launch.args, {
      cwd: launch.cwd,
      env: launch.env || process.env,
      shell: false,
      windowsHide: true,
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
    let timer;
    let killTimer;
    let killReason = null;
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };

    function killRecordedPid() {
      if (!Number.isInteger(pid)) return;
      try { (options.kill || terminateProcessTree)(pid); } catch {}
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', cancel);
      stdout += decoders.stdout.end(); stderr += decoders.stderr.end();
      resolve({ ...result, pid, stdout, stderr });
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', cancel);
      reject(error);
    }
    function collect(which) {
      return (chunk) => {
        const text = decoders[which].write(Buffer.from(chunk));
        if (which === 'stdout') stdout += text; else stderr += text;
        stdioBytes += Buffer.byteLength(chunk);
        lastStdioAtMs = Date.now();
        try { if (options[`${which}File`]) { assertPlainPath(options[`${which}File`]); fs.appendFileSync(options[`${which}File`], chunk); } }
        catch (error) { killRecordedPid(); fail(error); }
      };
    }
    if (child.stdout) child.stdout.on('data', collect('stdout'));
    if (child.stderr) child.stderr.on('data', collect('stderr'));
    if (child.stdin) child.stdin.once('error', (error) => { if (error.code !== 'EPIPE') { killRecordedPid(); fail(error); } });
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
    function requestKill(reason) {
      if (settled || killReason) return;
      killReason = reason;
      killRecordedPid();
      killTimer = setTimeout(() => fail(Object.assign(new Error('child exit was not confirmed after termination'), { code: 'CHILD_EXIT_UNCONFIRMED' })), options.killGraceMs ?? 10000);
    }
    function cancel() { requestKill('cancelled'); }
    options.signal?.addEventListener('abort', cancel, { once: true });
    timer = setInterval(() => {
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
        requestKill(decision.reason);
      }
    }, pollMs);

    child.once('close', (code) => {
      if (settled) return;
      finish({ ok: code === 0 && !killReason, exitCode: code ?? 1, killed: Boolean(killReason), killReason, exitConfirmed: true });
    });
  });
}

module.exports = { runLaunch };
