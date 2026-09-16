'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSealedRun, fakeVendor, temporary } = require('./test-fixtures.js');
const { sealPlan, readSealedRun } = require('./plan-seal.js');
const { hashFile } = require('./dispatch-evidence.js');
const { runDispatch, parseArgs } = require('./dispatch-run.js');

test('UTF-8 BOM plan and availability retain their byte identity through sealing and dispatch', async t => {
  const run = createSealedRun(t);
  for (const file of [run.planSource, run.availability]) fs.writeFileSync(file, '\uFEFF'+fs.readFileSync(file,'utf8'));
  const bytes = fs.readFileSync(run.planSource);
  const sealed = sealPlan({ noJev: 'test fixture', plan:run.planSource,runDir:path.join(run.root,'bom-run'),availability:run.availability,skillSourceRoot:run.opts.skillSourceRoot});
  assert.equal(sealed.planHash,hashFile(run.planSource));
  assert.deepEqual(fs.readFileSync(sealed.planPath),bytes);
  assert.equal(readSealedRun(sealed.runDir).plan.planId,run.planObject.planId);
  const native = fakeVendor();
  assert.equal((await runDispatch({...run.opts,plan:sealed.planPath,runDir:sealed.runDir,dispatchId:'d1'},native)).ok,true);
  assert.equal(native.calls(),1);
  fs.appendFileSync(sealed.planPath,' ');
  assert.throws(()=>readSealedRun(sealed.runDir),/sealed run inputs changed/);
});

test('invalid timeout leaves the dispatch available for a corrected command', async t => {
  const run = createSealedRun(t);
  const native = fakeVendor();
  for (const maxWallMs of ['oops',0,-1,Infinity,2700001,1.5]) {
    await assert.rejects(runDispatch({...run.opts,dispatchId:'d1',maxWallMs},native),/max-wall-ms/);
    assert.equal(native.calls(),0);
    assert.equal(fs.existsSync(path.join(run.runDir,'.magi-dispatches')),false);
  }
  assert.equal((await runDispatch({...run.opts,dispatchId:'d1',maxWallMs:'120000'},native)).ok,true);
  assert.equal(native.calls(),1);
});

test('duplicate task selectors, limits, and attestation flags are argument errors', () => {
  for(const flag of ['--dispatch-id','--plan','--max-wall-ms','--capture-sha256']) {
    assert.throws(()=>parseArgs([flag,'first',flag,'second']),/duplicate/i);
  }
  assert.throws(()=>parseArgs(['--on-topic','--on-topic']),/duplicate/i);
});

test('BOM operator config and availability updates use the same UTF-8 input contract', t => {
  const root=temporary(t);
  const config=path.join(root,'vendors.json');
  fs.writeFileSync(config,'\uFEFF'+JSON.stringify({vendors:{openai:{binary:process.execPath}}}));
  assert.equal(require('./vendor-binaries.js').resolveVendorBinary('openai',{configFile:config,env:{}}),process.execPath);
  const availability=path.join(root,'availability.json');
  fs.writeFileSync(availability,'\uFEFF'+JSON.stringify({schemaVersion:2,vendors:{}}));
  const proof=require('./test-fixtures.js').probeRecord(root,'openai','gpt-6-astra','high');
  require('./model-availability.js').record({file:availability,probe:proof.evidence.path});
  assert.equal(require('./dispatch-matrix.js').loadAvailability(availability).vendors.openai.models['gpt-6-astra'].efforts.high.available,true);
});

test('input decoding refuses malformed encodings and extra BOMs without rewriting files', t => {
  const root=temporary(t),file=path.join(root,'invalid.json');
  for(const bytes of [Buffer.from('\uFEFF{}','utf16le'),Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]),Buffer.from('\uFEFF\uFEFF{}'),Buffer.from('{')]) {
    fs.writeFileSync(file,bytes);
    assert.throws(()=>require('./json-file.js').readJsonFile(file));
    assert.deepEqual(fs.readFileSync(file),bytes);
  }
});

test('probe and availability commands reject ambiguous options before I/O', () => {
  for(const [module,flag]of [['model-probe.js','--vendor'],['model-availability.js','--file']]) {
    const parse=require('./'+module).parseArgs;
    assert.throws(()=>parse([flag,'first',flag,'second']),/duplicate/);
    assert.throws(()=>parse([flag,'--cwd']),/Usage|invalid option/);
  }
  let error='';
  const code=require('./dispatch-matrix.js').main(['--plan','first','--plan','second'],{stdout:{write(){}},stderr:{write(text){error+=text;}}});
  assert.equal(code,2);assert.match(error,/duplicate/);
});

test('sealing cannot place run evidence inside its installed runtime', t => {
  const run=createSealedRun(t),destination=path.join(run.root,'installed-runtime');
  require('./install-plugin.js').installMagiCursorCli({destination});
  const runDir=path.join(destination,'saved-run');
  assert.throws(()=>require(path.join(destination,'tools/plan-seal.js')).sealPlan({ noJev: 'test fixture', plan:run.planSource,availability:run.availability,runDir}),/runtime.*overlap|overlap.*runtime/i);
  assert.equal(fs.existsSync(runDir),false);
});
