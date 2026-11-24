const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const { KIT: K } = ink.load(), P = K.procedural, api = P.freeformSculpt;
const axes = [[1,0,0],[0,1,0],[0,0,1]];
const sphere = (x,y,z) => Math.hypot(x,y,z+.6)-.6;
const origin = [0,0,0], radius = .5;
const stamp = {origin,axes,radius};

test('freeform fields stay local and move, plane, scrape, groove, and pinch distinctly', () => {
  const field = (mode,more={}) => api.prepare({mode,
    stamps:[{...stamp,...(mode==='grab' && {drag:[0,0,.2]})}],...more}).field(sphere);
  const grab=field('grab'), flatten=field('flatten'), scrape=field('scrape',{depth:.14});
  const crease=field('crease',{depth:.14}), pinch=field('pinch');
  assert(grab(0,0,.12)<0 && sphere(0,0,.12)>0);
  assert(flatten(.2,0,-.025)<0 && sphere(.2,0,-.025)>0);
  assert(scrape(0,0,-.045)>0 && sphere(0,0,-.045)<0);
  assert(crease(0,0,-.045)>0);
  assert.equal(crease(0,.2,-.04),sphere(0,.2,-.04));
  assert(pinch(0,.21,-.05)>sphere(0,.21,-.05)+.02);
  for (const next of [grab,flatten,scrape,crease,pinch]) {
    assert.equal(next(1,0,0),sphere(1,0,0));
    assert.equal(next(.5,0,0),sphere(.5,0,0));
  }
  for (const x of [-.2,0,.2]) for (const z of [-.2,-.01,.14])
    assert(scrape(x,0,z)>=sphere(x,0,z));
  assert.throws(()=>api.prepare({mode:'grab',stamps:[{...stamp,drag:[.24,0,0]}]}),/45%/);
});

test('mirrored overlap is symmetric and applies the plane center only once', () => {
  const right = {origin:[.12,0,0],axes,radius,drag:[.17,0,.06]};
  const twin=api.reflect(right,{axis:'x'});
  const field=api.prepare({mode:'grab',stamps:[right,twin]}).field(sphere);
  for (const x of [0,.06,.21,.36]) for (const y of [0,.15]) for (const z of [-.1,0,.08])
    assert(Math.abs(field(x,y,z)-field(-x,y,z))<1e-12);
  const one=api.prepare({mode:'crease',stamps:[stamp]}).field(sphere);
  const two=api.prepare({mode:'crease',stamps:[stamp,api.reflect(stamp,{axis:'x'})]}).field(sphere);
  assert.equal(one(0,0,-.04),two(0,0,-.04));
});

function drawing() {
  return {format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'relief',scene:'relief.json',object:'relief'}],destinations:[{id:'sculpt',kind:'sdf-shape',binding:'relief'}]};
}

function nativeScene(protection) {
  return {id:'relief',style:'ember',camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    solids:[{id:'relief',kind:'ball',at:[0,0,0],r:[.92,.71,.42],mat:'ember',res:.08,
      ...(protection && {sdfProtection:protection})}]};
}

function scoped(source) {
  const scene=ink.createSceneEditor(source);
  const editor=ink.createPixelEditor(drawing(),{sceneEditor:scene,sceneRef:'relief.json'});
  function edit(id,operation) {
    const {documentRevision:revision,sourceRevision}=editor.targets('sculpt');
    return {id,frame:'front',destination:'sculpt',revision,sourceRevision,operation};
  }
  return {scene,editor,edit};
}

