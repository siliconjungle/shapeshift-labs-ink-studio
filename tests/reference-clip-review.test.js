const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');
const { referenceClips } = ink.load().KIT;

const format = 'ink-studio/reference-clip-review';
const beats = [
  { id:'arrive', reference:13, candidate:22 },
  { id:'spark', label:'Ignition', reference:14, candidate:25 },
  { id:'tail', reference:16, candidate:29 }
];

test('Reference beats align different cadences, nonzero starts, note addresses and focus ranges', () => {
  const spec = {
    reference:{ startFrame:12, frameCount:6, fps:{numerator:30000,denominator:1001} },
    candidate:{ startFrame:20, frameCount:12, fps:16 }, beats
  };
  const clip = referenceClips.create(spec);
  for (const beat of beats) {
    const [start,end] = clip.range(beat.id);
    const sample = clip.sample(start);
    assert(end > start);
    assert.equal(sample.beat,beat.id);
    assert.equal(sample.reference.frame,beat.reference);
    assert.equal(sample.candidate.frame,beat.candidate);
  }
  const midway = clip.sample((clip.frameTime(14)+clip.frameTime(15))/2);
  assert.equal(midway.candidate.frame,26);
  assert.equal(clip.sample(-1).reference.frame,12);
  assert.equal(clip.sample(999).candidate.frame,31);
  assert.deepEqual(clip.notes([{id:'note',time:clip.frameTime(14),text:' Check white core. '}]), [
    {id:'note',time:clip.frameTime(14),text:'Check white core.',beat:'spark',reference:14,candidate:25}
  ]);
  assert.throws(()=>referenceClips.create({...spec,beats:beats.slice().reverse()}),/increase strictly/);
  assert.throws(()=>referenceClips.create({...spec,beats:[{id:'bad',reference:99,candidate:22}]}),/one frame in each/);
  assert.throws(()=>clip.notes([{id:'note',time:999,text:'Outside'}]),/review time/);
  const start = referenceClips.create({...spec,beats:[{id:'trim',reference:12,candidate:22}]});
  assert.equal(start.sample(0).candidate.frame,22);
});

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reference-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const json=(name,value)=>{
    const file=path.join(root,name);
    fs.writeFileSync(file,JSON.stringify(value));
    return file;
  };
  const folder=path.join(root,'reference');
  fs.mkdirSync(folder);
  // Sorted numerically. Each source frame is an integer-scale transparent PNG.
  for (const [number,red] of [[10,40],[2,120],[1,200]]) {
    const data=Uint8Array.from({length:4*2*4},(_,i)=>[red,20,60,128][i%4]);
    fs.writeFileSync(path.join(folder,'shot-'+number+'.png'),PNG.encode(4,2,data,4));
  }
  const project = {
    format:'ink-studio/graph-project',version:1,
    nodes:{ panel:{ op:'raster.canvas',inputs:{ width:1,height:1,color:[51,119,153,255] } } },
    outputs:{ image:{ node:'panel' } }
  };
  return {
    root,json,project,
    plan:{ format,version:1,title:'An alignment </script> fixture',
      reference:{directory:'reference',fps:3,startFrame:10,pixelSize:2},
      candidate:{graph:'candidate.json',output:'image',fps:9,from:5,to:12,offset:[1,0]},
      beats:[{id:'ignite',reference:11,candidate:9}] }
  };
}

test('Node and CLI preview imported PNGs beside a direct Ink graph and package movable notes', t => {
  const {root,json,project,plan} = fixture(t);
  json('candidate.json',project);
  const file=json('review.json',plan);
  const review=ink.createReferenceClipReview(file);
  const initial=review.frame(0);
  assert.equal(initial.image.w,4);
  assert.equal(initial.image.h,1);
  assert.deepEqual(Array.from(initial.image.rgb),[100,10,30,100,10,30,0,0,0,51,119,153]);
  const time=review.alignment.range('ignite')[0];
  assert.equal(review.frame(time,{mode:'difference'}).image.w,2);
  assert.equal(review.frame(time).address.candidate.frame,9);
  assert.equal(review.sheet().w,12);

  const manifest=review.manifest;
  const notes=review.alignment.notes([{id:'test',time,text:'Observe the exact ignition frame.'}]);
  json('notes.json',{ format:referenceClips.noteFormat, version:1, sessionId:manifest.sessionId,notes });
  json('review.json',{...plan,notes:'notes.json'});
  const out=path.join(root,'out');
  const cli=path.join(__dirname,'../cli/ink-studio.js');
  const report=JSON.parse(execFileSync(process.execPath,[cli,'reference-clip',file,'--out',out,
    '--beat','ignite','--mode','swipe','--sheet'],{encoding:'utf8'}));
  assert.equal(report.frame.reference.frame,11);
  assert.equal(report.frame.candidate.frame,9);
  for (const artifact of ['index.html','ink.js','frame-images.js','review-ui.js','comparison.png','sheet.png','frame.json']) {
    assert(fs.existsSync(path.join(out,artifact)),artifact);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(out,'workbench.json'),'utf8'));
  assert.deepEqual(saved.notes,notes);
  assert.equal(PNG.read(path.join(out,'comparison.png')).w,2);
  assert(!fs.readFileSync(path.join(out,'index.html'),'utf8').includes(plan.title));
  json('alignment.json',{ format:referenceClips.alignmentFormat,version:1,sessionId:manifest.sessionId,
    beats:[{id:'ignite',reference:11,candidate:10}] });
  json('review.json',{...plan,notes:'notes.json',beats:'alignment.json'});
  const revised=ink.createReferenceClipReview(file).manifest;
  assert.equal(revised.sessionId,manifest.sessionId);
  assert.equal(revised.notes[0].reference,11);
  assert.equal(revised.notes[0].candidate,10);
});

test('Ink graph clip reports preserve frame addresses and reject changed source frames', t => {
  const {root,json,project,plan}=fixture(t);
  const file=json('candidate.json',project);
  const runner=ink.readGraphProject(file);
  const sequence=runner.clip({output:'image',from:5,to:12,format:'frames',clock:{fps:9}});
  for (const {file,bytes} of sequence.artifacts) {
    const target=path.join(root,'render',file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,bytes);
  }
  json('render/report.json',sequence.report);
  const review=json('review.json',{...plan,candidate:{clip:'render/report.json'}});
  const opened=ink.createReferenceClipReview(review);
  assert.equal(opened.frame(opened.alignment.range('ignite')[0]).address.candidate.frame,9);
  const png=path.join(root,'render',sequence.report.frames[0].file);
  fs.appendFileSync(png,'changed');
  assert.throws(()=>ink.createReferenceClipReview(review),/clip frame has changed/);
});
