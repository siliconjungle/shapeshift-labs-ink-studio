const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const root = path.resolve(__dirname,'..');
const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
  { cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'] });
const report = (...args)=>JSON.parse(cli(...args));

function setup(t,object = 'panel') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-reprobe-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name);
  const save = (name,data)=>fs.writeFileSync(file(name),typeof data === 'string' ? data : JSON.stringify(data));
  const read = name=>JSON.parse(fs.readFileSync(file(name)));
  const scene = file('scene.js');
  const grid = [80,56];
  const design = { format:'ink-studio/pixel-art',version:2,width:80,height:56,pixelAspect:[1,1],
    palette:{ wax:'#b16c44' },layers:[{ id:'ink' }],frames:[{ id:'key',durationMs:100,cels:{} }],
    selections:[{ id:'repair',frame:'key',pixels:[] }],sceneBindings:[{ id:'panel',scene,object,frame:'key' }],
    destinations:[{ id:'touchup',kind:'shot-correction',binding:'panel' }] };
  const capture = (name,...args)=>{
    cli('capture',scene,'--w',String(grid[0]),'--h',String(grid[1]),'--view-id',name,'--out',file(name+'.json'),...args);
    return ink.unpackPixelSourceView(read(name+'.json'));
  };
  const options = (before = 'before',document = 'art.json')=>
    [file(document),'--binding','panel','--before',file(before+'.json')];
  return { dir,file,save,read,scene,grid,design,capture,options };
}

const pixel = (view,p)=>[p%view.w,Math.floor(p/view.w)];
const owner = (view,p,object)=>view.passes.objects[view.passes.objectId[p]] === object;

test('local mesh topology and chart rebakes invalidate only changed pixels and protect normal binding entry points',t=>{
  const { file,save,read,scene,design,capture,options } = setup(t);
  save('scene.js',`
const fs = require('node:fs');
module.exports = ({KIT:K,makeBuilder}) => ({id:'mesh-reprobe',name:'Mesh reprobe',build() {
  const {topology,pigment} = JSON.parse(fs.readFileSync(${JSON.stringify(file('edit.json'))},'utf8'));
  const B = makeBuilder(2,[0x142231,0xad7054,0x88d0b6]);
  const quad = (id,x,color,inset=0)=>K.sceneMeshes.create({id,objectId:'panel',partId:id,
    positions:[x-.43,.42+inset,.2, x+.43,.42,.2, x-.43,-.42,.2, x+.43,-.42,.2],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id:'paint',color}]});
  return B.finish({ meshes:[quad('quiet',-1,0xad7054),quad('recut',0,0xad7054,topology ? .08 : 0),
     quad('rebake',1,pigment ? 0x88d0b6 : 0xad7054)],
    cam:{target:[0,0,0],dist:5,ortho:true,yaw:0,pitch:0,sway:0},radius:4,dither:0 });
}});
`);
  save('edit.json',{topology:false,pigment:false});
  const baseline = capture('before');
  const polygon = id=>pixel(baseline,baseline.passes.sourceSurface.findIndex((entry,p)=>
    baseline.passes.surfaceSources[entry]?.asset === id && Math.floor(p/80) === 26 && baseline.passes.sourceTriangle[p] === 0));
  const quiet = polygon('quiet'), recut = polygon('recut'), rebake = polygon('rebake');
  assert.ok([quiet,recut,rebake].every(([x,y])=>x>=0 && y===26));
  design.selections[0].pixels = [quiet,recut,rebake];
  save('art.json',design);

  save('edit.json',{topology:true,pigment:true});
  const after = capture('after');
  const result = report('reprobe',...options(),'--selection','repair','--invalidate',file('checked.json'));
  assert.deepEqual(result.counts,{verified:1,review:2,empty:0,stale:2});
  assert.deepEqual(result.reasons,{'source-revision-changed':1,'sampled-pigment-changed':1});
  assert.deepEqual(result.examples.map(row=>row.at),[recut,rebake]);
  assert.deepEqual(read('art.json'),design);
  assert.deepEqual(read('checked.json').sceneBindings[0].stale,result.runs.review);

  const inspect = (doc,point)=>report('inspect',file(doc),'--binding','panel','--at',point.join(','),'--source-view',file('after.json'));
  assert.equal(inspect('checked.json',recut).scene.bindings[0].status,'stale');
  assert.equal(inspect('checked.json',quiet).scene.bindings[0].status,'resolved');
  save('views.json',{version:1,samples:[{id:'start',time:0},{id:'stay',time:0}]});
  const tracking = report('track',file('checked.json'),'--binding','panel','--selection','repair','--views',file('views.json'));
  assert.equal(tracking.samples[0].reasons['stale-source-binding'],2);

  const inspected = inspect('checked.json',recut);
  save('paint.json',{id:'paint',frame:'key',revision:inspected.revision,destination:'touchup',
    operation:{at:recut,anchor:{splat:0}},edits:[{at:recut,from:inspected.swatch,layer:inspected.layer,to:'wax'}]});
  assert.throws(()=>cli('preview',file('checked.json'),file('paint.json'),'--scene',scene),error=>{
    assert.equal(error.status,2);
    assert.equal(JSON.parse(error.stdout).conflicts[0].code,'stale-binding-pixel');
    return true;
  });

  const legacy = read('before.json');
  for (const source of legacy.passes.surfaceSources.filter(Boolean)) delete source.triangles;
  save('legacy.json',legacy);
  const missing = report('reprobe',...options('legacy'),'--after',file('before.json'),'--rect',[...quiet,1,1].join(','));
  assert.equal(missing.reasons['missing-source-proof'],1);

  const accepted = report('reprobe',...options('after','checked.json'),'--after',file('after.json'),
    '--rect',[...recut,1,1].join(','),'--invalidate',file('accepted.json'),'--accept');
  assert.deepEqual(accepted.counts,{verified:1,review:0,empty:0,stale:1});
  assert.equal(inspect('accepted.json',recut).scene.bindings[0].status,'resolved');
  assert.equal(inspect('accepted.json',rebake).scene.bindings[0].status,'stale');
  assert.ok(after.passes.pigment.some(Boolean));
});

