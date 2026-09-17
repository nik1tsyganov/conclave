const test = require('node:test');
const assert = require('node:assert');
const { decide, forbiddenKill, vendorStdoutMode } = require('./cli-idle.js');

test('decide: all vendors past maxWallMs -> kill wall', () => {
    const sample = {
        vendor: 'openai', nowMs: 2000, startedAtMs: 0, lastStdioAtMs: 1000, stdioBytes: 100, cpuMs: null, lastCpuAtMs: null, maxWallMs: 1000, idleStdioMs: 5000, idleCpuMs: 5000
    };
    assert.deepStrictEqual(decide(sample), { action: 'kill', reason: 'wall', killMethod: 'pid-only' });
});

test('decide: openai silent stdio past idleStdioMs -> kill idle-stdio', () => {
    const sample = {
        vendor: 'openai', nowMs: 2000, startedAtMs: 0, lastStdioAtMs: 0, stdioBytes: 100, cpuMs: null, lastCpuAtMs: null, maxWallMs: 5000, idleStdioMs: 1000, idleCpuMs: 5000
    };
    assert.deepStrictEqual(decide(sample), { action: 'kill', reason: 'idle-stdio', killMethod: 'pid-only' });
});

test('decide: google and anthropic silent stdio past idleStdioMs but under wall and cpu null -> continue', () => {
    for (const vendor of ['google', 'anthropic']) {
        const sample = {
            vendor, nowMs: 2000, startedAtMs: 0, lastStdioAtMs: 0, stdioBytes: 100, cpuMs: null, lastCpuAtMs: null, maxWallMs: 5000, idleStdioMs: 1000, idleCpuMs: 5000
        };
        assert.deepStrictEqual(decide(sample), { action: 'continue', reason: null, killMethod: 'pid-only' });
    }
});

test('decide: anthropic cpu frozen past idleCpuMs alone does not kill (idle-cpu rung retired 2026-09-16); all signals silent past idleActivityMs does', () => {
    const sample = {
        vendor: 'anthropic', nowMs: 2000, startedAtMs: 0, lastStdioAtMs: 0, stdioBytes: 100, cpuMs: 100, lastCpuAtMs: 0, maxWallMs: 5000, idleStdioMs: 1000, idleCpuMs: 1000
    };
    assert.deepStrictEqual(decide(sample), { action: 'continue', reason: null, killMethod: 'pid-only' });
    assert.deepStrictEqual(decide({ ...sample, idleActivityMs: 1500 }), { action: 'kill', reason: 'idle-activity', killMethod: 'pid-only' });
    assert.deepStrictEqual(decide({ ...sample, idleActivityMs: 1500, lastActivityAtMs: 1900 }), { action: 'continue', reason: null, killMethod: 'pid-only' });
});

test('forbiddenKill: matches pkill <name> and killall', () => {
    assert.strictEqual(forbiddenKill('killall node'), true);
    assert.strictEqual(forbiddenKill('pkill node'), true);
    
    assert.strictEqual(forbiddenKill('taskkill /PID 1234'), false);
    assert.strictEqual(forbiddenKill('process.kill(1234)'), false);
    assert.strictEqual(forbiddenKill('pkill 1234'), false);
});

test('vendorStdoutMode: correct modes', () => {
    assert.strictEqual(vendorStdoutMode('google'), 'buffered-until-exit');
    assert.strictEqual(vendorStdoutMode('anthropic'), 'buffered-until-exit');
    assert.strictEqual(vendorStdoutMode('openai'), 'streaming');
});
