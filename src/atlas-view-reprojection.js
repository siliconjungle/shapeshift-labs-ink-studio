/* Reproject registered depth tiles into a shared camera-facing tile. */
const AtlasViewReprojection = (() => {
  const pixelLimit = 262144, cacheLimit = 24 * 1024 * 1024;
  const angleStep = Math.PI / 360, minCosine = Math.cos(Math.PI / 4);
  const cache = new Map(), keys = new WeakMap();
  let bytes = 0;
  const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const channels = {depth:true,emission:true};
  const texel = () => ({color:[0,0,0],normal:[0,0,0],emission:[0,0,0]});

  function mode(value) {
    if (value !== undefined && !['nearest','depth-reprojected'].includes(value))
      throw new RangeError('Impostor blend needs nearest or depth-reprojected');
    return value;
  }

  function pair(primary, candidates, direction) {
    const forward = primary.basis.normal, along = dot(forward,direction);
    if (along < minCosine || along > 1 - 1e-12) return null;
    let best, score = Infinity;
    const side = forward.map((v,k)=>v - along*direction[k]);
    for (const view of candidates) {
      if (view === primary) continue;
      const other = view.basis.normal, facing = dot(other,direction);
      if (facing < minCosine || dot(side,other) >= -1e-8) continue;
      // Prefer the segment whose two endpoints bracket the requested direction.
      const chord = other.map((v,k)=>v-forward[k]);
      const t = clamp((dot(direction,chord)-dot(forward,chord))/dot(chord,chord),0,1);
      const error = forward.reduce((sum,v,k)=>sum+(v+t*chord[k]-direction[k])**2,0);
      if (error < score) { best = view; score = error; }
    }
    return best;
  }

  function blendWeight(primary, other, direction) {
    if (!other) return 0;
    const a = Math.acos(clamp(dot(primary.basis.normal,direction),-1,1));
    const b = Math.acos(clamp(dot(other.basis.normal,direction),-1,1));
    return Math.min(.5,a/(a+b || 1));
  }

  function source(atlas, view, level) {
    const image = atlas.cutoutImage?.(view,level);
    const width = image?.width ?? view.rect.width, height = image?.height ?? view.rect.height;
    const pixelX = view.unitsPerPixel*view.rect.width/width, pixelY = view.unitsPerPixel*view.rect.height/height;
    const pivotX = view.pivot.x * width/view.rect.width, pivotY = view.pivot.y * height/view.rect.height;
    const sample = image ? (x,y,out)=>atlas.cutoutSample(view,image,(x+.5)*view.rect.width/width,
      (y+.5)*view.rect.height/height,channels,out) : (x,y,out)=>atlas.sample(view,x,y,channels,out);
    const depths=new Float32Array(width*height).fill(Infinity), row=texel();
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      if(sample(x,y,row)) depths[y*width+x]=row.depth;
    }
    return {view,width,height,pixelX,pixelY,pivotX,pivotY,sample,depths};
  }

  function transform(source, axes) {
    const {view:{basis},pixelX,pixelY,pivotX,pivotY} = source;
    // Left to right, top to bottom, and depth away from the viewer in both views.
    const sourceAxes = [basis.right,basis.up.map(v=>-v),basis.normal.map(v=>-v)];
    const targetAxes = [axes.right,axes.up.map(v=>-v),axes.normal.map(v=>-v)];
    const forward = targetAxes.map(axis=>sourceAxes.map(v=>dot(axis,v)));
    return (x,y,d) => {
      const u=(x-pivotX)*pixelX, v=(y-pivotY)*pixelY;
      return forward.map(row=>row[0]*u+row[1]*v+row[2]*d);
    };
  }

  function cornerDepth(source, x, y, center) {
    const {width,height,depths}=source, tolerance=3*Math.max(source.pixelX,source.pixelY);
    let sum=0,count=0;
    for(let sy=Math.max(0,y-1);sy<Math.min(height,y+1);sy++)
      for(let sx=Math.max(0,x-1);sx<Math.min(width,x+1);sx++) {
        const depth=depths[sy*width+sx];
        if (Math.abs(depth-center)>tolerance) continue;
        sum+=depth;
        count++;
      }
    return sum/count;
  }

  function targetGrid(source, warp, focal, units) {
    let x0=source.width,y0=source.height,x1=0,y1=0,near=Infinity,far=-Infinity;
    for (let y=0; y<source.height; y++) for (let x=0; x<source.width; x++) {
      const depth=source.depths[y*source.width+x];
      if (!Number.isFinite(depth)) continue;
      x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x+1); y1=Math.max(y1,y+1);
      near=Math.min(near,depth); far=Math.max(far,depth);
    }
    if (x0>=x1 || y0>=y1) return null;
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for (const x of [x0,x1]) for (const y of [y0,y1]) for (const depth of [near,far]) {
      const [u,v,d]=warp(x,y,depth), k=(1+d*focal)*units;
      if (k < .25*units) return null;
      left=Math.min(left,u/k); right=Math.max(right,u/k);
      top=Math.min(top,v/k); bottom=Math.max(bottom,v/k);
    }
    left=Math.floor(left); top=Math.floor(top);
    const width=Math.ceil(right)-left, height=Math.ceil(bottom)-top;
    if (!(width>0 && height>0) || width*height>pixelLimit || ![left,top,width,height].every(Number.isSafeInteger)) return null;
    return {left,top,width,height,units,focal};
  }

  function splat(source, warp, grid, normalSpace) {
    const {width,height,units,left,top,focal} = grid, lane = width*height*4;
    const values = new Float32Array(lane*3), row=texel();
    const {right,up,normal} = source.view.basis;
    let budget=8*pixelLimit;
    // Adjacent samples on a continuous depth surface share corner depths.
    // Depth breaks and transparent texels never connect across the gap.
    function triangle([ax,ay,az,aw],[bx,by,bz,bw],[cx,cy,cz,cw]) {
      const dx=bx-ax,dy=by-ay,ex=cx-ax,ey=cy-ay,area=dx*ey-dy*ex;
      if (area<=1e-7) return true;
      const x0=clamp(Math.ceil(Math.min(ax,bx,cx)-.5-1e-8),0,width);
      const x1=clamp(Math.floor(Math.max(ax,bx,cx)-.5+1e-8)+1,0,width);
      const y0=clamp(Math.ceil(Math.min(ay,by,cy)-.5-1e-8),0,height);
      const y1=clamp(Math.floor(Math.max(ay,by,cy)-.5+1e-8)+1,0,height);
      budget-=(x1-x0)*(y1-y0);
      if(budget<0) return false;
      for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
        const sx=x+.5-ax,sy=y+.5-ay;
        const b=(sx*ey-sy*ex)/area, c=(dx*sy-dy*sx)/area, a=1-b-c;
        if(Math.min(a,b,c)<-1e-8) continue;
        const depth=(a*az+b*bz+c*cz)/(a*aw+b*bw+c*cw);
        const at=(y*width+x)*4;
        if(values[at+3]&&depth>=values[lane+at+3]) continue;
        values.set(row.color,at);
        values[at+3]=row.alpha;
        for(let k=0;k<3;k++) values[lane+at+k]=!row.hasNormal ? 0 : normalSpace==='asset' ? row.normal[k] :
          right[k]*row.normal[0]+up[k]*row.normal[1]+normal[k]*row.normal[2];
        values[lane+at+3]=depth;
        values.set(row.emission,lane*2+at);
        values[lane*2+at+3]=+row.hasEmission;
      }
      return true;
    }
    for(let y=0;y<source.height;y++) for(let x=0;x<source.width;x++) {
      if(!source.sample(x,y,row)) continue;
      const corners=[];
      for(let i=0;i<4;i++) {
        const sx=x+(i&1),sy=y+(i>>1);
        const [u,v,d]=warp(sx,sy,cornerDepth(source,sx,sy,row.depth)), k=1+d*focal;
        if(k<.25) return null;
        corners.push([u/(units*k)-left,v/(units*k)-top,d/k,1/k]);
      }
      const [a,b,c,d]=corners;
      if(!triangle(a,b,c)||!triangle(b,d,c)) return null;
    }
    return values;
  }

  function merge(primary, alternate, grid, weight) {
    let blended = 0, nearest = 0, filteredCutouts = 0;
    const lane=grid.width*grid.height*4, depthTolerance=1.5*grid.units;
    for (let i=0; i<lane; i+=4) {
      if (!primary[i+3]) {
        if (alternate?.[i+3]) filteredCutouts++;
        continue;
      }
      if (!alternate?.[i+3] || (primary[i+3]>=.5)!==(alternate[i+3]>=.5) ||
          Math.abs(primary[i+3]-alternate[i+3])>.25 ||
          Math.abs(primary[lane+i+3]-alternate[lane+i+3])>depthTolerance) {
        nearest++;
        continue;
      }
      // Keep cutout ownership on the closest view. Mix only surface data that agrees in depth.
      blended++;
      for (let c=0; c<3; c++) {
        primary[i+c] += (alternate[i+c]-primary[i+c])*weight;
        primary[lane*2+i+c] += (alternate[lane*2+i+c]-primary[lane*2+i+c])*weight;
      }
      primary[lane+i+3] += (alternate[lane+i+3]-primary[lane+i+3])*weight;
      const n=lane+i, hasA=primary[n] || primary[n+1] || primary[n+2];
      const hasB=alternate[n] || alternate[n+1] || alternate[n+2];
      if (hasB) for (let c=0; c<3; c++)
        primary[n+c]=hasA ? primary[n+c]+(alternate[n+c]-primary[n+c])*weight : alternate[n+c];
      primary[lane*2+i+3]=Math.max(primary[lane*2+i+3],alternate[lane*2+i+3]);
    }
    return {blended,nearest,filteredCutouts};
  }

  function resolve(atlas, primary, candidates, direction, { distance=Infinity, pixelsPerTexel, time=0, basis }={}) {
    if (atlas.effect(primary) || atlas.fringe?.(primary,time) || atlas.transition?.(primary,time) ||
        primary.rect.width*primary.rect.height>pixelLimit || dot(primary.basis.normal,direction)<minCosine) return null;
    if (distance===Infinity && dot(primary.basis.normal,direction)>1-1e-12) return null;
    let other = pair(primary,candidates,direction);
    if (other && (other.rect.width*other.rect.height>pixelLimit || atlas.effect(other) ||
        atlas.fringe?.(other,time) || atlas.transition?.(other,time))) other=null;
    const yaw=Math.round(Math.atan2(direction[0],direction[2])/angleStep);
    const pitch=Math.round(Math.atan2(direction[1],Math.hypot(direction[0],direction[2]))/angleStep);
    const depthBin=distance===Infinity ? Infinity : Math.round(64*Math.log2(distance));
    if (depthBin!==Infinity && !Number.isFinite(depthBin)) return null;
    const axes=basis(yaw*angleStep,pitch*angleStep);
    const level=atlas.cutoutLevel?.(primary,pixelsPerTexel) ?? 0;
    const otherPixels=other && pixelsPerTexel*other.unitsPerPixel/primary.unitsPerPixel;
    const otherLevel=other && (atlas.cutoutLevel?.(other,otherPixels) ?? 0);
    // IDs live on authored view records. Repeated placements can share the warped tile.
    let indices=keys.get(primary);
    if (!indices) keys.set(primary,indices={views:new WeakMap(),next:1});
    if (other && !indices.views.has(other)) indices.views.set(other,indices.next++);
    const key=[yaw,pitch,depthBin,level,otherLevel,other && indices.views.get(other)].join('/');
    const entries=indices.entries ??= new Map();
    const handle=entries.get(key);
    if (handle) {
      const cached=cache.get(handle);
      cache.delete(handle);
      cache.set(handle,cached);
      return cached;
    }
    const a=source(atlas,primary,level), warp=transform(a,axes), focal=depthBin===Infinity?0:2**(-depthBin/64);
    const grid=targetGrid(a,warp,focal,Math.max(a.pixelX,a.pixelY));
    if (!grid) return null;
    const values=splat(a,warp,grid,atlas.normalSpace);
    if (!values) return null;
    const b=other && source(atlas,other,otherLevel);
    const alternate=b && splat(b,transform(b,axes),grid,atlas.normalSpace);
    const weight=alternate ? blendWeight(primary,other,axes.normal) : 0;
    const stats=merge(values,alternate,grid,weight);
    const {width,height,left,top,units}=grid;
    const result={view:{rect:{x:0,y:0,width,height},pivot:{x:-left,y:-top},unitsPerPixel:units},
      axes,image:{width,height,values},
      report:{yaw:yaw*angleStep,pitch:pitch*angleStep,weight,...stats,
        ...(alternate && {neighbor:{yaw:other.yaw,pitch:other.pitch}})}};
    while (bytes+values.byteLength>cacheLimit && cache.size) {
      const [oldest,previous]=cache.entries().next().value;
      cache.delete(oldest);
      oldest.entries.delete(oldest.key);
      bytes-=previous.image.values.byteLength;
    }
    const entry={key,entries};
    entries.set(key,entry);
    cache.set(entry,result);
    bytes+=values.byteLength;
    return result;
  }

  function sample({ image:{width,height,values} }, x, y, channels, out) {
    if (!(x>=0 && x<width && y>=0 && y<height)) return false;
    const i=(Math.floor(y)*width+Math.floor(x))*4, lane=width*height*4;
    if (!values[i+3]) return false;
    out.alpha=values[i+3];
    out.depth=channels.depth?values[lane+i+3]:0;
    out.hasNormal=!!(values[lane+i] || values[lane+i+1] || values[lane+i+2]);
    out.hasEmission=!!(channels.emission && values[2*lane+i+3]);
    for (let c=0; c<3; c++) {
      out.color[c]=values[i+c];
      out.normal[c]=values[lane+i+c];
      out.emission[c]=out.hasEmission ? values[2*lane+i+c] : 0;
    }
    return true;
  }

  return Object.freeze({ mode, resolve, sample, pixelLimit });
})();
if (typeof module !== 'undefined') module.exports = AtlasViewReprojection;
