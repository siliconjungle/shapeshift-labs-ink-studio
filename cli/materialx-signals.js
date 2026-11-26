const fs = require('node:fs');
const path = require('node:path');
const ColorSpace = require('../src/color-space.js');
const Textures = require('./texture-files.js');
const EXR = require('./texture-exr.js');
const C = require('./texture-common.js');

const addressing = { periodic:'wrap',clamp:'clamp',mirror:'mirror' };
const filters = { closest:'nearest',linear:'linear' };
const dimensions = { float:1,boolean:1,color3:3,color4:4,vector2:2,vector3:3,vector4:4 };
const isColor = type => ['color3','color4'].includes(type);
const distances = {nanometer:1e-9,micron:1e-6,millimeter:1e-3,centimeter:1e-2,inch:.0254,foot:.3048,
  yard:.9144,meter:1,kilometer:1e3,mile:1609.344};
const spaces = {
  lin_rec709:'srgb-linear',linear:'srgb-linear',raw:'srgb-linear','srgb-linear':'srgb-linear',
  srgb_texture:'srgb',srgb:'srgb',lin_displayp3:'display-p3-linear',lin_p3d65:'display-p3-linear',
  displayp3:'display-p3','display-p3':'display-p3','display-p3-linear':'display-p3-linear'
};
const own = (table,key) => Object.hasOwn(table,key) ? table[key] : undefined;

class UnsupportedSignal extends Error {}
const unsupported = explanation => { throw new UnsupportedSignal(explanation); };

function unpack(raw, channels) {
  const result=new Float32Array(raw.width*raw.height*channels);
  const max=raw.data instanceof Uint8Array?255:raw.data instanceof Uint16Array?65535:1;
  const stride=raw.channels, hasAlpha=raw.alpha!=='none'&&stride%2===0;
  for(let from=0,to=0;from<raw.data.length;from+=stride,to+=channels) {
    const a=hasAlpha?raw.data[from+stride-1]/max:1;
    for(let c=0;c<channels;c++) {
      if(c===3) result[to+c]=a;
      else {
        const v=raw.data[from+(stride<3?0:c)]/max;
        result[to+c]=raw.alpha==='premultiplied'?(a?v/a:0):v;
      }
    }
  }
  return result;
}

function colorResource(raw, type, declared, managed) {
  const tag=declared?.toLowerCase();
  const space=own(spaces,tag)??(!tag && !raw.profile?.icc && !raw.profile?.cicp ? raw.colorSpace ?? 'srgb-linear' : undefined);
  if(space) {
    const lanes=dimensions[type], samples=unpack(raw,lanes);
    if(space==='srgb-linear') return samples;
    const transform=ColorSpace.prepare(space,'srgb-linear'), rgb=[0,0,0];
    for(let i=0;i<samples.length;i+=lanes) {
      const converted=transform([samples[i],samples[i+1],samples[i+2]],rgb);
      for(let c=0;c<3;c++) samples[i+c]=converted[c];
    }
    return samples;
  }
  if(!managed) unsupported('Associate a supported color space or provide OCIO color settings for '+(declared||'the embedded color profile'));
  const candidate=own(managed.settings.sources,declared)??(managed.description.spaces.includes(declared)?declared:undefined);
  if(tag&&!candidate) unsupported('No OCIO mapping for MaterialX colorspace '+declared);
  const interpretation=candidate?{ocio:{mode:'space',space:candidate}}:{};
  const {raw:converted}=managed.importColor(raw,interpretation);
  return unpack(converted,dimensions[type]);
}

function literal(signal, managed) {
  const {value,type,colorSpace}=signal, channels=dimensions[type];
  if(value===null) return {type,value,channels};
  if(!channels || type==='boolean'&&typeof value!=='boolean' ||
      channels===1&&type!=='boolean'&&!Number.isFinite(value) ||
      channels!==1&&(!Array.isArray(value)||value.length!==channels||!Array.from(value).every(Number.isFinite)))
    unsupported('Unsupported or nonfinite MaterialX constant');
  if(isColor(type)&&colorSpace)
    return {type,channels,value:Array.from(colorResource({width:1,height:1,channels,data:Float32Array.from(value),
      alpha:channels===4?'straight':'none'},type,colorSpace,managed))};
  return {type,value,channels};
}

function apply(source, type, operation) {
  const channels=dimensions[type];
  if (!channels || source.value===null) unsupported('Unsupported MaterialX signal type');
  const input=value=>Array.isArray(value)?value:[value];
  if(!source.data) {
    const value=operation(input(source.value));
    return {type,channels,value:channels===1?value[0]:value};
  }
  const {data,width,height}=source, pixels=new Float32Array(width*height*channels);
  for(let i=0,j=0;i<data.length;i+=source.channels,j+=channels) pixels.set(operation(data.subarray(i,i+source.channels)),j);
  return {...source,type,data:pixels,channels};
}

