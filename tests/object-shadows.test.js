'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ink = require('..');
const ShadowArt = require('../src/shadow-art.js');
const maps = require('../src/directional-shadow-map.js');
const {scene,request,view} = require('../examples/tileset-pick/object-shadows-demo.cjs');
const render = (world,options)=>ink.render(world,{...view,...options,px:1,passes:['objectId']});
const rgb = (frame,i)=>frame.rgb[i*3]+frame.rgb[i*3+1]+frame.rgb[i*3+2];

function brightened(before,after,object) {
  const owner = before.passes.objects.indexOf(object);
  assert(owner>0,object);
  return before.passes.objectId.reduce((n,id,i)=>n+Number(id===owner&&rgb(after,i)>rgb(before,i)+36),0);
}

test('object flags persist with light settings and preserve visible geometry, with a single undo',()=>{
  const source=scene(), editor=ink.createSceneEditor(source);
  const before=render(editor.build(),{liveSun:request.map});
  const preview=editor.previewShadowControls(request);
  assert.deepEqual(editor.snapshot(),source);
  assert(preview.report.canCommit);
  editor.editShadowControls(request);
  assert.deepEqual(editor.snapshot().finish.look.shadowArt.objects,{'west-roof':{cast:false}});
  const after=render(editor.build());
  assert.deepEqual(after.passes.objectId,before.passes.objectId);
  assert(brightened(before,after,'west-floor')>100);
  assert(brightened(before,after,'east-floor')<20);
  editor.editShadowControls({object:'east-floor',flags:{receive:false}});
  const receives=render(editor.build());
  assert.deepEqual(receives.passes.objectId,after.passes.objectId);
  assert(brightened(after,receives,'east-floor')>100);
  assert.equal(brightened(after,receives,'west-floor'),0);
  editor.undo();
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
  editor.redo();
  assert.deepEqual(editor.snapshot().finish.liveSun.bounds,request.map.bounds);

  editor.editShadowControls({object:'west-roof',flags:null,light:{type:'sun'},map:{bounds:null}});
  assert.deepEqual(editor.snapshot().finish.look.shadowArt.objects,{});
  assert.equal(editor.snapshot().finish.liveSun.bounds,undefined);
  for (const invalid of [
    {object:'unknown',flags:{cast:false}}, {object:'west-roof',flags:{cast:1}},
    {light:{type:'sun'},map:{mapSize:2049}}, {light:{type:'sun'},map:{bounds:{min:[0,0],max:[1,0]}}},
    {light:{type:'sun'},map:{bias:-1}}, {light:{type:'pbr',index:1},map:{mapSize:64}}
  ]) assert.equal(editor.planShadowControls(invalid).canCommit,false);
});

test('fixed maps clip receivers at their light-space bounds and honor resolution and bias',()=>{
  const source={points:[[-4,-4,1],[4,-4,1],[0,4,1]],uv:[[0,0],[0,1],[1,0]],sample:()=>true};
  const bounds=maps.bounds({min:[-1,-.5],max:[1,.5]});
  const world={data:new Float32Array(0)}, pose={alpha:[]};
  const build=(mapSize,bias)=>maps.build({direction:[0,0,1],filter:1,mapSize,bias,bounds},
    world,pose,()=>[0,0,1],undefined,{triangles:[source]});
  const frame=build(64,.02), inspect=maps.inspect(frame), visibility=(f,x,y)=>maps.visibility(f,x,y,.2,[0,0,1],1);
  assert.deepEqual(inspect.size,[64,32]);
  assert.deepEqual(inspect.bounds,bounds);
  assert.deepEqual(inspect.axes,{right:[1,0,0],up:[0,1,0],towardLight:[0,0,1]});
  assert.equal(visibility(frame,0,0),0);
  assert.equal(visibility(frame,1,0),1);
  assert.equal(visibility(frame,0,.51),1);
  assert.equal(visibility(build(128,1),0,0),1);
  assert.deepEqual(maps.inspect(build(128,1)).size,[128,64]);

  const art=ShadowArt.prepare({cast:{exclude:[{part:'trim'}]},objects:{wall:{cast:true},roof:{cast:false}}});
  assert.equal(ShadowArt.participates(art,'cast',{object:'wall',part:'trim'}),false);
  assert.equal(ShadowArt.participates(art,'cast',{object:'roof'}),false);
  assert.equal(ShadowArt.participates(art,'receive',{object:'roof'}),true);
});

test('constructed light bias is editable and local shadows obey object flags',()=>{
  const source=scene();
  delete source.finish.liveSun;
  source.light={sun:[0,1,0],amb:.25,sky:0};
  source.solids=source.solids.filter(row=>['east-floor','east-roof'].includes(row.id));
  source.constructionLights={window:{
    mount:{kind:'world',at:[1.4,1.9,-.1]},aim:{kind:'world',at:[1.4,0,0]},
    emitter:{shape:'disk',size:[.2,.2],intensity:8,radius:4,shadows:true,visible:false}
  }};
  const editor=ink.createSceneEditor(source);
  const change={light:{type:'fixture',id:'window'},map:{bias:.03}};
  assert(editor.planShadowControls(change).canCommit);
  assert.equal(editor.planShadowControls({...change,map:{mapSize:256}}).canCommit,false);
  const before=render(editor.build());
  editor.editShadowControls({...change,object:'east-roof',flags:{cast:false}});
  assert.equal(editor.snapshot().constructionLights.window.emitter.bias,.03);
  const noCaster=render(editor.build());
  assert(brightened(before,noCaster,'east-floor')>80);
  editor.undo();
  editor.editShadowControls({...change,object:'east-floor',flags:{receive:false}});
  const noReceive=render(editor.build());
  assert(brightened(before,noReceive,'east-floor')>80);
  assert.deepEqual(noReceive.passes.objectId,before.passes.objectId);
});

test('CLI previews map settings and changed pixels, then saves the scene beside its source', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-shadow-controls-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  write('source.json',scene());
  write('request.json',request);
  write('view.json',view);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const receipt=JSON.parse(execFileSync(process.execPath,[cli,'mesh-topology','shadow-controls',
    'source.json','request.json','--preview','review','--view','view.json','--out','edited.json'],{cwd:dir}));
  assert.equal(receipt.preview.shadows.before.sun.boundsMode,'auto');
  assert.deepEqual(receipt.preview.shadows.after.sun.size,[192,144]);
  assert(receipt.preview.changedPixels>100);
  const edited=JSON.parse(fs.readFileSync(path.join(dir,'edited.json')));
  assert.equal(edited.finish.look.shadowArt.objects['west-roof'].cast,false);
  assert.deepEqual(edited.finish.liveSun.bounds,request.map.bounds);
  assert(fs.statSync(path.join(dir,'review','changes.png')).size>100);
});
