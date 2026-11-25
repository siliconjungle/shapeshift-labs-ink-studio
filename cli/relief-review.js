const path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const R=require('./render.js');
const PNG=require('./png.js');
const files=require('./asset-files.js');
const {pose}=require('./diarama-pose.js');
const {measure,lightResponse}=require('./render-suite-metrics.js');
const {percentiles}=require('./render-suite.js');

const format='ink-studio/relief-review', reportFormat='ink-studio/relief-review-report';
const phases=['motion','light'];
const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const finite=Number.isFinite;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const vector=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(finite);
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const picture=frame=>createHash('sha256').update(frame.rgb).update(frame.alpha??'').digest('hex');
const midpoint=frames=>Math.floor((frames.length-1)/2);

function need(ok,message) {
  if(!ok)throw new RangeError('Relief review: '+message);
}

function camera(row) {
  need(record(row)&&vector(row.target)&&finite(row.dist)&&row.dist>0&&finite(row.yaw)&&
    finite(row.pitch)&&Math.abs(row.pitch)<Math.PI/2&&finite(row.fov)&&row.fov>0&&row.fov<Math.PI&&
    typeof row.ortho==='boolean','each camera needs target, distance, yaw, pitch, fov and projection');
  const {target,dist,yaw,pitch,fov,ortho}=row;
  return {target,dist,yaw,pitch,fov,ortho};
}

function prepare(plan,V) {
  need(record(plan)&&plan.format===format&&plan.version===1&&typeof plan.asset==='string'&&plan.asset.trim(),
    'expected a version 1 plan for a named relief asset');
  const {asset,width,height,fps=12,raw=true,ranges}=plan;
  need(integer(width,24,320)&&integer(height,24,320)&&integer(fps,1,60)&&typeof raw==='boolean'&&
    Array.isArray(ranges)&&ranges.length>0&&ranges.length<=8,'use a 24–320 pixel grid, 1–60 fps, and up to eight ranges');
  const ids=new Set();
  let total=0;
  const samples=ranges.map(row=>{
    const {id:range,from,to,frames=5,time=0,light={}}=row??{};
    need(id(range)&&!ids.has(range)&&integer(frames,3,16)&&finite(time)&&time>=0&&time+frames/fps<=600&&record(light),
      'each range needs a unique ID, 3–16 frames and a valid start time');
    ids.add(range);
    const start=camera(from), end=camera(to);
    need(start.ortho===end.ortho&&Math.abs(start.yaw-end.yaw)<=Math.PI,
      'each range uses one projection and at most a half-turn of yaw');
    const {from:left=[-.82,.38,.45],to:right=[.79,.48,.38],ambient=.33,intensity=.72}=light;
    need([left,right].every(n=>vector(n)&&finite(V.len(n))&&V.len(n)>1e-8)&&
      V.dot(V.norm(left),V.norm(right))>-.999&&[ambient,intensity].every(n=>finite(n)&&n>=0&&n<=4),
      'use two non-opposite key directions and bounded light gain');
    const at=u=>{
      const mix=key=>start[key]+(end[key]-start[key])*u;
      return {target:V.lerp(start.target,end.target,u),dist:mix('dist'),yaw:mix('yaw'),
        pitch:mix('pitch'),fov:mix('fov'),ortho:start.ortho};
    };
    const fixed=at(.5), a=V.norm(left), b=V.norm(right);
    total+=2*frames*width*height;
    const sequence=phase=>Array.from({length:frames},(_,index)=>{
      const u=index/(frames-1), moving=phase==='motion';
      return {index,time:moving?time+index/fps:time+(frames-1)/(2*fps),
        camera:moving?at(u):fixed,light:{direction:moving?a:V.norm(V.lerp(a,b,u)),ambient,intensity,shadows:false}};
    });
    return {id:range,motion:sequence('motion'),light:sequence('light')};
  });
  need(total<=2_000_000,'the review exceeds two million art pixels per tier');
  return {asset,width,height,fps,raw,samples};
}

function capture(world,sample,config,tier,history,render,diagnostic) {
  let camera, selection;
  const result=R.render(world,{...render,...history,...sample.camera,
    w:config.width,h:config.height,px:1,raw:config.raw,t:sample.time,cameraTime:sample.time,
    lockCamera:true,camera:{...sample.camera,pose:undefined},shutter:false,renderGrid:false,composite:false,
    meshes:true,reliefLOD:tier,reliefApproval:false,protectedLOD:false,liveSun:sample.light,celestialTracks:false,
    resetRenderHistory:sample.index===0,passes:diagnostic?['objectId','partId','surfaceCoverage','sourceSurface']:[],
    renderStats:!diagnostic,reliefLODFrame:rows=>{ selection=rows.find(row=>row.id===config.asset); },
    ...(diagnostic&&R.cameraCapture(null,value=>{camera??=value;}))
  });
  need(result.w===config.width&&result.h===config.height&&selection,'every lane must contain the named relief at the requested native grid');
  return {result,camera,selection};
}

