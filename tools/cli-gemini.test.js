const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildArgs, buildLaunch, parseEnvelope, parseLogModel } = require('./cli-gemini.js');
const { assertPointerLaunch } = require('./cli-pointer.js');

test('buildArgs: standard launch', () => {
    const pointer = 'Read C:\\path.md in full. Bytes: 10. SHA-256: abc. Follow it. Repeat its first line verbatim before anything else.\n';
    const launch = buildArgs(pointer, 'gemini-3.1-pro-high', { extraDirs: ['C:\\src\\test'] });
    
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
    assert.ok(launch.args.includes(pointer));
    assert.ok(launch.args.includes('--dangerously-skip-permissions'));
    
    assert.deepStrictEqual(launch.stdio, ['ignore', 'pipe', 'pipe']);
    assert.strictEqual(launch.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
    assert.strictEqual(launch.env.GEMINI_API_KEY, undefined);
    assert.strictEqual(launch.env.GOOGLE_API_KEY, undefined);
});

test('buildArgs: custom cwd', () => {
    const pointer = 'Read C:\\path.md in full. Bytes: 10. SHA-256: abc. Follow it. Repeat its first line verbatim before anything else.\n';
    const launch = buildArgs(pointer, 'gemini-3.1-pro-high', { cwd: 'C:\\src\\other' });
    assert.ok(launch.args.includes('C:\\src\\other'));
    assert.ok(!launch.args.includes('C:\\src\\magi'));
});

test('buildArgs: sandbox true', () => {
    const pointer = 'Read C:\\path.md in full. Bytes: 10. SHA-256: abc. Follow it. Repeat its first line verbatim before anything else.\n';
    const launch = buildArgs(pointer, 'gemini-3.1-pro-high', { sandbox: true });
    assert.ok(launch.args.includes('--sandbox'));
    assert.ok(!launch.args.includes('--dangerously-skip-permissions'));
});

test('buildArgs: rejects payloads over 2000 chars', () => {
    const large = 'x'.repeat(2001);
    assert.throws(() => {
        buildArgs(large, 'gemini-3.1-pro-high');
    }, /Magi CLI does not put brief bodies in argv/);
});

test('buildArgs: rejects payloads over 30000 chars', () => {
    const huge = 'x'.repeat(30001);
    assert.throws(() => {
        buildArgs(huge, 'gemini-3.1-pro-high');
    }, /Argument list too long/);
});

test('buildLaunch: reads from file and generates pointer text', () => {
    const tempPath = './temp-brief-test.md';
    const hugeBody = 'x'.repeat(40000);
    fs.writeFileSync(tempPath, hugeBody);
    try {
        const launch = buildLaunch({ briefPath: tempPath, model: 'gemini-3.1-pro-high', extraDirs: ['test'] });
        
        assert.ok(launch.args.includes('--add-dir'));
        assert.ok(launch.args.includes('test'));
        
        const resolvedPath = path.resolve(tempPath);
        const expectedDir = path.dirname(resolvedPath);
        assert.ok(launch.args.includes(expectedDir));

        const pIndex = launch.args.indexOf('-p');
        const pValue = launch.args[pIndex + 1];
        
        // Use the utility to verify
        assertPointerLaunch(pValue, hugeBody, tempPath);
        
        assert.ok(pValue.includes('Read '));
        assert.ok(pValue.includes('Bytes: 40000'));
        assert.ok(pValue.includes('SHA-256: '));
        
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
