const path = require('node:path');
const { render, cameraCapture } = require('./render.js');
const { image, json, write } = require('./asset-files.js');
const PNG = require('./png.js');

const tau = Math.PI * 2;
const defaultViews = [
  { id:'front',yaw:0,pitch:0 },
  { id:'front-oblique',yaw:Math.PI/4,pitch:.25 },
  { id:'right',yaw:Math.PI/2,pitch:.12 },
  { id:'back',yaw:Math.PI,pitch:0 },
  { id:'left-oblique',yaw:-Math.PI/3,pitch:.32 },
  { id:'high',yaw:.28,pitch:1.1 }
];
const columns = ['mesh','sdf','silhouette','coverage','depth','seams'];
const color = {
  matching:[48,57,68], background:[13,18,25],
  sdfOnly:[253,166,73], meshOnly:[84,215,237], seamMatch:[123,220,157], materialMismatch:[237,105,181]
};
const limitsNames = ['silhouetteError','coverageMAE','depthP95','materialError','seamError'];
const integer = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
const finite = (n,min,max) => Number.isFinite(n) && n>=min && n<=max;
const fields = (value,keys) => value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));
const vector = value => Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);

function settings(options,cell) {
  if (!fields(options,['w','h','time','objectId','coverageSamples','coverageTolerance','depthTolerance','epsilon','steps','views','limits','kit']))
    throw new TypeError('Unknown SDF shape review option');
  const { w=160,h=112,time,objectId,coverageSamples=3,coverageTolerance=.12,depthTolerance=cell*.25,
    epsilon=.0005,steps=256,views=defaultViews,limits={} }=options;
  if (!integer(w,8,512) || !integer(h,8,512) || ![1,3].includes(coverageSamples) ||
      !Array.isArray(views) || !integer(views.length,2,16) || w*h*coverageSamples**2*views.length>3e6)
    throw new RangeError('SDF shape review needs an 8–512 art grid, 2–16 views, and at most 3 million samples per path');
  if ((time!==undefined && !finite(time,0,3600)) || (objectId!==undefined && (typeof objectId!=='string' || !objectId.trim())) ||
      !finite(coverageTolerance,0,1) || !Number.isFinite(depthTolerance) || depthTolerance<0 ||
      !finite(epsilon,.0001,.05) || !integer(steps,16,512))
    throw new RangeError('Invalid SDF shape review object, time, tolerance, or trace settings');
  if (!fields(limits,limitsNames) || Object.entries(limits).some(([name,n])=>!finite(n,0,name==='depthP95' ? Infinity : 1)))
    throw new RangeError('Shape limits need nonnegative depth or fractions from 0 to 1');
  const ids=new Set();
  for (const view of views) {
    if (!fields(view,['id','yaw','pitch','target','dist','ortho','fov']) ||
        typeof view.id!=='string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(view.id) || ids.has(view.id) ||
        !finite(view.yaw,-tau,tau) || !finite(view.pitch,-1.55,1.55) ||
        view.target!==undefined && !vector(view.target) ||
        view.dist!==undefined && !finite(view.dist,.01,400) ||
        view.ortho!==undefined && typeof view.ortho!=='boolean' ||
        view.fov!==undefined && !finite(view.fov,.08,2.6))
      throw new RangeError('Review views need a unique ID, yaw and pitch in radians, and valid camera overrides');
    ids.add(view.id);
  }
  return {w,h,time,objectId,coverageSamples,coverageTolerance,depthTolerance,epsilon,steps,views,limits};
}

function cameraFor(view,bounds,config) {
  const center=bounds.min.map((n,i)=>(n+bounds.max[i])/2);
  const target=view.target ?? center, extent=Math.hypot(...bounds.max.map((n,i)=>n-center[i]));
  const {ortho=true,fov=Math.PI/4}=view;
  const fit=extent*1.12/(Math.min(1,config.w/config.h)*Math.tan(fov/2));
  const dist=view.dist ?? Math.max(1.2,fit+(ortho ? 0 : extent));
  return {target:target.slice(),dist,yaw:view.yaw,pitch:view.pitch,ortho,fov};
}

