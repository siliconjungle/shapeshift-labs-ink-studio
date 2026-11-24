'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');

const artwork = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{ shade:'#37283d',plum:'#634658',light:'#c68268',same:'#37283d' },
  ramps:[{ id:'bevel',swatches:['shade','plum','light'] }],
  layers:[{ id:'ink' }],
  frames:[{ id:'front',durationMs:100,cels:{ ink:{ marks:[
    { swatch:'shade',at:[1,1] },{ swatch:'plum',at:[2,1] },{ swatch:'shade',at:[3,2] },
    { swatch:'same',at:[3,3] },{ swatch:'light',at:[5,4] },{ swatch:'light',at:[7,4] }
  ] } } },{ id:'back',durationMs:100,cels:{} }],
  protectedDetails:[{ id:'light-split',kind:'gap',frame:'front',pixels:[[6,4]] },
    { id:'edge',kind:'contour',frame:'front',pixels:[[1,1],[2,1]] }]
};

const command = (action,details)=>({ format:'ink-studio/pixel-command',version:1,action,...details });
const sceneDocument = (scene,object,part)=>({
  ...artwork,width:64,height:48,
  sceneBindings:[{ id:'study',scene,object,...(part && {part}),frame:'front',layer:'ink' }]
});
const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
  { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-intents-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return (name,data)=>{
    const file = path.join(dir,name);
    if (data !== undefined) fs.writeFileSync(file,typeof data === 'string' ? data : JSON.stringify(data));
    return file;
  };
}

test('palette shadow clusters, one-pixel gaps, and named protections return exact target evidence',()=>{
  const editor = ink.createPixelEditor(artwork);
  const shadow = { type:'shadow-cluster',ramp:'bevel',steps:2 };
  const clusters = editor.select(shadow);
  assert.deepEqual(clusters.pixels,[[1,1],[2,1],[3,2]]);
  assert.deepEqual(clusters.intents[0].targets.map(row=>[row.origin,row.runs]),[
    [[1,1],[[1,1,2]]],[[3,2],[[2,3,1]]]
  ]);
  assert.deepEqual(editor.select({ ...shadow,at:[3,2],connectivity:8 }).pixels,clusters.pixels);
  assert.deepEqual(editor.select({ ...shadow,at:[3,3] }).pixels,[]);
  assert.throws(()=>editor.select({ ...shadow,swatches:['shade'] }),/Choose shadow swatches/);
  assert.throws(()=>editor.select({ ...shadow,at:[8,0] }),/in-bounds/);

  const gap = editor.select({ type:'one-pixel-gap',at:[6,4] });
  assert.deepEqual(gap.pixels,[[6,4]]);
  assert.deepEqual(gap.intents[0].targets[0].sample,{
    at:[6,4],horizontal:[{at:[5,4],swatch:'light'},{at:[7,4],swatch:'light'}]
  });
  assert.equal(gap.intents[0].targets[0].protected,true);
  assert.deepEqual(editor.select({ type:'one-pixel-gap',at:[6,4],axis:'vertical' }).pixels,[]);
  assert.deepEqual(editor.select({ type:'one-pixel-gap',at:[0,4] }).pixels,[]);

  const protectedResult = editor.select({ type:'protected-detail',at:[2,1] });
  assert.deepEqual(protectedResult.pixels,[[1,1],[2,1]]);
  assert.equal(protectedResult.intents[0].targets[0].id,'edge');
  assert.deepEqual(editor.select({ type:'protected-detail',kind:'gap' },{ frame:'back' }).pixels,[]);
  const combined = editor.select({ type:'intersect',base:shadow,with:{type:'protected-detail',kind:'contour'} });
  assert.deepEqual(combined.pixels,[[1,1],[2,1]]);
  assert.deepEqual(combined.intents.map(row=>[row.matchedPixels,row.targetCount]),[[2,1],[2,1]]);
});

