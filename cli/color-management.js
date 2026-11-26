const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ColorSpace = require('../src/color-space.js');
const C = require('./texture-common.js');

const backend = path.join(__dirname,'color-management-ocio.py');
const encodings = ['srgb','display-p3','rec2100-pq','rec2100-hlg'];
const isHDR = encoding => encoding.startsWith('rec2100-');
const string = value => typeof value === 'string' && value.trim() === value && value.length > 0 &&
  value.length <= 256 && !/[\x00-\x1f]/.test(value);
const totalPixels = Math.floor(C.maxBytes / 12);
const clamp = n => Math.max(0,Math.min(n,1));
const acescg = [.713,.293,.165,.830,.128,.044,.32168,.33767];
const aces = [.7347,.2653,0,1,.0001,-.077,.32168,.33767];
const rec2020 = [.708,.292,.170,.797,.131,.046,.3127,.3290];
const primaries = {'srgb-linear':C.srgb,'display-p3-linear':C.p3,'rec2020-linear':rec2020,acescg,aces2065:aces};

function normalize(value) {
  if (!C.fields(value,['config','working','inkLinear','display','view','displayEncoding','paletteView',
    'sources','defaultInput','context','workingChromaticities','whiteNits']) ||
      typeof value.config!=='string' || !value.config.trim() || value.config.length>4096 || value.config.includes('\0') ||
      !string(value.inkLinear) || !encodings.includes(value.displayEncoding) ||
      ['working','display','view','defaultInput'].some(key=>value[key]!==undefined&&!string(value[key])))
    throw new TypeError('Color management needs an OCIO config, Ink linear Rec.709 mapping and explicit display encoding');
  const {sources={},context={},paletteView,workingChromaticities,whiteNits}=value;
  if (![sources,context].every(row=>C.record(row)&&Object.keys(row).length<=64&&
      Object.entries(row).every(([key,val])=>string(key)&&string(val))))
    throw new TypeError('Color source mappings and OCIO context must be bounded named strings');
  if (paletteView!==undefined && (!C.fields(paletteView,['display','view','encoding']) ||
      !string(paletteView.display) || !string(paletteView.view) || !['srgb','display-p3'].includes(paletteView.encoding)))
    throw new TypeError('Palette proof needs an explicit SDR display, view, and encoding');
  if (isHDR(value.displayEncoding) && !paletteView)
    throw new TypeError('An HDR display requires a separate SDR palette proof view');
  C.profile({chromaticities:workingChromaticities,whiteLuminance:whiteNits});
  return {...value,sources,context,paletteView};
}

function invoke(config,request,rgb) {
  const header=Buffer.from(JSON.stringify({...request,config}));
  const size=Buffer.allocUnsafe(4);
  size.writeUInt32LE(header.length);
  const input=rgb?Buffer.concat([size,header,Buffer.from(rgb.buffer,rgb.byteOffset,rgb.byteLength)]):
    Buffer.concat([size,header]);
  const env={...process.env};
  for (const name of ['OCIO','OCIO_ACTIVE_DISPLAYS','OCIO_ACTIVE_VIEWS','OCIO_INACTIVE_COLORSPACES',
    'OCIO_OPTIMIZATION_FLAGS','OCIO_USER_CATEGORIES']) delete env[name];
  const child=spawnSync(process.env.INK_OCIO_PYTHON || 'python3',[backend],{
    input,env,timeout:120000,maxBuffer:C.maxBytes+1024**2,windowsHide:true
  });
  if (child.error) throw new Error('OpenColorIO backend failed: '+child.error.message,{cause:child.error});
  if (child.status!==0) {
    const detail=child.stderr.toString('utf8').trim().slice(-2400);
    throw new Error('OpenColorIO: '+(detail||'processor failed'));
  }
  if (child.stdout.length<4) throw new Error('OpenColorIO backend returned a truncated reply');
  const end=4+child.stdout.readUInt32LE(0);
  const metadata=JSON.parse(child.stdout.toString('utf8',4,end));
  const output=child.stdout.subarray(end);
  if (output.length!==(rgb?.byteLength??0)) throw new Error('OpenColorIO backend returned the wrong sample count');
  const pixels=rgb?new Float32Array(output.length/4):null;
  if (pixels) Buffer.from(pixels.buffer).set(output);
  return {metadata,pixels};
}

