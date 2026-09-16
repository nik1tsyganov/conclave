'use strict';

const { execFileSync } = require('node:child_process');

function sampleCpuMs(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const platform = options.platform || process.platform;
  // POSIX has no sampler here: `ps -o time=` reports whole seconds only, which
  // is coarser than the idle-CPU rung needs. Returning null disables that rung.
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
    return;
  }
  // The child is not spawned detached, so there is no process group to signal.
  // Reap its direct children first, best effort, then kill the parent.
  try { execFileSync('/usr/bin/pkill', ['-KILL', '-P', String(pid)], { timeout: 10000, stdio: 'ignore' }); } catch { /* no children, or pkill unavailable */ }
  process.kill(pid, 'SIGKILL');
}

module.exports = { sampleCpuMs, terminateProcessTree };