function evaluator({inputs,managed}) {
  const sources=new Map();
  let texels=0;
  function image(signal) {
    const {file,type,u,v,filter,uv,colorSpace}=signal;
    if(uv!==0) unsupported('Editable surface bindings use the primary UV chart. Re-bake alternate charts before importing');
    if(!own(addressing,u)||!own(addressing,v)||!own(filters,filter))
      unsupported('The receiving graph supports periodic, clamp or mirror with closest or linear filtering');
    const channels=dimensions[type];
    if(!channels||type==='boolean') unsupported('Unsupported MaterialX image type '+type);
    let raw=sources.get(file);
    if(!raw){
      let stat;
      try { stat=fs.statSync(file); } catch(error) {
        if(error.code==='ENOENT'||error.code==='ENOTDIR') unsupported('Missing texture '+signal.sourceFile);
        throw error;
      }
      if(!stat.isFile()||stat.size>32*1024**2) unsupported('Choose a texture file within the 32 MiB budget');
      inputs.add(file);
      try { raw=Textures.readTexture(file); }
      catch(error) { unsupported('Texture '+signal.sourceFile+' could not be decoded: '+error.message); }
      sources.set(file,raw);
    }
    texels+=raw.width*raw.height;
    if(texels>10e6) throw new RangeError('MaterialX signal evaluation exceeds the 10-million-texel budget');
    if(channels>1&&!isColor(type)&&raw.channels<channels) unsupported('Vector image needs '+channels+' stored channels');
    if(channels===4&&!isColor(type)&&raw.alpha==='none') unsupported('Unassociated vector4 images require a supported fourth channel');
    const {width,height}=raw;
    const data=isColor(type)?colorResource(raw,type,colorSpace,managed):unpack(raw,channels);
    return {type,channels,width,height,data,tiling:{u:addressing[u],v:addressing[v]},sampling:filters[filter],
      source:signal.sourceFile,sourceColorSpace:colorSpace||raw.colorSpace||null};
  }
  function evaluate(signal) {
    if (!signal) unsupported('The MaterialX operator is missing a required input');
    const walk=child=>evaluate(child);
    switch (signal.kind) {
      case 'constant': return literal(signal,managed);
      case 'image': return image(signal);
      case 'extract': {
        const inner=walk(signal.in), i=signal.index;
        if(!Number.isSafeInteger(i)||i<0||i>=inner.channels) unsupported('Invalid component selection');
        return apply(inner,'float',v=>[v[i]]);
      }
      case 'convert': {
        const inner=walk(signal.in);
        if(inner.type==='float'&&['color3','vector3'].includes(signal.type))
          return apply(inner,signal.type,([v])=>[v,v,v]);
        unsupported('This MaterialX convert type needs baking in the source DCC');
        break;
      }
      case 'multiply': {
        const a=walk(signal.a), b=walk(signal.b);
        const source=a.data||!b.data?a:b, operand=source===a?b:a;
        const factor=Array.isArray(operand.value)?operand.value:[operand.value];
        if(operand.data || factor.some(n=>!Number.isFinite(n)) ||
            factor.length!==1&&factor.length!==source.channels||dimensions[signal.type]!==source.channels||
            source.normalSpace)
          unsupported('Only a uniform scalar or component factor on one signal can be baked as a material texture');
        return apply(source,signal.type,v=>Array.from(v,(n,i)=>n*factor[i%factor.length]));
      }
      case 'normalmap': {
        const inner=walk(signal.in);
        const scale=Array.isArray(signal.scale)?signal.scale:[signal.scale,signal.scale];
        if(inner.channels!==3||inner.normalSpace||scale.length!==2||!scale.every(Number.isFinite))
          unsupported('Normal map needs encoded XYZ and a uniform scale');
        const normal=apply(inner,'vector3',v=>[(2*v[0]-1)*scale[0],(2*v[1]-1)*scale[1],2*v[2]-1]);
        if(scale.some(v=>v!==1)) {
          // The native renderer reconstructs normals after filtering. A baked scale must remain representable.
          const inputs=normal.data??normal.value;
          if(inputs.some(v=>v< -1||v>1)) unsupported('Normal scale exceeds the signed map range. Bake the normal in the source DCC');
        }
        return {...normal,normalSpace:'tangent'};
      }
      default: return unsupported('Unsupported MaterialX signal '+signal.kind);
    }
  }
  return evaluate;
}

