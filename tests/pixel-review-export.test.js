'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const document = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{ red:'#b4383d',blue:'#323991' },layers:[{id:'ink'}],
  frames:[{id:'front',durationMs:100,cels:{ink:{marks:[{swatch:'red',at:[1,1]}]}}}]
};
const scene = {id:'review-gate',style:'slate',
  camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,projection:'orthographic',sway:0},
  solids:[{id:'gate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.15,mat:'stone'}]};
const sceneDocument = {...document,width:40,height:32,
  sceneBindings:[{id:'gate',scene:scene.id,object:'gate',frame:'front'}],
  destinations:[{id:'shape',kind:'sdf-shape',binding:'gate'}]};

const envelope = (action,fields = {})=>({format:'ink-studio/pixel-command',version:1,action,...fields});
const patch = (editor,id='blue-dot')=>({id,revision:editor.describe().revision,frame:'front',
  operation:{tool:'pencil',layer:'ink',swatch:'blue',points:[[3,2]]}});
const json = file=>JSON.parse(fs.readFileSync(file));
const rgba = ({w,data},x,y)=>Array.from(data.subarray((y*w+x)*4,(y*w+x)*4+4));
const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return name=>path.join(dir,name);
}

test('pending review bundles contain exact evidence, integer zooms and a portable offline index',t=>{
  const file = workspace(t), out = file('bundle'), editor = ink.createPixelEditor(document);
  editor.begin('Review <script>');
  editor.apply(patch(editor));
  const draft = editor.snapshot(), history = editor.history(), receipts = editor.receipts();
  const result = editor.exportReview({out,zoom:3});
  assert.equal(result.valid,true,JSON.stringify(result.conflicts));
  const manifest = json(path.join(out,'manifest.json'));
  assert.deepEqual(result.manifest,manifest);
  assert.equal(manifest.format,'ink-studio/pixel-review-bundle');
  assert.equal(manifest.anchors.after.documentRevision,editor.describe().revision);
  const [view] = manifest.views;
  assert.equal(view.changedPixels,1);
  const zoom = PNG.raster(path.join(out,view.zoomed.after));
  assert.deepEqual([zoom.w,zoom.h],[24,18]);
  for (let y=6;y<9;y++) for (let x=9;x<12;x++) assert.deepEqual(rgba(zoom,x,y),[50,57,145,255]);
  assert.deepEqual(rgba(zoom,12,6),[0,0,0,0]);
  const native = PNG.raster(path.join(out,view.native.after));
  assert.deepEqual([native.w,native.h],[8,6]);
  assert.deepEqual(rgba(native,3,2),[50,57,145,255]);
  const difference = PNG.raster(path.join(out,view.native.difference));
  assert.equal(rgba(difference,3,2)[0],255);
  assert.equal(rgba(difference,2,2)[0],0);
  const diff = json(path.join(out,'diff.json'));
  assert.equal(diff.diff.cells.filter(row=>row.layer===undefined).length,1);
  assert.deepEqual(diff.diff.geometry,[]);
  assert.deepEqual(json(path.join(out,'receipts.json')).receipts,receipts);
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(out,entry.path));
    assert.equal(bytes.length,entry.bytes);
    assert.equal(sha(bytes),entry.sha256);
  }
  const html = fs.readFileSync(path.join(out,'index.html'),'utf8');
  assert.match(html,/Review &lt;script&gt;/);
  assert.match(html,/views\/document\/after-3x\.png/);
  assert.doesNotMatch(html,/<script[ >]|https?:\/\//);
  assert.deepEqual(editor.snapshot(),draft);
  assert.deepEqual(editor.history(),history);
  assert.equal(editor.cancel(),true);
});

test('the latest commit and a recorded batch both produce exact read-only reviews',()=>{
  const editor = ink.createPixelEditor(document);
  const batch = editor.applyBatch({revision:editor.describe().revision,commands:[envelope('draw',{patch:patch(editor)})]});
  const after = editor.snapshot();
  const latest = editor.exportReview({zoom:1});
  assert.equal(latest.valid,true,JSON.stringify(latest.conflicts));
  const fromHistory = editor.exportReview({batch,zoom:1});
  const fresh = ink.createPixelEditor(document);
  const fromStart = fresh.exportReview({batch,zoom:1});
  assert.equal(fromHistory.valid,true,JSON.stringify(fromHistory.conflicts));
  assert.deepEqual(fromHistory,fromStart);
  assert.deepEqual(fromStart.manifest.anchors,{before:batch.inputs,after:batch.outputs});
  assert.deepEqual(JSON.parse(fromStart.files['receipts.json'].data),{version:1,receipts:batch.steps,batch});
  assert.deepEqual(fresh.snapshot(),document);
  assert.deepEqual(editor.snapshot(),after);
  assert.equal(editor.history().undo.length,1);

  const other = {...document,palette:{...document.palette,blue:'#101010'}};
  const rejected = ink.createPixelEditor(other).exportReview({batch});
  assert.equal(rejected.valid,false);
  assert.equal(rejected.conflicts[0].code,'stale-document');
});

