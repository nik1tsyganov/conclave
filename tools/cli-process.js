'use strict';

const { execFileSync } = require('node:child_process');

function sampleCpuMs(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return null;
  const exec = options.execFileSync || execFileSync;
  try {
    const out = exec(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).CPU`],
      { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const seconds = Number(String(out).trim());
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('positive child PID required');
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
  } else process.kill(pid, 'SIGKILL');
}

module.exports = { sampleCpuMs, terminateProcessTree };
