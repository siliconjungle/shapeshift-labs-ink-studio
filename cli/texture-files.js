const fs=require('node:fs');
const C=require('./texture-common.js');
const PNG=require('./texture-png.js');
const TIFF=require('./texture-tiff.js');
const EXR=require('./texture-exr.js');
const PSD=require('./texture-psd.js');
const Bitmap=require('../src/bitmap-resources.js');

const formats=['png','tiff','exr','psd','pfm'];
const typed=['typedImage','colorImage','grayImage','normalImage','heightImage'];
const integerMax={unorm8:255,unorm16:65535};

function readTexture(file,options={}) {
  if(!C.fields(options,['encoding','channels','page','rowOrder','layoutOnly']))
    throw new TypeError('Invalid texture read options');
  let input=file;
  if(typeof file==='string'){
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size>C.maxBytes)throw new RangeError('Choose a regular texture file within its byte budget');
    input=fs.readFileSync(file);
  }
  const bytes=C.input(input);
  const magic=bytes.toString('ascii',0,4);
  const detected=magic==='8BPS'?'psd':bytes.readInt32LE(0)===20000630?'exr':
    bytes[0]===137&&magic.slice(1)==='PNG'?'png':/^II|^MM/.test(magic)?'tiff':/^P[Ff][\r\n]/.test(magic)?'pfm':undefined;
  const encoding=options.encoding??detected;
  if(!formats.includes(encoding)||encoding!==detected)throw new TypeError('Unknown texture format or mismatched file signature');
  if(options.channels!==undefined&&encoding!=='exr'||options.page!==undefined&&encoding!=='tiff'||
      options.rowOrder!==undefined&&(encoding!=='pfm'||!['top-down','bottom-up'].includes(options.rowOrder))||
      options.layoutOnly!==undefined&&typeof options.layoutOnly!=='boolean')
    throw new TypeError('Texture selection does not match its encoding');
  let value;
  if(encoding==='png')value=PNG.read(bytes,options);
  if(encoding==='tiff')value=TIFF.read(bytes,options);
  if(encoding==='exr')value=EXR.read(bytes,options);
  if(encoding==='psd')value=PSD.read(bytes);
  if(encoding==='pfm'){
    const image=Bitmap.pfm(bytes,options);
    value={...image,bitDepth:32,alpha:'none',profile:{},colorSpace:'srgb-linear'};
  }
  return {encoding,...value};
}

function reportTexture(file,options={}) {
  const {data:_,composite,masks,layers,profile,...info}=readTexture(file,options);
  const {createHash}=require('node:crypto');
  const {icc,...tags}=profile??{};
  const describeImage=({width,height,channels})=>({width,height,channels});
  return {...info,profile:{...tags,...(icc&&{iccBytes:Buffer.from(icc,'base64').length,iccSha256:createHash('sha256')
    .update(Buffer.from(icc,'base64')).digest('hex')})},
    ...(composite&&{composite:describeImage(composite)}),
    ...(masks&&{masks:Object.fromEntries(Object.entries(masks).map(([name,image])=>[name,describeImage(image)]))}),
    ...(layers&&{layers:layers.map(({image,mask,...entry})=>({...entry,...describeImage(image),hasMask:!!mask}))})};
}

function exportOptions(options) {
  if(!C.fields(options,['encoding','bitDepth','compression'])||!formats.includes(options.encoding))
    throw new TypeError('Texture export needs png, tiff, exr, psd or pfm encoding');
  const {encoding,compression}=options;
  const support=encoding==='png'||encoding==='psd'?[8,16]:encoding==='tiff'?[8,16,32]:encoding==='exr'?[16,32]:[32];
  const compatible=encoding==='exr'?['none','zips','zip']:['none','zip'];
  if(options.bitDepth!==undefined&&!support.includes(options.bitDepth)||
      compression!==undefined&&(!['tiff','psd','exr'].includes(encoding)||!compatible.includes(compression)))
    throw new TypeError('Texture precision or compression does not match '+encoding);
  return options;
}
const defaultDepth=(image,encoding)=>encoding==='exr'||encoding==='pfm'?32:
  image?.descriptor?.precision==='unorm8'?8:
    encoding==='tiff'&&image?.descriptor?.precision!=='unorm16'?32:16;

