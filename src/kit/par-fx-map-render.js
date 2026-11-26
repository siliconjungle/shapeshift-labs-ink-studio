/* Tile-binned compositing for affine FX Map stamps. */
const FxMapRender=(function (P) {
  const G=P.graphImages, record=P.graphTypes.validator('record'), gray=P.graphTypes.validator('grayImage');
  const finite=Number.isFinite, own=Object.hasOwn, clamp=n=>Math.max(0,Math.min(1,n));
  const display=ColorSpace.prepare('srgb-linear',{space:'srgb',outOfRange:'clamp'});
  const linear=ColorSpace.prepare('srgb','srgb-linear');
  const luma=rgb=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  const storage={unorm8:[Uint8Array,255],unorm16:[Uint16Array,65535],float32:[Float32Array,0]};
  const modes={normal:'copy',multiply:'multiply',screen:'screen',add:'add',lighten:'max',darken:'min',subtract:'subtract'};
  const filters=['image','nearest','linear'], alphaModes=['source','ignore','luminance'];
  const address=['image','clamp','wrap','mirror','transparent'];
  const maxTexels=4194304, side=8;

  function color(value) {
    if(finite(value)&&value>=0&&value<=1)return [value,value,value,1];
    const lanes=Array.isArray(value)?value.slice():ColorCurves.color(value);
    if(![3,4].includes(lanes.length)||!Array.from(lanes).every(n=>finite(n)&&n>=0&&n<=1))
      throw new TypeError('FX Map color needs display RGB(A) or a normalized scalar');
    return [...linear(lanes.slice(0,3)),lanes[3]??1];
  }

  function settings(options,width,height) {
    const allowed=['background','samples','precision','wrap','seed'];
    if(!record(options)||Object.keys(options).some(key=>!allowed.includes(key)))
      throw new TypeError('Invalid FX Map options');
    const {background=[0,0,0,0],samples=1,precision='unorm8',wrap=[true,true],seed}=options;
    if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=8192)||width*height>maxTexels||
        ![1,2,4].includes(samples)||!own(storage,precision)||!Array.isArray(wrap)||wrap.length!==2||
        !Array.from(wrap).every(v=>typeof v==='boolean')||seed!==undefined&&!Number.isSafeInteger(seed))
      throw new RangeError('FX Map needs a bounded extent, sampling, precision, wrap, and integer seed');
    return {base:color(background),samples,precision,wrap:Array.from(wrap),seed};
  }

  function imageOptions(value) {
    const {filter='image',alpha='source',wrapU='image',wrapV='image',uv=[0,0,1,1]}=value;
    if(!filters.includes(filter)||!alphaModes.includes(alpha)||![wrapU,wrapV].every(mode=>address.includes(mode))||
        !Array.isArray(uv)||uv.length!==4||!Array.from(uv).every(n=>finite(n)&&Math.abs(n)<=64)||
        uv[0]===uv[2]||uv[1]===uv[3])
      throw new TypeError('FX Map pattern needs a valid image filter, alpha, addressing, and UV rectangle');
    return {filter,alpha,wrapU,wrapV,uv:uv.slice()};
  }

  function imageReader(source,options,cache) {
    const {filter,alpha,wrapU,wrapV,uv}=options, {descriptor:spec}=source;
    if(!cache.has(source))cache.set(source,new Map());
    const entries=cache.get(source);
    const colorImage=spec.intent==='color', coverageRead=alpha==='source';
    // Encode premultiplied linear samples once, then reuse the same taps for every instance.
    if(!entries.has(alpha)){
      const {raster:{width,height,data}}=colorImage?G.convert(source,{
        intent:'color',precision:'float32',colorSpace:'srgb-linear',
        layout:coverageRead?'rgba':alpha==='ignore'?'rgb':'rgba',
        alpha:coverageRead?'premultiplied':alpha==='ignore'?'none':'straight'
      },{dropAlpha:alpha==='ignore',outOfRange:'clamp'}):G.convert(source,{intent:spec.intent,precision:'float32'});
      if(width*height>maxTexels)throw new RangeError('FX Map source image exceeds its texel budget');
      const values=new Float32Array(width*height*4);
      for(let i=0,k=0;i<width*height;i++,k+=4){
        if(colorImage&&coverageRead){
          values[k]=clamp(data[k]);values[k+1]=clamp(data[k+1]);values[k+2]=clamp(data[k+2]);values[k+3]=data[k+3];
        }else if(colorImage&&alpha==='ignore'){
          values[k]=clamp(data[i*3]);values[k+1]=clamp(data[i*3+1]);values[k+2]=clamp(data[i*3+2]);values[k+3]=1;
        }else {
          const amount=colorImage?clamp(.2126*data[k]+.7152*data[k+1]+.0722*data[k+2])*data[k+3]:clamp(data[i]);
          const a=alpha==='ignore'?1:amount, tint=alpha==='ignore'?amount:1;
          values[k]=values[k+1]=values[k+2]=tint*a;values[k+3]=a;
        }
      }
      entries.set(alpha,{values,width,height});
    }
    const {values,width,height}=entries.get(alpha);
    const sampling=filter==='image'?spec.sampling:filter;
    const sampler=TextureAddress.sampler(values,width,height,TextureAddress.settings({filter:sampling,
      edgeU:wrapU==='image'?spec.tiling.u:wrapU,edgeV:wrapV==='image'?spec.tiling.v:wrapV}));
    return {cost:sampling==='linear'?8:2,read(u,v,out){
      sampler(uv[0]+(uv[2]-uv[0])*u,uv[1]+(uv[3]-uv[1])*v,out);
    }};
  }

  function preparedPatterns(patterns,images,background) {
    let packed=0;
    const cache=new WeakMap();
    function reader(source,options) {
      if(!cache.get(source)?.has(options.alpha)){
        packed+=source.raster.width*source.raster.height;
        if(packed>maxTexels)throw new RangeError('FX Map exceeds its source texel budget');
      }
      return imageReader(source,options,cache);
    }
    const base=background===null?null:reader(background,imageOptions({alpha:background.descriptor.intent==='color'?'source':'ignore'}));
    return {base,get(id){
      const pattern=patterns.get(id);
      if(pattern.read)return pattern;
      const {shape,image,options}=pattern;
      const prepared=shape?{cost:shape.cost,read(u,v,out){
        const a=shape.scalar(u,v);
        out[0]=out[1]=out[2]=out[3]=clamp(a);
      }}:reader(images[image],options);
      patterns.set(id,prepared);
      return prepared;
    }};
  }

  function bucketsFor(stamps,width,height,wrap,samples) {
    const columns=Math.ceil(width/side), rows=Math.ceil(height/side);
    const buckets=Array.from({length:columns*rows},()=>[]);
    const axis=(center,extent,loop)=>{
      if(!loop)return [0];
      const first=Math.ceil(-center-extent), last=Math.floor(1-center+extent);
      if(last-first>6)throw new RangeError('FX Map stamp spans too many wrapped copies');
      return Array.from({length:Math.max(0,last-first+1)},(_,i)=>first+i);
    };
    let work=0;
    for(const stamp of stamps){
      const {frame:{x,y,a,b,c,d},pattern}=stamp;
      const u=wrap[0]?x-Math.floor(x):x, v=wrap[1]?y-Math.floor(y):y;
      const ex=(Math.abs(a)+Math.abs(c))/2, ey=(Math.abs(b)+Math.abs(d))/2, determinant=a*d-b*c;
      if(Math.abs(determinant)<1e-18)continue;
      const inv=[d/determinant,-b/determinant,-c/determinant,a/determinant];
      for(const dx of axis(u,ex,wrap[0]))for(const dy of axis(v,ey,wrap[1])){
        const x=u+dx,y=v+dy, left=Math.max(0,Math.floor((x-ex)*width/side)), right=Math.min(columns,Math.ceil((x+ex)*width/side));
        const top=Math.max(0,Math.floor((y-ey)*height/side)),bottom=Math.min(rows,Math.ceil((y+ey)*height/side));
        const tiles=Math.max(0,right-left)*Math.max(0,bottom-top);
        work+=tiles*side*side*(samples*samples+(samples>1?1:0))*(pattern.cost+1);
        if(work>120e6)throw new RangeError('FX Map exceeds its raster work budget');
        const item={stamp,x,y,inv};
        for(let ty=top;ty<bottom;ty++)for(let tx=left;tx<right;tx++)buckets[ty*columns+tx].push(item);
      }
    }
    return {buckets,columns,work};
  }

  function render({width,height,mode,stamps,base,config}) {
    const {samples,precision,wrap,base:fill}=config, channels=mode==='gray'?1:4, pixels=width*height;
    const [Type,max]=storage[precision], output=new Type(pixels*channels), coverage=new Float32Array(pixels), ids=new Float32Array(pixels);
    const {buckets,columns,work:stampWork}=bucketsFor(stamps,width,height,wrap,samples);
    const work=stampWork+pixels*samples*samples*(1+(base?.cost??0));
    if(work>120e6)throw new RangeError('FX Map exceeds its raster work budget');
    const incoming=new Float64Array(4), best=new Float64Array(4), pixel=new Float64Array(4), total=new Float64Array(5);
    const store=n=>max?Math.round(clamp(n)*max):clamp(n);

    function over(color,alpha,blend) {
      const previous=pixel[3], retained=1-alpha;
      for(let c=0;c<3;c++)
        pixel[c]=pixel[c]*retained+alpha*((1-previous)*color[c]+(previous?previous*clamp(blend(pixel[c]/previous,color[c])):0));
      pixel[3]=previous+alpha*(1-previous);
    }

    function sample(u,v,items,labelsOnly=false) {
      let stampAlpha=0, last=0;
      if(!labelsOnly){
        for(let c=0;c<3;c++)pixel[c]=fill[c]*fill[3];
        pixel[3]=fill[3];
        if(base){
          base.read(u,v,incoming);
          if(incoming[3]){
            const alpha=incoming[3];
            for(let c=0;c<3;c++)incoming[c]/=alpha;
            over(incoming,alpha,RasterBlendModes.copy);
          }
        }
      }
      for(let i=0;i<items.length;){
        const stamp=items[i].stamp, {pattern,tint,opacity,blend,id}=stamp;
        best.fill(0);
        do {
          const {x,y,inv:[a,b,c,d]}=items[i++], dx=u-x,dy=v-y;
          const tx=.5+a*dx+c*dy,ty=.5+b*dx+d*dy;
          if(tx<0||tx>=1||ty<0||ty>=1)continue;
          pattern.read(tx,ty,incoming);
          if(incoming[3]>best[3])best.set(incoming);
        } while(i<items.length&&items[i].stamp===stamp);
        const alpha=best[3]*tint[3]*opacity;
        if(alpha<=0)continue;
        last=id;
        if(labelsOnly)continue;
        stampAlpha+=alpha*(1-stampAlpha);
        for(let c=0;c<3;c++)best[c]=best[c]*tint[c]/best[3];
        over(best,alpha,blend);
      }
      if(!labelsOnly){
        for(let c=0;c<4;c++)total[c]+=pixel[c];
        total[4]+=stampAlpha;
      }
      return last;
    }

    const count=samples*samples;
    for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++,i++){
      const items=buckets[Math.floor(y/side)*columns+Math.floor(x/side)], at=i*channels;
      total.fill(0);
      if(samples===1)ids[i]=sample((x+.5)/width,(y+.5)/height,items);
      else{
        for(let j=0;j<samples;j++)for(let k=0;k<samples;k++)
          sample((x+(k+.5)/samples)/width,(y+(j+.5)/samples)/height,items);
        ids[i]=sample((x+.5)/width,(y+.5)/height,items,true);
      }
      coverage[i]=total[4]/count;
      if(mode==='gray')output[at]=store(luma(total)/count);
      else{
        const a=total[3];
        if(a>0){
          const rgb=display([total[0]/a,total[1]/a,total[2]/a]);
          for(let c=0;c<3;c++)output[at+c]=store(rgb[c]);
        }
        output[at+3]=store(a/count);
      }
    }
    const tiling={u:wrap[0]?'wrap':'clamp',v:wrap[1]?'wrap':'clamp'};
    return {
      value:G.declare({width,height,channels,data:output},mode==='gray'?
        {intent:'data',precision,tiling}:{intent:'color',precision,colorSpace:'srgb',tiling}),
      coverage:G.declare({width,height,data:coverage},{intent:'mask',tiling}),
      stampId:G.declare({width,height,data:ids},{intent:'data',tiling}),
      work
    };
  }

  const validImage=value=>gray(value)||G.valid(value,'color');
  return Object.freeze({color,settings,imageOptions,preparedPatterns,render,validImage,
    blend(name){if(!own(modes,name))throw new TypeError('Invalid FX Map blend '+String(name));return RasterBlendModes[modes[name]];}});
})(KIT.procedural);
