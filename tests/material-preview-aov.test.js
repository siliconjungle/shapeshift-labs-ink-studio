const assert = require('node:assert/strict');
const { test } = require('node:test');
const { inflateSync } = require('node:zlib');
const AOV = require('../src/material-preview-aov.js');
const Ink = require('..');

const ref=node=>({node,port:'value'});
const image=(value,descriptor)=>({op:'image.uniform',inputs:{width:256,height:2,value,descriptor}});
const graph={
  format:'ink-studio/graph-project',version:1,
  inputs:{roughness:{type:'number',default:.31}},
  nodes:{
    color:image([.14,.46,.74],{intent:'color',precision:'unorm8'}),
    rough:image({input:'roughness'},{intent:'mask',precision:'unorm16'}),
    height:image(-.1234567890123,{intent:'height',units:'mm',precision:'float64'}),
    maps:{op:'data.record',inputs:{baseColor:ref('color'),roughness:ref('rough'),height:ref('height')}},
    material:{op:'material.pack',inputs:{maps:ref('maps')}}
  },
  outputs:{material:ref('material')}
};
const plan={
  format:'ink-studio/linked-material-preview',version:1,label:'Material pass fixture',
  targets:[{id:'plane',kind:'plane',slot:'enamel',uvGrid:[2,1]}],
  slots:{enamel:{output:'material'}},
  variants:[{id:'matte',label:'Matte',inputs:{roughness:.78}}],
  view:{width:112,height:88,steps:1,textureSize:32}
};
function unpack(files,row) {
  const code=String(files.get(row.file));
  const text=/^InkMaterialSamples\.receive\("([a-f0-9]+)","([A-Za-z0-9+/=]+)"\);\n$/.exec(code);
  assert(text);
  assert.equal(text[1],row.sha256);
  const data=inflateSync(Buffer.from(text[2],'base64'));
  assert.equal(data.length,row.bytes);
  return new DataView(data.buffer,data.byteOffset,data.byteLength);
}

test('linked previews publish graph precision, aligned diagnostic passes, and independently evaluated variants', async () => {
  const {data,files}=await Ink.createLinkedMaterialPreview(Ink.createGraphProject(graph),plan);
  const [catalog,alternate]=[data.targets[0],data.variants[0].targets[0]];
  assert.deepEqual(catalog.regions.map(row=>row.tile),['1001','1002']);
  assert.equal(data.variants[0].label,'Matte');
  const view=catalog.views[0], screen=unpack(files,view.screen);
  const rows=Array.from({length:data.width*data.height},(_,p)=>AOV.screen(screen,p));
  for(const [index,tally] of view.pixels.entries())
    assert.equal(rows.filter(row=>row?.index===index).length,tally);
  const hit=rows.find(row=>row?.index===0);
  assert(hit.uv.every(n=>n>=0 && n<=1));
  assert(hit.coverage>0 && hit.coverage<=1);
  assert(hit.depth>=view.depthRange[0] && hit.depth<=view.depthRange[1]);
  const [a,b]=[catalog,alternate].map(target=>target.regions[0].maps.find(row=>row.name==='roughness'));
  assert.equal(a.width,256,'full source resolution survives the limit of 32 for beauty shading');
  assert.equal(a.descriptor.precision,'unorm16');
  assert.deepEqual(AOV.sample(unpack(files,a.samples),a,...hit.uv).lanes,[{name:'R',value:Math.round(.31*65535)}]);
  assert.deepEqual(AOV.sample(unpack(files,b.samples),b,...hit.uv).lanes,[{name:'R',value:Math.round(.78*65535)}]);
  const height=catalog.regions[0].maps.find(row=>row.name==='height');
  assert.equal(height.descriptor.units,'mm');
  assert.equal(AOV.sample(unpack(files,height.samples),height,1,1).lanes[0].value,-.1234567890123);
  assert.equal(view.screen.sha256,alternate.views[0].screen.sha256,'a finish edit keeps the two views spatially aligned');
  assert.notEqual(a.display.sha256,b.display.sha256);
  const at=(id,maps=[])=>AOV.render(id,data.width,data.height,screen,catalog.regions,maps,view.depthRange);
  const color=at('baseColor',catalog.regions.map(region=>{
    const map=region.maps.find(row=>row.name==='baseColor');
    if(!map)return null;
    const display=unpack(files,map.display);
    return {...map,rgba:new Uint8Array(display.buffer,display.byteOffset,display.byteLength)};
  }));
  const first=rows.findIndex(row=>row?.index===0)*4, second=rows.findIndex(row=>row?.index===1)*4;
  assert.deepEqual(Array.from(color.slice(first,first+4)),[36,117,189,255]);
  assert.deepEqual(Array.from(color.slice(second,second+4)),[78,68,91,255]);
  const id=at('material-id'), unbound=at('map-bindings');
  assert.notDeepEqual(id.slice(first,first+4),id.slice(second,second+4));
  assert.deepEqual(Array.from(unbound.slice(first,first+4)),[90,174,157,255]);
  assert.deepEqual(Array.from(unbound.slice(second,second+4)),[246,151,72,255]);
});

test('native UV precision distinguishes both sides of a texel edge', () => {
  const width=320, boundary=102/width, left=Math.fround(boundary-1e-7), right=Math.fround(boundary+1e-7);
  assert.equal(Math.round(left*65535),Math.round(right*65535));
  const frame=new DataView(new ArrayBuffer(AOV.stride*2));
  for(const [i,u] of [left,right].entries()) {
    frame.setUint8(i*AOV.stride,1);
    frame.setFloat32(i*AOV.stride+1,u,true);
  }
  assert.deepEqual([0,1].map(i=>AOV.texel({width,height:8},...AOV.screen(frame,i).uv)),[[101,0],[102,0]]);
});

test('preview variant validation prevents replacing the current look or exceeding the native grid budget', async () => {
  const project=Ink.createGraphProject(graph);
  await assert.rejects(Ink.createLinkedMaterialPreview(project,{...plan,variants:[{id:'Current',label:'Duplicate'}]}),/Duplicate/);
  await assert.rejects(Ink.createLinkedMaterialPreview(project,{...plan,view:{width:640,height:640,steps:32}}),/budget/);
});