function typedRaster(P,image,depth,{linear=false,straight=false}={}) {
  if(!P.graphImages.valid(image))throw new TypeError('Texture export needs a typed graph image');
  let value=image;
  const desc=value.descriptor;
  if(desc.intent==='color'){
    const targetSpace=linear?desc.colorSpace.replace(/-linear$/,'')+'-linear':desc.colorSpace;
    const alpha=straight&&desc.alpha==='premultiplied'?'straight':desc.alpha;
    if(targetSpace!==desc.colorSpace||alpha!==desc.alpha)
      value=P.graphImages.convert(image,{intent:'color',colorSpace:targetSpace,alpha,precision:'float32'});
  }
  const {raster:{width,height,channels,data},descriptor}=value;
  C.extent(width,height,channels*depth/8);
  const Type=C.sampleType(depth), sourceMax=integerMax[descriptor.precision]??1, destMax=depth===32?1:2**depth-1;
  const alpha=descriptor.alpha;
  const pixels=new Type(data.length), gray=descriptor.intent==='height';
  if(gray&&depth!==32)throw new TypeError('Physical height needs a float TIFF, OpenEXR or PFM');
  for(let i=0;i<data.length;i++){
    let n=data[i]/sourceMax;
    const coverage=alpha!=='none'&&i%channels===channels-1;
    if(!coverage&&descriptor.intent==='normal'){
      if(depth!==32&&descriptor.domain==='signed-unit')n=(n+1)*.5;
      if(depth===32&&descriptor.domain==='unit')n=n*2-1;
    }
    if(!Number.isFinite(Math.fround(n))||depth!==32&&(n<0||n>1))
      throw new RangeError('Integer textures need normalized samples. Use a float texture for unclamped data.');
    pixels[i]=depth===32?n:Math.round(n*destMax);
  }
  return {width,height,channels,data:pixels,alpha,colorSpace:descriptor.colorSpace};
}

const explicitSource=value=>C.fields(value,['image','profile'])&&Object.hasOwn(value,'image');
function source(value) {
  return explicitSource(value)?value:{image:value};
}
function tagsFor(image,encoding,value) {
  const {bytes,icc,srgb,gamma,chromaticities,whiteLuminance,ocioColorSpace,cicp,mastering,lightLevels}=C.profile(value);
  const color=image.colorSpace!=='none';
  const primaries=color&&(image.colorSpace.startsWith('display-p3')?C.p3:C.srgb);
  const hd=whiteLuminance!==undefined || ocioColorSpace!==undefined, tagged=cicp||mastering||lightLevels;
  if (hd && encoding!=='exr' || tagged && encoding!=='png')
    throw new TypeError('Use OpenEXR for named linear HDR metadata and PNG for cICP or mastering metadata');
  if(encoding==='psd')return icc?{icc}:{};
  if(encoding==='exr') {
    if(bytes)throw new TypeError('Convert ICC-tagged pixels to a known linear space before OpenEXR export');
    const chroma=chromaticities??primaries;
    return {...(chroma&&{chromaticities:chroma}),...(whiteLuminance!==undefined&&{whiteLuminance}),...(ocioColorSpace&&{ocioColorSpace})};
  }
  if(encoding==='tiff')return {...(icc&&{icc}),...((chromaticities||color&&!icc)&&{chromaticities:chromaticities??primaries})};
  if(!color)return value??{};
  if(icc||tagged)return value;
  if (srgb!==undefined || gamma!==undefined || chromaticities!==undefined) return value;
  if(image.colorSpace==='srgb')return {srgb:0};
  if(image.colorSpace.endsWith('linear'))return {gamma:1,chromaticities:primaries};
  throw new TypeError('Display P3 PNG needs an explicit ICC profile');
}

function toPlanes(image,names) {
  const {width,height,channels,data}=image;
  const planes=Object.create(null);
  for(let c=0;c<channels;c++){
    const plane=new Float32Array(width*height);
    for(let p=0;p<plane.length;p++)plane[p]=data[p*channels+c];
    planes[names[c]]=plane;
  }
  return planes;
}
const flatNames={1:['Y'],2:['Y','A'],3:['R','G','B'],4:['R','G','B','A']};

function packExr(P,packet,options) {
  if (Object.keys(packet.channels).length>32)throw new RangeError('EXR material texture supports up to 32 maps');
  let width,height,alpha='none',profile={};
  const planes=Object.create(null);
  for(const [name,{raster,metadata}] of Object.entries(packet.channels)){
    const image=typedRaster(P,raster,32,{linear:true});
    if(width!==undefined&&(image.width!==width||image.height!==height))
      throw new RangeError('EXR material maps need the same extent');
    width=image.width;height=image.height;
    C.extent(width,height,(Object.keys(planes).length+image.channels)*4);
    const lanes=flatNames[image.channels];
    if(name==='baseColor'){
      alpha=image.alpha;
      profile=tagsFor(image,'exr',metadata.profile);
      Object.assign(planes,toPlanes(image,lanes));
    } else {
      const suffix=name==='normal'?['X','Y','Z','A']:name==='flow'?['U','V']:lanes;
      Object.assign(planes,toPlanes(image,image.channels===1?[name]:suffix.map(c=>name+'.'+c)));
    }
  }
  return EXR.write({width,height,planes,alpha},{...options,profile});
}

