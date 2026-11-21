/* Raster filters in premultiplied color, with explicit sampling boundaries. */
(function (P) {
  const R = P.raster, valid = P.graphTypes.validator('raster');
  const finite = Number.isFinite;
  const unit = n => Math.max(0,Math.min(1,n));
  const byte = n => Math.round(Math.max(0,Math.min(255,n)));
  const int = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
  const tuple = (value,n,check=finite) => Array.isArray(value) && value.length===n && Array.from(value).every(check);
  const plane = (width,height,data) => ({width,height,channels:1,data});
  const validateEdge = edge => {
    if (!['clamp','transparent','wrap'].includes(edge)) throw new TypeError('Pixel filter edge must be clamp, transparent or wrap');
  };

  function view(source) {
    if (!valid(source) || source.width>8192 || source.height>8192 || source.width*source.height>4e6)
      throw new RangeError('Pixel effects need a bounded raster of at most four million pixels');
    return source;
  }

  function channel(source,name) {
    const {width,height,data}=view(source), count=source.channels ?? data.length/(width*height);
    return R.channel(source,{channel:name ?? (count===2 || count===4 ? 'alpha' : 'luma')}).data;
  }

  function alpha(source,p) {
    const count=source.channels ?? source.data.length/(source.width*source.height);
    return count===2 || count===4 ? unit(source.data[p*count+count-1]/255) : 1;
  }

  function image(source) { return R.rgba(view(source)); }

  function boundary(edge) {
    if (edge==='wrap') return (n,span) => ((n%span)+span)%span;
    if (edge==='clamp') return (n,span) => Math.max(0,Math.min(span-1,n));
    return (n,span) => n>=0 && n<span ? n : -1;
  }

  function checkWork(width,height,taps) {
    if (width*height*taps>96e6) throw new RangeError('Pixel filter exceeds its sample budget');
  }

  function weights(radius,kind='gaussian',sigma=Math.max(.5,radius/2)) {
    if (!int(radius,0,64) || !['box','gaussian'].includes(kind) || !finite(sigma) || sigma<=0)
      throw new RangeError('Blur needs a radius from 0 to 64 and a positive sigma');
    const values=Array.from({length:2*radius+1},(_,i) => kind==='box' || i===radius ? 1 :
      Math.exp(-.5*((i-radius)/sigma)**2));
    const sum=values.reduce((a,b)=>a+b);
    return values.map(value=>value/sum);
  }

  function convolve(data,width,height,channels,taps,edge) {
    const {length}=data, result=new Float32Array(length), bound=boundary(edge);
    const sum=new Float64Array(channels);
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      sum.fill(0);
      for (const [dx,dy,w] of taps) {
        const u=bound(x+dx,width), v=bound(y+dy,height);
        if (u<0 || v<0) continue;
        const from=(v*width+u)*channels;
        for (let c=0; c<channels; c++) sum[c]+=data[from+c]*w;
      }
      result.set(sum,(y*width+x)*channels);
    }
    return result;
  }

  function separable(data,width,height,channels,kernel,edge) {
    const r=(kernel.length-1)/2;
    if (!r) return data;
    checkWork(width,height,kernel.length*2);
    const horizontal=kernel.map((w,i)=>[i-r,0,w]), vertical=kernel.map((w,i)=>[0,i-r,w]);
    const first=convolve(data,width,height,channels,horizontal,edge);
    return convolve(first,width,height,channels,vertical,edge);
  }

  function customKernel(kernel) {
    const h=kernel?.length, w=kernel?.[0]?.length;
    if (!int(h,1,31) || !int(w,1,31) || !(w%2 && h%2) ||
        !Array.isArray(kernel) || !Array.from(kernel).every(row=>tuple(row,w,n=>finite(n) && n>=0)))
      throw new TypeError('A blur kernel needs odd dimensions up to 31 and nonnegative weights');
    const total=kernel.reduce((sum,row)=>sum+row.reduce((a,b)=>a+b,0),0);
    if (!finite(total) || !total) throw new RangeError('A blur kernel needs a finite positive weight sum');
    return kernel.flatMap((row,y)=>row.map((value,x)=>[x-(w-1)/2,y-(h-1)/2,value/total])).filter(t=>t[2]);
  }

  function premultiply(value) {
    const {data}=value, out=new Float32Array(data.length);
    for (let i=0;i<data.length;i+=4) {
      for (let c=0;c<3;c++) out[i+c]=data[i+c]*data[i+3]/255;
      out[i+3]=data[i+3];
    }
    return out;
  }

  function resolve(value,samples) {
    const {data}=value;
    for (let i=0;i<data.length;i+=4) {
      const a=samples[i+3];
      data[i+3]=byte(a);
      for (let c=0;c<3;c++) data[i+c]=data[i+3] ? byte(255*samples[i+c]/a) : 0;
    }
    return value;
  }

  function layout({width,height}, size, taps, row, count) {
    const pixels=width*height;
    if (!int(width,1,8192) || !int(height,1,8192) || pixels>16777216)
      throw new RangeError('Tiled filters need a raster within the canvas budget');
    size ??= pixels>1048576 ? 256 : false;
    if (size!==false && !int(size,1,1024) && !tuple(size,2,n=>int(n,1,1024)))
      throw new TypeError('Filter tileSize needs an integer or two integers from 1 to 1024, or false');
    const radius=row ? (row.length-1)/2 : 0;
    let left=radius,right=radius,top=radius,bottom=radius;
    for (const [dx,dy] of taps ?? []) {
      left=Math.max(left,-dx); right=Math.max(right,dx);
      top=Math.max(top,-dy); bottom=Math.max(bottom,dy);
    }
    const halo={left,right,top,bottom}, resultBytes=pixels*4;
    if (size===false || count===0) {
      if (size===false && pixels>4e6) throw new RangeError('Pixel effects need tiling above four million pixels');
      checkWork(width,height,count);
      return {width,height,halo,tileSize:null,tiles:1,strategy:'whole',resultBytes,
        scratchBytes:pixels*(count===0 ? 0 : row ? 48 : 32)+(count ? 32 : 0),samples:pixels*count};
    }
    const [sx,sy]=Array.isArray(size) ? size : [size,size];
    const tw=Math.min(sx,width), th=Math.min(sy,height), columns=Math.ceil(width/tw), rows=Math.ceil(height/th);
    const extended=(tw+left+right)*(th+top+bottom);
    // A sparse path can jump millions of pixels. In that case, gather its taps directly.
    const gather=!row && extended>Math.max(262144,4*tw*th);
    const samples=row ? (2*pixels+width*rows*2*radius)*row.length : pixels*count;
    if (samples>512e6) throw new RangeError('Tiled filter exceeds its total sample budget');
    return {width,height,halo,tileSize:[tw,th],tiles:columns*rows,strategy:gather?'gather':'halo',resultBytes,samples,
      scratchBytes:(gather ? 0 : extended*16)+(row ? tw*(th+top+bottom)*16 : 0)+52};
  }

  function tiled(source, {plan,taps,row,edge}) {
    const {width,height,pivot,read}=R.rgbaReader(source), bound=boundary(edge);
    const {tileSize:[tw,th],halo:{left,right,top,bottom},strategy}=plan;
    const data=new Uint8Array(plan.resultBytes), rgba=new Uint8Array(4), sum=new Float64Array(4), sample=new Float32Array(4);
    const gathered=strategy==='gather', loaded=gathered ? null : new Float32Array((tw+left+right)*(th+top+bottom)*4);
    const first=row ? new Float32Array(tw*(th+top+bottom)*4) : null;

    function load(x,y,out,dst) {
      const u=bound(x,width), v=bound(y,height);
      if (u<0 || v<0) { out.fill(0,dst,dst+4); return; }
      read(v*width+u,rgba);
      for (let c=0;c<3;c++) out[dst+c]=rgba[c]*rgba[3]/255;
      out[dst+3]=rgba[3];
    }
    function store(dst) {
      const a=Math.fround(sum[3]);
      data[dst+3]=byte(a);
      for (let c=0;c<3;c++) data[dst+c]=data[dst+3] ? byte(255*Math.fround(sum[c])/a) : 0;
    }

    for (let oy=0;oy<height;oy+=th) for (let ox=0;ox<width;ox+=tw) {
      const w=Math.min(tw,width-ox), h=Math.min(th,height-oy), stride=w+left+right, rows=h+top+bottom;
      if (loaded) for (let y=0;y<rows;y++) for (let x=0;x<stride;x++)
        load(ox+x-left,oy+y-top,loaded,(y*stride+x)*4);
      if (row) for (let y=0;y<rows;y++) for (let x=0;x<w;x++) {
        sum.fill(0);
        for (let k=0;k<row.length;k++) {
          const from=(y*stride+x+k)*4;
          for (let c=0;c<4;c++) sum[c]+=loaded[from+c]*row[k];
        }
        first.set(sum,(y*w+x)*4);
      }
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        sum.fill(0);
        if (row) for (let k=0;k<row.length;k++) {
          const from=((y+k)*w+x)*4;
          for (let c=0;c<4;c++) sum[c]+=first[from+c]*row[k];
        }
        else for (const [dx,dy,gain] of taps) {
          if (gathered) {
            load(ox+x+dx,oy+y+dy,sample,0);
            for (let c=0;c<4;c++) sum[c]+=sample[c]*gain;
          } else {
            const from=((y+top+dy)*stride+x+left+dx)*4;
            for (let c=0;c<4;c++) sum[c]+=loaded[from+c]*gain;
          }
        }
        store(((oy+y)*width+ox+x)*4);
      }
    }
    return {width,height,channels:4,data,...(pivot && {pivot:pivot.slice()})};
  }

  function prepareKernel(size,{kind='gaussian',radius=2,sigma,kernel,edge='clamp',tileSize}={}) {
    validateEdge(edge);
    const taps=kernel===undefined ? null : customKernel(kernel);
    const row=taps ? null : weights(radius,kind,sigma);
    const count=taps?.length ?? (radius ? row.length*2 : 0);
    return {edge,taps,row,plan:layout(size,tileSize,taps,row,count)};
  }
  function kernelBlur(source,options) {
    const job=prepareKernel(source,options);
    if (job.plan.strategy!=='whole') return tiled(source,job);
    const value=R.rgba(source), {width,height}=value;
    if (!job.plan.samples) return value;
    return resolve(value,job.row ? separable(premultiply(value),width,height,4,job.row,job.edge) :
      convolve(premultiply(value),width,height,4,job.taps,job.edge));
  }

  function pathTaps(path,samples,anchor,falloff) {
    const vertices=Array.isArray(path) ? path : path?.points, closed=path?.closed ?? false;
    if (!Array.isArray(vertices) || !int(vertices.length,2,4096) ||
        !Array.from(vertices).every(p=>tuple(p,2,n=>finite(n) && Math.abs(n)<=1e6)) || typeof closed!=='boolean')
      throw new TypeError('Path blur needs a finite 2D path');
    const points=closed ? [...vertices,vertices[0]] : vertices;
    const lengths=[0];
    for (let i=1;i<points.length;i++) {
      const [x,y]=points[i],[u,v]=points[i-1];
      lengths.push(lengths.at(-1)+Math.hypot(x-u,y-v));
    }
    const total=lengths.at(-1);
    if (!total) return [[0,0,1]];
    function at(t) {
      const d=total*t;
      let first=0,last=lengths.length-1;
      while(last-first>1) {
        const mid=(first+last)>>1;
        if(lengths[mid]<=d) first=mid;
        else last=mid;
      }
      const delta=lengths[last]-lengths[first], f=delta ? (d-lengths[first])/delta : 0;
      return points[first].map((n,c)=>n+(points[last][c]-n)*f);
    }
    const [x,y]=at(anchor==='start' ? 0 : anchor==='end' ? 1 : .5);
    const taps=Array.from({length:samples},(_,i)=>{
      const t=i/(samples-1), [u,v]=at(t);
      return [x-u,y-v,falloff==='start' ? 1-t : falloff==='end' ? t : 1];
    });
    const sum=taps.reduce((n,tap)=>n+tap[2],0);
    return taps.filter(t=>t[2]).map(([u,v,w])=>[u,v,w/sum]);
  }

  function preparePath(size,path,{samples=13,anchor='start',falloff='uniform',filter='linear',edge='transparent',tileSize}={}) {
    validateEdge(edge);
    if (!int(samples,2,128) || !['start','center','end'].includes(anchor) ||
        !['uniform','start','end'].includes(falloff) || !['linear','nearest'].includes(filter))
      throw new TypeError('Invalid path blur sample count, anchor or filter');
    const taps=pathTaps(path,samples,anchor,falloff);
    const effective=[];
    for (const [x,y,w] of taps) {
      if (filter==='nearest') effective.push([Math.round(x),Math.round(y),w]);
      else {
        const u=Math.floor(x),v=Math.floor(y), fx=x-u,fy=y-v;
        for(let j=0;j<2;j++) for(let i=0;i<2;i++) {
          const gain=w*(i ? fx : 1-fx)*(j ? fy : 1-fy);
          if(gain) effective.push([u+i,v+j,gain]);
        }
      }
    }
    const plan=layout(size,tileSize,effective,null,taps.length*(filter==='linear' ? 4 : 1));
    return {edge,taps:effective,plan};
  }
  function pathBlur(source,path,options) {
    const job=preparePath(source,path,options);
    if (job.plan.strategy!=='whole') return tiled(source,job);
    const value=R.rgba(source);
    return resolve(value,convolve(premultiply(value),value.width,value.height,4,job.taps,job.edge));
  }

  P.pixelEffects={kernelBlur,pathBlur,
    planKernelBlur:(size,options)=>prepareKernel(size,options).plan,
    planPathBlur:(size,path,options)=>preparePath(size,path,options).plan};
  P.pixelEffectSupport={view,image,channel,alpha,unit,byte,int,tuple,plane,weights,separable};
})(KIT.procedural);
