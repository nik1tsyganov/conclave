// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createSealedRun,fakeVendor}=require('./test-fixtures.js');
const {installConclaveCursorCli}=require('./install-plugin.js');

test('installed CLI completes Claude checkpoint, foreign checks, activation, tally and diagnostic export',async t=>{
  const run=createSealedRun(t,[
    {unitId:'u1',vendor:'anthropic',model:'fable',effort:'medium'},
    {unitId:'u1',role:'verify',class:'test-verification',vendor:'openai',model:'gpt-5.6-sol',effort:'medium',authorVendor:'anthropic'},
    {unitId:'u1',role:'review',class:'review-adversarial',vendor:'google',model:'gemini-3.1-pro-high',effort:'fused-high',authorVendor:'anthropic'},
  ],{conclaveConvened:true});
  const installed=path.join(run.root,'runtime ü & [copy]');
  installConclaveCursorCli({destination:installed});
  const tools=path.join(installed,'tools');
  // Only external vendor transport is synthetic. Installed command parsing,
  // staging, proof, transactions, checkpoints and subsequent CLI gates are real.
  const native=fakeVendor();
  const providerHome=path.join(run.root,'provider-home');
  require(path.join(tools,'cli-adapters.js')).buildLaunch=opts=>{
    const launch=native.buildLaunch(opts);
    if(opts.vendor==='google')launch.nativeLogPath=path.join(path.dirname(opts.capturePath),'native-cli.log');
    return launch;
  };
  require(path.join(tools,'cli-runner.js')).runLaunch=async launch=>{
    const result=await native.runLaunch(launch);
    if(launch.vendor==='anthropic') {
      const id=result.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).find(row=>row.type==='result').session_id;
      const project=path.join(providerHome,'.claude','projects',launch.cwd.replace(/[^a-zA-Z0-9]/g,'-'));
      fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,id+'.jsonl'),result.stderr);
    }
    if(launch.vendor==='google')fs.writeFileSync(launch.nativeLogPath,result.stderr);
    return result;
  };
  const collector=require(path.join(tools,'vendor-native.js'));
  const nativeLog=collector.nativeLog;
  collector.nativeLog=(vendor,capture,baseLog,opts)=>nativeLog(vendor,capture,baseLog,{...opts,home:providerHome});
  collector.codexSessionTranscript=native.codexSessionTranscript;
  collector.googleSessionTranscript=native.googleSessionTranscript;
  const {main}=require(path.join(tools,'dispatch-run.js'));
  const common=['--plan',run.sealed.planPath,'--rules-root',run.opts.rulesRoot];
  async function dispatch(id,extra=[]) {
    let stdout='',stderr='';
    const code=await main([...common,'--dispatch-id',id,...extra],{stdout:{write:x=>stdout+=x},stderr:{write:x=>stderr+=x}});
    assert.equal(code,0,stderr);
    return JSON.parse(stdout);
  }
  function command(tool,args,expected=0) {
    const r=spawnSync(process.execPath,[path.join(tools,tool),...args],{cwd:installed,encoding:'utf8',timeout:15000});
    assert.equal(r.status,expected,r.stderr);assert.equal(r.error,undefined);
    return r.stdout;
  }
  command('conclave-whoami.js',['--mode','cursor-cli','--slug','grok-4.6']);
  const pending=await dispatch('d1');
  assert.equal(pending.status,'AWAITING_ATTESTATION');assert.equal(pending.ok,false);assert.equal(native.calls(),1);
  const pendingAgain=await dispatch('d1');
  assert.equal(pendingAgain.captureSha256,pending.captureSha256);assert.equal(native.calls(),1);
  assert.match(fs.readFileSync(pending.responsePath,'utf8'),/^ACK fixture/);
  const accepted=await dispatch('d1',['--on-topic','--capture-sha256',pending.captureSha256]);
  assert.equal(accepted.ok,true);assert.equal(native.calls(),1);
  assert.equal((await dispatch('d2')).ok,true);
  assert.equal((await dispatch('d3')).ok,true);assert.equal(native.calls(),3);
  for(const tool of ['run-finalize.js','activation-check.js']) assert.equal(JSON.parse(command(tool,['--run-dir',run.runDir])).ok,true);
  assert.equal(JSON.parse(command('panel-tally.js',['--run-dir',run.runDir,'--unit-id','u1'])).passed,true);
  const output=path.join(run.root,'report');
  const exported=JSON.parse(command('project-run-report.js',['--run-dir',run.runDir,'--output-dir',output]));
  assert.equal(exported.status,'PASS');
  const report=JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8'));
  assert.equal(report.dispatches.length,3);assert.ok(report.dispatches.every(row=>row.status==='PASS'&&row.nativeId));
  assert.equal(native.calls(),3);
});
