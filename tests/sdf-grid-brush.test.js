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
  write('edit.json',patch(observed,{mode:'carve',depth:.20,pixels:[[32,32],[33,32],[0,0]],profile:'taper'}));
  const args=[file('document.json'),file('edit.json'),...sceneArgs];
  const preview=run('preview',...args);
  assert.equal(preview.targets[0].brush.projectedPixels,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('scene.json'))),source());
  const receipt=run('edit',...args,'--out',file('edited.json'));
  assert.deepEqual(receipt.affectedTargets[0].brush,preview.targets[0].brush);
  assert.equal(receipt.skippedHits[0].code,'no-surface');
  assert.equal(receipt.affectedTargets[0].brush.depthUnit,'signed-world-from-hit');
  const output=JSON.parse(fs.readFileSync(file('edited.json')));
  assert.equal(output.solids[0].modifiers[0].id,'grid-cut');
  assert(KIT.diorama.check(output).every(row=>row.level!=='error'));
  write('scene.json',output);
  const latest=run('targets',file('document.json'),'--destination','sculpt',...sceneArgs);
  const retune=patch(latest,undefined,'deepen');
  retune.operation={updateBrush:{id:'grid-cut',depth:.34}};
  write('edit.json',retune);
  const tuned=run('preview',...args);
  assert(tuned.valid,JSON.stringify(tuned.conflicts));
  assert.equal(tuned.targets[0].modifier,'grid-cut');
  assert.equal(tuned.targets[0].brush.settings.depth,.34);
  run('edit',...args,'--out',file('deepened.json'));
  const [deepened]=JSON.parse(fs.readFileSync(file('deepened.json'))).solids[0].modifiers;
  assert.equal(deepened.id,'grid-cut');
  assert.deepEqual(deepened.brush.attachment,output.solids[0].modifiers[0].brush.attachment);
});

function sculpt(spec,mode,options,id=mode) {
  const scene=ink.createSceneEditor(spec);
  const editor=ink.createPixelEditor(document('panel.json'),{sceneEditor:scene,sceneRef:'panel.json'});
  const change=patch(pixels(editor),{ mode,...options },id);
  const preview=editor.previewEdit(change);
  return { editor,scene,change,preview,review:preview.targets[0]?.brush };
}

test('carve has an authored floor and through-cut requires and clears the back exit', () => {
  const spec=source();
  const mark={ pixels:[[32,32]],direction:'normal' };
  const blind=sculpt(spec,'carve',{ ...mark,depth:.30 });
  assert(blind.preview.valid,JSON.stringify(blind.preview.conflicts));
  const carved=KIT.diorama.brushField(blind.editor.apply(blind.change));
  assert(carved.sdf(0,0,.12)>0);
  assert(carved.sdf(0,0,-.20)<0);
  assert.equal(blind.review.depthUnit,'signed-world-from-hit');
  assert(blind.review.volume.removedWorldVolume>0);
  assert.equal(blind.review.volume.addedWorldVolume,0);

  const short=sculpt(spec,'through-cut',{ ...mark,depth:.30 });
  assert.equal(short.preview.valid,false);
  assert.equal(short.preview.conflicts[0].code,'through-cut-depth-limit');
  assert(short.preview.conflicts[0].requiredDepth>.49);
  assert.deepEqual(short.scene.snapshot(),spec);

  const through=sculpt(spec,'through-cut',{ ...mark,depth:.72 });
  assert(through.preview.valid,JSON.stringify(through.preview.conflicts));
  assert(through.review.hits[0].depth[0]<-.50);
  const output=through.editor.apply(through.change), drilled=KIT.diorama.brushField(output);
  assert(drilled.sdf(0,0,-.24)>0);
  assert(drilled.sdf(.20,0,-.24)<0);
  assert.equal(output.solids[0].modifiers[0].brush.version,2);

  const backFacing=sculpt(spec,'carve',{...mark,depth:.2,direction:[0,0,-1]});
  assert.equal(backFacing.preview.conflicts[0].code,'invalid-outward-axis');

  const { id,mat,res,...box } = spec.solids[0];
  const layered={...spec,solids:[{id,mat,res,kind:'join',how:'union',size:0,a:box,
    b:{kind:'box',at:[0,0,-.65],half:[.6,.5,.10]}}]};
  const firstExitOnly=sculpt(layered,'through-cut',{...mark,depth:.72});
  assert.equal(firstExitOnly.preview.conflicts[0].code,'through-cut-depth-limit');
  const lastExit=sculpt(layered,'through-cut',{...mark,depth:1.15});
  assert(lastExit.preview.valid,JSON.stringify(lastExit.preview.conflicts));
  const lastExitField=KIT.diorama.brushField(lastExit.editor.apply(lastExit.change));
  assert(lastExitField.sdf(0,0,-.65)>0);
  assert(lastExitField.sdf(.20,0,-.65)<0);
});