function selectResource(raw, interpretation, settings, spaces) {
  const {ocio={},colorSpace}=interpretation, {profile={}}=raw;
  const sourceName=key=>Object.hasOwn(settings.sources,key)?settings.sources[key]:null;
  const {mode='auto',space,intent=1}=ocio;
  if (mode==='space') return {space,method:'assigned'};
  if (colorSpace) {
    const mapped=sourceName(colorSpace);
    if (!mapped) throw new RangeError('No OCIO source mapping for declared '+colorSpace);
    return {space:mapped,method:'assigned'};
  }
  if (mode==='icc') {
    if (!profile.icc) throw new RangeError('This resource has no embedded ICC profile');
    return {space:settings.inkLinear,icc:profile.icc,intent,method:'icc'};
  }
  let encoding=profile.ocioColorSpace;
  if (profile.cicp) {
    const {primaries,transfer,matrix,fullRange}=profile.cicp;
    if (matrix!==0 || !fullRange) throw new RangeError('Assign an OCIO source space for unsupported cICP coding');
    encoding=({'9:16':'rec2100-pq','9:18':'rec2100-hlg','1:13':'srgb','12:13':'display-p3',
      '1:8':'srgb-linear','9:8':'rec2020-linear','12:8':'display-p3-linear'})[primaries+':'+transfer];
    if (!encoding) throw new RangeError('Assign an OCIO source space for unsupported cICP primaries or transfer');
  } else if (profile.icc) return {space:settings.inkLinear,icc:profile.icc,intent,method:'icc'};
  else if (profile.srgb!==undefined) encoding='srgb';
  else if (!encoding && profile.chromaticities) {
    const linear=Object.entries(primaries).find(([,v])=>v.every((n,i)=>Math.abs(profile.chromaticities[i]-n)<5e-5))?.[0];
    if (raw.encoding==='exr' || profile.gamma===1 || raw.encoding==='tiff' && raw.bitDepth===32) encoding=linear;
    if (!encoding) throw new RangeError('Assign an OCIO source space for these primaries and transfer');
  } else if (!encoding && profile.gamma!==undefined) {
    if (profile.gamma!==1) throw new RangeError('Assign an OCIO source space for this PNG transfer');
    encoding='srgb-linear';
  } else if (!encoding && ['exr','pfm'].includes(raw.encoding)) encoding='srgb-linear';
  if (!encoding) {
    if (!settings.defaultInput) throw new RangeError('Assign an OCIO source space for the untagged resource');
    return {space:settings.defaultInput,method:'default'};
  }
  const mapped=sourceName(encoding) ?? (profile.ocioColorSpace===encoding && spaces.includes(encoding)?encoding:null);
  if (!mapped) throw new RangeError('No OCIO source mapping for tagged '+encoding);
  return {space:mapped,method:'metadata',encoding};
}

function safeProfile(profile={}) {
  const {icc,...fields}=profile;
  return {...fields,...(icc&&{iccSha256:createHash('sha256').update(Buffer.from(icc,'base64')).digest('hex')})};
}

function rgbInput(raw, alphaMode=raw.alpha) {
  const {data,width,height,channels}=raw, count=width*height;
  if (!C.uint(width,1,8192) || !C.uint(height,1,8192) || !C.uint(count,1,totalPixels) || ![1,2,3,4].includes(channels) || !data || data.length!==count*channels)
    throw new RangeError('Managed texture needs a bounded pixel buffer');
  const scale=data instanceof Uint8Array || data instanceof Uint8ClampedArray?255:data instanceof Uint16Array?65535:1;
  const alpha=channels%2===0?new Float32Array(count):null, rgb=new Float32Array(count*3);
  for (let p=0,i=0;p<count;p++,i+=channels) {
    const a=alpha?raw.data[i+channels-1]/scale:1;
    if (alpha) {
      if (!(a>=0&&a<=1)) throw new RangeError('Managed texture alpha must be normalized');
      alpha[p]=a;
    }
    const divisor=alphaMode==='premultiplied'?scale*(a||1):scale;
    for(let c=0;c<3;c++) {
      const v=alphaMode==='premultiplied'&&!a?0:data[i+(channels<3?0:c)]/divisor;
      if (!Number.isFinite(Math.fround(v))) throw new RangeError('Managed texture contains nonfinite RGB');
      rgb[p*3+c]=v;
    }
  }
  return {width,height,rgb,alpha};
}

