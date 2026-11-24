const assert = require('node:assert/strict');
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const kit=ink.load(), {makeBuilder,makeSculpt,SpriteSurface}=kit;
const view={w:104,h:78,px:1,raw:true,passes:['objectId','depth','position']};
const front=[-.8660254,0,.5], across=[.5,0,.8660254];

function fixture({withStrip=true,splats=false,ortho=false}={}) {
  const A=SpriteSurface.make(64), B=makeBuilder(4,[0x1b2432,0xc58651,0x5fd69a,0x4b6b9b]);
  const panel=A.reserve(24,24,(x,y)=>x===12||y===12 ? 0xe8cf9b : 0xc58651);
  const backing=A.reserve(2,2,()=>0x4b6b9b), green=A.reserve(2,2,()=>0x50bf7c);
  A.faceRegion([-1.7,-1.5,-1.5],[3.4,0,0],[0,3,0],backing,{objectId:'wall'});
  A.faceRegion(across.map((n,i)=>-.72*n-(i===1?.68:0)),across.map(n=>1.44*n),[0,1.36,0],panel,
    {objectId:'dial'});
  if (withStrip) A.faceRegion([-.055,-.77,.62],[.11,0,0],[0,1.54,0],green,{objectId:'front rail'});
  if (splats) {
    const S=makeSculpt(B);
    S.keepRenderSdf=true;
    S.box([.29,-.27,.48],[.086,.25,.080],{r:[2],a:1.2},{objectId:'front hand',res:.058});
    S.box([-.50,.27,-.91],[.10,.18,.05],{r:[2],a:1.2},{objectId:'rear hand',res:.065});
    S.bake();
  }
  return B.finish({cam:{target:[0,0,0],dist:3.7,yaw:0,pitch:0,fov:.72,ortho,sway:0},
    radius:5,dither:0,spriteSurfaces:A.finish(),look:{splatCoverage:'continuous'}});
}

const fit={rules:[{id:'dial local',select:{object:'dial'},pivot:[0,0,0],facing:front,flatten:.9,strength:1,
  pins:[{id:'upper mount',point:[0,.58,0]},{id:'lower mount',point:[0,-.58,0]},
    {id:'contact',track:[{time:0,point:[0,-.2,0]},{time:1,point:[0,.2,0]}]}]}]};
const label=(frame,p)=>frame.passes.objects[frame.passes.objectId[p]];
function extent(frame,subject) {
  const pixels=Array.from(frame.passes.objectId.keys()).filter(p=>label(frame,p)===subject);
  const columns=pixels.map(p=>p%frame.w);
  return {pixels,span:Math.max(...columns)-Math.min(...columns)+1};
}

test('a planar atlas prop gets a local view with exact stationary and tracked pins',()=>{
  const world=fixture();
  const regular=ink.render(world,{...view,t:.27});
  const local=ink.render(world,{...view,t:.27,multiprojection:fit});
  const later=ink.render(world,{...view,t:.79,multiprojection:fit});
  const report=local.multiprojection.rules[0];
  assert.equal(report.status,'active');
  assert.equal(report.pins.length,3);
  assert(report.pins.every(pin=>pin.error<1e-8));
  assert(later.multiprojection.rules[0].pins.every(pin=>pin.error<1e-8));
  assert.notDeepEqual(report.pins[2].master,later.multiprojection.rules[0].pins[2].master);
  assert(extent(local,'dial').span>extent(regular,'dial').span*1.55);
  for (const p of extent(regular,'front rail').pixels) {
    assert.equal(label(local,p),'front rail');
    assert.equal(local.passes.depth[p],regular.passes.depth[p]);
  }
  for (const p of extent(local,'dial').pixels)
    assert(Math.abs(local.passes.depth[p]-(3.7-local.passes.position[3*p+2]))<.00001);
  assert.deepEqual(ink.render(world,{...view,multiprojection:false}).rgb,regular.rgb);
});

test('splat occlusion uses the same master depth as the projected prop',()=>{
  const world=fixture({withStrip:false,splats:true});
  for (const sdfAssist of [false,true]) {
    const regular=ink.render(world,{...view,sdfAssist});
    const local=ink.render(world,{...view,sdfAssist,multiprojection:fit});
    const foreground=extent(regular,'front hand').pixels;
    assert(foreground.length>9);
    assert(foreground.every(p=>label(local,p)==='front hand'));
    const newlyCovered=extent(regular,'rear hand').pixels.filter(p=>label(local,p)==='dial');
    assert(newlyCovered.length>4);
    assert(newlyCovered.every(p=>local.passes.depth[p]<regular.passes.depth[p]));
  }
});

test('orthographic projection preserves physical depth and reports impossible pins',()=>{
  const world=fixture({ortho:true});
  const plain=ink.render(world,view), local=ink.render(world,{...view,multiprojection:fit});
  assert(extent(local,'dial').span>extent(plain,'dial').span*1.65);
  assert(local.multiprojection.rules[0].pins.every(pin=>pin.error<1e-8));
  const invalid={rules:[{...fit.rules[0],pins:[{id:'behind',point:[0,0,60]}]}]};
  const result=ink.render(world,{...view,multiprojection:invalid});
  assert.equal(result.multiprojection.rules[0].status,'pin-outside-near-plane');
  assert.deepEqual(result.rgb,plain.rgb);
  assert.throws(()=>ink.render(world,{...view,multiprojection:{rules:[{...fit.rules[0],facing:[0,1,0]}]}}),
    /camera basis/);
});

test('motion passes reproject a dial sample through the previous local view',()=>{
  const world=fixture(), surfaceMotionHistory=ink.createSurfaceMotionHistory();
  const options={...view,passes:[...view.passes,'surfaceMotion'],multiprojection:fit,surfaceMotionHistory};
  const first=ink.render(world,{...options,t:0,yaw:0});
  const next=ink.render(world,{...options,t:1/12,yaw:.08,target:[.12,0,0]});
  const moved=extent(next,'dial').pixels.filter(p=>next.passes.surfaceMotionValid[p]);
  assert(moved.length>50);
  assert(moved.some(p=>Math.abs(next.passes.surfaceMotion[p*2])>.02));
  for (const p of moved) {
    const x=Math.floor(p%next.w+.5-next.passes.surfaceMotion[p*2]);
    const y=Math.floor(Math.floor(p/next.w)+.5-next.passes.surfaceMotion[p*2+1]);
    assert.equal(label(first,y*first.w+x),'dial');
  }
});

test('render and clip accept the authored multiprojection and the off override',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-multiprojection-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const root=path.resolve(__dirname,'..');
  function run(command,id,...extra) {
    const out=path.join(directory,id+'.png');
    execFileSync(process.execPath,['cli/ink-studio.js',command,'examples/multiprojection/signal-dial.js',
      '--w','80','--h','60','--px','1','--raw','--out',out,...extra],{cwd:root,stdio:'pipe'});
    return fs.readFileSync(out);
  }
  assert.notDeepEqual(run('render','render','--t','.7'),run('render','master','--t','.7','--multiprojection','off'));
  assert(run('clip','clip','--from','0','--to','.30','--fps','10').includes(Buffer.from('acTL')));
});