test('raise retains an oblique direction and grades the depth without changing the stencil', () => {
  const marks=Array.from({length:9},(_,i)=>[31+i%3,31+Math.floor(i/3)]);
  const options={pixels:marks,depth:.24,direction:[1,0,1],profile:[[0,0],[.5,.75],[1,1]],
    falloff:{pixels:1,curve:'linear'}};
  const run=sculpt(source({perspective:true}),'raise',options);
  assert(run.preview.valid,JSON.stringify(run.preview.conflicts));
  const center=run.review.hits.find(hit=>hit.at[0]===32 && hit.at[1]===32);
  const edge=run.review.hits.find(hit=>hit.at[0]===31 && hit.at[1]===31);
  assert.equal(center.strength,1);
  assert.equal(center.depth[1],.24);
  assert(Math.abs(edge.strength-.25)<1e-6);
  assert(Math.abs(edge.depth[1]-.06)<1e-6);
  assert.equal(run.review.projectedPixels,9);
  assert.equal(run.review.volume.removedWorldVolume,0);
  const raised=run.editor.apply(run.change);
  const field=KIT.diorama.brushField(raised);
  const tip=KIT.V.mad(center.rest,center.outward,.18);
  assert(field.sdf(...tip)<0);
  assert(field.sdf(...KIT.V.mad(edge.rest,edge.outward,.18))>0);
  const stored=raised.solids[0].modifiers[0].brush;
  assert.deepEqual(stored.settings.profile,options.profile);
  assert.deepEqual(stored.settings.falloff,options.falloff);
  assert(Math.abs(Math.hypot(...stored.settings.direction)-1)<1e-6);
});

test('fill meets the rim and smooth removes and adds relief locally', () => {
  const base=source(), face=base.solids[0];
  const { id,mat,res,...box }=face;
  const spec={...base,solids:[{id,mat,res,kind:'join',how:'cut',size:0,a:box,
    b:{kind:'box',at:[0,0,.28],half:[.027,.20,.20]}}]};
  const brush={pixels:[[32,32],[33,32]],depth:.25,direction:'normal'};
  const fill=sculpt(spec,'fill',brush);
  assert(fill.preview.valid,JSON.stringify(fill.preview.conflicts));
  assert.equal(fill.review.projectedPixels,1);
  assert.equal(fill.review.skippedHits[0].code,'already-at-level');
  assert.equal(fill.review.volume.removedWorldVolume,0);
  assert(fill.review.volume.addedWorldVolume>0);
  const filled=KIT.diorama.brushField(fill.editor.apply(fill.change));
  assert(filled.sdf(0,0,.22)<0);
  assert(filled.sdf(0,0,.27)>0);
  assert(filled.sdf(0,.12,.22)>0);

  const smoothing=sculpt(spec,'smooth',{...brush,profile:'round',radius:1,preserveFeatures:false});
  assert(smoothing.preview.valid,JSON.stringify(smoothing.preview.conflicts));
  assert.deepEqual(smoothing.review.hits.map(hit=>hit.change),['add','cut']);
  assert(smoothing.review.volume.addedWorldVolume>0);
  assert(smoothing.review.volume.removedWorldVolume>0);
  const edited=smoothing.editor.apply(smoothing.change);
  const smooth=KIT.diorama.brushField(edited), original=KIT.diorama.brushField(spec);
  assert(original.sdf(0,0,.12)>0);
  assert(smooth.sdf(0,0,.12)<0);
  const rim=smoothing.review.hits[1].rest;
  assert(original.sdf(rim[0],rim[1],.23)<0);
  assert(smooth.sdf(rim[0],rim[1],.23)>0);
  assert(smoothing.editor.undo());
  smoothing.editor.redo();
  assert.deepEqual(smoothing.scene.snapshot(),edited);
  const wider = smoothing.editor.apply(retune(smoothing.editor,'smooth',{radius:2}));
  assert.equal(wider.solids[0].modifiers[0].brush.settings.radius,2);
  assert.deepEqual(wider.solids[0].modifiers[0].brush.attachment,edited.solids[0].modifiers[0].brush.attachment);
});

function partSource() {
  const base = source();
  return { ...base,solids:[{ ...base.solids[0],part:'door' }],
    parts:{door:{joint:[0,0,0]}},
    motion:[
      {do:'bob',part:'door',axis:[1,0,0],amount:.45,period:2},
      {do:'squash',part:'door',axis:[0,0,1],amount:.3,period:2}
    ] };
}

