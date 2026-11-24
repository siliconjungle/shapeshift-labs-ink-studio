const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const ArtPasses = require('../src/art-passes.js');
const Bindings = require('../src/pixel-source-bindings.js');
const { KIT } = ink.load();

const [w,h]=[65,65], center=[32,32], sceneRef='panel.json';
const pixels=Array.from({length:81},(_,i)=>[28+i%9,28+Math.floor(i/9)]);
const finish={
  wall:{material:'metal',coordinates:'stroke',edge:{width:.025,material:'accent'},lighting:{gain:.8,flatten:.25}},
  cap:{material:'ember',coordinates:'rest',lighting:{gain:.55,flatten:1}}
};

function setup(modifiers) {
  const spec={id:'surface-panel',style:'slate',camera:{target:[0,0,0],yaw:0,pitch:0,dist:4,sway:0,projection:'orthographic'},
    solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.9,.72,.25],res:.04,mat:'stone',...(modifiers && {modifiers})}]};
  const document={format:'ink-studio/pixel-art',version:2,width:w,height:h,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:sceneRef,object:'plate'}],
    destinations:[{id:'sculpt',kind:'sdf-shape',binding:'plate'},{id:'paint',kind:'sdf-material',binding:'plate'}]};
  const scene=ink.createSceneEditor(spec), editor=ink.createPixelEditor(document,{sceneEditor:scene,sceneRef});
  return { spec,scene,editor };
}

function request(editor,id,operation,destination='sculpt') {
  const { documentRevision:revision,sourceRevision }=editor.targets(destination);
  return {id,revision,sourceRevision,destination,frame:'front',operation};
}

function render(scene,options={}) {
  return ink.render(scene.build(),{ w,h,px:1,raw:true,transparent:true,passes:['opaque-surface','sourceSurface'],...options });
}

function hit(frame,[x,y]) {
  return Bindings.sample(frame,[x,y],ArtPasses)?.geometry;
}

function surfaceAt(spec,point,normal) {
  const field=KIT.diorama.brushField(spec), {owner}=field.renderSurface(...point);
  return field.materialAt(owner.mat,point,normal);
}