function buffers(frame,subject,kind,w,h) {
  const {passes}=frame;
  const id=passes?.objects?.indexOf(subject);
  if (frame.w!==w || frame.h!==h || !passes?.depth || !passes.surfaceCoverage || !passes.surfaceKind ||
      !passes.materialId || !passes.objectId)
    throw new TypeError('SDF shape review needs matched native surface buffers');
  const hit=new Uint8Array(w*h);
  for (let p=0;p<hit.length;p++) {
    if (!Number.isFinite(passes.depth[p])) continue;
    if (id<1 || passes.objectId[p]!==id || passes.surfaceKind[p]!==kind)
      throw new Error('SDF shape review captured an unexpected object or representation');
    hit[p]=1;
  }
  return {hit,depth:passes.depth,coverage:passes.surfaceCoverage,
    label:p=>passes.materials[passes.materialId[p]] ?? null};
}

function measure(sdf,mesh,{w,h,coverageSamples:s,coverageTolerance,depthTolerance,objectId}) {
  const width=w*s,height=h*s,size=w*h,mid=s>>1,count=s*s;
  const a=buffers(sdf,objectId,2,width,height), b=buffers(mesh,objectId,1,width,height);
  const maps=Object.fromEntries(columns.map(key=>[key,new Uint8Array(size*4)]));
  const silhouette={sdfPixels:0,meshPixels:0,missingPixels:0,extraPixels:0,intersectionPixels:0,unionPixels:0};
  const coverage={comparedPixels:0,sdfArea:0,meshArea:0,meanAbsolute:0,maxAbsolute:0,pixelsAbove:0};
  const depth={matchedPixels:0,meanAbsolute:0,meanSigned:0,rmse:0,p95Absolute:null,maxAbsolute:0,pixelsAbove:0};
  const material={comparedPixels:0,mismatchPixels:0};
  const seams={comparedEdges:0,sdfEdges:0,meshEdges:0,missingEdges:0,extraEdges:0,matchedEdges:0,changedPairs:0};
  const depthErrors=[], aLabel=[], bLabel=[], shared=new Uint8Array(size), seamMarks=new Uint8Array(size);
  const mark=(key,p,c,weight=1,alpha=255)=>maps[key].set([c[0]*weight,c[1]*weight,c[2]*weight,alpha],p*4);
  function pixel(rgb,source,target,p,alpha) {
    const at=source*3;
    mark(target,p,rgb.subarray(at,at+3),1,Math.round(255*alpha));
  }

  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const base=y*s*width+x*s, i=base+mid*(width+1), hasA=a.hit[i],hasB=b.hit[i];
    let coverA=0,coverB=0;
    for (let v=0;v<s;v++) for (let u=0;u<s;u++) {
      const j=base+v*width+u;
      if (a.hit[j]) coverA+=a.coverage[j];
      if (b.hit[j]) coverB+=b.coverage[j];
    }
    coverA/=count;
    coverB/=count;
    pixel(sdf.rgb,i,'sdf',p,hasA);
    pixel(mesh.rgb,i,'mesh',p,hasB);
    silhouette.sdfPixels+=hasA;
    silhouette.meshPixels+=hasB;
    if (hasA || hasB) {
      silhouette.unionPixels++;
      if (hasA && hasB) silhouette.intersectionPixels++;
      else if (hasA) silhouette.missingPixels++;
      else silhouette.extraPixels++;
    }
    mark('silhouette',p,hasA ? (hasB ? color.matching : color.sdfOnly) : hasB ? color.meshOnly : color.background);
    const delta=coverB-coverA, absolute=Math.abs(delta);
    coverage.sdfArea+=coverA;
    coverage.meshArea+=coverB;
    if (coverA || coverB) coverage.comparedPixels++;
    coverage.meanAbsolute+=absolute;
    coverage.maxAbsolute=Math.max(coverage.maxAbsolute,absolute);
    if (absolute>coverageTolerance) coverage.pixelsAbove++;
    mark('coverage',p,delta ? (delta<0 ? color.sdfOnly : color.meshOnly) :
      coverA ? color.matching : color.background,delta ? .25+.75*absolute : 1);
    mark('depth',p,color.background);
    mark('seams',p,hasA&&hasB ? color.matching : color.background);
    if (!hasA || !hasB) continue;

    shared[p]=1;
    const error=b.depth[i]-a.depth[i], difference=Math.abs(error);
    depth.matchedPixels++;
    depth.meanAbsolute+=difference;
    depth.meanSigned+=error;
    depth.rmse+=error*error;
    depth.maxAbsolute=Math.max(depth.maxAbsolute,difference);
    if (difference>depthTolerance) depth.pixelsAbove++;
    depthErrors.push(difference);
    const weight=Math.min(1,difference/Math.max(depthTolerance,1e-7));
    mark('depth',p,difference>depthTolerance ? (error>0 ? color.meshOnly : color.sdfOnly) : color.matching,
      difference>depthTolerance ? 1 : 1-.3*weight);

    const ma=aLabel[p]=a.label(i), mb=bLabel[p]=b.label(i);
    if (ma===null && mb===null) continue;
    material.comparedPixels++;
    if (ma!==mb) {
      material.mismatchPixels++;
      seamMarks[p]|=8;
    }
  }

  function edge(p,q) {
    if (!shared[p] || !shared[q]) return;
    seams.comparedEdges++;
    const a=aLabel[p], b=aLabel[q], c=bLabel[p], d=bLabel[q];
    const sdfEdge=a!==null && b!==null && a!==b, meshEdge=c!==null && d!==null && c!==d;
    seams.sdfEdges+=Number(sdfEdge);
    seams.meshEdges+=Number(meshEdge);
    let bits=0;
    if (sdfEdge && meshEdge) {
      if (a===c && b===d || a===d && b===c) { seams.matchedEdges++; bits=1; }
      else { seams.changedPairs++; bits=8; }
    } else if (sdfEdge) { seams.missingEdges++; bits=2; }
    else if (meshEdge) { seams.extraEdges++; bits=4; }
    seamMarks[p]|=bits;
    seamMarks[q]|=bits;
  }

  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    if (x+1<w) edge(p,p+1);
    if (y+1<h) edge(p,p+w);
  }
  for (let p=0;p<size;p++) {
    const bits=seamMarks[p];
    if (bits) mark('seams',p,(bits&8) || (bits&6)===6 ? color.materialMismatch :
      bits&2 ? color.sdfOnly : bits&4 ? color.meshOnly : color.seamMatch);
  }

  const fraction=(n,d)=>d ? n/d : null;
  silhouette.errorFraction=fraction(silhouette.missingPixels+silhouette.extraPixels,silhouette.unionPixels);
  coverage.meanAbsolute=fraction(coverage.meanAbsolute,coverage.comparedPixels);
  if (!coverage.comparedPixels) coverage.maxAbsolute=null;
  depth.meanAbsolute=fraction(depth.meanAbsolute,depth.matchedPixels);
  depth.meanSigned=fraction(depth.meanSigned,depth.matchedPixels);
  depth.rmse=depth.matchedPixels ? Math.sqrt(depth.rmse/depth.matchedPixels) : null;
  if (!depth.matchedPixels) depth.maxAbsolute=null;
  if (depthErrors.length) depth.p95Absolute=depthErrors.sort((a,b)=>a-b)[Math.ceil(depthErrors.length*.95)-1];
  material.errorFraction=fraction(material.mismatchPixels,material.comparedPixels);
  seams.errorFraction=fraction(seams.missingEdges+seams.extraEdges+seams.changedPairs,
    seams.missingEdges+seams.extraEdges+seams.changedPairs+seams.matchedEdges);
  return {metrics:{silhouette,coverage,depth,material,seams},maps};
}

