const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT:K, makeBuilder, makeSculpt } = ink.load();

const view = { w:96,h:54,px:1,ortho:true,dither:0 };
const hex = (rgb,p) => '#'+Buffer.from(rgb.subarray(p*3,p*3+3)).toString('hex');
const number = (report,swatch) => report.swatches.find(row=>row.swatch===swatch)?.pixels ?? 0;

function scene() {
  const b = makeBuilder(18,[0x171f2e,0xbd543d,0x985882,0x498494,0x65b5bb,0xffe6a2,0x5d466e,0x29705d]);
  const s = K.sculpt(makeSculpt(b));
  function panel(at, name, material, solid, palette) {
    s.box(at,[.60,.62,.10],K.surface.material({r:[solid],em:true,materialId:material},{paletteConstraint:{palette}}),
      {res:.045,rd:.025,objectId:name});
  }
  panel([-1,0,0],'banner','linen',1,['linen']);
  panel([1,0,0],'arch','stone',3,['stone']);
  panel([15,0,0],'rail','brass',5,['hidden']);
  s.bake();
  return b.finish({ cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},dither:0,
    paletteRoles:{linen:[1,2],stone:[3,4],hidden:[5],mist:[4,6]},
    look:{splatCoverage:'continuous'} });
}

function assertHistogram(frame,report,filter) {
  const expected = new Map();
  let pixels = 0, excluded = 0;
  for(let p=0;p<frame.w*frame.h;p++) {
    const x = p%frame.w,y = Math.floor(p/frame.w);
    if (!filter(p,x,y)) continue;
    if (frame.alpha?.[p]===0) { excluded++; continue; }
    const swatch=hex(frame.rgb,p);
    pixels++;
    expected.set(swatch,(expected.get(swatch) ?? 0)+1);
  }
  assert.equal(report.pixels,pixels);
  assert.equal(report.excludedTransparentPixels,excluded);
  assert.equal(report.swatches.length,new Set(report.swatches.map(row=>row.swatch)).size);
  for (const row of report.swatches) {
    assert.equal(row.pixels,expected.get(row.swatch) ?? 0);
    assert.equal(row.share,pixels ? row.pixels/pixels : 0);
    expected.delete(row.swatch);
  }
  assert.equal(expected.size,0);
}

test('whole, object and material reports count exact export pixels and keep scoped unused colours', () => {
  const world=scene();
  for (const settings of [view,{...view,coverageAware:true},{...view,colored:true}]) {
    const frame=ink.render(world,{...settings,passes:['objectId','materialId']});
    const whole=ink.paletteUsage(world,settings);
    assertHistogram(frame,whole,()=>true);
    assert(whole.unused.includes('#29705d'));
    const linen=ink.paletteUsage(world,{...settings,select:{object:'banner',material:'linen'}});
    assertHistogram(frame,linen,p=>frame.passes.objects[frame.passes.objectId[p]]==='banner' &&
      frame.passes.materials[frame.passes.materialId[p]]==='linen');
    assert(linen.pixels>20);
    assert(linen.unused.includes('#985882'));
    assert(!linen.swatches.some(row=>row.swatch==='#ffe6a2'));
    const hidden=ink.paletteUsage(world,{...settings,select:{object:'rail'}});
    assert.equal(hidden.pixels,0);
    assert.deepEqual(hidden.unused,['#ffe6a2']);
  }
});

test('regions clip to the native grid, use visible alpha and classify rare declarations', () => {
  const world=scene(), settings={...view,transparent:true,px:2};
  const frame=ink.render(world,{...settings,passes:['objectId','position','splatId']});
  const left=ink.paletteUsage(world,{...settings,select:{region:[-2,-4,28,35]}});
  assert.deepEqual([left.width,left.height,left.pixelSize],[48,27,2]);
  assertHistogram(frame,left,(p,x,y)=>x<26 && y<31);
  assert(left.excludedTransparentPixels>0);
  const p=frame.passes.objectId.findIndex(id=>frame.passes.objects[id]==='banner');
  const one=ink.paletteUsage(world,{...settings,select:{object:'banner',region:[p%frame.w,Math.floor(p/frame.w),1,1]},
    rarePixels:1,rareShare:0});
  assert.equal(one.pixels,1);
  assert.deepEqual(one.rare,[hex(frame.rgb,p)]);

  const min=[-2,-1,-1],max=[-.2,1,1];
  const spatial=ink.paletteUsage(world,{...settings,select:{region:{min,max}}});
  assertHistogram(frame,spatial,p=>frame.passes.splatId[p] && min.every((n,i)=>
    frame.passes.position[p*3+i]>=n && frame.passes.position[p*3+i]<=max[i]));
  assert(spatial.pixels>20);
  assert.throws(()=>ink.paletteUsage(world,{select:{region:[0,0,0,4]}}),/region/);
  assert.throws(()=>ink.paletteUsage(world,{rareShare:2}),/rarity/);
});