function join(image,pixels,Type=Float32Array) {
  const {width,height,alpha}=image, channels=alpha?4:3, max=Type===Uint16Array?65535:Type===Uint8Array?255:1;
  const data=new Type(width*height*channels);
  const sample=Type===Float32Array?n=>n:n=>Math.round(clamp(n)*max);
  for(let p=0;p<width*height;p++) {
    for(let c=0;c<3;c++) data[p*channels+c]=sample(pixels[p*3+c]);
    if(alpha) data[p*channels+3]=sample(alpha[p]);
  }
  return {width,height,channels,data,alpha:alpha?'straight':'none'};
}

function configure(value,{baseDir=process.cwd(),onFile=()=>{}}={}) {
  const settings=normalize(value), config=path.resolve(baseDir,settings.config);
  function digest(file) {
    onFile(file);
    const stat=fs.statSync(file);
    if (!stat.isFile()||stat.size>C.maxBytes) throw new RangeError('OCIO dependency needs a bounded regular file');
    const bytes=fs.readFileSync(file);
    return createHash('sha256').update(bytes).digest('hex');
  }
  const configSha256=digest(config);
  const run=(request,rgb)=>invoke(config,{...request,context:settings.context},rgb);
  const {metadata:inspected}=run({action:'inspect',working:settings.working??'',inkLinear:settings.inkLinear,
    display:settings.display??'',view:settings.view??'',sources:{...settings.sources,...(settings.defaultInput&&{default:settings.defaultInput})}});
  const {dependencies,spaces,displays,working,inkLinear,display,view,...runtime}=inspected;
  if (dependencies.length>128) throw new RangeError('OCIO config exceeds its LUT dependency budget');
  const sources=dependencies.map(file=>({file:path.relative(path.dirname(config),file).split(path.sep).join('/'),sha256:digest(file)}));
  const primary={display,view,encoding:settings.displayEncoding};
  function choice(value) {
    if (!C.fields(value,['display','view','encoding']) || !encodings.includes(value.encoding) ||
        !Object.hasOwn(displays,value.display) || !displays[value.display].includes(value.view))
      throw new RangeError('Unknown OCIO display/view or output encoding');
    return value;
  }
  const proof=settings.paletteView&&choice(settings.paletteView);
  choice(primary);
  settings.inkLinear=inkLinear;
  const knownPrimaries=({'ACEScg':acescg,'ACES2065-1':aces,'Linear P3-D65':C.p3,
    'Linear Rec.709 (sRGB)':C.srgb,'Linear Rec.2020':rec2020})[working];
  const workingChromaticities=settings.workingChromaticities??knownPrimaries;
  const description={...runtime,config:settings.config,configSha256,dependencies:sources,working,inkLinear,
    primary,paletteProof:proof??null,spaces,displays,...(workingChromaticities&&{workingChromaticities}),
    ...(settings.whiteNits!==undefined&&{whiteNits:settings.whiteNits})};

  function execute(image,stages,source={}) {
    const {rgb}=image;
    if (!stages.length && !source.icc) return {pixels:rgb,processors:[]};
    const {pixels,metadata:{processors}}=run({action:'convert',pixels:rgb.length/3,stages,
      ...(source.icc&&{icc:source.icc,intent:source.intent})},rgb);
    return {pixels,processors};
  }

  function sourceDescription(raw,interpretation={}) {
    const {icc,...selected}=selectResource(raw,interpretation,settings,spaces);
    return {...selected,profile:safeProfile(raw.profile)};
  }

  function importColor(raw,interpretation={},{target='ink'}={}) {
    const selected=selectResource(raw,interpretation,settings,spaces);
    if (!['working','ink'].includes(target)) throw new RangeError('Choose working or Ink linear import');
    const input=rgbInput(raw,interpretation.alpha??raw.alpha);
    const stages=[{src:selected.space,dst:working},...(target==='ink'&&working!==inkLinear?[{src:working,dst:inkLinear}]:[])];
    const {pixels,processors}=execute(input,stages,selected);
    return {raw:{...join(input,pixels),precision:'float32',
      ...(target==='ink'&&{colorSpace:'srgb-linear',profile:{chromaticities:C.srgb}})},
      report:{...sourceDescription(raw,interpretation),working,target:target==='ink'?inkLinear:working,processors}};
  }

  function output(raw,{exposure=0,viewport,fromWorking=false,proofOnly=false}={}) {
    if (!Number.isFinite(exposure)||exposure< -32||exposure>32) throw new RangeError('Display exposure needs −32 to 32 stops');
    const chosen=viewport===undefined?primary:choice({...primary,...viewport});
    const preview=isHDR(chosen.encoding)?proof:chosen;
    if (!preview) throw new TypeError('An HDR display requires a separate SDR palette proof view');
    const image=rgbInput(raw);
    const stages=fromWorking?[]:[{src:inkLinear,dst:working}];
    const process=value=>execute(image,[...stages,{src:working,display:value.display,view:value.view,exposure}]);
    const viewed=proofOnly?null:process(chosen);
    const sdr=preview===chosen&&viewed?viewed:process(preview);
    let palettePixels=sdr.pixels;
    if (preview.encoding==='display-p3') {
      const fit=ColorSpace.prepare({space:'display-p3',outOfRange:'preserve'},{space:'srgb',outOfRange:'preserve'});
      palettePixels=new Float32Array(sdr.pixels.length);
      const input=[0,0,0], out=[0,0,0];
      for(let i=0;i<palettePixels.length;i+=3) {
        for(let c=0;c<3;c++) input[c]=sdr.pixels[i+c];
        palettePixels.set(fit(input,out),i);
      }
    }
    const count=palettePixels.reduce((n,v)=>n+(v<0||v>1),0);
    const value={...join(image,palettePixels,Uint8Array),colorSpace:'srgb'};
    return {value,display:viewed&&join(image,viewed.pixels,Uint16Array),
      report:{working,display:chosen,proof:preview,paletteEncoding:'srgb',exposure,
        clippedPaletteComponents:count,processors:viewed?.processors??sdr.processors,paletteProcessors:sdr.processors}};
  }

  function workingImage(raw) {
    const input=rgbInput(raw);
    const {pixels}=execute(input,inkLinear===working?[]:[{src:inkLinear,dst:working}]);
    return join(input,pixels);
  }
  return {settings,description,sourceDescription,importColor,output,workingImage};
}