function runPhase(build,config,samples,tier,kit,render) {
  const create=()=>{
    const world=build(), plan=world.reliefLOD?.find(row=>row.id===config.asset);
    need(plan?.asset,'scene must contain relief asset '+config.asset);
    return {world,asset:plan.asset};
  };
  const timed=create(), visual=create();
  need(isDeepStrictEqual(timed.asset,visual.asset),'scene builds returned different relief revisions');
  const warm=R.sequenceHistory(kit.KIT), timeHistory=R.sequenceHistory(kit.KIT), drawHistory=R.sequenceHistory(kit.KIT);
  const place=(row,sample)=>{
    if(row.time===sample.time)return;
    pose(row.world,sample.time,{kit,maxSteps:36000,artDirection:render.artDirection});
    row.time=sample.time;
  };
  place(timed,samples[0]);
  for(let i=0;i<2;i++) capture(timed.world,samples[0],config,tier,warm,render,false);
  const metrics=samples.map(sample=>{
    place(timed,sample);
    const {result,selection}=capture(timed.world,sample,config,tier,timeHistory,render,false);
    const {frameMs,rasterPasses,fragments}=result.renderStats;
    return {frameMs,rasterPasses,fragments,triangles:selection.triangles,normalTexels:selection.normalTexels,
      materialTexels:selection.materialTexels,pictureSha256:picture(result)};
  });
  const frames=samples.map((sample,i)=>{
    place(visual,sample);
    const captureRow=capture(visual.world,sample,config,tier,drawHistory,render,true);
    const {result,camera}=captureRow;
    need(camera&&result.passes?.sourceSurface?.length===config.width*config.height,'native diagnostic capture is unavailable');
    const stats=metrics[i];
    return {...captureRow,stats:{...stats,diagnosticMatchesTimedPicture:picture(result)===stats.pictureSha256}};
  });
  return {asset:visual.asset,frames};
}

const maximum=values=>{
  const known=values.filter(n=>n!==null&&n!==undefined);
  return known.length?Math.max(...known):null;
};

function summarize(frames,tier) {
  const lanes=frames.map(row=>row.lanes[tier]);
  return {
    silhouetteErrorMax:maximum(lanes.map(lane=>lane.metrics.silhouette.errorFraction)),
    subjectRgbRmseMax:maximum(lanes.map(lane=>lane.metrics.rgbRmse8Bit)),
    motionResidualRmseMax:maximum(lanes.map(lane=>lane.metrics.flicker.residualDeltaRmse8Bit)),
    lightResponseRmseMax:maximum(lanes.map(lane=>lane.light?.candidate)),
    lightResponseErrorMax:maximum(lanes.map(lane=>lane.light?.error)),
    triangles:maximum(lanes.map(lane=>lane.work.triangles)),
    normalTexels:maximum(lanes.map(lane=>lane.work.normalTexels)),
    materialTexels:maximum(lanes.map(lane=>lane.work.materialTexels)),
    fragments:percentiles(lanes.map(lane=>lane.work.fragments)),
    frameMs:percentiles(lanes.map(lane=>lane.work.frameMs)),
    visibleFrames:lanes.filter(lane=>lane.metrics.silhouette.candidatePixels>0).length,
    diagnosticMismatches:lanes.filter(lane=>!lane.work.diagnosticMatchesTimedPicture).length
  };
}

function cameraRange(id,frames,axes) {
  const cameras=frames.map(row=>row.lanes.geometry.selection.camera);
  if(cameras.some(camera=>!camera))return null;
  const {width,height,ortho}=cameras[0], extent={};
  for(const axis of axes){
    const values=cameras.map(row=>row[axis]);
    extent[axis]=[Math.min(...values),Math.max(...values)];
  }
  // A range across the azimuth seam needs two explicit reviews.
  if(extent.yaw[1]-extent.yaw[0]>Math.PI)return null;
  return {id,width,height,ortho,...extent};
}

