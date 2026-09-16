function decide(sample) {
    const {
        vendor,
        nowMs, startedAtMs,
        lastStdioAtMs, stdioBytes,
        cpuMs, lastCpuAtMs,
        maxWallMs, idleStdioMs, idleCpuMs
    } = sample;

    if (nowMs - startedAtMs >= maxWallMs) {
        return { action: 'kill', reason: 'wall', killMethod: 'pid-only' };
    }

    if (vendor === 'anthropic' || vendor === 'google') {
        // do NOT kill for idle-stdio (google buffers stdout until exit)
    } else if (vendor === 'openai') {
        if (nowMs - lastStdioAtMs >= idleStdioMs) {
            return { action: 'kill', reason: 'idle-stdio', killMethod: 'pid-only' };
        }
    }

    // Stalled-vs-thinking rung (adopted from Droppy Code Hydra, 2026-09-16):
    // no stdio byte, no native-log growth and no CPU progress for idleActivityMs
    // means the child is stuck, whatever the vendor. Any one signal resets it.
    const { lastActivityAtMs, idleActivityMs } = sample;
    if (Number.isFinite(idleActivityMs) && idleActivityMs > 0) {
        const signals = [lastStdioAtMs, lastActivityAtMs, lastCpuAtMs].filter((t) => typeof t === 'number' && Number.isFinite(t));
        const lastSignal = signals.length ? Math.max(...signals) : startedAtMs;
        if (nowMs - lastSignal >= idleActivityMs) {
            return { action: 'kill', reason: 'idle-activity', killMethod: 'pid-only' };
        }
    }

    if (typeof cpuMs === 'number' && Number.isFinite(cpuMs) &&
        typeof lastCpuAtMs === 'number' && Number.isFinite(lastCpuAtMs)) {
        if (nowMs - lastCpuAtMs >= idleCpuMs) {
            return { action: 'kill', reason: 'idle-cpu', killMethod: 'pid-only' };
        }
    }

    return { action: 'continue', reason: null, killMethod: 'pid-only' };
}

function forbiddenKill(cmd) {
    if (typeof cmd !== 'string') return false;
    const lowerCmd = cmd.toLowerCase();
    if (/\btaskkill\s+\/im\b/.test(lowerCmd)) return true;
    if (/\bkillall\b/.test(lowerCmd)) return true;
    if (/\bpkill\s+[^\d-]/.test(lowerCmd)) return true;
    return false;
}

function vendorStdoutMode(vendor) {
    if (vendor === 'anthropic' || vendor === 'google') {
        return 'buffered-until-exit';
    }
    return 'streaming';
}

module.exports = {
    decide,
    forbiddenKill,
    vendorStdoutMode
};
