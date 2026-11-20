const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const api = ink.load(), { KIT: K, ArtDirection, makeBuilder } = api;
const cam = { target:[0,0,0], dist:6, pitch:0, yaw:0, sway:0 };
const pal = [0x183045,0xd0dbdf,0xffbe73];
const view = { w:75,h:55,px:1,raw:true };
const same = (a,b) => Buffer.from(a.rgb).equals(Buffer.from(b.rgb));

test('new motion clocks inherit the original paths and can explicitly run continuously', () => {
  const direction = ArtDirection.prepare({ cadence:{ scene:4, environment:2, foliage:12, cloth:8, water:0, emissive:6 } });
  const clocks = ArtDirection.motion(direction,.22,.47);
  assert.deepEqual(clocks, {scene:0,environment:0,foliage:2/12,cloth:1/8,rain:0,falling:0,water:.22,emissive:1/6});
  const rain = ArtDirection.prepare({ cadence:{rain:8} });
  assert.equal(ArtDirection.motion(rain,.22,.47).rain,3/8);
  assert.equal(ArtDirection.motion(rain,.22,.47).falling,3/8);
  assert.throws(() => ArtDirection.prepare({ cadence:{cloth:-2} }), /Cloth cadence/);
  assert.throws(() => ArtDirection.prepare({ windResponse:{water:1.1} }), /Water wind/);
});

function fixture({ KIT:K, makeBuilder }, effect) {
  const B = makeBuilder(11, [0x183045,0xd0dbdf,0xffbe73]);
  const palette = B.P;
  if (effect === 'foliage' || effect === 'cloth') {
    const bend = K.procedural.airflow.pinned({ channel:effect, reach:1.7, frequency:5 });
    for (let i=0;i<9;i++) B.disc(0,-.5+i*.14,0,[0,0,1],.14,.02,palette[1],3,bend(i/8));
  } else if (effect === 'rain') {
    B.stick(0,1.7,0,[.1,-.99,0],.26,.065,palette[1],1,{k:2,sp:4,rg:3.3,ph:.08,nd:true});
    B.describePrecipitation(0,1);
  } else if (effect === 'water') {
    B.disc(0,0,0,[0,0,1],.43,.03,palette[1],3,{k:4,sp:5,ph:.4});
  } else B.disc(0,0,0,[0,0,1],.47,.03,palette[2],2,{k:7,sp:6,ph:.4,em:true,nd:true});
  const cam = { target:[0,0,0], dist:6, pitch:0, yaw:0, sway:0 };
  return B.finish({ cam, dither:0, windField:{velocity:[1.8,.3],gust:{amplitude:.7,period:1.2}} });
}

test('each renderer effect holds on its own ticks while two samples of the combined gust remain distinct', () => {
  for (const effect of ['foliage','cloth','rain','water','emissive']) {
    const world = fixture(api,effect), settings = { ...view, artDirection:{ cadence:{[effect]:4},
      windResponse:{water:.25,emissive:.23} } };
    const first = ink.render(world,{...settings,t:.01}), held = ink.render(world,{...settings,t:.22});
    assert(same(first,held), effect + ' changed within a hold');
    assert(!same(first,ink.render(world,{...settings,t:.26})),effect + ' never changed on the next tick');
    assert(!same(first,ink.render(world,{...settings,t:.22,artDirection:false})),effect + ' continuous playback did not change');
  }
  for (const effect of ['foliage','cloth','rain','emissive']) {
    const world = fixture(api,effect), t=.26, options = { ...view,t,artDirection:{cadence:{[effect]:4},windResponse:{emissive:.3}} };
    const a = ink.render(world,options), b = ink.render(world,{...options,windField:{gust:false}});
    assert(!same(a,b),effect + ' did not respond to the gust');
  }
});