test('regenerated splat rows keep stable addresses while changing the proof for the touched chunk',t=>{
  const { file,save,design,capture,options } = setup(t,'cloud');
  save('scene.js',`
const fs = require('node:fs');
module.exports = ({makeBuilder}) => ({id:'chunks',name:'Rebuilt splat chunks',build() {
  const { rebuild,block }=JSON.parse(fs.readFileSync(${JSON.stringify(file('edit.json'))},'utf8'));
  const B=makeBuilder(3,[0x172534,0x8accbb]);
  if (rebuild) {
    B.iso(-3,0,0,.28,B.P[1],2,{splatId:'added-unrelated'});
    B.describeSplats(0,1,{object:'other'});
  }
  B.iso(-.75,0,0,.30,B.P[1],2,{splatId:'left-chunk'});
  B.iso(.75,0,0,rebuild ? .36 : .30,B.P[1],2,{splatId:'right-chunk'});
  B.describeSplats(B.count()-2,B.count(),{object:'cloud'});
  if (block) {
    B.iso(.75,0,.7,.46,B.P[1],3,{splatId:'new-cover'});
    B.describeSplats(B.count()-1,B.count(),{object:'front'});
  }
  return B.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0,ortho:true},radius:5,dither:0});
}});
`);
  save('edit.json',{rebuild:false});
  const original = capture('before'), p = original.passes;
  const at = name=>pixel(original,p.splatId.findIndex((row,i)=>p.splatSources.some(hit=>
    hit?.id===name && hit.renderRow===row-1) && Math.floor(i/80)===28 && owner(original,i,'cloud')));
  const left = at('left-chunk'), right = at('right-chunk');
  design.selections[0].pixels = [left,right];
  save('art.json',design);
  save('edit.json',{rebuild:true});
  capture('after');
  const rechecked = report('reprobe',...options(),'--selection','repair','--after',file('after.json'));
  assert.deepEqual(rechecked.counts,{verified:1,review:1,empty:0,stale:1});
  const [example] = rechecked.examples;
  assert.deepEqual(example.at,right);
  assert.equal(example.reason,'source-revision-changed');
  assert.equal(example.before[0].address,example.after[0].address);
  capture('angle','--yaw','.5');
  assert.throws(()=>report('reprobe',...options(),'--selection','repair','--after',file('angle.json')),/matching native cameras/);
});

test('a cut field is reprobed in a registered crop',t=>{
  const { file,save,design,capture,options } = setup(t);
  save('scene.js',`
const fs = require('node:fs');
module.exports = ({ makeBuilder,makeSculpt }) => ({ id:'cut-study',name:'Cut study',build() {
  const {cut}=JSON.parse(fs.readFileSync(${JSON.stringify(file('edit.json'))},'utf8'));
  const B=makeBuilder(2,[0x182232,0xc19b65,0x825035]), S=makeSculpt(B);
  S.keepRenderSdf=true;
  const group=S.grp(), material={r:[1,2]};
  S.box([0,0,0],[1,.55,.2],material,{...group,objectId:'panel',res:.075});
  if (cut) S.box([.55,0,.04],[.23,.45,.5],material,{...group,neg:true,res:.075});
  S.bake();
  return B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,ortho:true,dist:5,sway:0},radius:5,dither:0,
    look:{sdfAssist:true}});
}});
`);
  save('edit.json',{cut:false});
  capture('before');
  Object.assign(design,{width:2,height:1});
  design.sceneBindings[0].canvas={size:[80,56],offset:[40,28],scale:[6,1]};
  design.selections[0].pixels=[[0,0],[1,0]];
  save('art.json',design);
  save('edit.json',{cut:true});
  const result = report('reprobe',...options(),'--selection','repair');
  assert.equal(result.counts.verified,1,JSON.stringify(result));
  assert.equal(result.counts.review,1);
  assert.deepEqual(result.examples[0].at,[1,0]);
  assert.equal(result.examples[0].reason,'source-lost');
});