test('native freeform brushes report size and mirror, retain rest geometry, and support retuning and replay', () => {
  const spec=nativeScene(), {scene,editor,edit}=scoped(spec);
  const change=edit('groove',{brush:{mode:'crease',size:{unit:'pixels',radius:7},pixels:[[38,32]],mirror:{axis:'x'},depth:.13}});
  const preview=editor.previewEdit(change);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.deepEqual(scene.snapshot(),spec);
  const evidence=preview.targets[0].brush;
  assert(evidence.occupancyProbes.removed>0);
  assert.equal(evidence.hits[0].stamps.length,2);
  assert.equal(evidence.hits[0].stamps[0].rest[0],-evidence.hits[0].stamps[1].rest[0]);
  const updated=editor.apply(change), first=updated.solids[0].modifiers[0].brush;
  assert.equal(first.version,3);
  assert.equal(first.stamps[0].radius,evidence.hits[0].radiusWorld);
  assert.equal(first.stamps[0].radius,api.radius(change.operation.brush.size,Math.hypot(...first.attachment.projection.right)));
  const brushField=K.diorama.brushField(updated);
  const p=K.V.mad(first.stamps[0].origin,first.stamps[0].axes[2],-.035);
  assert(brushField.sdf(...p)>0);
  assert(K.diorama.brushField(spec).sdf(...p)<0);
  const moved={...updated,solids:[{...updated.solids[0],transform:{translation:[2,0,0]}}]};
  assert(Math.abs(K.diorama.brushField(moved).sdf(p[0]+2,p[1],p[2])-brushField.sdf(...p))<1e-9);
  const original=editor.receipts().at(-1);
  assert(editor.undo());
  assert.deepEqual(scene.snapshot(),spec);
  editor.replay(original);
  assert.deepEqual(scene.snapshot(),updated);
  const revised=editor.apply(edit('retune',{updateBrush:{id:'groove',size:{unit:'world',radius:.31},mirror:null,angle:62,depth:.09}}));
  const [second]=revised.solids[0].modifiers;
  assert.equal(second.id,'groove');
  assert.equal(second.brush.stamps.length,1);
  assert.equal(second.brush.stamps[0].radius,.31);
  assert.deepEqual(second.brush.attachment,first.attachment);
  assert.notDeepEqual(second.brush.stamps[0].axes,first.stamps[0].axes);
});

test('native mirror reports a guarded copy without losing its valid source stroke', () => {
  const spec=nativeScene([{id:'keep-left',kind:'seam',bounds:{min:[-.65,-.12,.2],max:[-.19,.12,.48]}}]);
  const {editor,edit}=scoped(spec);
  const change=edit('mirror-test',{brush:{mode:'scrape',size:{unit:'world',radius:.17},pixels:[[40,32]],mirror:{axis:'x'}}});
  const preview=editor.previewEdit(change);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const report=preview.targets[0].brush;
  assert.equal(report.hits[0].stamps.length,1);
  assert.equal(report.skippedHits[0].feature,'keep-left');
  assert.equal(report.skippedHits[0].mirrored,true);
});

test('sparse freeform changes rebuild local bricks and respect locked face sets atomically', () => {
  const field=P.sculptMasks.field({kind:'box',min:[-2,-.8,-.35],max:[2,.8,.35]});
  const root=P.sparseBricks.create({cell:.125,brickSize:5,base:field});
  const mask={id:'locked-side',volumes:[{kind:'box',min:[-1.5,-.55,-.6],max:[-.5,.55,.7]}]};
  const slab=P.brickMeshes.create({bricks:root,objectId:'slab',
    bounds:{min:[-2.2,-1,-.6],max:[2.2,1,.75]},materials:[{id:'clay',color:0xb75a41}],
    sculptMasks:{masks:[mask],faceSets:[{id:'left',mask:mask.id}],controls:{locked:['left']}}});
  const before=slab.current(), right={origin:[1,0,.35],axes,radius:.39};
  const stroke={mode:'scrape',depth:.15,stamps:[right,api.reflect(right,{axis:'x'})]};
  assert.throws(()=>slab.sculpt(stroke,{maxSamples:1}),/budget/);
  assert.equal(slab.current(),before);
  const edited=slab.sculpt(stroke);
  assert(edited.work.rebuilt.length>0 && edited.work.rebuilt.length<edited.chunks.length);
  assert(edited.chunks.every((chunk,i)=>edited.work.rebuilt.includes(chunk.key) || chunk===before.chunks[i]));
  assert.equal(edited.bricks.distance(-1,0,.375),before.bricks.distance(-1,0,.375));
  assert(edited.bricks.distance(1,0,.375)>before.bricks.distance(1,0,.375)+.10);
  assert(edited.work.dirty.every(edit=>edit.bounds.min[0]>0));
});
