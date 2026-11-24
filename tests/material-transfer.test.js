'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { KIT } = ink.load();

const recipe = { format:'ink-studio/material-response', version:1, materials:{
  mud:{ pickup:{ amount:.8 } },
  tile:{ chart:{ bounds:[-2,-1,3,1], reach:.10 }, resolution:[100,40],
    transfer:{ from:'mud', fraction:.5, size:[.45,.62], duration:4,
      bands:[{at:.026,color:'#dd9771'},{at:.1,color:'#bb6757'},
        {at:.19,color:'#933c49'},{at:.37,color:'#661a40'}] } }
} };
const step = (id, material, time, carrier = 'walker/left', extra = {}) =>
  ({ id, interaction:'step', material, time, carrier, point:[0,0,0], speed:0, load:10, ...extra });
const close = (given, expected) => assert(Math.abs(given - expected) < 1e-12, given + ' versus ' + expected);
const pass = 'material-response-surface/tile';

test('pickup loads individual shoes, contacts conserve carried mud, and only valid receivers consume it', () => {
  const contacts = [
    step('clean-shoe','tile',.10,'walker/right'),step('load-a','mud',.20,undefined,{load:5}),
    step('load-b','mud',.30),step('outside-reach','tile',.4,undefined,{point:[0,.6,0]}),
    step('outside-chart','tile',.45,undefined,{point:[3,0,0]}),step('wheel','tile',.5,undefined,{interaction:'roll'}),
    step('first-print','tile',.6),step('second-print','tile',.8),step('third-print','tile',1),
    step('clean-again','tile',1.1,'walker/right'),step('no-load','tile',1.2,undefined,{load:0}),
    step('pick-up-again','mud',1.3,undefined,{load:5}),step('light-step','tile',1.4,undefined,{load:5})
  ];
  const track = KIT.materialResponse.create(recipe,{contacts});
  const events = track.transfers();
  assert.deepEqual(events.map(event=>event.contact),[
    'load-a','load-b','first-print','second-print','third-print','pick-up-again','light-step'
  ]);
  assert.deepEqual(events.slice(2,5).map(event=>event.amount),[.5,.25,.125]);
  assert(events.slice(2,5).every(event=>event.pickup==='load-b'));
  assert.equal(events.at(-1).pickup,'pick-up-again');
  close(events.at(-1).amount,.13125);
  for (const row of events) {
    close(row.action === 'pickup' ? row.before+row.amount : row.before-row.amount,row.after);
    assert.equal(row.carrier,'walker/left');
  }
  assert.deepEqual(track.transfers(.59).map(event=>event.contact),['load-a','load-b']);
  assert.equal(track.add(contacts),0);
  events[0].after = 999;
  assert.equal(track.transfers()[0].after,.4);
  assert.throws(()=>KIT.materialResponse.create({ ...recipe,materials:{tile:recipe.materials.tile} }),/source material with pickup/);
});

test('late contacts rebuild the ledger and chart with stable timing and snapshot round-trips', () => {
  const contacts = [step('a-pickup','mud',.5),step('b-first','tile',.5),step('later','tile',1.2,undefined,{point:[1,0,0]})];
  const track = KIT.materialResponse.create(recipe,{contacts:contacts.slice(1)});
  assert.deepEqual(track.transfers(1.5),[]);
  assert.equal(track.effectPass(pass).inspect(1.5,[37,19])[0].sample.value,0);
  assert.throws(()=>track.add([contacts[0],step('bad','tile',.7,'')]),/timestamp/);
  assert.deepEqual(track.transfers(),[]);
  track.add([contacts[0]]);
  assert.deepEqual(track.transfers().map(row=>row.contact),['a-pickup','b-first','later']);
  const current = track.effectPass(pass).inspect(1.5,[37,19])[0];
  assert.equal(current.kind,'transfer');
  assert.equal(current.sample.event.id,'b-first');
  assert.equal(current.sample.transfer.pickup,'a-pickup');
  assert(current.sample.value > .30);
  assert.equal(track.effectPass(pass).inspect(.49,[37,19])[0].sample.value,0);
  assert.deepEqual(track.effectPass(pass).inspect(1.5,[37,19])[0],current);
  assert.equal(track.effectPass(pass).inspect(5.1,[37,19])[0].sample.value,0);
  const portable = JSON.parse(JSON.stringify(track.snapshot()));
  assert.deepEqual(KIT.materialResponse.create(portable.recipe,{contacts:portable.contacts}).transfers(),track.transfers());
  const fallback = contacts.map(hit=>{
    const { carrier, ...row } = hit;
    return { ...row, entity:'walker', source:hit.id==='later'?'another-run':'walker-run' };
  });
  assert.deepEqual(KIT.materialResponse.create(recipe,{contacts:fallback}).transfers().map(row=>row.contact),['a-pickup','b-first']);
});

test('masked field stamps orient treads on the native grid and trace the same cell values', () => {
  const common = { at:[2,2], shape:'mask', mask:{width:2,height:2,data:[1,0,0,0]},size:[2,2],values:{mud:.75},source:'sole' };
  const field = direction=>KIT.splatEffects.field({width:4,height:4,cell:1,channels:{mud:{}},stamps:[{...common,direction}]});
  const alongX = field([1,0]).frame(0), alongY = field([0,1]).frame(0);
  assert.deepEqual(alongX.data('mud').findIndex(value=>value),6);
  assert.deepEqual(alongY.data('mud').findIndex(value=>value),10);
  assert.deepEqual(alongY.traceCell('mud',2,2),{ value:.75, uv:[2.5,2.5], contributors:1, source:'sole' });
  assert.equal(alongX.traceCell('mud',2,2).value,0);
  assert.throws(()=>field([0,0]),/Mask stamps/);
});

