const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..');
const {KIT} = ink.load();
const {relight} = KIT.procedural.pixelEffects;
const raster=(width,height,channels,data)=>({width,height,channels,data});
const row=(...data)=>raster(data.length,1,1,data);
const at=(image,x=0,y=0)=>{
  const start=(y*image.width+x)*image.channels;
  return Array.from(image.data.slice(start,start+image.channels));
};
const near=(a,b,tol=1e-7)=>assert(Math.abs(a-b)<tol, a+' differs from '+b);

test('An emitter produces independent colored light with distance, elevation and recipient coverage',()=>{
  const emission=raster(4,1,4,[255,255,255,0, 255,0,0,255, 0,0,0,0, 0,0,0,0]);
  const result=relight(emission,{radius:4,emitterHeight:1,mask:row(0,255,128,255)});
  assert.deepEqual(at(result.irradiance,0),[0,0,0]);
  assert.deepEqual(at(result.irradiance,1),[.5625,0,0]);
  near(at(result.irradiance,2)[0],(1-Math.SQRT2/4)**2*(128/255)/Math.SQRT2);
  near(at(result.intensity,1)[0],.2126*.5625);
  assert.deepEqual(at(result.value,0),[0,0,0,0]);
  assert.deepEqual(at(result.value,1),[255,0,0,198]);
  assert.equal(at(relight(emission,{radius:4,emitterHeight:4}).intensity,1)[0],0);
  const cutoff=relight(emission,{radius:2,emitterHeight:1});
  assert.equal(at(cutoff.intensity,3)[0],0);
  const matte=raster(4,1,4,[255,255,255,0, 0,0,0,128, 0,0,0,0, 255,255,255,0]);
  near(at(relight(emission,{radius:4,emitterHeight:1,mask:matte}).irradiance,1)[0],.5625*128/255);
});

test('Raised slopes respond directionally and explicit normals override their orientation',()=>{
  const height=row(0,1,2), setup={radius:8,emitterHeight:2,height};
  const uphill=relight(row(255,0,0),setup), downhill=relight(row(0,0,255),setup);
  near(at(uphill.intensity,1)[0],(1-Math.SQRT2/8)**2);
  near(at(downhill.intensity,1)[0],0);
  const normals=raster(3,1,3,[0,0,0, 5,0,0, 0,0,0]);
  const sided=relight(row(0,0,255),{...setup,normals});
  near(at(sided.intensity,1)[0],(1-Math.SQRT2/8)**2/Math.SQRT2);
  assert.equal(at(sided.intensity,2)[0],0);
  const raw=row(0,100,200);
  near(at(relight(row(255,0,0),{...setup,height:raw,heightScale:.01}).intensity,1)[0],
    at(uphill.intensity,1)[0]);
});

test('Normals use view-space +Y up and RGB8 normals honor missing alpha',()=>{
  const brightAbove=raster(1,3,1,[255,0,0]), brightBelow=raster(1,3,1,[0,0,255]);
  const normals=raster(1,3,4,[128,128,255,0, 128,255,128,255, 128,128,255,0]);
  const setup={radius:12,emitterHeight:1,normals,normalEncoding:'rgb8'};
  assert(at(relight(brightAbove,setup).intensity,0,1)[0]>.5);
  assert.equal(at(relight(brightBelow,setup).intensity,0,1)[0],0);
  assert.equal(at(relight(brightAbove,setup).intensity,0,0)[0],0);
  const relief=raster(1,3,1,[0,1,2]);
  assert(at(relight(brightBelow,{radius:12,emitterHeight:2,height:relief}).intensity,0,1)[0]<1e-7);
  assert(at(relight(brightAbove,{radius:12,emitterHeight:2,height:relief}).intensity,0,1)[0]>.7);
});

test('Linear RGBA preserves HDR energy and pooled samples conserve the summed colored emission',()=>{
  const white=raster(1,1,4,[12,2,0,.5]);
  const bright=relight(white,{emissionEncoding:'linear',emissionScale:1,radius:4,emitterHeight:1});
  assert.deepEqual(at(bright.irradiance),[3.375,.5625,0]);
  assert.equal(bright.irradiance.colorSpace,'srgb-linear');
  assert.deepEqual(at(bright.value),[255,198,0,255]);
  const tagged={...white,colorSpace:'srgb-linear'};
  assert.deepEqual(at(relight(tagged,{radius:4,emitterHeight:1}).irradiance),at(bright.irradiance));
  const emission=raster(3,1,3,[1,0,0, 0,.2126/.7152,0, 0,0,0]);
  const options={emissionScale:1,emissionEncoding:'linear',sampleStep:2,radius:8,emitterHeight:2};
  const grouped=relight(emission,options);
  const d=Math.hypot(.5,2), factor=(1-d/8)**2*2/d;
  near(at(grouped.irradiance,0)[0],factor);
  near(at(grouped.irradiance,0)[1],factor*.2126/.7152);
  assert.deepEqual(at(grouped.irradiance,0),at(grouped.irradiance,1));
  const a=relight(row(128),{radius:4,emitterHeight:1});
  const b=relight(row(128),{radius:4,emitterHeight:1,emissionEncoding:'linear'});
  assert(at(a.intensity)[0]<at(b.intensity)[0]);
});

test('Relighting rejects invalid input grids, encodings and oversized light work',()=>{
  assert.throws(()=>relight(row(255),{height:row(1,2)}),/matching/);
  assert.throws(()=>relight(row(255),{normals:row(1)}),/normals/);
  assert.throws(()=>relight(row(255),{mask:row(1,2)}),/mask/);
  assert.throws(()=>relight(row(255),{radius:257}),/reach/);
  assert.throws(()=>relight(row(255),{normalEncoding:'hsl'}),/encoding/);
  const dense=raster(200,200,1,new Uint8Array(40000).fill(255));
  assert.throws(()=>relight(dense,{radius:32}),/visit budget/);
  assert(relight(dense,{radius:32,sampleStep:8}).intensity.data[10000]>0);
});

test('The normal and light ports compose with stock generators, palettes and display conversion',()=>{
  const {graph}=KIT.procedural;
  const project=graph.create({nodes:{
    globe:{op:'proc.sphereMap',inputs:{options:{width:5,height:5,radius:2}}},
    energy:{op:'raster.canvas',inputs:{width:5,height:5,color:[255,200,75,140]}},
    relight:{op:'fx.relight',inputs:{emission:{node:'energy'},normals:{node:'globe',port:'normal'},
      options:{radius:4,emitterHeight:1,strength:.5}}},
    display:{op:'color.rasterToDisplay',inputs:{source:{node:'relight',port:'irradiance'}}},
    heat:{op:'color.gradient',inputs:{source:{node:'relight',port:'intensity'},ramp:['#080720','#58290b','#ffd38c'],
      options:{channel:0,range:[0,1],interpolation:'step'}}}
  },outputs:{heat:{node:'heat'},display:{node:'display'},irradiance:{node:'relight',port:'irradiance'},
    intensity:{node:'relight',port:'intensity'}}});
  const top=project.evaluate().outputs;
  assert.deepEqual(at(top.irradiance,0,0),[0,0,0]);
  assert(at(top.intensity,2,2)[0]>.5);
  assert(at(top.display,2,2)[0]>at(top.display,2,2)[1]);
  assert.notDeepEqual(at(top.heat,2,2),at(top.heat,0,0));
  project.clear();
});
