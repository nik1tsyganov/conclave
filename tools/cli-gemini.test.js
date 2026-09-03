const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { buildArgs, buildLaunch, parseEnvelope, parseLogModel } = require('./cli-gemini.js');

test('buildArgs: standard launch', () => {
    const brief = 'this is a test brief';
    const launch = buildArgs(brief, 'gemini-3.1-pro-high', { extraDirs: ['C:\\src\\test'] });
    
    assert.strictEqual(launch.binary, 'C:\\Users\\YESSIR\\tools\\bin\\agy.exe');
    assert.ok(launch.args.includes('--print-timeout'));
    assert.ok(launch.args.includes('20m'));
    assert.ok(launch.args.includes('--output-format'));
    assert.ok(launch.args.includes('json'));
    assert.ok(launch.args.includes('--add-dir'));
    assert.ok(launch.args.includes('C:\\Users\\YESSIR\\.claude\\skills'));
    assert.ok(launch.args.includes('C:\\src\\magi'));
    assert.ok(launch.args.includes('C:\\src\\test'));
    assert.ok(launch.args.includes('--model'));
    assert.ok(launch.args.includes('gemini-3.1-pro-high'));
    assert.ok(!launch.args.includes('-m'));
    assert.ok(launch.args.includes('-p'));
    assert.ok(launch.args.includes(brief));
    assert.ok(launch.args.includes('--dangerously-skip-permissions'));
    
    assert.deepStrictEqual(launch.stdio, ['ignore', 'pipe', 'pipe']);
    assert.strictEqual(launch.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
    assert.strictEqual(launch.env.GEMINI_API_KEY, undefined);
    assert.strictEqual(launch.env.GOOGLE_API_KEY, undefined);
});

test('buildArgs: custom cwd', () => {
    const brief = 'this is a test brief';
    const launch = buildArgs(brief, 'gemini-3.1-pro-high', { cwd: 'C:\\src\\other' });
    assert.ok(launch.args.includes('C:\\src\\other'));
    assert.ok(!launch.args.includes('C:\\src\\magi'));
});

test('buildArgs: rejects payloads over 30000 chars', () => {
    const huge = 'x'.repeat(30001);
    assert.throws(() => {
        buildArgs(huge, 'gemini-3.1-pro-high');
    }, /Argument list too long/);
});

test('buildLaunch: reads from file', () => {
    const tempPath = './temp-brief-test.md';
    fs.writeFileSync(tempPath, 'file brief text');
    try {
        const launch = buildLaunch({ briefPath: tempPath, model: 'gemini-3.1-pro-high', extraDirs: ['test'] });
        assert.ok(launch.args.includes('file brief text'));
        assert.ok(launch.args.includes('--add-dir'));
        assert.ok(launch.args.includes('test'));
    } finally {
        fs.unlinkSync(tempPath);
    }
});

test('parseEnvelope: success returns object with conversation_id and usage', () => {
    const good = JSON.stringify({
        status: 'SUCCESS',
        response: 'done',
        conversation_id: '123',
        usage: { totalTokens: 42 }
    });
    assert.deepStrictEqual(parseEnvelope(good), { ok: true, conversation_id: '123', usage: { totalTokens: 42 } });

    const goodNoUsage = JSON.stringify({
        status: 'SUCCESS',
        response: 'done',
        conversation_id: '123'
    });
    assert.deepStrictEqual(parseEnvelope(goodNoUsage), { ok: true, conversation_id: '123' });

    const missingResp = JSON.stringify({ status: 'SUCCESS', response: '', conversation_id: '123' });
    assert.deepStrictEqual(parseEnvelope(missingResp), { ok: false });

    const failStatus = JSON.stringify({ status: 'FAIL', response: 'done', conversation_id: '123' });
    assert.deepStrictEqual(parseEnvelope(failStatus), { ok: false });
    
    const missingConv = JSON.stringify({ status: 'SUCCESS', response: 'done' });
    assert.deepStrictEqual(parseEnvelope(missingConv), { ok: false });
});

test('parseLogModel: extracts model or fails if mismatch', () => {
    const log = `some log text model="gemini-3.1-pro-high" other`;
    assert.strictEqual(parseLogModel(log, 'gemini-3.1-pro-high'), 'gemini-3.1-pro-high');
    
    // Mismatch
    assert.strictEqual(parseLogModel(log, 'gemini-2.0-pro-exp'), false);
    
    // No model
    assert.strictEqual(parseLogModel('no model here', 'gemini-3.1-pro-high'), false);
});