test('effect usage counts final palette ownership and keeps an inactive effect’s declarations', () => {
  const world=scene();
  world.atmosphere=[K.atmosphere.fog({density:.8,far:12,color:'#65b5bb'})];
  world.look.effectPalettes={fog:{colors:['mist'],combine:'material',threshold:.25}};
  const opts={...view,passes:['materialId','paletteOwner']};
  const frame=ink.render(world,opts);
  const result=ink.paletteUsage(world,{...view,select:{effect:'fog',material:'linen'}});
  assertHistogram(frame,result,p=>frame.passes.materials[frame.passes.materialId[p]]==='linen' &&
    frame.passes.paletteOwners[frame.passes.paletteOwner[p]]?.effect==='fog');
  assert(result.pixels>20);
  assert(number(result,'#65b5bb')>0);
  assert(result.unused.includes('#985882'));

  world.look.effectPalettes.fog.when={channel:'unreached',min:1};
  const inactive=ink.paletteUsage(world,{...view,select:{effect:'fog'}});
  assert.equal(inactive.pixels,0);
  assert.deepEqual(inactive.unused,['#5d466e','#65b5bb']);

  delete world.look.effectPalettes.fog.when;
  world.look.coverageAware=true;
  world.look.renderStages=[{stage:'palette',select:{material:'linen'},palette:{palette:['#f57030']}}];
  const overridden=ink.paletteUsage(world,{...view,select:{material:'linen',effect:'fog'}});
  assert.equal(overridden.pixels,0);
});

test('mixed-resolution reports sample ownership on the output grid and count overlay RGB', () => {
  const world=scene();
  world.look.composite={world:{resolution:[48,27]},layers:[
    {resolution:[1,1],rect:[0,0,1,1],source:{w:1,h:1,rgba:Uint8Array.of(255,0,255,255)}}
  ]};
  const frame=ink.render(world,{...view,passes:['objectId']});
  const full=ink.paletteUsage(world,view);
  assertHistogram(frame,full,()=>true);
  assert.equal(number(full,'#ff00ff'),1);
  assert.equal(full.swatches.find(row=>row.swatch==='#ff00ff').status,'undeclared');
  const linen=ink.paletteUsage(world,{...view,select:{object:'banner'}});
  assertHistogram(frame,linen,(_p,x,y)=>{
    const {objectId,objects,w,h}=frame.passes;
    return objects[objectId[Math.floor((y+.5)*h/frame.h)*w+Math.floor((x+.5)*w/frame.w)]]==='banner';
  });
  assert(linen.pixels>0);
});

test('whole-frame declarations include sampled grades and unused ink colours', () => {
  const b=makeBuilder(5,[0x171f2e,0x884c2d]);
  b.disc(0,0,0,[0,0,1],.55,.10,b.P[1],3);
  const world=b.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0},look:{ink:{
    materials:{offscreen:{ramp:['#113355'],silhouette:{color:'#55ff00'}}}
  }}});
  world.anim={grade:Float32Array.from([23,31,46,240,80,32],n=>n/255)};
  const report=ink.paletteUsage(world,view);
  assert(number(report,'#f05020')>0);
  assert.equal(report.swatches.find(row=>row.swatch==='#f05020').declared,true);
  assert(report.unused.includes('#113355'));
  assert(report.unused.includes('#55ff00'));
});

test('CLI usage reads render flags and writes a report', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-usage-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const app=path.resolve(__dirname,'../examples/surface-palette-roles.js');
  const out=path.join(dir,'nested','usage.json');
  execFileSync(process.execPath,[cli,'palette','usage',app,'--w','96','--h','48','--px','2','--t','.5',
    '--select','{"region":[0,0,10,10]}','--rare-pixels','1','--rare-share','0','--out',out]);
  const report=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.deepEqual([report.width,report.height,report.time,report.pixels],[48,24,.5,100]);
  assert.deepEqual(report.thresholds,{rarePixels:1,rareShare:0});
});
