const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const SourceCapture = require('../cli/pixel-source-passes.js');

const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
  { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
const close = (actual,expected)=>assert.ok(Math.abs(actual-expected) < 1e-4,actual+' differs from '+expected);

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-representation-binding-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  return name=>path.join(directory,name);
}
function design(scene,object,{ part,canvas,grid = [64,48] } = {}) {
  return { format:'ink-studio/pixel-art',version:2,width:grid[0],height:grid[1],pixelAspect:[1,1],
    palette:{ wax:'#bb763e' },layers:[{ id:'paint' },{ id:'overlay' }],
    frames:['art','other'].map(id=>({ id,durationMs:100,cels:{} })),
    sceneBindings:[{ id:'study',scene,object,frame:'art',layer:'paint',...(part && {part}),...(canvas && {canvas}) }] };
}
function capture(scene,file,w,h,...options) {
  cli('capture',scene,'--w',String(w),'--h',String(h),'--out',file,...options);
  return ink.unpackPixelSourceView(JSON.parse(fs.readFileSync(file,'utf8')));
}

test('a saved mesh binding returns a chart, triangle and barycentrics in the registered camera grid',t=>{
  const file = workspace(t), scene = 'examples/opaque-surface-gate.js', view = file('view.json');
  const rendered = capture(scene,view,120,80,'--t','.45');
  const { passes } = rendered;
  const pixel = passes.surfaceKind.indexOf(1), at = [pixel%120,Math.floor(pixel/120)];
  const canvas = { size:[120,80],offset:at,scale:[1,1] };
  const document = design(scene,'sluice-screen',{ canvas,grid:[1,1] });
  fs.writeFileSync(file('design.json'),JSON.stringify(document));
  const inspect = (...extras)=>JSON.parse(cli('inspect',file('design.json'),'--at','0,0','--binding','study',
    '--source-view',view,...extras));
  const result = inspect().scene.bindings[0];
  assert.equal(result.status,'resolved');
  assert.deepEqual(result.sourceAt,at);
  const [hit] = result.hits;
  assert.equal(hit.kind,'mesh');
  assert.equal(hit.chart,'sluice-screen');
  assert.ok([0,1].includes(hit.triangle));
  assert.ok(hit.barycentric.every(n=>n >= 0));
  close(hit.barycentric.reduce((a,b)=>a+b),1);
  const uvs = hit.triangle === 0 ? [[0,0],[1,0],[0,1]] : [[0,1],[1,0],[1,1]];
  hit.uv.forEach((n,k)=>close(n,uvs.reduce((sum,uv,i)=>sum+uv[k]*hit.barycentric[i],0)));
  assert.equal(inspect('--frame','other').scene.bindings[0].status,'wrong-frame');
  const editor = ink.createPixelEditor(document);
  assert.deepEqual(editor.inspect([0,0],{ binding:'study',renderFrame:rendered }).scene.bindings,[result]);
});

test('a transformed SDF resolves to the authored solid and its own local XYZ at the traced hit',t=>{
  const file = workspace(t), scene = file('sdf.json'), view = file('view.json');
  fs.writeFileSync(scene,JSON.stringify({ id:'plate-study',style:'slate',
    camera:{ target:[.6,.25,0], dist:5, yaw:0, pitch:0, sway:0, projection:'orthographic' },
    solids:[{ id:'plate',kind:'box',at:[.2,.1,0],half:[.9,.6,.25],res:.1,mat:'stone',
      transform:{ translation:[.4,.15,0],rotation:[0,0,Math.PI/2],scale:1.5 } }] }));
  const rendered = capture(scene,view,64,48,'--sdf-assist','on'), document = design(scene,'plate');
  const resolved = ink.createPixelEditor(document).inspect([32,24],{ binding:'study',renderFrame:rendered }).scene.bindings[0];
  assert.equal(resolved.status,'resolved');
  const [hit] = resolved.hits;
  assert.equal(hit.kind,'sdf');
  assert.equal(hit.entity,'plate');
  assert.ok(Math.abs(hit.local[2]-.25) < .01);
  const [u,v,w] = hit.local;
  close(hit.rest[0],.6-1.5*v);
  close(hit.rest[1],.25+1.5*u);
  close(hit.rest[2],1.5*w);
});

test('splat bindings use scoped stable contributor IDs and report alpha, depth and surviving coverage',t=>{
  const file = workspace(t), scene = file('splats.js'), view = file('view.json');
  fs.writeFileSync(scene,`module.exports = ({makeBuilder}) => ({ id:'splat-study',name:'Splat study',build() {
    const B = makeBuilder(12,[0x222234,0xeea729,0x469c89]);
    B.iso(0,0,0,.7,B.P[1],3,{splatId:'stem-rest'});
    B.describeSplats(0,1,{object:'assembly',target:{entity:'plant',part:'stem'}});
    B.iso(0,0,.6,.7,B.P[2],.28,{nd:true,splatId:'front-mist'});
    B.describeSplats(1,2,{object:'weather'});
    return B.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,ortho:true},radius:4,dither:0});
  } });`);
  const rendered = capture(scene,view,64,48,'--at','32,24');
  const document = design(scene,'plant',{ part:'stem' });
  const report = ink.createPixelEditor(document).inspect([32,24],{ binding:'study',renderFrame:rendered }).scene;
  const [result] = report.bindings, [hit] = result.hits;
  assert.equal(result.status,'resolved');
  assert.equal(result.hits.length,1);
  assert.equal(hit.id,'stem-rest');
  assert.equal(hit.part,'stem');
  assert.equal(hit.editable,true);
  const front = report.sources.splats.find(row=>row.id === 'front-mist');
  assert.ok(front.depth < hit.depth);
  assert.ok(front.visibleCoverage > 0);
  close(hit.visibleCoverage,hit.alpha*(1-front.alpha));
  const observed = report.fragments.hits.find(row=>row.identity === hit.id);
  close(hit.visibleCoverage,observed.visibleCoverage);
  const other = ink.createPixelEditor(design(scene,'plant',{ part:'leaf' }));
  assert.equal(other.inspect([32,24],{ binding:'study',renderFrame:rendered }).scene.bindings[0].status,'miss');
});

test('bounded contribution storage accounts for omitted splats and opaque occluders',()=>{
  const B = ink.load().makeBuilder(3,[0x333333,0xeeeeee]);
  const capture = SourceCapture.splatBuffer(2), alpha = .2;
  for (let i=0; i<6; i++) {
    B.iso(i,0,0,1,B.P[1],3,{ splatId:'source-'+i });
    capture.add(0,i,alpha,6-i);
    capture.add(1,i,alpha,6-i);
  }
  capture.add(1,-1,1,.5);
  const world = B.finish(), result = capture.finish(world,array=>array);
  assert.deepEqual([...result.sourceSplat.slice(0,4)].map(slot=>result.splatSources[slot].id),
    ['source-5','source-4','source-3','source-2']);
  close(result.sourceSplatOmitted[0],alpha*(.8**4+.8**5));
  assert.deepEqual([...result.sourceSplat.slice(4)],[0,0,0,0]);
  assert.equal(result.sourceSplatOmitted[1],0);
});