function sceneFixture({ KIT, makeBuilder, makeSculpt }, recipe) {
  const B = makeBuilder(21,[0x554a3e,0xc8c5ad,0x426867]), S=makeSculpt(B);
  S.box([-1.6,-.11,0],[.55,.11,.8],{r:[0],materialId:'mud'},{res:.065});
  S.box([.62,-.11,0],[1.63,.11,.8],{r:[1],materialId:'tile'},{res:.055});
  S.box([.75,.085,-.15],[.12,.08,.12],{r:[2],materialId:'blocker'},{res:.037});
  S.bake();
  const world = B.finish({ cam:{target:[0,.02,0],dist:6.6,yaw:0,pitch:1.16,projection:'orthographic'},
    dither:0,radius:3,amb:1 });
  const contacts = [
    ['mud','mud',.2,-1.60],['a','tile',.5,-.60],['b','tile',.8,.01],['c','tile',1.1,.75],['d','tile',1.4,1.48]
  ].map(([id,material,time,x])=>({ id,material,time,point:[x,0,0],speed:2,interaction:'step',carrier:'left' }));
  KIT.materialResponse.create(recipe,{contacts}).bind(world);
  return world;
}
const size = { w:144, h:82 };
function footprintPixels(rgb) {
  const colors = new Set(recipe.materials.tile.transfer.bands.map(({color})=>parseInt(color.slice(1),16)));
  const marked = [];
  for (let i = 0; i < rgb.length; i+=3) {
    const color = rgb[i]*65536 + rgb[i+1]*256 + rgb[i+2];
    if (colors.has(color)) marked.push([i/3,color]);
  }
  return marked;
}
const make = () => sceneFixture(ink.load(),recipe);
const render = (world,t) => ink.render(world,{...size,px:1,t,raw:true}).rgb;

test('headless composites tread prints on tile, keeps early frames clean, and reports a source contact', () => {
  const world = make(), after = footprintPixels(render(world,1.6));
  assert.equal(footprintPixels(render(world,.4)).length,0);
  assert(after.length > 100);
  assert(new Set(after.map(([,color])=>color)).size >= 4);
  const xMin = Math.min(...after.map(([i])=>i%size.w)), xMax = Math.max(...after.map(([i])=>i%size.w));
  assert(xMax-xMin > 35);
  assert.deepEqual(footprintPixels(render(world,1.6)),after);
  const [pixel] = after.find(([,color])=>color===0x661a40);
  const report = ink.inspectEffectPixel(world,{...size,t:1.6,px:1,raw:true,at:[pixel%size.w,Math.floor(pixel/size.w)]});
  assert.equal(report.receiver.material,'tile');
  assert.equal(report.winner.kind,'transfer');
  assert.equal(report.winner.event.id,'a');
  assert.equal(report.winner.sample.transfer.pickup,'mud');
  assert(report.winner.matchesOutput);
});

test('WebGL projects the same transfer swatches and reproduces a frame after a rewind',
  {skip:!process.env.INK_TEST_CHROME}, () => {
    const after = footprintPixels(render(make(),1.6)), [pixel] = after.find(([,color])=>color===0x661a40);
    const at=[pixel%size.w,Math.floor(pixel/size.w)];
    const result = runWebGL({},sceneFixture,(kit,build,backend,{recipe,size,at})=>{
      const world=build(kit,recipe), draw=backend(size.w,size.h,{raw:true,offscreen:true});
      try {
        const render=time=>{draw.draw(world,{time});return draw.image();};
        const after=render(1.6), before=render(.4), seek=render(1.6);
        const report=draw.draw(world,{time:1.6,effectPixel:at}).effectPixel;
        return {after,before,seek,report};
      }finally{draw.close();}
    },{recipe,size,at});
    assert.equal(footprintPixels(Buffer.from(result.before,'base64')).length,0);
    assert.equal(result.after,result.seek);
    const gpu=footprintPixels(Buffer.from(result.after,'base64'));
    const cpu=new Map(after);
    assert(gpu.length>100);
    assert(gpu.filter(([i,color])=>cpu.get(i)===color).length > after.length*.90);
    assert.equal(result.report.winner?.sample.transfer.pickup,'mud');
    assert(result.report.winner.matchesOutput);
});

test('CLI opens the portable scene and exports a time-bounded pickup/deposit ledger', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mudroom-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scene=path.join(dir,'mudroom.json'), report=path.join(dir,'transfers.json');
  fs.writeFileSync(scene,JSON.stringify(require('../examples/material-transfer/scene.cjs')()));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'effect','transfers',scene,'--t','1','--out',report],{stdio:['ignore','pipe','pipe']});
  const {events}=JSON.parse(fs.readFileSync(report,'utf8'));
  assert.deepEqual(events.map(row=>[row.carrier,row.action]),[['left','pickup'],['right','pickup'],['left','deposit']]);
  close(events.at(-1).after,.46);
});
