const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT } = ink.load();

const [w,h] = [65,65];
function source({ transform, perspective = false, blocker = false } = {}) {
  return { id:'brush-panel',style:'slate',camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,
    projection:perspective ? 'perspective' : 'orthographic'},
    solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.9,.72,.25],res:.08,mat:'stone',...(transform && {transform})},
      ...(blocker ? [{id:'pin',kind:'box',at:[.66,0,.64],half:[.13,.15,.1],res:.065,mat:'metal'}] : [])] };
}

function document(scene, extras={}) {
  return {format:'ink-studio/pixel-art',version:2,width:w,height:h,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene,object:'plate'}],destinations:[{id:'sculpt',kind:'sdf-shape',binding:'plate'}],...extras};
}

function patch(observed,brush,id='grid-cut') {
  return {id,frame:'front',destination:'sculpt',revision:observed.documentRevision,sourceRevision:observed.sourceRevision,
    operation:{brush}};
}

function pixels(editor) {
  return editor.targets('sculpt');
}

test('cut preview reports removed depth, skips blocked and empty pixels, and leaves a transparent tip cell intact', () => {
  const spec=source({blocker:true}), scene=ink.createSceneEditor(spec);
  const image=ink.render(scene.build(undefined,{retainRenderSdf:true}),{w,h,px:1,raw:true,sdfAssist:true,passes:['objectId']});
  const pin=image.passes.objectId.indexOf(image.passes.objects.indexOf('pin')), blocked=[pin%w,Math.floor(pin/w)];
  assert(pin>=0);
  const ring=[[31,31],[32,31],[33,31],[31,32],[33,32],[31,33],[32,33],[33,33]];
  const editor=ink.createPixelEditor(document('panel.json',{selections:[{id:'ring',frame:'front',pixels:[...ring,blocked,[0,0]]}]}),
    {sceneEditor:scene,sceneRef:'panel.json'});
  const change=patch(pixels(editor),{mode:'cut',depth:.22,selection:'ring'});
  const preview=editor.previewEdit(change);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.deepEqual(scene.snapshot(),spec);
  const target=preview.targets[0], review=target.brush;
  assert.equal(target.modifier,'grid-cut');
  assert.equal(review.projectedPixels,8);
  assert.deepEqual(review.skippedHits.map(hit=>hit.code),['occluded-or-outside-target','no-surface']);
  assert(review.volume.estimatedWorldVolume>0);
  assert.equal(review.volume.space,'solid-rest');
  assert(review.hits.every(hit=>hit.changedDepths.length>0 && hit.depth[0]<hit.surfaceDepth && hit.depth[1]>hit.surfaceDepth));

  editor.begin('cut a ring');
  const edited=editor.apply(change), retained=edited.solids[0].modifiers[0];
  assert.equal(retained.kind,'grid-brush');
  assert.deepEqual(editor.previewChanges().targets[0].brush,review);
  assert.deepEqual(editor.receipts().at(-1).skippedHits,review.skippedHits);
  editor.commit();
  const field=KIT.diorama.brushField(edited);
  const point=(x,y,z)=>KIT.procedural.gridSculptBrush.point(retained.brush.projection,retained.brush.grid,x,y,z);
  const depth=review.hits[0].surfaceDepth+.1;
  assert(field.sdf(...point(31.5,31.5,depth))>0);
  assert(field.sdf(...point(32.5,32.5,depth))<0);
  assert(field.sdf(...point(32,31.5,depth))>0,'adjacent painted pixels have no seam');
  const rendered=ink.render(scene.build(),{w,h,px:1,raw:true,passes:['depth','surfaceKind']});
  assert(rendered.passes.depth[31*w+31] > rendered.passes.depth[32*w+32]+.1);
  const saved=editor.receipts().at(-1);
  assert(editor.undo());
  assert.deepEqual(scene.snapshot(),spec);
  editor.replay(saved);
  assert.deepEqual(scene.snapshot(),edited);
});

test('a perspective add brush retains its shape in the solid frame when the solid moves', () => {
  const spec=source({perspective:true,transform:{translation:[.15,0,.2],rotation:[.35,0,0],scale:1.4}});
  const scene=ink.createSceneEditor(spec), editor=ink.createPixelEditor(document('panel.json'),
    {sceneEditor:scene,sceneRef:'panel.json'});
  const change=patch(pixels(editor),{mode:'add',depth:.25,pixels:[[32,32]],camera:{ortho:false}},'raise');
  const preview=editor.previewEdit(change);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const { hits:[hit],volume }=preview.targets[0].brush;
  assert(volume.estimatedWorldVolume>0);
  const edited=editor.apply(change), { brush }=edited.solids[0].modifiers[0];
  assert.equal(brush.projection.perspective,true);
  const point=KIT.procedural.gridSculptBrush.point(brush.projection,brush.grid,32.5,32.5,(hit.surfaceDepth+hit.depth[0])*.5);
  const shift=([x,y,z])=>[x+2,y,z];
  const moved=(input,modifiers)=>({...input,solids:[{...input.solids[0],transform:{translation:[2,0,0]},modifiers}]});
  assert(KIT.diorama.brushField(moved(edited,[])).sdf(...shift(point))>0);
  assert(KIT.diorama.brushField(moved(edited,edited.solids[0].modifiers)).sdf(...shift(point))<0);
  assert.equal(editor.previewEdit(patch(pixels(editor),{mode:'cut',depth:.1,pixels:[[0,0]]},'empty')).valid,false);
});

test('the CLI previews and writes a source-bound brush with a stable modifier ID', t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sdf-grid-brush-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const file=name=>path.join(temp,name);
  const write=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'pixel-art',...args],{cwd:temp,encoding:'utf8'}));
  write('scene.json',source());
  write('document.json',document(file('scene.json')));
  const sceneArgs=['--scene',file('scene.json')];
  const observed=run('targets',file('document.json'),'--destination','sculpt',...sceneArgs);
  write('edit.json',patch(observed,{mode:'cut',depth:.20,pixels:[[32,32],[33,32],[0,0]]}));
  const args=[file('document.json'),file('edit.json'),...sceneArgs];
  const preview=run('preview',...args);
  assert.equal(preview.targets[0].brush.projectedPixels,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('scene.json'))),source());
  const receipt=run('edit',...args,'--out',file('edited.json'));
  assert.deepEqual(receipt.affectedTargets[0].brush,preview.targets[0].brush);
  assert.equal(receipt.skippedHits[0].code,'no-surface');
  const output=JSON.parse(fs.readFileSync(file('edited.json')));
  assert.equal(output.solids[0].modifiers[0].id,'grid-cut');
  assert(KIT.diorama.check(output).every(row=>row.level!=='error'));
});
