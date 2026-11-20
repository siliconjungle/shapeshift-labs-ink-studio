const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl');
const kit = studio.load(), K = kit.KIT, F = K.fieldViews;
const bounds = { min:[-2,-2,-2],max:[2,2,2] };
const scalar = sample => F.source({ bounds,sample,type:'number',units:'K' });
const vector = sample => F.source({ bounds,sample,type:'vec3',units:'world/s' });

test('scalar slices use world-space cell centers and mask missing samples', () => {
  const heat = scalar((x,y,z) => z > 0 ? null : x+2*y+3*z);
  const result = F.slice(heat,{ plane:{axis:'y',at:.5},counts:[2,2] });
  assert.deepEqual(result.values,[-3,-1,null,null]);
  assert.deepEqual(result.range,[-3,-1]);
  assert.deepEqual(result.frame.normal,[0,-1,0]);
  assert.equal(result.units,'K');
  assert.equal(heat.sample(3,0,0),null);
  assert(Object.isFrozen(result.values));

  const oblique = F.slice(scalar((x,y) => y),{ counts:[2,2],plane:{
    origin:[-1,-1,0],u:[2,0,0],v:[0,1,1],size:[2,Math.SQRT2]
  } });
  assert(oblique.values.every((n,i)=>Math.abs(n-[-.75,-.75,-.25,-.25][i])<1e-12));
  assert.throws(()=>F.slice(heat,{counts:[1000,1000]}),/sample budget/);
  assert.throws(()=>F.slice(heat,{plane:{origin:[0,0,0],u:[0,0,0],v:[0,0,1],size:[2,2]}}),/nonzero/);
});

test('multiple contour levels reuse their field samples and preserve open boundaries', () => {
  let reads = 0;
  const rings = scalar((x,y,z) => { reads++; return x*x+z*z; });
  const levels = F.contours(rings,{plane:{axis:'y',at:.7},levels:[.25,1],cell:.1});
  assert.equal(reads,41*41);
  assert.deepEqual(levels.paths.map(p=>[p.level,p.closed]),[[.25,true],[1,true]]);
  assert(levels.paths.every(row => row.points.every(([x,y,z])=>y===.7 && Math.abs(x*x+z*z-row.level)<.004)));
  const mask = scalar((x,y,z)=>x<0 ? null : x*x+z*z);
  const arcs = F.contours(mask,{levels:[.58],cell:.1});
  assert.equal(arcs.paths.length,1);
  assert.equal(arcs.paths[0].closed,false);
  assert(arcs.paths[0].points.every(([x])=>x>=0));
});

test('isosurfaces are native meshes with outward normals and no surfaces across missing cells', () => {
  const sphere = F.isosurface(scalar((x,y,z)=>1-Math.hypot(x,y,z)),{resolution:.18,edgeRefinements:10});
  const { positions,normals,bounds:meshBounds,sampling } = sphere.mesh;
  assert(positions.length > 500);
  assert(sampling.cells <= 64000);
  assert(meshBounds.max.every(v=>v>.98 && v<1.01));
  let alignment=0;
  for(let i=0;i<positions.length;i+=3) {
    const p=positions.slice(i,i+3), n=normals.slice(i,i+3);
    assert(Math.abs(Math.hypot(...p)-1)<.009);
    const outward=K.V.dot(p,n);
    assert(outward>0);
    alignment+=outward;
  }
  assert(alignment/(positions.length/3)>.98);
  const half = F.isosurface(scalar((x,y,z)=>x<0 ? null : 1-Math.hypot(x,y,z)),{resolution:.14});
  assert(half.mesh.bounds.min[0] >= 0 && half.mesh.bounds.max[0] > .95);
  const blank = F.isosurface(scalar(()=>null),{resolution:.3});
  assert.equal(blank.mesh.positions.length,0);
  assert.throws(()=>F.isosurface(scalar(x=>x),{maxTriangles:1}),/triangle budget/);
  assert.throws(()=>K.procedural.geometry.implicitSurface(()=>null,bounds),/finite values/);
});

test('streamlines follow masked, bounded vectors and glyphs retain direction and magnitude', () => {
  const wind = vector((x)=>x>.8 ? null : [2,0,0]);
  const travel = F.streamlines(wind,{seeds:[[0,0,0],[1,0,0]],direction:'both',step:.2});
  const [line,missing] = travel.paths;
  assert(line.points.some(p=>p[0]<-1.9) && line.points.some(p=>p[0]>.76));
  assert(line.points.every(([x,y,z])=>x>=-2 && x<=.8 && y===0 && z===0));
  assert.deepEqual(travel.range,[2,2]);
  assert.equal(missing.status,'missing');
  let reads=0;
  const counted = vector(()=>{ reads++;return [1,0,0]; });
  const limited = F.streamlines(counted,{seeds:[[0,0,0],[.5,0,0]],step:.2,maxChecks:3});
  assert.equal(reads,3);
  assert.equal(limited.samples,3);
  assert.deepEqual(limited.paths.map(p=>p.status),['budget','budget']);

  const flat = F.source({bounds,type:'vec2',components:'xy',sample:(x)=>x < 0 ? [0,0] : [3,4],units:'m/s'});
  assert.equal(F.magnitude(flat).sample(1,0,0),5);
  const { arrows,range } = F.glyphs(flat,{points:[[0,0,0],[-1,0,0],[1,0,0]],scale:.4,maxLength:1});
  assert.deepEqual(range,[5,5]);
  assert.deepEqual(arrows[0].vector,[3,4,0]);
  assert(Math.abs(arrows[0].to[0]-.6)<1e-9 && Math.abs(arrows[0].to[1]-.8)<1e-9);
  assert.equal(arrows.length,2);
});

