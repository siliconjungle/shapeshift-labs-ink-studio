/* Material mapping and inspection over a single resolved scatter surface. */
const TypedScatterMappers = ({requireImage,alignedGrid,descriptor,wrap,pack,storage,integerMax,convertColor,
  sampler,borders,fields,clone,freeze,hash,hash01}) => {
  const format='ink-studio/scatter-surface', selectionFormat='ink-studio/scatter-selection';
  const known=new WeakSet(), empty=Object.freeze({}), validId=n=>Number.isSafeInteger(n)&&n>0&&n<=4096;
  const range=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const tuple=(p,n,check)=>Array.isArray(p)&&p.length===n&&Array.from(p).every(check);
  const unit=n=>Math.min(1,Math.max(0,n));
  const scalar=spec=>['data','mask'].includes(spec.intent)&&spec.units==='unitless'&&spec.layout==='r';
  const idPlane=spec=>spec.intent==='data'&&spec.units==='unitless'&&spec.layout==='r'&&
    spec.sampling==='nearest'&&['float32','float64'].includes(spec.precision);
  function surface({instanceId,shapeId,uv,coverage,height=null,normal=null,layout=null}) {
    const core={instanceId,shapeId,uv,coverage}, first=requireImage(instanceId).raster;
    if(first.width*first.height>1e6) throw new RangeError('Scatter surface exceeds its texel budget');
    for(const source of [...Object.values(core),...[height,normal].filter(source=>source!==null)]){
      const image=requireImage(source);
      if(!alignedGrid(instanceId,image)||image.descriptor.tiling.u!==instanceId.descriptor.tiling.u||
        image.descriptor.tiling.v!==instanceId.descriptor.tiling.v)
        throw new RangeError('Scatter maps must have aligned grids and addressing');
    }
    if(!idPlane(instanceId.descriptor)||!idPlane(shapeId.descriptor)||
      uv.descriptor.intent!=='data'||uv.descriptor.layout!=='rg'||uv.descriptor.units!=='uv'||
      !['float32','float64'].includes(uv.descriptor.precision)||coverage.descriptor.intent!=='mask'||
      height!==null&&height.descriptor.intent!=='height'||normal!==null&&normal.descriptor.intent!=='normal')
      throw new TypeError('Scatter surface needs discrete IDs, planar RG UVs, coverage and optional height and normal');
    const a=first.data,b=shapeId.raster.data,c=coverage.raster.data, divisor=integerMax(coverage.descriptor.precision)||1;
    const shapes=new Map();
    for(let p=0;p<a.length;p++){
      if(a[p]===0&&b[p]===0&&c[p]===0) continue;
      if(!validId(a[p])||!validId(b[p])||!range(c[p]/divisor,Number.MIN_VALUE,1)||
        shapes.has(a[p])&&shapes.get(a[p])!==b[p])
        throw new RangeError('Scatter IDs and coverage must identify the same visible instance');
      shapes.set(a[p],b[p]);
    }
    if(layout!==null){
      if(!fields(layout,Object.keys(layout))||!Array.isArray(layout.placements)||layout.placements.length>4096)
        throw new TypeError('Scatter layout needs a bounded placement list');
      const ids=new Set();
      for(const row of layout.placements){
        if(!validId(row?.id)||!validId(row?.shapeId)||ids.has(row.id)||
          shapes.has(row.id)&&shapes.get(row.id)!==row.shapeId)
          throw new RangeError('Scatter layout is inconsistent with the visible instance IDs');
        ids.add(row.id);
      }
      if([...shapes.keys()].some(id=>!ids.has(id))) throw new RangeError('Scatter layout omits a visible instance');
    }
    const packet=Object.freeze({format,version:1,...core,height,normal,layout:layout===null?null:freeze(clone(layout))});
    known.add(packet);
    return packet;
  }
  function read(source) {
    if(known.has(source)) return source;
    if(source?.format!==format||source.version!==1) throw new TypeError('Expected a version 1 scatter surface');
    return surface(source);
  }
  function valid(source) {
    try { read(source);return true; } catch { return false; }
  }

  function idList(list) {
    return Array.isArray(list)&&list.length<=4096&&Array.from(list).every(validId)&&new Set(list).size===list.length;
  }
  function isSelection(value) {
    return value?.format===selectionFormat&&value.version===1&&idList(value.ids);
  }
  function selector(options,seed) {
    if(isSelection(options)){
      const ids=new Set(options.ids);
      return id=>ids.has(id);
    }
    if(!fields(options,['instanceIds','shapeIds','instanceRange','shapeRange','fraction','invert','seed']))
      throw new TypeError('Unknown scatter selection option');
    const {instanceIds,shapeIds,instanceRange,shapeRange,fraction=1,invert=false,seed:key=seed}=options;
    if(![instanceIds,shapeIds].every(ids=>ids===undefined||idList(ids))||
      ![instanceRange,shapeRange].every(r=>r===undefined||tuple(r,2,validId)&&r[0]<=r[1])||
      !range(fraction,0,1)||typeof invert!=='boolean'||!Number.isSafeInteger(key))
      throw new RangeError('Invalid scatter selection IDs, fraction or seed');
    const chosen=instanceIds&&new Set(instanceIds), kinds=shapeIds&&new Set(shapeIds), salt=hash('scatter subset/'+key);
    return (id,shape)=>id>0&&invert!==Boolean((!chosen||chosen.has(id))&&(!kinds||kinds.has(shape))&&
      (!instanceRange||range(id,...instanceRange))&&(!shapeRange||range(shape,...shapeRange))&&
      hash01(String(id),salt)<fraction);
  }
  function meta(source) {
    const {tiling,pixelPitchMm,materialSeed}=source.coverage.descriptor;
    return {tiling,pixelPitchMm,materialSeed};
  }
  function selection(source,choose) {
    const {width,height,pivot,data:ids}=source.instanceId.raster, shapes=source.shapeId.raster.data;
    const coverage=source.coverage.raster.data, divisor=integerMax(source.coverage.descriptor.precision)||1;
    const data=new Float32Array(ids.length), found=new Map();
    for(let p=0;p<ids.length;p++){
      const id=ids[p];
      if(!id) continue;
      if(!found.has(id)) found.set(id,choose(id,shapes[p]));
      if(found.get(id)) data[p]=coverage[p]/divisor;
    }
    const grid={width,height,pivot,channels:1,data};
    const value=wrap(grid,descriptor(grid,{intent:'mask',precision:'float32',...meta(source)}));
    return {value,selection:freeze({format:selectionFormat,version:1,ids:[...found].filter(([,v])=>v).map(([k])=>k).sort((a,b)=>a-b)})};
  }
  function mask(surface,options={},seed=0) {return selection(read(surface),selector(options,seed));}
  function inspect(input,options={}) {
    const source=read(input);
    if(!fields(options,['pixel','instanceId'])||Object.hasOwn(options,'pixel')&&Object.hasOwn(options,'instanceId'))
      throw new TypeError('Scatter inspection takes one pixel or one instance ID');
    const {pixel=[0,0],instanceId}=options, {width,height,data:ids}=source.instanceId.raster;
    if(instanceId===undefined&&!tuple(pixel,2,n=>Number.isSafeInteger(n)&&n>=0)||
      instanceId===undefined&&(pixel[0]>=width||pixel[1]>=height)||instanceId!==undefined&&!validId(instanceId))
      throw new RangeError('Scatter inspection needs an in-bounds pixel or a positive instance ID');
    const p=instanceId===undefined?pixel[1]*width+pixel[0]:ids.indexOf(instanceId), id=instanceId??ids[p];
    const stamp=selection(source,x=>x===id).value, {data}=stamp.raster;
    let visiblePixels=0,coverageSum=0,firstX=width,firstY=height,lastX=0,lastY=0;
    for(let i=0;i<data.length;i++) if(data[i]){
      const x=i%width,y=Math.floor(i/width);
      visiblePixels++;coverageSum+=data[i];firstX=Math.min(firstX,x);firstY=Math.min(firstY,y);
      lastX=Math.max(lastX,x+1);lastY=Math.max(lastY,y+1);
    }
    const placement=source.layout?.placements.find(row=>row.id===id)??null;
    const status=!id?'background':visiblePixels?'visible':placement?'occluded':'missing';
    const normalAt=()=>{
      if(!source.normal)return null;
      const {raster:{data,channels},descriptor:spec}=source.normal, i=p*channels;
      const max=integerMax(spec.precision);
      const alpha=spec.alpha==='premultiplied'?data[i+3]/(max||1):1;
      return alpha?[0,1,2].map(k=>(max?2*data[i+k]/max-1:data[i+k])/alpha):[0,0,1];
    };
    const sample=p<0?null:{texel:[p%width,Math.floor(p/width)],coverage:data[p],
      uv:id?Array.from(source.uv.raster.data.slice(p*2,p*2+2)):null,height:source.height?.raster.data[p]??null,
      normal:normalAt()};
    return {value:freeze({status,instanceId:id,shapeId:p>=0?source.shapeId.raster.data[p]:placement?.shapeId??0,
      visiblePixels,coverageSum,bounds:visiblePixels?[firstX,firstY,lastX,lastY]:null,placement,sample}),mask:stamp};
  }

  function edit(selection,options={}) {
    if(!isSelection(selection)||!fields(options,['action','shapeId'])) throw new TypeError('Scatter edit needs a valid selection and edit options');
    const {action='hide',shapeId}=options;
    if(!['hide','replace'].includes(action)||action==='replace'&&!range(shapeId,1,32)||
      action==='replace'&&!Number.isSafeInteger(shapeId)||action==='hide'&&shapeId!==undefined)
      throw new RangeError('Scatter edit needs hide or a replacement library shape ID');
    return freeze(action==='hide'?{hide:selection.ids.slice()}:{replace:selection.ids.map(id=>({id,shapeId}))});
  }

  function optionsFor(options,seed) {
    if(!fields(options,['mode','value','opacity','textureBy','uvScale','uvOffset','uvAngle','filter','border','seed']))
      throw new TypeError('Unknown scatter mapper option');
    const {mode='replace',value,opacity=1,textureBy='shape',uvScale=[1,1],uvOffset=[0,0],uvAngle=0,
      filter='image',border,seed:key=seed}=options;
    if(!['replace','tint'].includes(mode)||!range(opacity,0,1)||!['shape','instance','random'].includes(textureBy)||
      !tuple(uvScale,2,n=>range(n,-64,64)&&n!==0)||!tuple(uvOffset,2,n=>range(n,-64,64))||
      !Number.isFinite(uvAngle)||!['image','nearest','linear'].includes(filter)||!Number.isSafeInteger(key))
      throw new RangeError('Invalid scatter mapping mode, opacity, UV transform or texture picking');
    if(border!==undefined)borders(border,{u:'clamp',v:'clamp'});
    const a=uvAngle%360*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    return {mode,value,opacity,textureBy,uvScale,uvOffset,c,s,filter,border,key};
  }
  function color(value) {
    const rgba=tuple(value,4,n=>range(n,0,1))?value:[...ColorCurves.color(value),1];
    return [...ColorSpace.convert(rgba,'srgb','srgb-linear'),rgba[3]];
  }
  function reader(source,kind,config) {
    const {raster:{width,height,channels,data},descriptor:spec}=requireImage(source);
    if(kind==='color'?spec.intent!=='color':!scalar(spec)) throw new TypeError('Scatter '+kind+' texture has an incompatible image type');
    const edges=config.border===undefined?spec.tiling:borders(config.border,spec.tiling);
    const filter=config.filter==='image'?spec.sampling:config.filter, divisor=integerMax(spec.precision)||1;
    const values=new Float64Array(kind==='color'?4:1), rgba=[0,0,0], decode=kind==='color'&&convertColor(spec,'srgb-linear');
    const accumulate=kind==='color'?(i,out,w)=>{
      const a=decode(data,i,rgba)*w;
      if(!a)return;
      for(let c=0;c<3;c++)out[c]+=rgba[c]*a;
      out[3]+=a;
    }:(i,out,w)=>{out[0]+=unit(data[i]/divisor)*w;};
    const at=sampler({width,height,accumulate},channels,filter,TextureAddress.axis(edges.u),TextureAddress.axis(edges.v));
    return (u,v)=>{
      values.fill(0);at(u,v,1,values);
      if(kind==='color'&&values[3])for(let c=0;c<3;c++) values[c]/=values[3];
      return values;
    };
  }
  function map(input,base,textures=[],select=empty,options=empty,seed=0,kind='color') {
    const source=read(input), config=optionsFor(options,seed);
    const {mode,value:solid,opacity,textureBy,uvScale,uvOffset,c,s,key}=config;
    if(!Array.isArray(textures)||textures.length>32) throw new RangeError('Scatter mapper supports up to 32 textures');
    if(!base&&mode==='tint') throw new TypeError('Scatter tint needs a base image');
    const colored=kind==='color', frame=source.instanceId.raster;
    if(base){
      const {descriptor:spec}=requireImage(base);
      if(!alignedGrid(source.instanceId,base)||(colored?spec.intent!=='color':!scalar(spec)))
        throw new TypeError('Scatter mapper needs an aligned '+kind+' base image');
    }
    const selected=mask(source,select,seed).value;
    const readers=Array.from(textures,img=>reader(img,kind,config));
    const ink=colored?color(solid??'#ffffff'):[solid??1];
    if(!colored&&!range(ink[0],0,1))throw new RangeError('Scatter grayscale value must be in [0,1]');
    const {width,height,pivot}=frame, channels=base?.raster.channels??(colored?4:1);
    const grid={width,height,pivot,channels}, spec=base?.descriptor??descriptor(grid,{
      intent:colored?'color':'data',precision:colored?'unorm8':'float32',...meta(source)});
    const Data=storage[spec.precision], out=base?Data.from(base.raster.data):new Data(width*height*channels);
    const {data:weights}=selected.raster, {data:uv}=source.uv.raster;
    const ids=source.instanceId.raster.data, shapes=source.shapeId.raster.data;
    const rgb=[0,0,0], encoded=[0,0,0], divisor=integerMax(spec.precision)||1;
    const decode=colored&&base&&convertColor(spec,'srgb-linear');
    const encode=colored&&ColorSpace.prepare('srgb-linear',{space:spec.colorSpace,outOfRange:spec.domain==='unit'?'clamp':'preserve'});
    const salt=hash('scatter texture/'+key);
    for(let p=0,i=0;p<weights.length;p++,i+=channels){
      const weight=weights[p]*opacity;
      if(!weight) continue;
      const id=ids[p], type=shapes[p];
      const pick=textureBy==='random'?Math.floor(hash01(String(id),salt)*readers.length):textureBy==='instance'?id-1:type-1;
      const a=uv[p*2]-.5,b=uv[p*2+1]-.5;
      const sample=readers.length?readers[pick%readers.length]((.5+c*a-s*b)*uvScale[0]+uvOffset[0],
        (.5+s*a+c*b)*uvScale[1]+uvOffset[1]):null;
      if(!colored){
        const previous=out[i]/divisor, next=ink[0]*(sample?.[0]??1)*(mode==='tint'?previous:1);
        out[i]=pack(previous+(next-previous)*weight,spec,false,'clamp');
        continue;
      }
      const amount=unit(weight*ink[3]*(sample?.[3]??1));
      if(!amount)continue;
      const was=decode?decode(base.raster.data,i,rgb):0;
      const alpha=mode==='replace'?amount+was*(1-amount):was;
      // Keep zero-alpha tint texels byte-for-byte intact.
      if(!alpha) continue;
      for(let c=0;c<3;c++){
        const tint=ink[c]*(sample?.[c]??1);
        rgb[c]=mode==='tint'?rgb[c]*(1-amount+tint*amount):(tint*amount+rgb[c]*was*(1-amount))/alpha;
      }
      encode(rgb,encoded);
      const gain=spec.alpha==='premultiplied'?alpha:1;
      for(let c=0;c<3;c++)out[i+c]=pack(encoded[c]*gain,spec,false,'clamp');
      if(channels===4)out[i+3]=pack(alpha,spec,true,'clamp');
    }
    return {value:wrap({...grid,data:out},spec),mask:selected};
  }
  return Object.freeze({surface,valid,mask,inspect,edit,
    color:(src,base,textures,select,options,seed)=>map(src,base,textures,select,options,seed,'color'),
    grayscale:(src,base,textures,select,options,seed)=>map(src,base,textures,select,options,seed,'gray')});
};
