'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { setTimeout: pause } = require('node:timers/promises');
const ink = require('..');
const { withChrome } = require('../cli/canvas-grid-chrome.js');
const { KIT:K,makeBuilder } = ink.load();

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-flow-map-'));
  t.after(() => fs.rmSync(dir,{ recursive:true,force:true }));
  return dir;
}
function cli(...args) {
  return execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'flow-map',...args],
    { encoding:'utf8',stdio:['ignore','pipe','pipe'] });
}
function uniform(velocity) {
  const map = K.flowMap.create({ width:12,height:8 });
  const speed = Math.hypot(...velocity);
  if (speed) map.stroke({ points:[[0,0]],radius:4,speed,direction:velocity,hardness:1 });
  return K.flowMap.open(JSON.parse(JSON.stringify(map.asset())));
}

test('continuous strokes carry signed direction, speed and a portable editable history', () => {
  const map = K.flowMap.create({ width:4,height:3,bounds:[0,0,4,3] });
  const path = [[.5,1.5],[3.5,1.5]];
  assert.deepEqual(map.stroke({ points:path,speed:2,radius:.4 }),{ changed:4,revision:1 });
  assert.deepEqual(map.cell(0,1),[2,0]);
  assert.deepEqual(map.sample(2,1),[1,0]);
  assert.deepEqual(map.sample(4,1.5),[2,0]);
  assert.equal(map.sample(4.001,1.5),null);
  map.stroke({ points:path.slice().reverse(),speed:3,radius:.4 });
  assert.deepEqual(map.inspect(.5,1.5),{
    at:[.5,1.5],velocity:[-3,0],speed:3,direction:180,cell:[0,1],center:[.5,1.5],cellVelocity:[-3,0]
  });
  map.stroke({ points:path,mode:'speed',speed:1,radius:.4 });
  assert.deepEqual(map.cell(1,1),[-1,0]);
  const beforeErase = map.asset();
  map.stroke({ points:[[1.5,1.5]],mode:'erase',opacity:.5,radius:.4 });
  assert.deepEqual(map.cell(1,1),[-.5,0]);
  assert.equal(map.undo(),true);
  assert.deepEqual(map.asset(),beforeErase);
  assert.equal(map.redo(),true);
  assert.deepEqual(map.cell(1,1),[-.5,0]);
  const asset = JSON.parse(JSON.stringify(map.asset())), restored = K.flowMap.open(asset);
  asset.vectors.fill(0);
  assert.deepEqual(restored.cell(1,1),[-.5,0]);
  assert.equal(restored.history().undo,0);
  assert.throws(() => map.stroke({ points:[[NaN,0]],radius:1 }),/bounded/);
  assert.deepEqual(map.cell(1,1),[-.5,0]);
  assert.throws(() => K.flowMap.open({ ...map.asset(), vectors:[1] }),/velocity pair/);
});

test('the same exported velocity field drives water, smoke, cloth and debris', () => {
  const map = uniform([1.2,-.8]), calm = uniform([0,0]);
  const projected = map.world({ origin:[0,2,4],u:[0,0,1],v:[0,1,0],scale:2,outside:'none' });
  const velocities = projected(10,2,4);
  assert(Math.abs(velocities[1]+1.6) < 1e-12 && Math.abs(velocities[2]-2.4) < 1e-12);
  assert.equal(projected(10,2,12),null);
  assert.deepEqual(map.world()(10,0,0),[0,0,0]);

  const water = K.procedural.motion.shallowWater({ width:12,height:8,cell:.5,origin:[-3,-2],initial:() => .36 });
  const state = water.step(.2,{ flow:map.planar(),flowDrag:5 }), flow = state.sample(0,0).velocity;
  assert(flow[0] > .5 && flow[1] < -.3);
  assert(Math.abs(state.mass.error) < 1e-10);

  const rasters = K.procedural.rasterSimulation;
  function puff(asset) {
    const spec = rasters.define('smoke',{
      width:20,height:12,flowMap:asset,flowScale:9,flowDrag:8,buoyancy:0,
      emitters:[{ at:[4,5],radius:1.65,density:4,velocity:[0,0] }]
    });
    const frame = rasters.session(JSON.parse(JSON.stringify(spec))).seek(.75);
    const { data,width } = frame.field;
    return data.reduce((sum,v,i) => sum+v*(i%width+.5),0)/data.reduce((sum,v) => sum+v,0);
  }
  assert(puff(map.asset()) > puff(calm.asset()) + .65);

  // Two linked corners with the same face and point wind path used by cloth.
  const fabric = K.xpbd.sim({ wind:map.world({ scale:3 }),gravity:[0,0,0],damp:0 });
  const a = fabric.point([0,0,0],0), b = fabric.point([0,1,0],1), c = fabric.point([0,0,1],1);
  fabric.link(a,b,.001); fabric.link(a,c,.001); fabric.link(b,c,.001);
  fabric.face(a,b,c,1); fabric.drag(b,2); fabric.drag(c,2);
  for (let tick=1; tick<=6; tick++) fabric.step(1/30,tick/30);
  assert(fabric.X[3] > .07, 'the loose cloth corner should move toward +X');

  const B = makeBuilder(2,[0x18242a,0xe4c786]);
  B.iso(0,2,0,.1,B.P[1],1); B.iso(7,2,0,.1,B.P[1],1);
  const debris = K.debris(K.stage(B.finish({})),{ wind:map.world({ outside:'none' }),windDrag:4,gravity:0 });
  const inside = debris.spawn([0]), outside = debris.spawn([1]);
  debris.update(.03,.03);
  assert(inside.c[0] > 0 && inside.c[2] < 0);
  assert.deepEqual(outside.c,[7,2,0]);
});

