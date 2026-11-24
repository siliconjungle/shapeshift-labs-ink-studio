const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const ArtPasses = require('../src/art-passes.js');
const Bindings = require('../src/pixel-source-bindings.js');

const [w,h] = [65,65];
const sceneRef = 'panel.json';
const center = [32,32];
const camera = {target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'};
const passes = ['opaque-surface','coverage','sourceSurface'];
const render = (world, options)=>ink.render(world,{ w,h,px:1,raw:true,transparent:true,passes,...options });
const pixel = (frame,[x,y])=>Array.from(frame.rgb.subarray(3*(y*w+x),3*(y*w+x+1)));

function fixture(extras={}) {
  const spec = { id:'paint-panel',style:'slate',camera,
    solids:[{ id:'plate',kind:'box',at:[0,0,0],half:[.9,.72,.25],res:.06,mat:'stone' }],...extras };
  const design = { format:'ink-studio/pixel-art',version:2,width:w,height:h,pixelAspect:[1,1],
    palette:{ ink:'#17222b' },layers:[{ id:'ink' }],frames:[{ id:'front',durationMs:100,cels:{} }],
    sceneBindings:[{ id:'plate',scene:sceneRef,object:'plate',...(spec.solids[0].part && {part:spec.solids[0].part}) }],
    destinations:[{ id:'paint',kind:'sdf-material',binding:'plate' }],
    selections:[{ id:'badge',frame:'front',pixels:[center,[33,32],[0,0]] }] };
  const scene = ink.createSceneEditor(spec), editor = ink.createPixelEditor(design,{ sceneEditor:scene,sceneRef });
  return { spec,scene,editor };
}

function command(editor,id,paint) {
  const { documentRevision,sourceRevision }=editor.targets('paint');
  return { id,frame:'front',destination:'paint',revision:documentRevision,sourceRevision,operation:{paint} };
}

function at(frame,point) {
  return Bindings.sample(frame,point,ArtPasses);
}

test('native SDF material paint previews, commits, replays and preserves geometry and a native boundary',()=>{
  const {spec,scene,editor}=fixture();
  const options={ sdfAssist:true };
  const before=render(scene.build(undefined,{retainRenderSdf:true}),options);
  const baseline=render(scene.build(),{});
  const edit=command(editor,'badge',{ selection:'badge',material:'ember',masks:{wear:.8,soot:.25} });
  const preview=editor.previewEdit(edit);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const report=preview.targets[0].surfacePaint;
  assert.equal(report.projectedPixels,2);
  assert.deepEqual(report.skippedHits.map(hit=>hit.code),['no-surface']);
  assert.deepEqual(scene.snapshot(),spec);

  editor.begin('paint the badge');
  const edited=editor.apply(edit);
  assert.deepEqual(editor.previewChanges().targets[0].surfacePaint,report);
  const receipt=editor.receipts().at(-1);
  assert.deepEqual(receipt.skippedHits,report.skippedHits);
  editor.commit();
  const { sdfPaint,...solid }=edited.solids[0];
  assert.deepEqual(solid,spec.solids[0]);
  assert.equal(sdfPaint.strokes[0].id,'badge');
  assert.deepEqual(editor.targets('paint').paintStrokes,[{id:'badge',material:'ember',masks:{wear:.8,soot:.25},pixels:2}]);

  const world=scene.build(), after=render(world,options);
  for (const channel of ['depth','coverage','surfaceCoverage','geometricNormal','shadingNormal','objectId'])
    assert.deepEqual(after.passes[channel],before.passes[channel],channel);
  assert.equal(ArtPasses.pick(after.passes,...center).material,'ember');
  assert.deepEqual(at(after,center).geometry.paint,{material:'ember',masks:{wear:.8,soot:.25}});
  const neighbor = [31,32];
  assert.equal(ArtPasses.pick(after.passes,...neighbor).material,'stone');
  assert.equal(at(after,neighbor).geometry.paint,undefined);
  assert.notDeepEqual(pixel(after,center),pixel(before,center));
  assert.deepEqual(pixel(after,neighbor),pixel(before,neighbor));
  const back=render(world,{...options,yaw:Math.PI});
  assert.equal(ArtPasses.pick(back.passes,...center).material,'stone');
  assert.equal(at(back,center).geometry.paint,undefined);

  const baked=render(world,{});
  for (const channel of ['depth','coverage','objectId']) assert.deepEqual(baked.passes[channel],baseline.passes[channel],channel);
  assert(editor.undo());
  assert.deepEqual(scene.snapshot(),spec);
  editor.replay(receipt);
  assert.deepEqual(scene.snapshot(),edited);
});

test('SDF paint channels can replace or clear one value and follow a moved solid',()=>{
  const {scene,editor,spec}=fixture();
  const apply=(id,values)=>editor.apply(command(editor,id,{ pixels:[center],...values }));
  apply('first',{material:'ember',masks:{wear:.8,soot:.25}});
  const edited=apply('second',{material:null,masks:{wear:null,shine:1}});
  const options={sdfAssist:true};
  const frame=render(scene.build(),options);
  assert.equal(ArtPasses.pick(frame.passes,...center).material,'stone');
  assert.deepEqual(at(frame,center).geometry.paint,{masks:{soot:.25,shine:1}});
  const translation=[1.1,0,0];
  const moved=ink.createSceneEditor({...edited,camera:{...camera,target:translation},
    solids:[{...edited.solids[0],transform:{translation}}]});
  assert.deepEqual(at(render(moved.build(),options),center).geometry.paint,{masks:{soot:.25,shine:1}});
  const { KIT }=ink.load(), field=KIT.diorama.brushField(edited), base=KIT.diorama.brushField(spec);
  const anchor=[0,0,.25], normal=[0,0,1];
  const {owner}=field.renderSurface(...anchor);
  const material=field.materialAt(owner.mat,anchor,normal);
  assert.deepEqual(material.model.masks,{soot:.25,shine:1});
  for (const p of [[0,0,0],anchor,[0,0,.4],[-.9,.3,.18]])
    assert.equal(field.sdf(...p),base.sdf(...p));
  const invalid=editor.previewEdit(command(editor,'invalid',{ material:'missing-role',pixels:[center] }));
  assert.equal(invalid.valid,false);
  assert.deepEqual(scene.snapshot(),edited);
});


test('paint sampled on a posed part follows its rest point and respects occlusion',()=>{
  const plate={ id:'plate',kind:'box',at:[0,0,0],half:[.9,.72,.25],res:.06,mat:'stone',part:'door' };
  const blocker={ id:'pin',kind:'box',at:[.45,0,.64],half:[.12,.12,.10],res:.06,mat:'metal' };
  const {scene,editor}=fixture({
    solids:[plate,blocker],parts:{door:{joint:[0,0,0]}},
    motion:[{do:'bob',part:'door',axis:[1,0,0],amount:.45,period:2},
      {do:'squash',part:'door',axis:[0,0,1],amount:.3,period:2}]
  });
  const posed=(time,retain=false)=>{
    const world=scene.build(undefined,{retainPartRenderSdf:retain});
    require('../cli/diarama-pose.js').pose(world,time,{kit:ink.load()});
    return render(world,{ t:time,sdfAssist:{posed:true} });
  };
  const before=posed(.5,true), blockerSlot=before.passes.objects.indexOf('pin');
  const blocked=before.passes.objectId.indexOf(blockerSlot), blockedAt=[blocked%w,Math.floor(blocked/w)];
  const patch=command(editor,'posed-badge',{pixels:[center,blockedAt],time:.5,material:'ember',masks:{wear:.5}});
  const preview=editor.previewEdit(patch);
  assert(preview.valid,JSON.stringify(preview.conflicts));
  const {surfacePaint}=preview.targets[0];
  assert.equal(surfacePaint.projectedPixels,1);
  assert.equal(surfacePaint.skippedHits[0].code,'occluded-or-outside-target');
  assert(surfacePaint.hits[0].rest[0]<-.4);
  editor.apply(patch);
  assert.deepEqual(at(posed(.5),center).geometry.paint,{material:'ember',masks:{wear:.5}});
  const atRest=posed(0);
  const painted=Array.from({length:w},(_,x)=>[x,32]).find(point=>at(atRest,point)?.geometry?.paint?.masks.wear===.5);
  assert(painted && painted[0]<center[0]);
  assert.equal(at(atRest,center).geometry.paint,undefined);
});


test('baked splats carry the palette role without changing any packed geometry',()=>{
  const {scene,editor}=fixture();
  const base=scene.build();
  const pixels=Array.from({length:121},(_,i)=>[27+i%11,27+Math.floor(i/11)]);
  editor.apply(command(editor,'large-badge',{pixels,material:'ember'}));
  const baked=scene.build();
  assert.equal(baked.count,base.count);
  let painted=0;
  for(let i=0;i<baked.data.length;i++) {
    if (i%16===7 && baked.data[i]!==base.data[i]) painted++;
    else assert.equal(baked.data[i],base.data[i],'packed column '+i%16);
  }
  assert(painted>0);
  assert(baked.renderMetadata.materials.includes('ember'));
  assert.notDeepEqual(pixel(render(baked,{}),center),pixel(render(base,{}),center));
});