function run(build,plan,{directory,kit=require('..').load(),render={}}={}) {
  if(typeof build!=='function')throw new TypeError('Relief review needs a fresh world builder');
  const {tiers,axes}=kit.KIT.procedural.lod.reliefApproval, config=prepare(plan,kit.KIT.V);
  const stills=[],movie=[],ranges=[];
  let asset;
  const save=(name,frame)=>files.write(path.join(directory,name),PNG.encodeFrame(PNG.packFrame(frame)));
  for(const range of config.samples){
    const sequences={};
    for(const phase of phases){
      const variants=Object.fromEntries(tiers.map(tier=>[tier,runPhase(build,config,range[phase],tier,kit,render)]));
      asset??=variants.geometry.asset;
      need(tiers.every(tier=>isDeepStrictEqual(asset,variants[tier].asset)),'tiers must share an asset revision');
      const fixture={silhouette:asset.objectId,part:asset.partId,asset:asset.id,opaque:true,subjectOnly:true};
      const previous=new Map();
      sequences[phase]=range[phase].map((sample,i)=>{
        const reference=variants.geometry.frames[i], before=variants.geometry.frames[i-1]?.result;
        const images=[], difference=[], lanes={};
        for(const tier of tiers){
          const {camera,result,selection,stats}=variants[tier].frames[i];
          need(isDeepStrictEqual(camera,reference.camera),'tier cameras and native grids differ');
          const resultRow=measure(reference.result,result,fixture,previous.get(tier),phase==='light');
          previous.set(tier,resultRow.state);
          const light=phase==='light'?lightResponse(variants[tier].frames[i-1]?.result,result,before,reference.result,asset):null;
          const prefix='frames/'+range.id+'/'+phase+'-'+String(i+1).padStart(2,'0')+'-'+tier;
          if(directory){
            save(prefix+'.png',result);
            if(tier!=='geometry')save(prefix+'-difference.png',resultRow.evidence);
          }
          images.push(result);
          if(tier!=='geometry')difference.push(resultRow.evidence);
          lanes[tier]={selection,work:stats,metrics:resultRow.metrics,light,
            ...(directory&&{image:prefix+'.png',...(tier!=='geometry'&&{difference:prefix+'-difference.png'})})};
        }
        if(directory){
          const strip=R.grid(images,3);
          if(i===midpoint(range[phase]))stills.push(strip);
          movie.push(PNG.packFrame(R.grid([...images,...difference],5)));
        }
        return {...sample,resolvedCamera:reference.camera,lanes};
      });
    }
    const frames=[...sequences.motion,...sequences.light], summary=Object.fromEntries(phases.map(phase=>
      [phase,Object.fromEntries(tiers.map(tier=>[tier,summarize(sequences[phase],tier)]))]));
    ranges.push({id:range.id,cameraRange:cameraRange(range.id,frames,axes),summary,frames:sequences});
  }
  const report={format:reportFormat,version:1,backend:'headless',
    machine:{node:process.version,platform:process.platform,arch:process.arch},
    asset,artGrid:{width:config.width,height:config.height,pixelSize:1},
    fps:config.fps,raw:config.raw,tiers,ranges,...(directory&&{comparison:'comparison.png',animation:'comparison.apng'})};
  if(directory){
    save(report.comparison,R.grid(stills,1));
    files.write(path.join(directory,report.animation),PNG.encodeAnimation(movie,config.fps));
    files.json(path.join(directory,'report.json'),report);
  }
  return report;
}

function approve(report,choices,{kit=require('..').load()}={}) {
  const api=kit.KIT.procedural.lod.reliefApproval;
  need(report?.format===reportFormat&&report.version===1&&Array.isArray(report.ranges)&&record(choices)&&
    Object.keys(choices).length>0,'expected a version 1 comparison report and named tier choices');
  const sha256=hash(JSON.stringify(report));
  const selected=Object.entries(choices).map(([id,tier])=>{
    const row=report.ranges.find(range=>range.id===id);
    need(api.tiers.includes(tier)&&row?.cameraRange,'no reviewed camera range or tier for '+id);
    const frames=phases.flatMap(phase=>row.frames[phase]);
    need(frames.length>=6&&frames.every(sample=>api.tiers.every(lane=>sample.lanes[lane])&&
      ['geometry',tier].every(key=>{
        const lane=sample.lanes[key];
        return lane.work.diagnosticMatchesTimedPicture&&lane.selection.tier===key&&lane.metrics.silhouette.candidatePixels>0;
      })),
    'approval requires visible geometry and candidate evidence for every sample in '+id);
    return {asset:report.asset,range:row.cameraRange,tier,evidence:{sha256,frames:frames.length}};
  });
  const approval={format:api.format,version:1,choices:selected};
  api.prepare(approval);
  return approval;
}

module.exports={run,approve};
