const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {load} = require('..');
const {embedStoryDocuments} = require('../cli/story-document.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const sim = (...args)=>spawnSync(process.execPath,[cli,'sim',...args],{encoding:'utf8'});
const R = load().KIT.world.runtime;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-fork-compare-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return name=>path.join(dir,name);
}
function compare(source,plan,out) {
  const run = sim('fork-compare',source,plan,'--out',out);
  assert.equal(run.status,0,run.stderr);
  const report = read(path.join(out,'comparison.json'));
  assert.deepEqual(JSON.parse(run.stdout),report);
  return report;
}
const exampleRun = (name,out)=>compare(example(name+'.world'),example(name+'.fork-compare'),out);

test('capture one active stage, try its shorthand choice, and verify both branches from the identical state', t => {
  const out = temp(t)('routes'), report = exampleRun('breakwater-watch',out);
  const point = read(path.join(out,report.decision.checkpoint));
  assert.equal(report.decision.tick,3);
  assert.equal(report.decision.story.stage,'plan-route');
  assert.equal(report.decision.choices.visit,2);
  assert.equal(report.decision.sha256,createHash('sha256').update(JSON.stringify(point)).digest('hex'));
  assert.deepEqual(report.branches.map(row=>row.story.outcome),['standard-delivery','night-delivery']);
  for (const branch of report.branches) {
    assert.equal(branch.verification.status,'verified');
    const run = read(path.join(out,branch.recording));
    assert.deepEqual(run.origin,point);
    assert.deepEqual(R.replay(run).checkpoint(),run.end);
  }
  const [coast,night] = report.branches;
  assert.deepEqual([coast,night].map(row=>row.costs.accounts.find(a=>a.id==='supplies/staging').delta),[-2,-3]);
  assert.deepEqual([coast,night].map(row=>row.costs.transfers.rows[0].applied),[2,3]);
  assert.equal(night.commands[0].args.visit,2);
  assert.equal(night.commands[0].args.option,'ridge');
  assert.equal(report.difference.costs.accounts.find(row=>row.id==='supplies/staging').delta,-1);
});

test('keep commands pending at the capture tick and exclude later submissions from the source recording', t => {
  const file = temp(t), source = example('breakwater-watch.world');
  const run = R.create(embedStoryDocuments(read(source),source),{recordRun:true});
  run.schedule([{tick:6,action:'world/event',args:{kind:'shared-submission'}}]);
  run.advance(4);
  run.schedule([{tick:5,action:'world/event',args:{kind:'source-continuation'}}]);
  run.advance(8);
  const log = file('original.run.json'), plan = file('plan.json');
  write(log,run.recording());
  write(plan,{story:'breakwater-watch/dispatch',capture:{tick:3},until:8,branches:[
    {id:'baseline'},{id:'trial',actions:[{tick:5,action:'world/event',args:{kind:'trial-submission'}}]}
  ]});
  const out = file('trials'), report = compare(log,plan,out);
  const [a,b] = report.branches.map(row=>read(path.join(out,row.recording)));
  assert.deepEqual(a.origin,b.origin);
  assert(a.origin.pending.some(row=>row.args.kind==='shared-submission'));
  assert(run.history.some(row=>row.kind==='source-continuation'));
  for (const record of [a,b]) {
    assert(record.end.history.some(row=>row.kind==='shared-submission'));
    assert(!record.end.history.some(row=>row.kind==='source-continuation'));
  }
  assert(!a.end.history.some(row=>row.kind==='trial-submission'));
  assert(b.end.history.some(row=>row.kind==='trial-submission'));
});

test('commitment and fallout differences retain the native receipts even with world history disabled', t => {
  const file = temp(t), quay = exampleRun('quay-relay',file('quay'));
  assert.equal(quay.decision.commitment.assignment.agent,'mira');
  assert.deepEqual(quay.branches.map(row=>[row.commitment.assignment.agent,row.story.status]),
    [['mira','expired'],['niko','completed']]);
  const handoff = quay.difference.commitments[0].after.handoffs.transfers[0];
  assert.equal(handoff.release.status,'cancelled');
  assert.equal(handoff.release.work.results[0].receipt.applied,2);
  const bank = exampleRun('low-bank',file('bank'));
  assert.deepEqual(bank.branches.map(row=>row.story.consequences.subjects.roll.result),['salvaged','lost']);
  assert(bank.branches.every(row=>row.story.consequences.subjects.level.irreversible));
  assert.deepEqual(bank.branches.map(row=>row.fallout.probes.find(probe=>probe.id==='roll-status').after.value),['held','held']);
  assert(bank.branches.every(row=>row.fallout.events.rows.some(event=>event.kind==='story-consequences')));
  assert.equal(bank.difference.fallout.probes.length,0);
});

test('invalid plans leave the input and destination intact', t => {
  const file = temp(t), source = example('breakwater-watch.world'), out = file('output');
  const plan = file('plan.json'), invalid = read(example('breakwater-watch.fork-compare'));
  invalid.branches[1].choice.tick = 3;
  write(plan,invalid);
  const result = sim('fork-compare',source,plan,'--out',out);
  assert.equal(result.status,1);
  assert.match(result.stderr,/actions must follow capture/);
  assert.equal(fs.existsSync(out),false);
  fs.mkdirSync(out);
  const aliased = path.join(out,'comparison.json');
  fs.symlinkSync(plan,aliased);
  const original = fs.readFileSync(plan,'utf8');
  assert.match(sim('fork-compare',source,plan,'--out',out).stderr,/separate directory/);
  assert.equal(fs.readFileSync(plan,'utf8'),original);
});