function meterScale(unit,destination) {
  if(!unit || unit===destination) return 1;
  if(destination==='nits' && ['cd/m2','nit','nits'].includes(unit)) return 1;
  const from=own(distances,unit), to=({cm:.01,um:1e-6})[destination];
  if(!from||!to) unsupported('Unsupported unit '+unit+' for '+destination);
  return from/to;
}

function normalizeInput(P, name, signal, evaluated, {gain=1,monochrome=false}={}) {
  const input=P.openPbr.inputs[name];
  let result=evaluated;
  if(evaluated.type==='color3'&&monochrome) result=apply(evaluated,'float',v=>{
    if(Math.abs(v[0]-v[1])>1e-6||Math.abs(v[0]-v[2])>1e-6)
      unsupported('RGB opacity cannot be represented by scalar OpenPBR coverage');
    return [v[0]];
  });
  const scale=gain*meterScale(signal?.unit,input.units);
  if(scale!==1) result=apply(result,result.type,v=>Array.from(v,n=>n*scale));
  if(result.type!==input.type) unsupported('MaterialX signal is '+result.type+' but '+name+' needs '+input.type);
  if(!result.data && !result.normalSpace) {
    return {value:P.openPbr.define({[name]:result.value}).parameters[name],units:input.units,scaled:scale!==1};
  }
  const vector=input.type==='vector3', normal=vector&&name.endsWith('_normal');
  if(vector&&!normal) unsupported('A mapped MaterialX tangent is a world direction. Ink accepts an explicit uniform world tangent or an authored tangent-space flow map');
  const {width=1,height=1,data=Float32Array.from(result.value??[]),channels}=result;
  const typed=P.graphImages.declare({width,height,channels,data},{
    intent:normal?'normal':vector||input.type==='float'?'data':'color',
    units:input.units??'unitless',
    ...(normal&&{normalSpace:result.normalSpace??'world',
      ...(result.normalSpace==='tangent'&&{normalOrientation:'opengl'})}),
    ...(input.type==='color3'&&{colorSpace:'srgb-linear'}),
    precision:'float32',tiling:result.tiling,sampling:result.sampling
  });
  P.openPbr.define({}, {[name]:typed});
  return {image:typed,units:input.units,source:result.source,sourceColorSpace:result.sourceColorSpace,
    scaled:scale!==1};
}

function writeMap(P, name, image) {
  const spec=image.descriptor, field=P.openPbr.inputs[name], normal=field.type==='vector3';
  if(normal&&!name.endsWith('_normal')) unsupported('Tangent flow depends on Ink’s UV frame and has no portable MaterialX binding');
  const modes={wrap:'periodic',clamp:'clamp',mirror:'mirror'};
  const {u,v}=spec.tiling;
  if(!modes[u]||!modes[v]) unsupported('Transparent texture address policies need a compatible receiver-specific border');
  const tangent=normal&&spec.normalSpace!=='world', dx=tangent&&spec.normalOrientation==='directx';
  const rgb=field.type==='color3';
  const source=rgb?P.graphImages.convert(image,{intent:'color',layout:'rgb',colorSpace:'srgb-linear',
    precision:'float32',alpha:'none'},{dropAlpha:true}):image;
  const {width,height,channels,data}=source.raster;
  const divisor=source.descriptor.precision==='unorm8'?255:source.descriptor.precision==='unorm16'?65535:1;
  const planes={};
  const list=field.type==='float'?['Y']:['R','G','B'];
  let precisionLoss=0;
  for(const [c,key] of list.entries()) {
    const plane=new Float32Array(width*height);
    for(let p=0;p<plane.length;p++) {
      let value=data[p*channels+c]/divisor;
      if(normal) {
        if(spec.domain==='unit') value=value*2-1;
        if(dx&&c===1) value=-value;
        if(tangent) value=(value+1)*.5;
      }
      plane[p]=value;
      precisionLoss=Math.max(precisionLoss,Math.abs(plane[p]-value));
    }
    planes[key]=plane;
  }
  const bytes=EXR.write({width,height,planes},{profile:rgb?{chromaticities:C.srgb}:{}});
  return {bytes,width,height,type:field.type,normal:tangent,u:modes[u],v:modes[v],
    filter:spec.sampling==='nearest'?'closest':'linear',precisionLoss,
    conversions:[...(rgb&&spec.colorSpace!=='srgb-linear'?['linear Rec.709 color conversion']:[]),
      ...(dx?['DirectX to OpenGL normal orientation']:[]),...(tangent?['signed tangent XYZ encoded for normalmap']:[]),
      ...(rgb&&spec.alpha!=='none'?['the color3 socket carries RGB only']:[])]};
}

module.exports={UnsupportedSignal,unsupported,evaluator,normalizeInput,writeMap};