function psd(P,value,options) {
  if(!C.fields(value,['width','height','layers','masks','composite','profile'])||!Array.isArray(value.layers)||
      !C.uint(value.layers.length,1,128)||value.masks!==undefined&&!C.record(value.masks))
    throw new TypeError('Layered PSD needs a canvas and a raster layer list');
  const { width,height,layers,masks={},composite,profile }=value;
  const depth=options.bitDepth??8, namedMasks=Object.entries(masks);
  if(namedMasks.length>52)throw new RangeError('PSD supports up to 52 named document masks');
  C.extent(width,height,(4+namedMasks.length)*depth/8);
  let budget=width*height*(4+namedMasks.length)*depth/8, colorSpace;
  for (const row of layers){
    if(!C.fields(row,['name','image','mask','x','y','opacity','visible','blend']) ||
        !P.graphImages.valid(row.image))
      throw new TypeError('PSD layers need a typed graph image and valid layer fields');
    const image=row.image.raster;
    budget+=image.width*image.height*(row.mask===undefined?4:5)*depth/8;
    if(budget>C.maxBytes)throw new RangeError('PSD layers exceed their sample budget');
  }
  function color(image) {
    if(image?.descriptor?.intent!=='color')throw new TypeError('PSD layers need typed RGB(A) color images');
    if(colorSpace!==undefined&&colorSpace!==image.descriptor.colorSpace)
      throw new TypeError('PSD color layers need one shared color encoding');
    colorSpace=image.descriptor.colorSpace;
    return typedRaster(P,image,depth,{straight:true});
  }
  const bound=layers.map(({image,mask,...layer})=>({...layer,image:color(image),
    ...(mask!==undefined&&{mask:typedRaster(P,mask,depth)})}));
  const alpha=Object.fromEntries(namedMasks.map(([name,map])=>[name,typedRaster(P,map,depth)]));
  return PSD.write({width,height,layers:bound,masks:alpha,
    ...(composite!==undefined&&{composite:color(composite)}),profile:tagsFor({colorSpace},'psd',profile)},options);
}

function writePfm(image) {
  if(![1,3].includes(image.channels))throw new TypeError('PFM needs one or three float channels without alpha');
  const {width,height,channels,data}=image, stride=width*channels;
  const pixels=Buffer.alloc(data.length*4);
  for(let y=0;y<height;y++)for(let i=0;i<stride;i++)pixels.writeFloatLE(data[(height-y-1)*stride+i],(y*stride+i)*4);
  return Buffer.concat([Buffer.from((channels===1?'Pf':'PF')+'\n'+width+' '+height+'\n-1.0\n'),pixels]);
}
function encodeTexture(P,value,options) {
  const settings=exportOptions(options), {encoding,compression}=settings;
  if(encoding==='psd')return psd(P,value,settings);
  if(encoding==='exr'&&P.materialChannels.valid(value))return packExr(P,value,settings);
  const {image,profile}=source(value), depth=settings.bitDepth??defaultDepth(image,encoding);
  const linear=encoding==='exr'||encoding==='pfm';
  const raster=typedRaster(P,image,linear?32:depth,{linear,straight:encoding==='png'});
  if(encoding==='pfm'){
    if(Object.keys(profile??{}).length)throw new TypeError('PFM stores float samples without a file color profile');
    return writePfm(raster);
  }
  const tags=tagsFor(raster,encoding,profile);
  if(encoding==='png')return PNG.write(raster,tags);
  if(encoding==='tiff')return TIFF.write(raster,tags,compression);
  const names=raster.alpha==='none'&&raster.channels%2===0 ?
    raster.channels===2?['U','V']:['X','Y','Z','W']:flatNames[raster.channels];
  return EXR.write({width:raster.width,height:raster.height,alpha:raster.alpha,planes:toPlanes(raster,names)},
    {bitDepth:depth,compression,profile:tags});
}

module.exports={readTexture,reportTexture,encodeTexture,exportOptions,typed};