function flag(metrics,limits) {
  const actual={silhouetteError:metrics.silhouette.errorFraction,coverageMAE:metrics.coverage.meanAbsolute,
    depthP95:metrics.depth.p95Absolute,materialError:metrics.material.errorFraction,seamError:metrics.seams.errorFraction};
  return Object.entries(limits).flatMap(([metric,maximum])=>actual[metric]!==null && actual[metric]>maximum ?
    [{metric,maximum,actual:actual[metric]}] : []);
}

function reviewSdfShape(world,directory,options={}) {
  if (typeof directory!=='string' || !directory.trim()) throw new TypeError('SDF shape review needs an output directory');
  const kit=options.kit ?? require('../index.js').load(), api=kit.KIT.procedural.brickMeshes;
  const rows=api.frame(world);
  const selected=options.objectId===undefined && rows.length===1 ? rows[0] : rows.find(row=>row.objectId===options.objectId);
  if (!selected) throw new RangeError('SDF shape review needs one selected brick field. Supply its object ID when the scene has several.');
  const snapshot=api.fullView(selected), plan=settings({...options,objectId:snapshot.objectId},snapshot.bricks.cell);
  const {w,h,time,views,coverageSamples:s,epsilon,steps,limits}=plan;
  const extent=Math.hypot(...snapshot.bounds.max.map((n,i)=>n-snapshot.bounds.min[i]))/2;
  const {objectId,revision,bounds,work}=snapshot;
  const target=kit.makeBuilder(1,world.pal,{initialCapacity:1}).finish({
    brickMeshes:[snapshot],cam:{target:[0,0,0],yaw:0,pitch:0,dist:4},radius:Math.max(1,extent),dither:0
  },{consumePendingPaint:false});
  const reports=[], sheet=new Uint8Array(w*columns.length*h*views.length*4);
  for (const [row,view] of views.entries()) {
    const camera=cameraFor(view,bounds,plan);
    const background=target.radius*2+4;
    if (camera.dist+(camera.ortho ? background : 0)+extent>400 && view.dist===undefined)
      throw new RangeError('The default fitted camera exceeds the shared render depth range. Supply a closer view.');
    const draw={...camera,w:w*s,h:h*s,px:1,lockCamera:true,raw:true,transparent:true,splatDepthProxies:false,
      passes:['objectId','materialId','depth','surfaceCoverage','surfaceKind'],renderGraph:false,renderGrid:false,
      composite:false,shutter:false,cameraGuides:false,snap:false};
    let a,b;
    const mesh=render(target,{...draw,sdfAssist:false,...cameraCapture(null,raster=>{a=Array.from(raster.view);})});
    const sdf=render(target,{...draw,sdfAssist:{epsilon,steps},...cameraCapture(null,raster=>{b=Array.from(raster.view);})});
    if (!a || !b || a.some((n,i)=>n!==b[i])) throw new Error('Shape review failed to hold the camera across both renders');
    const {metrics,maps}=measure(sdf,mesh,plan), files={};
    for (const [col,key] of columns.entries()) {
      files[key]=image(directory,w,h,maps[key]);
      for (let y=0;y<h;y++) sheet.set(maps[key].subarray(y*w*4,(y+1)*w*4),
        ((row*h+y)*columns.length*w+col*w)*4);
    }
    reports.push({id:view.id,camera,empty:metrics.silhouette.unionPixels===0 && metrics.coverage.comparedPixels===0,
      metrics,flags:flag(metrics,limits),files});
  }
  const report={format:'ink-studio/sdf-shape-review',version:1,scene:world.id ?? null,object:objectId,revision,
    bounds,work,artGrid:{width:w,height:h},...(time!==undefined && {time}),
    coverageSamples:s,coverageTolerance:plan.coverageTolerance,depthTolerance:plan.depthTolerance,trace:{epsilon,steps},limits,
    legend:color,columns,comparison:'comparison.png',views:reports,
    flags:reports.flatMap(view=>view.flags.map(entry=>({view:view.id,...entry})))};
  write(path.join(directory,report.comparison),PNG.encode(w*columns.length,h*views.length,sheet,4));
  json(path.join(directory,'report.json'),report);
  return report;
}

module.exports={reviewSdfShape,measure};
