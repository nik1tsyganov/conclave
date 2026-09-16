'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {probe}=require('./model-probe.js');
const {temporary,nativeCapture}=require('./test-fixtures.js');

function fixture(t) {
  const root=temporary(t,'magi-probe-edge-');
  const original=process.env.MAGI_CODEX_BIN;process.env.MAGI_CODEX_BIN=process.execPath;
  t.after(()=>{if(original===undefined)delete process.env.MAGI_CODEX_BIN;else process.env.MAGI_CODEX_BIN=original;});
  let calls=0;
  const runLaunch=async launch=>{
    calls++;
    const prompt=fs.readFileSync(launch.stdinFile,'utf8');
    const challenge=prompt.match(/MAGI_PROBE_[a-f0-9]{32}/)[0];
    const native=nativeCapture('openai','gpt-5.6-sol','medium',challenge);
    fs.writeFileSync(launch.args[launch.args.indexOf('-o')+1],native.capture);
    return {ok:true,exitCode:0,exitConfirmed:true,stdout:'',stderr:native.log};
  };
  return {root,calls:()=>calls,runLaunch,opts:{vendor:'openai',model:'gpt-5.6-sol',effort:'medium',evidenceDir:path.join(root,'evidence')}};
}

test('probe evidence inside a supplied workspace is rejected without calls or files',async t=>{
  const f=fixture(t),cwd=path.join(f.root,'product');fs.mkdirSync(cwd);
  const evidenceDir=path.join(cwd,'probe');
  await assert.rejects(probe({...f.opts,cwd,evidenceDir},{runLaunch:f.runLaunch}),/outside.*workspace/i);
  assert.equal(f.calls(),0);assert.deepEqual(fs.readdirSync(cwd),[]);
});

test('invalid probe timeout cannot create evidence or call a vendor',async t=>{
  const f=fixture(t);
  for(const maxWallMs of [NaN,Infinity,0,-1,1.5]) {
    await assert.rejects(probe({...f.opts,maxWallMs},{runLaunch:f.runLaunch}),/maxWallMs/);
    assert.equal(f.calls(),0);assert.equal(fs.existsSync(f.opts.evidenceDir),false);
  }
});

test('probe preserves the owned PID and incomplete cleanup after unconfirmed exit',async t=>{
  const f=fixture(t);let options;
  await assert.rejects(probe(f.opts,{runLaunch:async(launch,opts)=>{
    options=opts;const error=Object.assign(new Error('synthetic unconfirmed child exit'),{code:'CHILD_EXIT_UNCONFIRMED',pid:1234,exitConfirmed:false});throw error;
  }}),/unconfirmed child/);
  assert.equal(options.pidFile,path.join(f.opts.evidenceDir,'child.pid'));
  const result=JSON.parse(fs.readFileSync(path.join(f.opts.evidenceDir,'probe.json'),'utf8'));
  assert.equal(result.status,'FAIL');assert.equal(result.errorCode,'CHILD_EXIT_UNCONFIRMED');assert.equal(result.pid,1234);assert.equal(result.exitConfirmed,false);
  const audit=JSON.parse(fs.readFileSync(path.join(f.opts.evidenceDir,'scope-audit.json'),'utf8'));
  assert.equal(audit.complete,false);
});

test('both default and separate probe workspaces succeed with native fixture evidence',async t=>{
  const f=fixture(t),cwd=path.join(f.root,'product');fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'keep.txt'),'unchanged');
  for(const [name,work]of [['default',undefined],['external',cwd]]) {
    const result=await probe({...f.opts,cwd:work,evidenceDir:path.join(f.root,name)},{runLaunch:f.runLaunch});
    assert.equal(result.status,'PASS');
  }
  assert.equal(f.calls(),2);assert.equal(fs.readFileSync(path.join(cwd,'keep.txt'),'utf8'),'unchanged');
});

test('probe rejects a missing explicit cwd and runtime output before mutation',async t=>{
  const f=fixture(t),missing=path.join(f.root,'typo');
  await assert.rejects(probe({...f.opts,cwd:missing},{runLaunch:f.runLaunch}),/existing directory/);
  assert.equal(fs.existsSync(missing),false);assert.equal(fs.existsSync(f.opts.evidenceDir),false);
  const evidenceDir=path.join(__dirname,'unexpected-probe-output');
  await assert.rejects(probe({...f.opts,evidenceDir},{runLaunch:f.runLaunch}),/outside the runtime/);
  assert.equal(fs.existsSync(evidenceDir),false);assert.equal(f.calls(),0);
});

test('openai probe launch carries MAGI_CODEX_PROVIDER when set', async t => {
  const prev = process.env.MAGI_CODEX_PROVIDER;
  process.env.MAGI_CODEX_PROVIDER = 'openai';
  t.after(() => { if (prev === undefined) delete process.env.MAGI_CODEX_PROVIDER; else process.env.MAGI_CODEX_PROVIDER = prev; });
  const h = fixture(t);
  let seen;
  await probe(h.opts, { runLaunch: async launch => { seen = launch; return h.runLaunch(launch); } });
  const i = seen.args.indexOf('model_provider=openai');
  assert.ok(i > 0 && seen.args[i - 1] === '-c', 'provider flag missing');
  assert.ok(seen.args.indexOf('-C') > i, 'provider flag must precede -C');
});
