'use strict';

const inRange=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const point=(p,length=3)=>Array.isArray(p)&&p.length===length&&Array.from(p).every(n=>inRange(n,-1e6,1e6));
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id);

function prepare(inputs, kit) {
  if (!Array.isArray(inputs)||inputs.length<2||inputs.length>12)
    throw new RangeError('Scan fusion needs 2 to 12 registered RGB-D views');
  const ids=new Set(), {V,M,Q}=kit;
  let pixels=0;
  return inputs.map(input=>{
    const {id,capture,pose,weight=1}=input??{}, {width,height}=capture??{};
    const {position,rotation}=pose??{};
    if (!validId(id)||ids.has(id)||!point(position)||!point(rotation,4)||!inRange(Math.hypot(...rotation),.999,1.001)||
        !inRange(weight,.01,100)||![width,height].every(n=>Number.isSafeInteger(n)&&n>=2&&n<=1536)||
        (pixels+=width*height)>4_000_000)
      throw new RangeError('Invalid or over-budget registered scan view '+id);
    ids.add(id);
    const normalized=Q.normalize(rotation), matrix=Q.toMatrix(normalized), inverse=M.tr(matrix);
    const toWorld=p=>V.add(position,M.app(matrix,p)), toLocal=p=>M.app(inverse,V.sub(p,position));
    const model=kit.depth.fromMap({...capture,isolatedPatches:false});
    const {camera,maxDepthJump}=model, d=new Float32Array(width*height), colors=new Uint8Array(width*height*3);
    let valid=0;
    const channels=capture.image?.channels??(capture.image?.data.length===d.length*4 ? 4 : 3);
    for (let i=0;i<d.length;i++) {
      d[i]=model.depthAt(i%width,Math.floor(i/width));
      if (!d[i]) continue;
      if (!Number.isFinite(d[i])) throw new RangeError('Scan depth exceeds float storage in '+id);
      valid++;
      const image=capture.image;
      colors.set(image&&(channels!==4||image.data[i*4+3]) ?
        Array.from({length:3},(_,k)=>image.data[i*channels+k]) : [150,171,186],i*3);
    }
    const perspective=camera.type==='perspective', [sx,sy]=camera.scaleAt(1);
    const front=M.app(matrix,[0,0,1]);
    const jump=Number.isFinite(maxDepthJump) ? maxDepthJump : Infinity;
    function pixel(x,y,depth) {
      const scale=perspective ? depth : 1;
      return [(x-camera.cx)*sx*scale,(camera.cy-y)*sy*scale,-depth];
    }
    function raster(p) {
      const q=toLocal(p), depth=-q[2], denom=perspective ? depth : 1;
      if (depth<=0) return;
      return {u:camera.cx+q[0]/(sx*denom),v:camera.cy-q[1]/(sy*denom),depth};
    }
    function project(p) {
      const sample=raster(p);
      if (!sample) return;
      const {u,v,depth}=sample;
      if (u<-.5||v<-.5||u>=width-.5||v>=height-.5) return;
      const x=Math.round(u), y=Math.round(v), index=x+y*width, observed=d[index];
      if (!observed) return;
      let measured=observed;
      const a=Math.floor(u), b=Math.floor(v);
      if (a>=0&&b>=0&&a+1<width&&b+1<height) {
        const i=a+b*width, d0=d[i], d1=d[i+1], d2=d[i+width], d3=d[i+width+1];
        if (d0&&d1&&d2&&d3&&Math.max(d0,d1,d2,d3)-Math.min(d0,d1,d2,d3)<=jump) {
          const tx=u-a, ty=v-b;
          measured=(d0+(d1-d0)*tx)*(1-ty)+(d2+(d3-d2)*tx)*ty;
        }
      }
      return {u,v,index,depth,measured,gap:measured-depth};
    }
    const incidence=new Float32Array(d.length);
    function confidence(hit) {
      const i=hit.index;
      if (incidence[i]) return incidence[i];
      const x=i%width, y=Math.floor(i/width), depth=d[i];
      const dx=x+1<width&&d[i+1]&&Math.abs(d[i+1]-depth)<=jump ?
        V.sub(pixel(x+1,y,d[i+1]),pixel(x,y,depth)) :
        x>0&&d[i-1]&&Math.abs(d[i-1]-depth)<=jump ? V.sub(pixel(x,y,depth),pixel(x-1,y,d[i-1])) : null;
      const dy=y>0&&d[i-width]&&Math.abs(d[i-width]-depth)<=jump ?
        V.sub(pixel(x,y-1,d[i-width]),pixel(x,y,depth)) :
        y+1<height&&d[i+width]&&Math.abs(d[i+width]-depth)<=jump ?
          V.sub(pixel(x,y,depth),pixel(x,y+1,d[i+width])) : null;
      if (!dx||!dy) return incidence[i]=.25;
      const facing=perspective ? V.norm(V.mul(pixel(x,y,depth),-1)) : [0,0,1];
      return incidence[i]=clamp(V.dot(V.norm(V.cross(dx,dy)),facing),.07,1);
    }
    return {id,width,height,weight,position:position.slice(),rotation:normalized,toWorld,project,raster,
      d,colors,valid,matrix,front,perspective,camera,model,confidence,pixel};
  }).sort((a,b)=>a.id<b.id ? -1 : a.id>b.id ? 1 : 0);
}