function paletteOperation(managed,P) {
  return {
    description:'Convert a scene-linear image to straight sRGB bytes at the palette boundary using the project display view.',
    inputs:{source:'colorImage',exposure:{type:'number',default:0}},
    outputs:{value:'raster',report:'record'},workerLocal:true,
    run({source,exposure}) {
      if (!P.graphImages.valid(source,'color') || !source.descriptor.colorSpace.endsWith('-linear'))
        throw new TypeError('Palette input needs a scene-linear color image');
      const {raster,descriptor}=P.graphImages.convert(source,{intent:'color',colorSpace:'srgb-linear',precision:'float32',
        alpha:source.descriptor.alpha==='none'?'none':'straight'});
      if (managed) {
        const {value,report}=managed.output({...raster,alpha:descriptor.alpha},{exposure,proofOnly:true});
        return {value,report};
      }
      if (!Number.isFinite(exposure)||exposure< -32||exposure>32) throw new RangeError('Display exposure needs −32 to 32 stops');
      const image=rgbInput({...raster,alpha:descriptor.alpha});
      const transfer=ColorSpace.prepare('srgb-linear',{space:'srgb',outOfRange:'clamp'}), gain=2**exposure;
      for(let i=0;i<image.rgb.length;i+=3) image.rgb.set(transfer([image.rgb[i]*gain,image.rgb[i+1]*gain,image.rgb[i+2]*gain]),i);
      return {value:{...join(image,image.rgb,Uint8Array),colorSpace:'srgb'},
        report:{working:'srgb-linear',paletteEncoding:'srgb',mode:'built-in',exposure}};
    }
  };
}

module.exports = { normalize,configure,paletteOperation,safeProfile,encodings,primaries,isHDR };
