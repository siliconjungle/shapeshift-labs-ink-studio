const assert = require('node:assert/strict');
const test = require('node:test');
const probes = require('../src/reflection-probes.js');
const { load, render } = require('..');
const { KIT: K, makeBuilder, makeSculpt } = load();

function target(size, colorAt) {
  const rgb = new Float32Array(size*size*3), coverage = new Float32Array(size*size);
  for (let y=0,p=0;y<size;y++) for (let x=0;x<size;x++,p++) {
    const color = colorAt(x,y);
    if (color) {
      coverage[p] = 1;
      rgb.set(color,p*3);
    }
  }
  return { w:size,h:size,rgb,coverage };
}

test('probe faces are captured once, preserve a sharp image and spread it along the chosen grain', () => {
  const site = probes.probe({ id:'room',at:[0,0,0],size:64 });
  const captures = [];
  const sample = probes.sampler([site],({size},face)=>{
    captures.push(face);
    return target(size,(x,y)=>face===4 && Math.abs(x-31.5)<2 && Math.abs(y-31.5)<2 ? [1,.45,.12] : null);
  });
  const read = (ray,roughness=[0,0],axis) => sample('room',site.at,ray,roughness,axis);
  assert.equal(read([0,0,1]).coverage,1);
  assert.equal(read([.27,0,1]),null);
  const horizontal = read([.27,0,1],[.67,.01],[1,0,0]);
  const across = horizontal.coverage;
  assert(across>0);
  assert(horizontal.rgb[0] > horizontal.rgb[1]);
  const vertical = read([.27,0,1],[.67,.01],[0,1,0]);
  assert(across > (vertical?.coverage ?? 0) * 1.5);
  assert(read([0,0,1],[.67,.67]).coverage<.5);
  assert.deepEqual(captures,[0,1,2,3,4,5]);
});

test('box projection corrects the sampled direction and fades probes at their bounds', () => {
  const site = probes.probe({ id:'room',at:[0,0,0],size:32,
    bounds:{min:[-2,-2,-2],max:[2,2,2],feather:.5} });
  const sample = probes.sampler([site],({size},face)=>target(size,x=>face===4 && x<12 ? [1,0,0] : null));
  assert.equal(sample('room',[0,0,0],[0,0,1],[0,0]),null);
  assert.equal(sample('room',[1,0,0],[0,0,1],[0,0]).coverage,1);
  assert(Math.abs(sample('room',[1.75,0,0],[0,0,1],[0,0]).coverage-.5)<1e-6);
  assert.equal(sample('room',[2.1,0,0],[0,0,1],[0,0]),null);
  assert.throws(()=>probes.prepare([site,site]),/Duplicate reflection probe/);
  assert.throws(()=>probes.probe({ ...site, at:[3,0,0] }),/enclose/);
});

test('cross-face interpolation keeps a continuous directional signal at cube seams', () => {
  const site = probes.probe({ id:'room',at:[.2,.3,.4],size:32 });
  const sample = probes.sampler([site],({size,at},face)=>{
    const m = probes.view(at,face);
    return target(size,(x,y)=>{
      const ray = [0,4,8].map(i=>-m[i+2]+m[i]*((x+.5)*2/size-1)+m[i+1]*((y+.5)*2/size-1));
      const length = Math.hypot(...ray);
      return ray.map(n=>.5+n/length*.5);
    });
  });
  for (const roughness of [0,.35,.7]) {
    const a = sample('room',site.at,[.9999,.23,1],[roughness,roughness]).rgb.slice();
    const b = sample('room',site.at,[1,.23,.9999],[roughness,roughness]).rgb;
    assert(a.every((value,i)=>Math.abs(value-b[i])<.016));
  }
});

function scene({ pixel, select = true } = {}) {
  const B=makeBuilder(51,[0x121622,0x234250,0x7b4837,0xff7925,0xffdd91]);
  const S=K.sculpt(makeSculpt(B));
  S.pixel=pixel;
  const base = K.reflection.localMaterial({r:[1],materialId:'tile'},'workroom',{f0:1,roughness:.06});
  S.box([0,-.04,.2],[1.25,.04,1.1],base,{res:.065});
  S.box([.05,.65,-.8],[.16,.37,.11],{r:[3,4],em:true},{res:.035,ghost:true,objectId:'light'});
  S.bake();
  return B.finish({
    cam:{target:[0,.05,0],dist:4.8,yaw:0,pitch:.56,sway:0},look:{ pixel },detail:18,radius:4,dither:0,
    reflectionProbes:[K.reflection.probe({id:'workroom',at:[0,.2,.2],size:64,
      bounds:{min:[-2,-.1,-.8],max:[2,2,2]},capture:select ? {include:[{object:'light'}]} : {include:[{object:'absent'}]} })]
  });
}

test('headless material layers sample the scene in both projections and export reflection pixels', () => {
  for (const pixel of [false,true]) {
    const world=scene({pixel}), options={w:94,h:76,px:1,ortho:!pixel,passes:['reflections'],renderStats:true};
    const on=render(world,options), off=render(world,{...options,reflectionProbes:false});
    assert.equal(on.renderStats.reflectionProbeFaces,6);
    assert.equal(off.renderStats.reflectionProbeFaces,0);
    const low=render(world,{...options,passQuality:{reflections:{primary:[],secondaryScale:.5}}});
    assert.equal(low.renderStats.reflectionProbePixels,6*32*32);
    assert(low.passes.reflections.some(value=>value>.25));
    const skipped=render(world,{...options,passQuality:{reflections:{primary:[],maxSecondary:0}}});
    assert.equal(skipped.renderStats.reflectionProbeFaces,0);
    assert.deepEqual(skipped.rgb,off.rgb);
    assert(on.passes.reflections.some(value=>value>.35));
    assert(!off.passes.reflections.some(Boolean));
    assert.notDeepEqual(on.rgb,off.rgb);
    assert.deepEqual(render(scene({pixel,select:false}),options).rgb,off.rgb);
    assert.equal(render(world,{...options,yaw:.4}).renderStats.reflectionProbeFaces,6);
    const source = world.renderMetadata.objects.indexOf('light');
    for (let i=0;i<world.count;i++) if (world.renderMetadata.objectIds[i]===source) world.data[i*16]+=.46;
    const moved=render(world,options);
    assert.notDeepEqual(moved.passes.reflections,on.passes.reflections);
    assert.equal(moved.renderStats.reflectionProbeFaces,6);
  }
});

test('JSON scenes validate and bind local reflection definitions', () => {
  const spec = {
    id:'glaze', finish:{ reflectionProbes:[{ id:'studio', at:[0,1,0], size:32 }] },
    solids:[{ kind:'ball', at:[0,0,0], r:.6, mat:{ role:'pale', surface:{ layers:{
      mirror:{ type:'localReflection', probe:'studio', roughness:[.2,.5] }
    } } } }]
  };
  assert.equal(K.diorama.build(spec).reflectionProbes[0].id,'studio');
  spec.finish.reflectionProbes[0].size=100;
  assert(K.diorama.check(spec).some(issue=>issue.path==='finish.reflectionProbes' && issue.level==='error'));
});
