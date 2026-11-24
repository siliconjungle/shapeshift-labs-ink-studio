const Boundaries = require('./pixel-boundaries.js');
const Selectors = require('../src/target-selectors.js');

const capture = Symbol('pixel boundary evidence'), replay = Symbol('pixel boundary replay');
const flip = (p,w,h)=>(h-1-Math.floor(p/w))*w+p%w;
const transferred = {depth:1,objectId:1,materialId:1,partId:1,surfaceCoverage:1,normal:3,position:3,
  geometricNormal:3,shadingNormal:3,objectPosition:3,protected:1,splatId:1,inkShadow:1,coverage:1,
  emission:3,emissionDepth:1,surfaceKind:1,surfaceUV:2,surfaceUVValid:1,motion:2,motionValid:1};
const tables = {objectId:'objects',materialId:'materials',partId:'parts'};

function apply(input, {detail,edits}) {
  if (detail.w!==2*input.w || detail.h!==2*input.h) throw new RangeError('Pixel boundary replay grid changed');
  const {w,h,color,depth,alpha,localAt,passes,outline,locks}=input;
  const mapped={};
  for (const [channel,table] of Object.entries(tables)) {
    if (!passes[table]) continue;
    const key=value=>channel==='partId' ? JSON.stringify(value) : value;
    const names=new Map(passes[table].map((value,i)=>[key(value),i]));
    mapped[channel]=detail.passes[table].map(value=>names.get(key(value)) ?? 0);
  }
  for (const [p,q] of edits) {
    if (passes.protected[p] || locks?.[p]) continue;
    const a=flip(p,w,h), b=flip(q,detail.w,detail.h);
    color.set(detail.color.subarray(b*3,b*3+3),a*3);
    depth[a]=detail.depth[b];
    if (alpha) alpha[p]=detail.alpha[p];
    if (localAt) localAt[a]=detail.localAt?.[b] ?? 0;
    if (outline) outline[a]=detail.outline?.[b] ?? 0;
    for (const [name,stride] of Object.entries(transferred)) {
      const lane=detail.passes[name];
      if (!passes[name] || !lane) continue;
      for (let c=0;c<stride;c++) {
        const value=lane[q*stride+c];
        passes[name][p*stride+c]=mapped[name] ? mapped[name][value] : name==='motion' ? value/2 : value;
      }
    }
  }
}

function evidence(input) {
  const {world,w,h,color,passes,glass,overlay,locks,sun,live,lighting}=input;
  const size=w*h, key=new Float32Array(size), value=new Float32Array(size), excluded=new Uint8Array(size);
  const labels=Selectors.index(world), entries=Array.from({length:world.count},(_,i)=>labels.row(i));
  for (let p=0;p<size;p++) {
    const q=flip(p,w,h), n=p*3, b=q*3, i=passes.splatId[p]-1;
    value[p]=.2126*color[b]+.7152*color[b+1]+.0722*color[b+2];
    excluded[p]=Number(locks?.[p] || glass[q]>.015 || Boolean(overlay?.slots[q]) || passes.protected[p] ||
      (Number.isFinite(passes.depth[p]) && passes.surfaceCoverage[p]<.6) ||
      Math.max(...passes.emission.subarray(n,n+3))>.04);
    if (!sun?.intensity || !Number.isFinite(passes.depth[p])) continue;
    const normal=passes.normal.subarray(n,n+3), aim=lighting?.normal?.(i,normal) ?? normal;
    const facing=aim[0]*sun.direction[0]+aim[1]*sun.direction[1]+aim[2]*sun.direction[2];
    const level=lighting?.band?.(i,facing) ?? facing;
    if (level>0) key[p]=Math.min(1,level*(live?.normal(i) ?
      live.visibility(i,...passes.position.subarray(n,n+3),normal,level) : 1));
  }
  const {depth,alpha,localAt,outline}=input;
  return {w,h,color,passes,depth,alpha,localAt,outline,entries,key,value,excluded};
}

function shot({width:w,height:h,count,settings,draw,output,progress}) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w<8 || h<8 || w*h>100000 ||
      !Number.isSafeInteger(count) || count<2 || count>96 || count*w*h>1200000)
    throw new RangeError('Pixel boundaries need 2–96 frames on a fixed art grid within 1.2 million native samples');
  if (typeof draw!=='function' || typeof output!=='function') throw new TypeError('Pixel boundary shots need draw and output callbacks');
  const plan=Boundaries.prepare(settings,w,h), inputs=[];
  const passes=[...new Set([...Boundaries.channels,'geometricNormal','shadingNormal','emissionDepth','surfaceUV','surfaceUVValid'])];
  let previous;
  for (let frame=0;frame<count;frame++) {
    let native, detail;
    const options={w,h,px:1,captureMotion:true,
      [capture]:input=>{native=evidence(input);}};
    draw(frame,options,'native',passes);
    const sampled=draw(frame,{...options,w:w*2,h:h*2,artGridScale:2,motionFrom:previous,
      highlightCels:false,shoreFoam:false,protectedPixels:false,
      [capture]:input=>{detail=evidence(input);}},'samples',passes);
    previous=sampled.motionReference;
    if (!native || native.w!==w || native.h!==h || !detail || detail.w!==2*w || detail.h!==2*h)
      throw new RangeError('Pixel boundaries need a headless primary view on a fixed rectangular art grid');
    inputs.push({native,detail});
    progress?.('sample',frame);
  }
  const solved=Boundaries.solve(inputs,plan);
  for (const [i,frame] of solved.frames.entries()) {
    const overrides=frame.edits.length ? {[replay]:{detail:inputs[i].detail,edits:frame.edits}} : {};
    output(i,overrides);
    progress?.('finish',i);
  }
  return {
    format:'ink-studio/pixel-boundaries',version:1,width:w,height:h,frames:solved.frames.map(({edits,...frame})=>({
      ...frame,changedPixels:edits.length
    })),transitions:solved.transitions
  };
}

module.exports={shot,capture,replay,apply};
