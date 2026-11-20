const assert = require('node:assert/strict');
const {test} = require('node:test');
const {load} = require('..');
const {KIT:K,SurfaceLook} = load();
const base = [.31,.27,.22], projection = { along:[1,0,0],across:[0,0,1] };
const field = {
  type:'projected',pattern:'hue-brightness',projection,
  hueBrightness:{size:[2,2],palette:[
    '#ffffff','#808080','#000000','#ff0000','#0000ff','#800000','#000080'
  ]}
};
const prepare = (signals,layer=field)=>SurfaceLook.prepare({signals,layers:{paint:layer}},[],[0,0,1]);
const point = {position:[.5,0,.5],worldPosition:[.5,2,.5],normal:[0,0,1],view:[0,0,1]};
const rgb = (mat,sample=point)=>SurfaceLook.shade(mat,sample,base).slice(0,3);
const close = (actual,expected)=>actual.forEach((channel,i)=>assert(Math.abs(channel-expected[i])<1e-9));

test('world height, directional exposure and retained wetness read independently',()=>{
  const signals = {
    height:{type:'axis',axis:'y',space:'world',range:[0,2],interpolation:'linear'},
    sun:{type:'light',interpolation:'linear'},
    wetness:{type:'weather',channel:'wetness',range:[0,.4],interpolation:'linear'}
  };
  const mat = prepare(signals,{...field,axes:{
    hue:{signal:'height',range:[0,2/3]},brightness:{signal:'sun'},saturation:{signal:'wetness'}
  }});
  const wet = (x,z)=>{
    assert.deepEqual([x,z],[.5,.5]);
    return {wetness:.4};
  };
  assert(mat.weather && mat.finishBeforeFog);
  assert.deepEqual(rgb(mat),[1,1,1]);
  assert.deepEqual(rgb(mat,{...point,weather:wet}),[0,0,1]);
  assert.deepEqual(rgb(mat,{...point,weather:wet,worldPosition:[.5,0,.5]}),[1,0,0]);
  assert.deepEqual(rgb(mat,{...point,weather:wet,visibility:.5}),[0,0,128/255]);
  assert.deepEqual(rgb(mat,{...point,weather:wet,lightDirection:[1,0,0]}),[0,0,0]);
  assert.deepEqual(rgb(mat,{...point,position:[3,0,.5]}),base);
});

test('a painted texture can drive hue or reverse a lightness range',()=>{
  const signal = {type:'texture',channel:'red',projection,
    raster:{width:2,height:1,channels:3,frames:[[0,0,0,255,255,255]]},scale:[2,2]};
  const mat = prepare({paint:signal},{...field,
    hueBrightness:{...field.hueBrightness,brightness:[1,1]},
    axes:{hue:{signal:'paint',range:[2/3,1]}}});
  assert.deepEqual(rgb(mat,{...point,position:[.25,0,1]}),[0,0,1]);
  assert.deepEqual(rgb(mat,{...point,position:[1.25,0,1]}),[1,0,0]);
  const reverse = prepare({paint:signal},{...field,axes:{brightness:{signal:'paint',range:[1,0]}}});
  assert.deepEqual(rgb(reverse,{...point,position:[1.25,0,1]}),[0,0,0]);
});

test('a field channel can address UV and multiple bindings share one signal read',()=>{
  const axes = {u:{signal:'crease'},v:{signal:'crease'}};
  let reads = 0;
  const field = {type:'desaturation',color:'#51b28e',neutralLightness:.89,shade:[1,0],shadow:'#101a21'};
  const layer = {type:'projected',pattern:'chroma-field',projection,chromaField:{...field,size:[2,2]},axes};
  const shading = prepare({crease:()=>{reads++; return .61;}},layer);
  close(rgb(shading),K.palette.chromaField(field).sample(.61,.61));
  assert.equal(reads,1);
  const fromField = SurfaceLook.prepare({signals:{
    crease:{type:'field',field:'paint',channel:'crease',projection,interpolation:'linear'}
  },layers:{paint:layer}},[],[0,0,1],{
    fields:{paint:{channels:['crease'],frame:()=>({sample:()=>.2})}}
  });
  close(rgb(fromField),K.palette.chromaField(field).sample(.2,.2));
});

test('polar bindings preserve disk coverage and invalid axis contracts fail when preparing',()=>{
  const mat = {type:'projected',pattern:'polar-colour',projection,polar:{palette:['#ff0000','#0000ff'],size:[2,2]},
    axes:{hue:{signal:'paint',range:[0,0]},brightness:{signal:'paint'},saturation:{signal:'paint'}}};
  const compiled = prepare({paint:()=>1},mat);
  assert.deepEqual(rgb(compiled,{...point,position:[1,0,1]}),[1,0,0]);
  assert.deepEqual(rgb(compiled,{...point,position:[0,0,0]}),base);
  assert.throws(()=>prepare({},mat),/named surface signal/);
  assert.throws(()=>prepare({paint:()=>1},{...mat,axes:{brightness:{signal:'paint',range:[0,2]}}}),/output range/);
  const ramp = {type:'projected',pattern:'palette-ramp',paletteRamp:{type:'primary',accent:'#0000ff'}};
  assert.throws(()=>prepare({paint:()=>1},{...ramp,axes:{hue:{signal:'paint'}}}),/Invalid palette axis/);
});