function manifest() {
  const bounds = {min:[-1,-1,-1],max:[1,1,1]};
  return {
    format:'ink-studio/world',id:'field-scene',dt:.5,systems:{sensors:{kind:'fields',config:{fields:{
      heat:{type:'number',units:'K',bounds,grid:{counts:[2,2,2],values:[0,2,0,2,0,2,0,2]}},
      current:{type:'vec2',units:'world/s',components:'xz',axes:'xz',bounds:{min:[-1,-1],max:[1,1]},default:[.7,.3]}
    }}}},
    visual:{bounds:{min:[-3,-2,-3],max:[3,2,3]},ground:-1.8,
      camera:{target:[0,0,0],dist:5,yaw:.2,pitch:1.1,projection:'orthographic'},
      fieldViews:[
        {id:'heat-map',kind:'slice',field:'sensors/heat',options:{counts:[20,20]},style:{domain:[0,5]}},
        {id:'one-degree',kind:'contours',field:'sensors/heat',options:{levels:[1],plane:{axis:'y',at:.02}}},
        {id:'heat-shell',kind:'isosurface',field:'sensors/heat',options:{level:1.5,resolution:.25}},
        {id:'wind-line',kind:'streamlines',field:'sensors/current',options:{seeds:[[0,.1,0]],maxLength:.8}},
        {id:'wind-glyphs',kind:'glyphs',field:'sensors/current',options:{plane:{axis:'y',at:.12},counts:[7,7]}}
      ] }
  };
}

test('world renders bind all field view kinds to the current query, with targets and a shared splat budget', () => {
  const run=K.world.runtime.create(manifest());
  const old=run.query();
  const initial=K.world.visual(kit,run.view(),old);
  assert.deepEqual(initial.fieldViews.map(view=>view.kind),['slice','contours','isosurface','streamlines','glyphs']);
  assert(initial.fieldViews.every(view=>view.count>0));
  assert.equal(initial.fieldViews[0].count,400);
  assert(initial.fieldViews[0].range[1]<2);
  assert(initial.renderMetadata.targets.some(row=>row?.surface==='fieldView/heat-map'));
  const b=kit.makeBuilder(3);
  assert.throws(()=>F.stampQuery(b,old,manifest().visual.fieldViews.slice(0,2),{maxSplats:405}),/splat budget/);
  assert.equal(b.count(),0);

  run.schedule([{tick:1,action:'sensors/set',args:{field:'heat',
    region:{bounds:{min:[-1,-1,-1],max:[0,1,1]},value:5}}}]);
  run.advance(1);
  const latest=K.world.visual(kit,run.view(),run.query());
  assert.equal(latest.fieldViews[0].range[1],5);
  assert(old.sampler('sensors/heat')(-.5,0,0)<1);
  assert.throws(()=>K.world.runtime.validate({ ...manifest(),visual:{fieldViews:[{},{}]} }),/field visualization layer/);
});

test('the sim render CLI builds native field geometry from a manifest', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-field-view-'));
  try {
    const scene=path.join(dir,'world.json'), out=path.join(dir,'frame.png');
    fs.writeFileSync(scene,JSON.stringify(manifest()));
    execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'sim','render',scene,
      '--w','180','--h','130','--raw','--out',out],{stdio:'pipe'});
    const png=require('../cli/png').raster(fs.readFileSync(out));
    assert.equal(png.w,180);
    assert.equal(png.h,130);
    assert(new Set(png.data).size>30);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('CPU and WebGL render the same field views with comparable colors and coverage', {skip:!process.env.INK_TEST_CHROME}, () => {
  function make(kit,spec) {
    const { world } = kit.KIT, run=world.runtime.create(spec);
    return world.visual(kit,run.view(),run.query());
  }
  function draw(kit,make,backend,{spec,view}) {
    const world=make(kit,spec), frame=backend(view.width,view.height,view);
    try {
      frame.draw(world,view);
      return { image:frame.image(),count:world.count };
    } finally { frame.close(); }
  }
  const spec=manifest(), view={width:200,height:160,raw:true,scale:1};
  const world=make(kit,spec), cpu=studio.render(world,{w:view.width,h:view.height,raw:true,px:1}).rgb;
  const browser=runWebGL({},make,draw,{spec,view}), gpu=Buffer.from(browser.image,'base64');
  assert.equal(browser.count,world.count);
  assert.equal(cpu.length,gpu.length);
  let both=0, either=0, error=0;
  for(let i=0;i<cpu.length;i+=3) {
    const differs=(rgb)=>[0,1,2].some(c=>Math.abs(rgb[i+c]-rgb[c])>18);
    const a=differs(cpu), b=differs(gpu);
    both+=Number(a&&b);
    either+=Number(a||b);
    for(let c=0;c<3;c++) error+=Math.abs(cpu[i+c]-gpu[i+c]);
  }
  assert(both>250);
  assert(both/either>.80,'foreground overlap '+both/either);
  assert(error/cpu.length<5,'mean channel error '+error/cpu.length);
});