test('scene reviews capture effective camera and clock, source geometry and bound receipts',()=>{
  const editor = ink.createPixelEditor(sceneDocument,{sceneEditor:ink.createSceneEditor(scene)});
  editor.begin('Cut the gate');
  editor.apply({id:'cut',revision:editor.describe().revision,
    destination:'shape',frame:'front',operation:{parameters:{half:[.4,.7,.23]}}});
  const review = editor.exportReview({zoom:2,views:[{id:'gate-oblique',binding:'gate',frame:'front',
    time:.25,camera:{yaw:.3,dist:4.2}}]});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  const [view] = review.manifest.views;
  assert.ok(view.changedPixels>20);
  assert.deepEqual(view.grids.after,[40,32]);
  const render = JSON.parse(review.files['render-settings.json'].data);
  const recorded = render.views[0].after;
  assert.equal(recorded.scene,scene.id);
  assert.equal(recorded.binding,'gate');
  assert.equal(recorded.time,.25);
  assert.equal(recorded.clock.time,.25);
  assert.equal(recorded.camera.yaw,.3);
  assert.equal(recorded.camera.distance,4.2);
  assert.equal(recorded.view.length,16);
  assert.equal(recorded.flags.transparent,true);
  assert.deepEqual(JSON.parse(review.files['diff.json'].data).diff.geometry[0],
    {scene:scene.id,kind:'solid',object:'gate',key:'half',before:[.8,.7,.23],after:[.4,.7,.23]});
  assert.equal(JSON.parse(review.files['receipts.json'].data).receipts[0].affectedTargets[0].object,'gate');
  assert.deepEqual(editor.exportReview().manifest.views.map(row=>row.id),['document','binding-gate']);
  assert.equal(editor.cancel(),true);
  assert.deepEqual(editor.sceneEditor.snapshot(),scene);
});

test('whole-scene review includes direct scene edits, and export rejects unsafe paths',t=>{
  const file = workspace(t);
  const editor = ink.createPixelEditor(document,{sceneEditor:ink.createSceneEditor(scene)});
  editor.begin('Retain this draft');
  editor.sceneEditor.updateShape({half:[.2,.7,.23]},'solid:gate');
  const review = editor.exportReview({zoom:1});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.deepEqual(review.manifest.views.map(row=>row.id),['document','scene']);
  assert.deepEqual(JSON.parse(review.files['receipts.json'].data).receipts,[]);
  assert.ok(review.manifest.views[1].changedPixels>0);
  const explicit = editor.exportReview({views:[{id:'whole',scene:true,time:.1}]});
  assert.equal(explicit.valid,true,JSON.stringify(explicit.conflicts));

  fs.mkdirSync(file('existing'));
  fs.writeFileSync(file('existing/keep.txt'),'untouched');
  assert.equal(editor.exportReview({out:file('existing')}).valid,false);
  assert.equal(fs.readFileSync(file('existing/keep.txt'),'utf8'),'untouched');
  const invalid = editor.exportReview({out:file('unsafe'),views:[{id:'../escape'}]});
  assert.equal(invalid.valid,false);
  assert.equal(fs.existsSync(file('unsafe')),false);
});

test('CLI session exports a relative package without changing its pending transaction',t=>{
  const file = workspace(t), input = file('art.json'), dir = file('session'), command = file('command.json');
  fs.writeFileSync(input,JSON.stringify(document));
  const run = (args,expected=0)=>{
    const result = spawnSync(process.execPath,['cli/ink-studio.js','pixel-art','session',...args],
      {cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
    assert.equal(result.status,expected,result.stderr);
    return result.stdout && JSON.parse(result.stdout);
  };
  run(['init',dir,input]);
  run(['begin',dir,'--label','Review before commit']);
  const edit = file('edit.json');
  fs.writeFileSync(edit,JSON.stringify(patch(ink.createPixelEditor(document))));
  run(['draw',dir,edit]);
  fs.writeFileSync(command,JSON.stringify(envelope('export-review',{options:{out:'review',zoom:2}})));
  const reply = run(['run',dir,command]);
  assert.equal(reply.directory,file('review'));
  assert.equal(json(file('review/manifest.json')).label,'Review before commit');
  assert.equal(run(['status',dir]).pending,true);
  const failed = run(['run',dir,command],2);
  assert.equal(failed.valid,false);
  assert.equal(json(file('review/manifest.json')).label,'Review before commit');

  fs.writeFileSync(command,JSON.stringify(envelope('export-review',{options:{out:'collision'}})));
  run(['run',dir,command,'--out',file('collision/manifest.json')],2);
  assert.equal(json(file('collision/manifest.json')).valid,false);
  assert.equal(fs.existsSync(file('collision/index.html')),false);
});