test('carved walls and caps have separate materials, coordinates, edge bands and lighting',()=>{
  const {editor,scene}=setup();
  const input=request(editor,'pocket',{brush:{mode:'carve',direction:'normal',depth:.2,pixels,surface:finish}});
  const preview=editor.previewEdit(input);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.deepEqual(preview.targets[0].brush.settings.surface,finish);
  editor.begin('carve pocket');
  const carved=editor.apply(input);
  const receipt=editor.receipts().at(-1);
  assert.deepEqual(receipt.affectedTargets[0].brush.settings.surface,finish);
  editor.commit();

  const [stroke]=carved.solids[0].modifiers, column=stroke.brush.columns.find(row=>row.at[0]===28&&row.at[1]===32);
  const x=column.corners[0][0], cap=[0,0,column.corners[0][2]];
  const wall=surfaceAt(carved,[x,0,.12],[1,0,0]), edge=surfaceAt(carved,[x,0,.24],[1,0,0]);
  const floor=surfaceAt(carved,cap,[0,0,1]);
  assert.equal(wall.materialId,'metal');
  assert.deepEqual(wall.generatedSurface,{stroke:'pocket',change:'cut',face:'wall',coordinates:'stroke',
    edge:false,lighting:{gain:.8,flatten:.25},side:'left'});
  assert(wall.surfaceUV.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
  assert.equal(edge.materialId,'accent');
  assert.equal(edge.generatedSurface.edge,true);
  assert.equal(floor.materialId,'ember');
  assert.deepEqual(floor.surfaceUV,[0,0]);
  assert.deepEqual(floor.generatedSurface.lighting,{gain:.55,flatten:1});
  assert(floor.model.color.every(n=>n<=.55));

  const frame=render(scene);
  assert.equal(hit(frame,center).material,'ember');
  assert.equal(hit(frame,center).generatedSurface.face,'cap');
  assert.deepEqual(hit(frame,center).uv,[0,0]);
  assert.equal(hit(frame,[25,32]).material,'stone');
  assert.equal(hit(frame,[25,32]).generatedSurface,undefined);
  const oblique=render(scene,{yaw:.48}), hits=[];
  for (let y=27;y<38;y++) for (let x=20;x<41;x++) hits.push(hit(oblique,[x,y]));
  assert(hits.some(row=>row?.material==='metal'&&row.generatedSurface.face==='wall'));
  assert(hits.some(row=>row?.material==='accent'&&row.generatedSurface.edge));
});

test('refinishing raised relief preserves signed geometry, and later pigment paint stays independent',()=>{
  const {editor,scene}=setup();
  const raised=editor.apply(request(editor,'relief',{brush:{mode:'raise',depth:.18,direction:'normal',pixels}}));
  const before=render(scene), stroke=raised.solids[0].modifiers[0];
  const change=request(editor,'style-relief',{updateBrush:{id:'relief',surface:finish}});
  const preview=editor.previewEdit(change);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  assert.equal(preview.targets[0].brush.appearanceOnly,true);
  const styled=editor.apply(change), updated=styled.solids[0].modifiers[0], after=render(scene);
  assert.deepEqual(updated.brush.columns,stroke.brush.columns);
  assert.deepEqual(updated.brush.attachment,stroke.brush.attachment);
  for (const channel of ['depth','surfaceCoverage','geometricNormal','objectId'])
    assert.deepEqual(after.passes[channel],before.passes[channel],channel);
  assert.equal(hit(after,center).material,'ember');
  assert.equal(hit(after,center).generatedSurface.change,'add');
  const angle=render(scene,{yaw:.7});
  assert(angle.passes.surfaceSources.some(row=>row?.generatedSurface?.face==='wall'&&row.generatedSurface.change==='add'));

  editor.apply(request(editor,'overpaint',{paint:{pixels:[center],material:'moss',masks:{wear:.5}}},'paint'));
  const painted=hit(render(scene),center);
  assert.equal(painted.material,'moss');
  assert.equal(painted.generatedSurface.face,'cap');
  assert.deepEqual(painted.paint,{material:'moss',masks:{wear:.5}});
  editor.apply(request(editor,'wipe-paint',{paint:{pixels:[center],material:null}},'paint'));
  assert.equal(hit(render(scene),center).material,'ember');

  const cleared=editor.apply(request(editor,'clear-style',{updateBrush:{id:'relief',surface:null}}));
  assert.deepEqual(cleared.solids[0].modifiers[0],stroke);
  assert.equal(hit(render(scene),center).generatedSurface,undefined);
  assert(editor.undo());
  assert.equal(hit(render(scene),center).generatedSurface.face,'cap');
});

test('invalid surface settings are rejected before a retained brush changes',()=>{
  const {editor,scene,spec}=setup();
  const input=request(editor,'bad-surface',{brush:{mode:'carve',depth:.12,pixels:[center],
    surface:{wall:{edge:{width:.1,material:'missing-role'}}}}});
  const preview=editor.previewEdit(input);
  assert.equal(preview.valid,false);
  assert.deepEqual(scene.snapshot(),spec);
});

test('a depth retune keeps the finish and its rest coordinates follow the solid transform',()=>{
  const {editor,scene}=setup();
  editor.apply(request(editor,'pocket',{brush:{mode:'carve',depth:.15,direction:'normal',pixels,surface:finish}}));
  const before=render(scene), oldHit=hit(before,center);
  const deeper=editor.apply(request(editor,'deepen',{updateBrush:{id:'pocket',depth:.26}}));
  assert.deepEqual(deeper.solids[0].modifiers[0].brush.settings.surface,finish);
  const after=render(scene), newHit=hit(after,center);
  assert(newHit.depth>oldHit.depth+.1);
  assert.deepEqual(newHit.generatedSurface,oldHit.generatedSurface);
  assert.deepEqual(newHit.uv,oldHit.uv);

  const translation=[1.1,0,0];
  scene.setTransform({translation},'solid:plate');
  const moved=hit(render(scene,{target:translation}),center);
  assert.equal(moved.material,'ember');
  assert.deepEqual(moved.generatedSurface,newHit.generatedSurface);
  assert(moved.uv.every((n,i)=>Math.abs(n-newHit.uv[i])<1e-5));
});
