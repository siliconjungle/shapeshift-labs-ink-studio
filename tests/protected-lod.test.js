const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const kit = ink.load();
const { prepare } = require('../cli/protected-lod-review.js');
const run = ink.reviewProtectedLOD;
const scene = require('../examples/protected-lod/lockhouse.js')(kit);
const plan = require('../examples/protected-lod/lockhouse.review.json');
const render = {raw:true,edges:false};

test('named features hold only unsuitable cards across approved distances and poses', () => {
  const report = run(scene.build, plan, {kit,render});
  assert.equal(report.views.length, 5);
  assert.deepEqual(report.guard.holds.map(row=>row.part), ['portal','tablet','fin']);
  assert.deepEqual(report.firstFailures.map(f=>[f.pose,f.distance,f.feature,f.request.from,f.request.to]), [
    ['front',9,'boat-opening','mesh','card'], ['front',9,'brass-h','mesh','card'], ['front',9,'flag-notch','mesh','card'],
    ['raking',9,'boat-opening','mesh','card'], ['raking',9,'brass-h','mesh','card'], ['raking',9,'flag-notch','mesh','card']
  ]);
  assert.equal(report.firstFailure.request.amount,.53125);
  assert.equal(report.firstFailure.witness.pass,false);
  assert.equal(report.views[0].checks[0].status,'native');
  assert.deepEqual(report.untested,[]);
  assert.deepEqual(report.unresolved,[]);
  for (const view of report.views.slice(1)) {
    assert.deepEqual(view.checks.map(check=>check.status),['failed','failed','failed','passed']);
    assert.deepEqual(view.checks.map(check=>check.blocked.length),[1,1,1,0]);
    assert(view.checks.every(check=>check.guarded.every(probe=>probe.pass)));
  }
});

test('untested transitions retain detail, and bad native witnesses are called out', () => {
  const input = structuredClone(plan), {poses:[front]} = input;
  input.poses = [front];
  front.views = [front.views[0]];
  front.views[0].probes['boat-opening'][0].at = [63,62];
  const report = run(scene.build,input,{kit,render});
  assert.equal(report.firstFailure,null);
  assert.equal(report.views[0].checks[0].status,'reference-unresolved');
  assert.deepEqual(report.unresolved,[{pose:'front',distance:6,feature:'boat-opening',status:'reference-unresolved'}]);
  assert.equal(report.guard.holds.length,4);
  assert.equal(report.untested.length,4);
  front.views[0].probes['boat-opening'][0].at = [176,62];
  assert.throws(()=>prepare(input),/invalid or duplicate witness/);
  const {protectedLOD} = kit.KIT;
  assert.throws(()=>protectedLOD.prepare({...report.guard,holds:[report.guard.holds[0],report.guard.holds[0]]}),
    /Duplicate protected LOD hold/);
});
