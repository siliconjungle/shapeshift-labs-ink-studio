'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { tasks, grid } = require('../examples/modeling-benchmark/tasks.cjs');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const review = require('./pixel-review-export.js');

const namespace = 'ink-studio/modeling-benchmark';
const formats = Object.fromEntries(['suite','run','result','repair','review-key','ballot','scores','comparison']
  .map(name => [name,namespace+'-'+name]));
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const token = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const text = (value,max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const check = (condition,message) => { if (!condition) throw new RangeError('Modeling benchmark: '+message); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => sha256(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const valid = (value,format) => value?.format === formats[format] && value.version === 1;
const allowedKind = kind => ['person','agent','script'].includes(kind);
const inputName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}\.(?:json|png)$/.test(value);
const sourceSpec = task => {
  const {title,brief,review,views,fixture} = task;
  return {title,brief,review,views,...(fixture && {fixture})};
};

async function publish(directory, build) {
  const output = path.resolve(directory), parent = path.dirname(output);
  check(!fs.lstatSync(output,{throwIfNoEntry:false}),'choose a new output directory');
  fs.mkdirSync(parent,{recursive:true});
  const stage = fs.mkdtempSync(path.join(parent,'.ink-modeling-benchmark-'));
  try {
    const result = await build(stage);
    fs.renameSync(stage,output);
    return result;
  } finally {
    fs.rmSync(stage,{recursive:true,force:true});
  }
}

function inventory(directory, names) {
  return names.map(file => ({file,sha256:sha256(fs.readFileSync(path.join(directory,file)))}));
}

function validateTrack(track) {
  const task = track && Object.hasOwn(tasks,track.id) && tasks[track.id];
  check(task && isDeepStrictEqual(track.spec,sourceSpec(task)) && digest(track.startRevision) &&
    Array.isArray(track.inputs) && track.inputs.length >= 1 && track.inputs.length <= 20 &&
    track.inputs.every(row => inputName(row?.file) && digest(row.sha256)) &&
    new Set(track.inputs.map(row => row.file)).size === track.inputs.length &&
    track.inputs.some(row => row.file === 'source.json') &&
    fingerprint({id:track.id,spec:track.spec,grid,inputs:track.inputs}) === track.startRevision,
  'invalid starting revision or unsupported task protocol');
  return task;
}

function verifyInputs(directory, track) {
  const task = validateTrack(track);
  check(isDeepStrictEqual(inventory(directory,track.inputs.map(row => row.file)),track.inputs),
    'starting files changed since preparation');
  return task;
}

async function prepare(directory, { toolkit = require('..') } = {}) {
  return publish(directory,async stage => {
    const tracks = [];
    for (const [id,task] of Object.entries(tasks)) {
      const folder = path.join(stage,id);
      fs.mkdirSync(folder);
      files.json(path.join(folder,'source.json'),await task.source(toolkit,folder));
      const inputs = inventory(folder,fs.readdirSync(folder).sort()), spec = sourceSpec(task);
      const track = {id,spec,inputs,startRevision:fingerprint({id,spec,grid,inputs})};
      validateTrack(track);
      tracks.push(track);
      fs.writeFileSync(path.join(folder,'BRIEF.txt'),spec.title+'\n\n'+spec.brief+'\n\n'+(spec.fixture ?? '')+'\n');
    }
    const suite = {format:formats.suite,version:1,grid,tracks,suiteRevision:fingerprint(tracks)};
    files.json(path.join(stage,'suite.json'),suite);
    return suite;
  });
}

function suiteAt(directory) {
  const suite = read(path.join(directory,'suite.json'));
  check(valid(suite,'suite') && isDeepStrictEqual(suite.grid,grid) &&
    Array.isArray(suite.tracks) && suite.tracks.length === Object.keys(tasks).length &&
    new Set(suite.tracks.map(track => track?.id)).size === suite.tracks.length &&
    suite.suiteRevision === fingerprint(suite.tracks),'invalid benchmark suite');
  suite.tracks.forEach(validateTrack);
  return suite;
}

async function start(suiteDirectory, task, directory, { participant, kind, workflow, toolRevision } = {}) {
  check(id(participant) && allowedKind(kind) && id(workflow) && text(toolRevision,160),
    'use a participant ID, person|agent|script, workflow ID and tool revision');
  const suite = suiteAt(suiteDirectory), track = suite.tracks.find(row => row.id === task);
  check(track,'choose a task from the prepared suite');
  const input = path.join(suiteDirectory,track.id);
  verifyInputs(input,track);
  return publish(directory,stage => {
    const source = path.join(stage,'start');
    fs.mkdirSync(source);
    for (const {file} of track.inputs) {
      fs.copyFileSync(path.join(input,file),path.join(source,file));
      if (file !== 'source.json') fs.copyFileSync(path.join(source,file),path.join(stage,file));
    }
    verifyInputs(source,track);
    fs.copyFileSync(path.join(source,'source.json'),path.join(stage,'edit.json'));
    fs.writeFileSync(path.join(stage,'BRIEF.txt'),track.spec.title+'\n\n'+track.spec.brief+
      '\n\n'+(track.spec.fixture ?? '')+'\n\nEdit edit.json. The start/ directory is the pinned input.\n');
    const run = {format:formats.run,version:1,runId:randomUUID(),suiteRevision:suite.suiteRevision,track,
      participant,kind,workflow,toolRevision,startedAt:new Date().toISOString()};
    files.json(path.join(stage,'run.json'),run);
    return run;
  });
}

function runAt(directory) {
  const run = read(path.join(directory,'run.json'));
  check(valid(run,'run') && token(run.runId) && digest(run.suiteRevision) && id(run.participant) &&
    allowedKind(run.kind) && id(run.workflow) && text(run.toolRevision,160) &&
    Number.isFinite(Date.parse(run.startedAt)),'invalid run record');
  validateTrack(run.track);
  return run;
}

function repair(directory, { target, note } = {}) {
  const run = runAt(directory);
  check(!fs.existsSync(path.join(directory,'result')),'the run is already finished');
  check(text(target,160) && text(note,800),'record a repair target and a short description');
  const event = {format:formats.repair,version:1,runId:run.runId,id:randomUUID(),at:new Date().toISOString(),target,note};
  files.json(path.join(directory,'repairs',event.id+'.json'),event);
  return event;
}

function repairsAt(directory, run, deadline) {
  const folder = path.join(directory,'repairs');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder,{withFileTypes:true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => {
      const item = read(path.join(folder,entry.name)), time = Date.parse(item?.at);
      check(valid(item,'repair') && item.runId === run.runId && entry.name === item.id+'.json' &&
        token(item.id) && text(item.target,160) && text(item.note,800) &&
        Number.isFinite(time) && time >= Date.parse(run.startedAt),'invalid manual repair receipt');
      return item;
    }).filter(row => Date.parse(row.at) <= deadline).sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

function bindingChanges(before, after) {
  const retained = [], lost = [], displaced = [];
  for (const [id,value] of before) {
    const next = !after.has(id) ? lost : after.get(id) === value ? retained : displaced;
    next.push(id);
  }
  return {expected:before.size,retained:retained.length,lost,displaced};
}

function pixels(image) {
  check(image.w === grid.width && image.h === grid.height,'review images must match the native grid');
  return PNG.encode(image.w,image.h,image.rgb);
}

async function finish(directory, edited, { repairsComplete = false, toolkit = require('..') } = {}) {
  const ended = Date.now(), input = path.join(directory,'start'), run = runAt(directory);
  check(typeof repairsComplete === 'boolean','use a boolean repairs confirmation');
  const elapsedMs = ended-Date.parse(run.startedAt);
  check(elapsedMs >= 0,'the system clock moved before the start time');
  const task = verifyInputs(input,run.track), repairs = repairsAt(directory,run,ended);
  const source = read(path.join(input,'source.json'));
  const content = fs.readFileSync(edited ?? path.join(directory,'edit.json'));
  check(content.length <= 32*1024*1024,'the submitted JSON exceeds 32 MiB');
  const submitted = JSON.parse(content);
  return publish(path.join(directory,'result'),async stage => {
    const evidence = await task.evaluate(toolkit,source,submitted,input);
    const bindings = bindingChanges(evidence.beforeBindings,evidence.afterBindings);
    const views = task.views.map((scope,i) => {
      const settings = {grid,view:scope};
      return {scope,before:{bytes:pixels(evidence.before[i]),settings},after:{bytes:pixels(evidence.after[i]),settings}};
    });
    const bundle = review.assemble({label:task.title,anchors:{startRevision:run.track.startRevision,runId:run.runId},
      preview:{checks:evidence.checks,bindings,paint:evidence.paint},receipts:repairs,views,zoom:3});
    const viewHashes = new Map(bundle.manifest.files.map(row => [row.path,row.sha256]));
    const report = {format:formats.result,version:1,runId:run.runId,task:run.track.id,
      participant:run.participant,kind:run.kind,workflow:run.workflow,toolRevision:run.toolRevision,
      suiteRevision:run.suiteRevision,startRevision:run.track.startRevision,submissionSha256:sha256(content),
      startedAt:run.startedAt,submittedAt:new Date(ended).toISOString(),elapsedMs,
      environment:{platform:process.platform,arch:process.arch,node:process.version},
      manualRepair:{recorded:repairs.length,confirmed:repairsComplete,count:repairsComplete ? repairs.length : null,events:repairs},
      bindings,paint:evidence.paint,checks:evidence.checks,
      views:bundle.manifest.views.map(({id,native,changedPixels}) => ({
        id,changedPixels,afterSha256:viewHashes.get(native.after),beforeSha256:viewHashes.get(native.before)
      }))};
    files.write(path.join(stage,'submission.json'),content);
    files.json(path.join(stage,'report.json'),report);
    review.publish(bundle,path.join(stage,'review'),{});
    return report;
  });
}

function resultAt(directory) {
  const run = runAt(directory), result = read(path.join(directory,'result','report.json'));
  check(valid(result,'result') && result.runId === run.runId && result.startRevision === run.track.startRevision &&
    result.suiteRevision === run.suiteRevision && result.task === run.track.id &&
    ['participant','kind','workflow','toolRevision'].every(key => result[key] === run[key]) &&
    Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 && digest(result.submissionSha256) &&
    sha256(fs.readFileSync(path.join(directory,'result','submission.json'))) === result.submissionSha256 &&
    result.views?.length === run.track.spec.views.length &&
    result.views.every(({id,afterSha256,beforeSha256},i) => id === run.track.spec.views[i].id &&
      digest(afterSha256) && digest(beforeSha256)),
  'invalid finished run');
  return result;
}

module.exports = {formats,grid,tasks,id,token,text,check,sha256,fingerprint,read,valid,publish,
  prepare,start,repair,finish,resultAt};