test('the CLI paints and inspects a revision without replacing the original asset', t => {
  const dir = workspace(t), map = path.join(dir,'calm.json'), strokes = path.join(dir,'brush.json');
  const painted = path.join(dir,'painted.json');
  cli('new','--size','4,4','--bounds','-2,-2,2,2','--out',map);
  fs.writeFileSync(strokes,JSON.stringify({ points:[[.5,.5]],radius:.6,speed:4,direction:[0,-1] }));
  cli('paint',map,strokes,'--out',painted);
  const result = JSON.parse(cli('inspect',painted,'--at','.5,.5'));
  assert.deepEqual(result.sample.velocity,[0,-4]);
  assert.deepEqual(result.sample.cell,[2,2]);
  assert.equal(result.sample.direction,-90);
  assert.equal(JSON.parse(cli('inspect',map,'--at','.5,.5')).sample.speed,0);
  assert.throws(() => cli('paint',map,strokes,'--out',map),/separate file/);
});

test('offline editor paints, probes, plays the shared solvers and round-trips JSON',
  { skip:!process.env.INK_TEST_CHROME },async t => {
    const dir = workspace(t), file = path.join(dir,'editor.html'), exported = path.join(dir,'ink-flow-map.json');
    cli('editor','--out',file);
    await withChrome(dir,{ hardware:true },async ({ send,evaluate }) => {
      async function until(read) {
        for (let i=0; i<160; i++) {
          if (await read()) return;
          await pause(30);
        }
        throw new Error('The offline flow editor did not reach the expected state');
      }
      await send('Emulation.setDeviceMetricsOverride',{ width:1280,height:1080,deviceScaleFactor:1,mobile:false });
      await send('Emulation.setEmulatedMedia',{ features:[{ name:'prefers-reduced-motion',value:'reduce' }] });
      await send('Page.navigate',{ url:pathToFileURL(file).href });
      await until(() => evaluate('document.querySelector("#grid")?.textContent.includes("48 × 32")'));
      assert.equal(await evaluate('document.querySelectorAll("[data-simulation]").length'),4);
      const state = () => evaluate(`Array.from(document.querySelectorAll('[data-simulation]'),canvas =>
        canvas.toDataURL())`);
      const before = await state();
      await evaluate('document.querySelector("#toggle").click()');
      await until(() => evaluate('parseFloat(document.querySelector("#time").value) >= .30'));
      await evaluate('document.querySelector("#toggle").click()');
      const after = await state();
      assert(after.every((image,i) => image !== before[i]));

      await evaluate(`(() => {
        const q = id => document.getElementById(id);
        q('new').click(); q('heading').value = 'fixed'; q('heading').dispatchEvent(new Event('change'));
        q('speed').value = 4; q('angle').value = -90; q('radius').value = .6;
      })()`);
      const [x,y] = await evaluate(`(() => {
        const r = document.querySelector('#chart').getBoundingClientRect();
        return [r.left+r.width/2,r.top+r.height/2];
      })()`);
      await send('Input.dispatchMouseEvent',{ type:'mousePressed',x,y,button:'left',clickCount:1 });
      await send('Input.dispatchMouseEvent',{ type:'mouseReleased',x,y,button:'left',clickCount:1 });
      assert.match(await evaluate('document.querySelector("#notice").textContent'),/cells updated/);
      assert.equal(await evaluate('document.querySelector("#magnitude").textContent'),'4 units/s');
      await evaluate('document.querySelector("#undo").click()');
      assert.equal(await evaluate('document.querySelector("#magnitude").textContent'),'0 units/s');
      await evaluate('document.querySelector("#redo").click()');
      await send('Page.setDownloadBehavior',{ behavior:'allow',downloadPath:dir });
      await evaluate('document.querySelector("#export").click()');
      await until(() => fs.existsSync(exported));
      const map = K.flowMap.open(JSON.parse(fs.readFileSync(exported,'utf8')));
      assert(Math.abs(map.inspect(0,0).velocity[1]+4) < 1e-9);
      await evaluate('document.querySelector("#new").click()');
      await send('DOM.enable');
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector',{ nodeId:root.nodeId,selector:'#open' });
      await send('DOM.setFileInputFiles',{ nodeId,files:[exported] });
      await until(() => evaluate('document.querySelector("#magnitude").textContent === "4 units/s"'));
    });
  });