test('the CLI and SDK verify the same target, guard mask commits, and replay the receipt',t=>{
  const file = workspace(t), editor = ink.createPixelEditor(artwork);
  const query = { type:'shadow-cluster',swatches:['shade'] };
  const result = editor.execute(command('select',{query,options:{layer:'ink'}}));
  const art = file('art.json',artwork), queryPath = file('query.json',query);
  assert.deepEqual(cli('select',art,queryPath,'--layer','ink'),result);
  assert.equal(cli('select',art,queryPath,'--layer','ink','--target-revision',result.targetRevision).verified,true);
  assert.throws(()=>cli('select',art,queryPath,'--target-revision',result.targetRevision),error=>
    error.status === 2 && JSON.parse(error.stdout).conflicts[0].code === 'stale-target');
  assert.equal(editor.select({ swatches:['shade'],type:'shadow-cluster' },{
    layer:'ink',targetRevision:result.targetRevision
  }).verified,true);
  assert.throws(()=>editor.select(query,{targetRevision:result.targetRevision}),error=>error.conflicts[0].code==='stale-target');

  const patch = { id:'save-shadow',destination:'selections',frame:'front',revision:result.revision,
    operation:{ id:'shadow',query,layer:'ink' } };
  assert.equal(editor.previewEdit(patch).conflicts[0].code,'unverified-target');
  const guarded = { ...patch,operation:{ ...patch.operation,targetRevision:result.targetRevision } };
  assert.equal(editor.previewEdit(guarded).targets[0].targetRevision,result.targetRevision);
  const applied = editor.execute(command('mask',{patch:guarded}));
  assert.equal(applied.affectedTargets[0].targetRevision,result.targetRevision);
  assert.deepEqual(editor.select({type:'recall',id:'shadow'}).pixels,result.pixels);
  assert.deepEqual(ink.createPixelEditor(artwork).replay(applied),editor.snapshot());
  const receipt = cli('edit',art,file('patch.json',guarded),'--out',file('output.json'));
  assert.equal(receipt.affectedTargets[0].targetRevision,result.targetRevision);
  cli('replay',art,file('receipt.json',receipt),'--out',file('replayed.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('replayed.json'))),editor.snapshot());
});

test('real source passes identify named parts and attribute coverage loss to foreground splats',t=>{
  const file = workspace(t), scene = file('splats.js',`
    module.exports = ({makeBuilder}) => ({ id:'paint-study', name:'Paint study',build() {
      const B = makeBuilder(12,[0x222234,0xeea729,0x469c89]);
      B.iso(0,0,0,.7,B.P[1],3,{splatId:'stem-rest'});
      B.describeSplats(0,1,{object:'assembly',target:{entity:'plant',part:'stem'}});
      B.iso(0,0,.6,.7,B.P[2],.28,{nd:true,splatId:'front-mist'});
      B.describeSplats(1,2,{object:'weather'});
      return B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,ortho:true},radius:4,dither:0});
    } });
  `);
  const doc = sceneDocument(scene,'plant','stem'), art = file('art.json',doc);
  const visible = { type:'visible-part',at:[32,24] };
  const query = file('visible.json',visible), view = file('view.json');
  cliCapture(scene,view);
  const captured = ink.unpackPixelSourceView(JSON.parse(fs.readFileSync(view)));
  const editor = ink.createPixelEditor(doc);
  const result = editor.select(visible,{ renderFrame:captured });
  assert.deepEqual(cli('select',art,query,'--source-view',view),result);
  assert.deepEqual(cli('select',art,query,'--scene',scene),result);
  const session = file('session');
  cli('session','init',session,art);
  assert.deepEqual(cli('session','select',session,query,'--source-view',view),result);
  assert.equal(cli('session','run',session,file('select.json',command('select',{
    query:visible,options:{targetRevision:result.targetRevision}
  })),'--source-view',view).verified,true);
  const [identified] = result.intents[0].targets;
  assert.deepEqual([identified.object,identified.entity,identified.part],['assembly','plant','stem']);
  assert.ok(identified.sample.coverage > 0);
  assert.equal(editor.select({ ...visible,entity:'other' },{renderFrame:captured}).pixelCount,0);
  const shadow = editor.select({type:'shadow-cluster',range:[0,1],at:[32,24]},{renderFrame:captured});
  assert.ok(shadow.pixelCount > 0);
  assert.equal(shadow.intents[0].targets[0].source,'inkShadow');

  const occluder = { type:'occluding-contributor',binding:'study',scope:'partial',at:[32,24] };
  const blocked = cli('select',art,file('occlusion.json',occluder),'--scene',scene);
  assert.deepEqual(blocked.pixels,[[32,24]]);
  const [mist] = blocked.intents[0].targets;
  assert.equal(mist.role,'foreground-splat');
  assert.equal(mist.id,'front-mist');
  assert.ok(mist.sample.depth < mist.sample.targetDepth);
  assert.ok(mist.sample.visibleCoverage < mist.sample.projectedCoverage);
  assert.ok(mist.sample.contribution > 0);
  assert.throws(()=>editor.select(occluder,{renderFrame:captured}),/matched visible and isolated/);
});

function cliCapture(scene,view) {
  execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','capture',scene,
    '--w','64','--h','48','--out',view],{cwd:path.resolve(__dirname,'..')});
}

test('registered occlusion resolves opaque blockers and a changed source invalidates verification',()=>{
  const world = ink.createSceneEditor({ id:'blocker-study',style:'slate',
    camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    finish:{look:{sdfAssist:true}},
    solids:[
      {id:'rear',kind:'box',at:[0,0,0],half:[.65,.65,.12],res:.13,mat:'stone'},
      {id:'cover',kind:'box',at:[0,0,.7],half:[.24,1.1,.12],res:.13,mat:'stone'}
    ] }).build();
  const doc = { ...sceneDocument('blocker-study','rear'),width:5,height:3 };
  doc.protectedDetails = [];
  doc.frames = [{id:'front',durationMs:100,cels:{}}];
  doc.sceneBindings[0].canvas = { size:[64,48],offset:[30,23],scale:[1,1] };
  const editor = ink.createPixelEditor(doc);
  const capture = yaw=>settings=>ink.render(world,{ ...settings,px:1,yaw,raw:true });
  const query = { type:'intersect',base:{type:'occluding-contributor',binding:'study',scope:'full',object:'cover'},
    with:{type:'pixels',pixels:[[2,1],[3,1]]} };
  const context = {captureSelection:capture(0)};
  const result = editor.select(query,context);
  assert.deepEqual(result.pixels,[[2,1],[3,1]]);
  const { sample,role,object } = result.intents[0].targets[0];
  assert.equal(role,'opaque-blocker');
  assert.equal(object,'cover');
  assert.deepEqual(sample.sourceAt,[32,24]);
  assert.equal(sample.visibleCoverage,0);
  assert.ok(sample.targetDepth > sample.depth);
  const patch = { id:'save-blocker',destination:'selections',frame:'front',revision:result.revision,
    operation:{ id:'blocker',query,targetRevision:result.targetRevision } };
  assert.equal(editor.previewEdit(patch,context).valid,true);
  const stale = editor.previewEdit(patch,{captureSelection:capture(.15)});
  assert.equal(stale.conflicts[0].code,'stale-target');
  assert.equal(stale.conflicts[0].expected,result.targetRevision);
  assert.notEqual(stale.conflicts[0].actual,result.targetRevision);
});
