// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const { execFileSync } = require('node:child_process');

// `ps -o time=` reports whole seconds ([[HH:]MM:]SS[.ss]); coarse, but the
// idle-activity rung measures minutes of silence, so seconds are enough.
function sampleCpuMs(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const exec = options.execFileSync || execFileSync;
  try {
    const out = exec('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] });
    const text = String(out).trim();
    if (!text) return null;
    const parts = text.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
    return Math.round(seconds * 1000);
  } catch { return null; }
}

function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('positive child PID required');
  // The child is not spawned detached, so there is no process group to signal.
  // Reap its direct children first, best effort, then kill the parent.
  try { execFileSync('/usr/bin/pkill', ['-KILL', '-P', String(pid)], { timeout: 10000, stdio: 'ignore' }); } catch { /* no children, or pkill unavailable */ }
  process.kill(pid, 'SIGKILL');
}

module.exports = { sampleCpuMs, terminateProcessTree };
