/* Move labeled paint on the native grid and report the paint exposed beneath it. */
(function (P) {
  const {view,image,int,tuple,plane}=P.pixelEffectSupport;
  const maxPixels=1048576, maxRegions=65536, maxSamples=48e6;
  const validId=id=>int(id,-1,0xffffffff);
  const pair=(value,min,max)=>tuple(value,2,n=>Number.isFinite(n) && n>=min && n<=max);
  const coordinate=value=>pair(value,-1e6,1e6);
  const identity={offset:[0,0],scale:[1,1],angle:0,depth:0,opacity:1};

  function regionTransforms(transforms, background) {
    if (!Array.isArray(transforms) || transforms.length>maxRegions)
      throw new RangeError('Region motion needs a bounded list of transforms');
    const entries=new Map();
    for (const transform of transforms) {
      const {id,offset=identity.offset,pivot,scale=identity.scale,angle=0,depth=0,opacity=1}=transform ?? {};
      const size=typeof scale==='number' ? [scale,scale] : scale;
      if (!validId(id) || id===background || entries.has(id))
        throw new RangeError('Region transform IDs must be unique and distinct from the background ID');
      if (!coordinate(offset) || (pivot!==undefined && !coordinate(pivot)) ||
          !pair(size,-256,256) || size.some(n=>Math.abs(n)<.001) ||
          !Number.isFinite(angle) || Math.abs(angle)>1e6 || !Number.isFinite(depth) ||
          !Number.isFinite(opacity) || opacity<0 || opacity>1)
        throw new RangeError('Invalid region offset, pivot, scale, angle, depth, or opacity');
      entries.set(id,{offset,pivot,scale:size,angle,depth,opacity});
    }
    return entries;
  }

  function isIntegerShift({offset,scale,angle}) {
    return !angle && scale[0]===1 && scale[1]===1 && offset.every(Number.isInteger);
  }

  function prepare(region, width, height, linear) {
    const {left,right,top,bottom,offset,angle,scale}=region;
    const [px,py]=region.pivot ?? [(left+right)/2,(top+bottom)/2];
    const snap=n=>Math.abs(n)<1e-12 ? 0 : n;
    const cos=snap(Math.cos(angle)), sin=snap(Math.sin(angle));
    const [sx,sy]=scale, [tx,ty]=offset;
    const a=cos*sx, b=-sin*sy, c=sin*sx, d=cos*sy;
    const originX=px+tx, originY=py+ty;
    const pad=linear ? .5 : 0;
    // Transform the region's source bounding rectangle, then clip its pixel-center bounds.
    const corners=[[left-pad,top-pad],[right+pad,top-pad],[left-pad,bottom+pad],[right+pad,bottom+pad]];
    const xs=corners.map(([x,y])=>originX+a*(x-px)+b*(y-py));
    const ys=corners.map(([x,y])=>originY+c*(x-px)+d*(y-py));
    const x0=Math.max(0,Math.ceil(Math.min(...xs)-.5));
    const y0=Math.max(0,Math.ceil(Math.min(...ys)-.5));
    const x1=Math.min(width-1,Math.floor(Math.max(...xs)-.5));
    const y1=Math.min(height-1,Math.floor(Math.max(...ys)-.5));
    const inverse=[cos/sx,sin/sx,-sin/sy,cos/sy];
    return {x0,y0,x1,y1,px,py,originX,originY,inverse,
      visits:Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1)};
  }

  function over(destination,i,r,g,b,alpha) {
    const remaining=1-alpha/255;
    destination[i]=r+destination[i]*remaining;
    destination[i+1]=g+destination[i+1]*remaining;
    destination[i+2]=b+destination[i+2]*remaining;
    destination[i+3]=alpha+destination[i+3]*remaining;
  }

  function moveRegions(source, labels, transforms = [], {background=0,keepUnlabeled=true,filter='nearest'} = {}) {
    const {width,height}=source ?? {};
    const labelView=view(labels), ids=labelView.data;
    const count=width*height, linear=filter==='linear';
    if (count>maxPixels || labelView.width!==width || labelView.height!==height || ids.length!==count)
      throw new RangeError('Region motion needs aligned paint and one-channel labels within its pixel budget');
    if (!validId(background) || typeof keepUnlabeled!=='boolean' || !['nearest','linear'].includes(filter))
      throw new TypeError('Invalid region background, unlabeled handling, or filter');
    const entries=regionTransforms(transforms,background);
    const {data,pivot}=image(source);
    const regions=new Map(), next=new Int32Array(count);
    for (let y=0,p=0;y<height;y++) for (let x=0;x<width;x++,p++) {
      const id=ids[p];
      if (!validId(id)) throw new RangeError('Region labels must be integer IDs from -1 through 4294967295');
      if (id===background || !data[4*p+3]) continue;
      let region=regions.get(id);
      if (!region) {
        if (regions.size===maxRegions) throw new RangeError('Region motion exceeds its region budget');
        const settings=entries.get(id) ?? identity;
        region={...settings,id,shift:isIntegerShift(settings),head:-1,left:x,right:x+1,top:y,bottom:y+1};
        regions.set(id,region);
      }
      if (region.shift) {
        next[p]=region.head;
        region.head=p;
      } else {
        region.left=Math.min(region.left,x);
        region.right=Math.max(region.right,x+1);
        region.bottom=y+1;
      }
    }

    let samples=count;
    const ordered=[...regions.values()].filter(region=>region.opacity)
      .sort((a,b)=>b.depth-a.depth || a.id-b.id);
    for (const region of ordered) {
      if (region.shift) continue;
      region.mapping=prepare(region,width,height,linear);
      samples+=region.mapping.visits*(linear ? 4 : 1);
    }
    if (samples>maxSamples) throw new RangeError('Region motion exceeds its transformed sample budget');

    const paint=new Float32Array(count*4), visibleIds=new Float64Array(count).fill(background);
    function copyPixel(from,to,opacity) {
      const i=4*from, alpha=data[i+3]*opacity, factor=alpha/255;
      over(paint,4*to,data[i]*factor,data[i+1]*factor,data[i+2]*factor,alpha);
    }
    if (keepUnlabeled) for (let p=0;p<count;p++) {
      if (ids[p]===background && data[4*p+3]) copyPixel(p,p,1);
    }
    const sample=new Float64Array(4);
    function tap(x,y,weight,id) {
      if (!weight || x<0 || x>=width || y<0 || y>=height) return;
      const from=y*width+x;
      if (ids[from]!==id) return;
      const i=4*from, alpha=data[i+3]*weight, factor=alpha/255;
      for (let c=0;c<3;c++) sample[c]+=data[i+c]*factor;
      sample[3]+=alpha;
    }
    for (const region of ordered) {
      const {id,opacity}=region;
      if (region.shift) {
        const [dx,dy]=region.offset;
        for (let p=region.head;p>=0;p=next[p]) {
          const x=p%width+dx, y=Math.floor(p/width)+dy;
          if (x<0 || x>=width || y<0 || y>=height) continue;
          const to=y*width+x;
          copyPixel(p,to,opacity);
          visibleIds[to]=id;
        }
        continue;
      }
      const {x0,y0,x1,y1,px,py,originX,originY,inverse:[a,b,c,d]}=region.mapping;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
        const dx=x+.5-originX, dy=y+.5-originY;
        const u=px+a*dx+b*dy, v=py+c*dx+d*dy;
        sample.fill(0);
        if (linear) {
          const sx=Math.floor(u-.5), sy=Math.floor(v-.5);
          const fx=u-.5-sx, fy=v-.5-sy;
          tap(sx,sy,(1-fx)*(1-fy),id); tap(sx+1,sy,fx*(1-fy),id);
          tap(sx,sy+1,(1-fx)*fy,id); tap(sx+1,sy+1,fx*fy,id);
        } else tap(Math.floor(u),Math.floor(v),1,id);
        if (!sample[3]) continue;
        const to=y*width+x;
        over(paint,4*to,sample[0]*opacity,sample[1]*opacity,sample[2]*opacity,sample[3]*opacity);
        visibleIds[to]=id;
      }
    }

    const color=new Uint8Array(count*4), gaps=new Uint8Array(count);
    for (let p=0,i=0;p<count;p++,i+=4) {
      const alpha=paint[i+3];
      color[i+3]=Math.round(alpha);
      if (color[i+3]) for (let c=0;c<3;c++)
        color[i+c]=Math.min(255,Math.round(255*paint[i+c]/alpha));
      else visibleIds[p]=background;
      if (ids[p]!==background) gaps[p]=Math.max(0,data[i+3]-color[i+3]);
    }
    return {value:{width,height,channels:4,data:color,...(pivot && {pivot})},
      labels:plane(width,height,visibleIds),gaps:plane(width,height,gaps)};
  }

  P.pixelEffects.moveRegions=moveRegions;
})(KIT.procedural);