test('water finish normals use their own clock and local wind strength', () => {
  const material = K.surface.prepare({ normal:{ cadence:'water',type:'waves',amplitude:.4,scale:.5,speed:3 },
    layers:{ sky:{type:'reflection',strength:1,f0:1,sky:'#c0e9ff',ground:'#0c192e',horizon:'#777875'} } },pal);
  const sample = { position:[.37,0,.12], normal:[0,1,0],view:[.3,.3,.9],time:.1,waterTime:.2 };
  const draw = extra => K.surface.shade(material,{...sample,...extra},[.3,.4,.6]);
  assert.deepEqual(draw({}),draw({time:.4}));
  assert.notDeepEqual(draw({}),draw({waterTime:.4}));
  assert.notDeepEqual(draw({}),draw({waterWind:()=>.6}));
});

test('holding XPBD cloth dabs leaves the live solve and shared wind advancing', () => {
  function build(rate) {
    const b=makeBuilder(5,pal);
    const cloth=K.cloth(b,{nu:5,nv:5,dabs:1,at:[-.8,1.3,0],u:[1.8,0,0],v:[0,-1.2,0],wind:'scene',
      substeps:2,pattern:()=>[1,2]});
    const world=b.finish({cam,windField:{velocity:[.1,2],gust:{amplitude:.55,period:1}},
      look:{artDirection:{cadence:{cloth:rate}}}});
    const stage=K.stage(world);
    stage.add(cloth);
    stage.update(0,0);
    return {world,cloth,stage};
  }
  const held=build(4), continuous=build(0);
  assert.notDeepEqual(held.cloth.sim.wind(0,0,0,0),held.cloth.sim.wind(0,0,0,.25));
  const rows=held.world.data.slice();
  for(let i=1;i<=12;i++) for(const {stage} of [held,continuous]) stage.update(1/60,i/60);
  assert.deepEqual(held.cloth.sim.X,continuous.cloth.sim.X);
  assert.deepEqual(held.world.data,rows);
  assert.notDeepEqual(continuous.world.data,rows);
  for(let i=13;i<=15;i++) {
    held.stage.update(1/60,i/60);
    continuous.stage.update(1/60,i/60);
  }
  assert.deepEqual(held.world.data,continuous.world.data);
});

test('the CLI can hold scene updates while its standalone cloth presents faster', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-motion-rates-'));
  try {
    const scene=path.join(dir,'test.js');
    fs.writeFileSync(scene,`module.exports = ({ KIT:K, makeBuilder }) => ({ id:'dual', seed:1, build() {
      const b=makeBuilder(1,[0x172737,0xd0b47a]);
      const panel=K.cloth(b,{nu:5,nv:5,at:[-.8,.6,0],u:[1.6,0,0],v:[0,-1.2,0],pinAt:(_i,_j,p,t)=>[p[0]+2.5*t,p[1],p[2]],pattern:()=>[1]});
      const w=b.finish({cam:${JSON.stringify(cam)},look:{artDirection:{cadence:{scene:2,cloth:8}}}});
      K.stage(w).add(panel); return w;
    }});`);
    const cli=path.resolve(__dirname,'../cli/ink-studio.js');
    function frame(t) {
      const out=path.join(dir,`${t}.png`);
      execFileSync(process.execPath,[cli,'render',scene,'--t',String(t),'--w','64','--h','48','--px','1','--raw','--out',out]);
      return fs.readFileSync(out);
    }
    assert.deepEqual(frame(0),frame(.10));
    assert.notDeepEqual(frame(0),frame(.33));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('WebGL holds native splats through independently held effect ticks', {
  skip:!process.env.INK_TEST_CHROME
}, () => {
  const result = runWebGL({},fixture,(kit, fixture, backend) => {
    const result={};
    for(const effect of ['foliage','cloth','rain','water','emissive']) {
      const world=fixture(kit,effect), gpu=backend(75,55,{raw:true,stepAnimation:false});
      const settings={artDirection:{cadence:{[effect]:4}}};
      gpu.draw(world,{...settings,time:.01}); const first=gpu.image();
      gpu.draw(world,{...settings,time:.22}); const held=gpu.image();
      gpu.draw(world,{...settings,time:.26}); const next=gpu.image();
      result[effect]=[first===held,first!==next];
      gpu.close();
    }
    return result;
  });
  for (const effect of ['foliage','cloth','rain','water','emissive']) assert.deepEqual(result[effect],[true,true],effect);
});
