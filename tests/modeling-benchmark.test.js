'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const B = require('../cli/modeling-benchmark.js');
const files = require('../cli/asset-files.js');
const review = require('../cli/modeling-benchmark-review.js');
const PNG = require('../cli/png.js');
const demo = require('../examples/modeling-benchmark/demo.cjs');

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-modeling-benchmark-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  return directory;
}

test('fixed starts reject drift and finish freezes exact evidence of changed attachments and pigment',async t => {
  const directory = sandbox(t), suite = path.join(directory,'suite'), run = path.join(directory,'trial');
  const prepared = await ink.prepareModelingBenchmark(suite);
  assert.deepEqual(await ink.prepareModelingBenchmark(path.join(directory,'again')),prepared);
  assert(!fs.existsSync(path.join(suite,'captured-prop','hatch.json')));
  const call = (...args) => JSON.parse(execFileSync(process.execPath,
    [path.resolve(__dirname,'../cli/ink-studio.js'),'modeling-benchmark',...args],{encoding:'utf8'}));
  const started = call('start',suite,'signal-coil','--participant','maker-1','--kind','person',
    '--workflow','test','--tool-revision','build-123','--out',run);
  const source = path.join(run,'start','source.json'), bytes = fs.readFileSync(source);
  fs.appendFileSync(source,'\n');
  await assert.rejects(ink.finishModelingBenchmark(run),/starting files changed/);
  assert(!fs.existsSync(path.join(run,'result')));
  fs.writeFileSync(source,bytes);
  const repaired = call('repair',run,'--target','entry-socket','--note','Adjusted the socket binding.');
  const draft = B.read(source);
  draft.pigment = '#111111';
  draft.route.attachments.pop();
  draft.route.splines[0].points[0].position[0] += .05;
  files.json(path.join(run,'edit.json'),draft);
  const result = call('finish','--repairs-complete',run);
  assert.equal(result.runId,started.runId);
  assert(result.elapsedMs >= 0);
  assert.equal(result.manualRepair.count,1);
  assert.deepEqual(result.manualRepair.events,[repaired]);
  assert.deepEqual(result.bindings,{expected:2,retained:0,lost:['exit-socket'],displaced:['entry-socket']});
  assert.deepEqual(result.paint,{protectedTexels:0,retainedTexels:0,protectedSwatches:1,retainedSwatches:0});
  assert.equal(B.resultAt(run).submissionSha256,B.sha256(fs.readFileSync(path.join(run,'result','submission.json'))));
  assert.throws(() => ink.recordModelingRepair(run,{target:'a',note:'Late repair'}),/already finished/);
  await assert.rejects(ink.finishModelingBenchmark(run),/new output directory/);
});

test('all four reference edits beat unedited controls on pinned native views and accept blinded scores',async t => {
  const directory = path.join(sandbox(t),'demo');
  const {reviewers} = await demo.run(directory), blind = path.join(directory,'blind');
  const at = (...parts) => path.join(directory,...parts);
  const key = B.read(path.join(blind,'review-key.json'));
  assert.equal(reviewers.length,4);
  const plan = B.read(at('comparison-plan.json'));
  const [control,reference] = [plan.baseline,plan.candidate].map(group => group.map(run => at(run)));
  const main = PNG.read(at('Four-Modeling-Edits.png'));
  assert.deepEqual([main.w,main.h],[1056,1190]);
  assert.equal(B.read(at('pending-scores.json')).received,0);
  for (const file of reviewers) {
    const html = fs.readFileSync(path.join(blind,file),'utf8');
    assert(!/sdk-reference|unedited-control|fixture-runner|review-key\.json/.test(html));
    assert(!key.seats.some(seat => seat.assignments.some(row => html.includes(row.runId))));
    assert.match(html,/"width":160,"height":104/);
  }
  const first = key.seats[0], second = key.seats[1];
  const order = (seat,task) => seat.assignments.filter(row => row.task === task).map(row => row.runId);
  for (const task of Object.keys(B.tasks)) assert.deepEqual(order(first,task),order(second,task).reverse());
  const references = new Set(reference.map(dir => B.resultAt(dir).runId));
  const ballot = {format:B.formats.ballot,version:1,session:key.session,seat:first.seat,
    ratings:first.assignments.map(({code,runId}) => ({code,values:{brief:references.has(runId) ? 5 : 2,craft:4,continuity:3}}))};
  assert.throws(() => review.summarize(key,[ballot,ballot]),/duplicate ballot/);
  assert.throws(() => review.summarize(key,[{...ballot,ratings:ballot.ratings.slice(1)}]),/incomplete/);
  files.json(at('ballots','test.json'),ballot);
  const scores = ink.scoreModelingBenchmarkReview(path.join(blind,'review-key.json'),at('ballots'),at('scores.json'));
  assert.equal(scores.received,1);
  const summary = ink.compareModelingBenchmarks(control,reference,{scores});
  assert.equal(summary.tasks.length,4);
  for (const {cohorts,participants} of summary.tasks) {
    assert.equal(cohorts[0].paired,1);
    assert.deepEqual(cohorts[0].meanDeltas['review-brief'],{pairs:1,mean:3});
    assert.equal(participants[0].candidate.metrics.lostBindings,0);
    assert(participants[0].difference.checksPassed > 0);
  }
  const reportFile = path.join(reference[0],'result','report.json'), original = fs.readFileSync(reportFile);
  const report = B.read(reportFile);
  report.views[0].beforeSha256 = 'a'.repeat(64);
  files.json(reportFile,report);
  assert.throws(() => ink.compareModelingBenchmarks(control,reference),/different starting revisions or baseline frames/);
  fs.writeFileSync(reportFile,original);
  assert.equal(B.read(path.join(reference[3],'result','report.json')).views[0].changedPixels,0);
});