function partDocument() {
  return document('panel.json',{ sceneBindings:[{id:'plate',scene:'panel.json',object:'plate',part:'door'}] });
}

function retune(editor,id,settings,editId='retune') {
  const observed = pixels(editor);
  const command = patch(observed,undefined,editId);
  command.operation = { updateBrush:{id,...settings} };
  return command;
}

test('cuts and relief drawn on a posed part follow rest points through a squash and translation', () => {
  const spec = partSource(), scene = ink.createSceneEditor(spec);
  const editor = ink.createPixelEditor(partDocument(),{sceneEditor:scene,sceneRef:'panel.json'});
  const command = patch(pixels(editor),{mode:'carve',depth:.16,time:.5,direction:'normal',pixels:[[32,32]]},'door-groove');
  const preview = editor.previewEdit(command);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const target = preview.targets[0], hit = target.brush.hits[0];
  assert.deepEqual(target.brush.attachment,{object:'plate',part:'door',time:.5});
  assert(hit.rest[0]<-.4);
  const carved = editor.apply(command);
  assert.equal(carved.solids[0].modifiers[0].brush.attachment.source.part,'door');
  const edited = editor.apply(patch(pixels(editor),{mode:'raise',depth:.11,time:.5,direction:'normal',pixels:[[35,32]]},'door-relief'));

  function render(sourceScene,time) {
    const world = KIT.diorama.build(sourceScene,{retainPartRenderSdf:true});
    require('../cli/diarama-pose.js').pose(world,time,{kit:ink.load()});
    return ink.render(world,{w,h,px:1,t:time,raw:true,sdfAssist:{posed:true},
      passes:['opaque-surface','partId','sourceSurface']}).passes;
  }
  const animated = render(edited,.5), original = render(spec,.5), center=32*w+32;
  assert.equal(animated.surfaceKind[center],2);
  assert(animated.depth[center]>original.depth[center]+.13);
  const relief=32*w+35;
  assert.equal(animated.surfaceKind[relief],2);
  assert(animated.depth[relief]<original.depth[relief]-.08);
  const unposed = render(edited,0), originalRest = render(spec,0);
  const changed = Array.from({length:w},(_,x)=>32*w+x).filter(p=>
    unposed.surfaceKind[p]===2 && originalRest.surfaceKind[p]===2 && unposed.depth[p]>originalRest.depth[p]+.09);
  assert(changed.some(p=>p%w<30));
  assert(unposed.depth[center]<originalRest.depth[center]+.01);
});

test('parameter updates use the original anchors and preserve the stroke ID and following sculpt modifiers', () => {
  const scene = ink.createSceneEditor(partSource()), editor = ink.createPixelEditor(partDocument(),
    {sceneEditor:scene,sceneRef:'panel.json'});
  const cut = patch(pixels(editor),{mode:'carve',depth:.15,time:.5,pixels:[[32,32]]},'retained-notch');
  const first = editor.apply(cut).solids[0].modifiers[0];
  scene.setTransform({translation:[2,0,0],scale:1.5},'solid:plate');
  const warp = {id:'later-warp',kind:'warp',bend:.15};
  scene.setModifiers([first,warp],'solid:plate');
  const before = scene.snapshot(), command = retune(editor,first.id,{depth:.31,direction:'normal',profile:'round',falloff:{pixels:.2}});
  const preview = editor.previewEdit(command);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const review = preview.targets[0].brush;
  assert.equal(preview.targets[0].modifier,first.id);
  assert.equal(review.settings.depth,.31);
  assert.deepEqual(review.attachment,{object:'plate',part:'door',time:.5});
  assert.deepEqual(scene.snapshot(),before);
  editor.begin('Retune retained notch');
  const result = editor.apply(command), [updated,following] = result.solids[0].modifiers;
  assert.deepEqual(editor.previewChanges().targets[0].brush,review);
  assert.equal(updated.id,first.id);
  assert.deepEqual(updated.brush.attachment,first.brush.attachment);
  assert.notDeepEqual(updated.brush.columns,first.brush.columns);
  assert.deepEqual(following,warp);
  const scan = pixels(editor).modifiers[0];
  assert.equal(scan.settings.depth,.31);
  assert.equal(scan.attachment.pixels,1);
  editor.commit();
  const receipt = editor.receipts().at(-1);
  assert(editor.undo());
  assert.deepEqual(scene.snapshot(),before);
  editor.replay(receipt);
  assert.deepEqual(scene.snapshot(),result);
});
