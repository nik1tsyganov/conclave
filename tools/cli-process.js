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
      { encoding: 'utf8', windowsHide: true, timeout: 4000 },
    );
    const seconds = Number(String(out).trim());
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}

module.exports = { sampleCpuMs };