function atlas(views, fills, radius) {
  // A one-pixel gutter around every source keeps its filtered samples inside that source.
  const tiles=views.map(view=>({id:view.id,view}));
  const swatches=fills.map((fill,i)=>({id:fill.id,color:fill.color,w:2,h:2,x:(i%32)*4+1,y:Math.floor(i/32)*4+1}));
  let width,height,divisor=1;
  for (;;) {
    let x=0,y=16,row=0;
    width=128;
    for (const tile of tiles) {
      tile.w=Math.max(2,Math.ceil(tile.view.width/divisor));
      tile.h=Math.max(2,Math.ceil(tile.view.height/divisor));
      if (x+tile.w+2>2048) { x=0; y+=row; row=0; }
      tile.x=x+1; tile.y=y+1;
      x+=tile.w+2; row=Math.max(row,tile.h+2);
      width=Math.max(width,x);
    }
    height=y+row;
    if (height<=2048) break;
    divisor++;
  }
  const pixels=new Uint8Array(width*height*4), byId=new Map();
  for (const tile of [...tiles,...swatches]) {
    const {view,w,h,x,y}=tile;
    byId.set(tile.id,tile);
    for (let v=-1;v<=h;v++) for (let u=-1;u<=w;u++) {
      const xx=clamp(u,0,w-1), yy=clamp(v,0,h-1), at=((y+v)*width+x+u)*4;
      if (!view) { pixels.set([...tile.color,255],at); continue; }
      const sx=Math.round(xx*(view.width-1)/(w-1)), sy=Math.round(yy*(view.height-1)/(h-1));
      const i=sx+sy*view.width, depth=view.d[i], rgb=[0,0,0];
      let weight=0;
      if (depth) {
        const local=view.camera.scaleAt(depth);
        const tolerance=Math.min(view.model.maxDepthJump,Math.max(...local)*(radius+2));
        for (let j=Math.max(0,sy-radius);j<=Math.min(view.height-1,sy+radius);j++)
          for (let k=Math.max(0,sx-radius);k<=Math.min(view.width-1,sx+radius);k++) {
            const slot=j*view.width+k;
            if (!view.d[slot]||Math.abs(view.d[slot]-depth)>tolerance) continue;
            const gain=1/(1+Math.abs(j-sy)+Math.abs(k-sx));
            for (let c=0;c<3;c++) rgb[c]+=view.colors[slot*3+c]*gain;
            weight+=gain;
          }
      }
      // A selected face remains opaque. Extend the nearest valid color at a mask edge.
      if (!weight) {
        let nearest=-1, best=Infinity;
        for (let j=Math.max(0,sy-2);j<=Math.min(view.height-1,sy+2);j++)
          for (let k=Math.max(0,sx-2);k<=Math.min(view.width-1,sx+2);k++) {
            const slot=j*view.width+k, distance=(j-sy)**2+(k-sx)**2;
            if (view.d[slot]&&distance<best) {nearest=slot;best=distance;}
          }
        pixels.set(nearest>=0 ? [...view.colors.subarray(nearest*3,nearest*3+3),255] : [150,171,186,255],at);
      } else pixels.set([...rgb.map(n=>Math.round(n/weight)),255],at);
    }
  }
  const uv=(id,u=0,v=0)=>{
    const tile=byId.get(id), {view,x,y,w,h}=tile;
    return [(x+(view ? (w-1)*clamp(u,0,view.width-1)/(view.width-1) : .5))/(width-1),
      (y+(view ? (h-1)*clamp(v,0,view.height-1)/(view.height-1) : .5))/(height-1)];
  };
  return {image:{width,height,pixels},uv,divisor};
}

module.exports={prepare,atlas,point,validId,inRange};
