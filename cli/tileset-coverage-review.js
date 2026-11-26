'use strict';

const fs=require('node:fs'), path=require('node:path');
const files=require('./asset-files.js'), PNG=require('./png.js'), R=require('./render.js');
const {pose}=require('./diarama-pose.js');
const {viewSettings}=require('./mesh-native-view.js');

const colors={opaque:[228,161,79],mask:[98,224,149],blend:[90,173,248]};
const channels=['projectedPixels','sampledPixels','clearPixels','fractionalPixels','visiblePixels',
  'hiddenPixels','attenuatedPixels','spillPixels','overpaintPixels','projectedCoverage','visibleCoverage'];
const overlapChannels=['overlapPixels','openPixels','transmittedPixels','blockedPixels','reversedPixels','depthConflictPixels'];
const name=value=>typeof value==='string' && !!value.trim();
const id=value=>typeof value==='string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
const fields=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype && Object.keys(row).every(key=>keys.includes(key));
const unique=rows=>new Set(rows.map(row=>row.id)).size===rows.length;
const epsilon=1/65536;

function settings(input) {
  const {w,h,raw,views,targets,pairs=[],checks=[]}=input??{};
  if (!fields(input,['w','h','raw','views','targets','pairs','checks']) ||
      !Array.isArray(views) || !views.length || views.length>24 ||
      !Array.isArray(targets) || !targets.length || targets.length>8)
    throw new TypeError('Coverage review needs 1–24 camera samples and 1–8 named material targets');
  const view=viewSettings({w,h,raw},false);
  if (view.w>512 || view.h>512 || view.w*view.h*views.length*targets.length>6_000_000)
    throw new RangeError('Coverage review exceeds its native pixel budget');
  if (!Array.from(views).every(row=>fields(row,['id','t','camera','cameraShot','zoom']) && id(row.id) &&
      (row.t===undefined || Number.isFinite(row.t) && row.t>=0) &&
      (row.cameraShot===undefined || name(row.cameraShot)) &&
      (row.zoom===undefined || Number.isFinite(row.zoom) && row.zoom>0) &&
      (row.camera===undefined || fields(row.camera,['yaw','pitch','dist','target','ortho','projection','fov','focalLength','sensorHeight']))) ||
      !unique(views))
    throw new TypeError('Camera samples need distinct IDs and optional time, camera, shot or zoom');
  if (!Array.from(targets).every(row=>fields(row,['id','object','material','face','mode']) && id(row.id) &&
      name(row.object) && name(row.material) && (row.face===undefined || name(row.face)) &&
      (row.mode===undefined || Object.hasOwn(colors,row.mode))) || !unique(targets))
    throw new TypeError('Targets need distinct IDs, object and material IDs, and optional face and alpha mode');
  const targetIds=new Set(targets.map(row=>row.id));
  if (!Array.isArray(pairs) || pairs.length>24 || !Array.from(pairs).every(row=>
      fields(row,['id','front','back']) && id(row.id) && targetIds.has(row.front) && targetIds.has(row.back) && row.front!==row.back) ||
      !unique(pairs))
    throw new TypeError('Coverage pairs need distinct IDs and different front and back targets');
  const pairIds=new Set(pairs.map(row=>row.id));
  if (!Array.isArray(checks) || checks.length>96 || !Array.from(checks).every(row=>
      fields(row,['target','pair','metric','min','max','view']) &&
      (row.target===undefined ? pairIds.has(row.pair) && overlapChannels.includes(row.metric) :
        row.pair===undefined && targetIds.has(row.target) && channels.includes(row.metric)) &&
      (row.view===undefined || views.some(view=>view.id===row.view)) &&
      (row.min!==undefined || row.max!==undefined) &&
      [row.min,row.max].every(value=>value===undefined || Number.isFinite(value) && value>=0) &&
      (row.min===undefined || row.max===undefined || row.min<=row.max)))
    throw new TypeError('Checks need a target or pair, a supported metric, and a minimum or maximum');
  return {...view,views,targets,pairs,checks};
}

function bind(world,spec,kit) {
  const charts=new Map(), selectors=new Map();
  const key=(object,material)=>JSON.stringify([object,material]);
  for (const {mesh} of Object.values(world.topologyMeshes??{})) {
    const layer=kit.KIT.sceneMeshes.layer(mesh);
    for (const chart of layer.surfaceCharts) {
      const mode=layer.tilesetMaterials?.find(row=>row.first===chart.first)?.settings.alphaMode ?? 'mask';
      charts.set(key(chart.objectId,chart.materialId),{mode,faces:new Set(layer.featureFaces.slice(chart.first/3,chart.end/3))});
    }
  }
  for (const {id,anchor} of world.surfaceDecals?.document.decals??[])
    charts.set(key(anchor.object,'decal:'+id),{mode:'mask',faces:new Set()});
  const targets=spec.targets.map((row,index)=>{
    const {object,material,face}=row, token=key(object,material), chart=charts.get(token);
    if (!chart || face!==undefined && !chart.faces.has(face))
      throw new RangeError('No editable mesh material or retained decal matches target '+row.id);
    if (row.mode!==undefined && row.mode!==chart.mode)
      throw new RangeError('Target '+row.id+' uses '+chart.mode+' coverage');
    const named=selectors.get(token)??new Map();
    if (named.has(undefined) || face===undefined && named.size || named.has(face))
      throw new RangeError('Coverage targets overlap on '+object+'/'+material);
    named.set(face,index);
    selectors.set(token,named);
    return {...row,mode:chart.mode};
  });
  const target=(chart,face)=>{
    const named=chart && selectors.get(key(chart.objectId,chart.materialId));
    return named?.get(face) ?? named?.get(undefined);
  };
  return {targets,target};
}

const zero=names=>Object.fromEntries(names.map(name=>[name,0]));
const round=value=>Number(value.toFixed(6));

function capture(targets,target) {
  let rows, ordinal=0;
  return {
    target,
    begin(w,h,project) {
      rows=targets.map((_,index)=>{
        const size=w*h, depth=new Float64Array(size).fill(Infinity), sampledDepth=new Float64Array(size).fill(Infinity);
        const projected=new Float32Array(size), visible=new Float32Array(size), order=new Uint32Array(size);
        for (const {p,z,alpha} of project(index,(p,z)=>{depth[p]=Math.min(depth[p],z);})) {
          projected[p]+=alpha*(1-projected[p]);
          sampledDepth[p]=Math.min(sampledDepth[p],z);
        }
        return {depth,sampledDepth,projected,visible,order};
      });
    },
    fragment(pixel,alpha,index) {
      for (const row of rows) row.visible[pixel]*=1-alpha;
      if (index!==undefined) {
        rows[index].visible[pixel]+=alpha;
        rows[index].order[pixel]=++ordinal;
      }
    },
    rows() { return rows; }
  };
}

function metric(row) {
  const counts=zero(channels);
  for (let i=0;i<row.depth.length;i++) {
    const projected=row.projected[i], visible=row.visible[i];
    if (row.depth[i]===Infinity) {
      if (visible>epsilon) counts.spillPixels++;
      continue;
    }
    counts.projectedPixels++;
    if (projected>epsilon) {
      counts.sampledPixels++;
      if (projected<1-epsilon) counts.fractionalPixels++;
      if (visible<=epsilon) counts.hiddenPixels++;
      else if (visible<projected-epsilon) counts.attenuatedPixels++;
    } else counts.clearPixels++;
    if (visible>epsilon) counts.visiblePixels++;
    if (visible>projected+epsilon) counts.overpaintPixels++;
    counts.projectedCoverage+=projected;
    counts.visibleCoverage+=visible;
  }
  return {...counts,projectedCoverage:round(counts.projectedCoverage),visibleCoverage:round(counts.visibleCoverage)};
}

function overlap(front,back) {
  const counts=zero(overlapChannels);
  for (let i=0;i<front.depth.length;i++) {
    const d=front.depth[i], backDepth=back.sampledDepth[i];
    if (!Number.isFinite(d) || !Number.isFinite(backDepth)) continue;
    counts.overlapPixels++;
    const a=front.projected[i], f=front.visible[i]>epsilon, b=back.visible[i]>epsilon;
    const delta=front.sampledDepth[i]-backDepth, closer=d<backDepth-1e-6;
    if (a>epsilon && Math.abs(delta)<=1e-6) counts.depthConflictPixels++;
    if (f && b && front.order[i]<back.order[i]) counts.reversedPixels++;
    if (closer && b && a<=epsilon && !f) counts.openPixels++;
    if (f && b && a>epsilon && a<1-epsilon && front.order[i]>back.order[i]) counts.transmittedPixels++;
    if (closer && f && !b && a>=1-epsilon) counts.blockedPixels++;
  }
  return counts;
}

function images(directory,sample,frame,targets,rows) {
  const {w,h,rgb}=frame, color=new Uint8Array(rgb.length), mats={};
  function write(name,pixels,lanes=3) {
    const relative='frames/'+sample.id+'/'+name;
    files.write(path.join(directory,relative),lanes===1 ? PNG.encodeGray(w,h,pixels) : PNG.encode(w,h,pixels,lanes));
    return relative;
  }
  const flip=i=>(h-1-Math.floor(i/w))*w+i%w;
  for (let i=0;i<w*h;i++) {
    const p=flip(i), start=3*i;
    for (let k=0;k<3;k++) {
      const amount=rows.reduce((sum,row,j)=>sum+row.visible[p]*colors[targets[j].mode][k],0);
      color[start+k]=Math.min(255,Math.round(.19*rgb[start+k]+.81*amount));
    }
  }
  for (const [index,target] of targets.entries()) {
    const row=rows[index], prefix=target.id+'-';
    mats[target.id]={
      footprint:write(prefix+'footprint.png',Uint8Array.from({length:w*h},(_,i)=>row.depth[flip(i)]<Infinity ? 255 : 0),1),
      sampled:write(prefix+'sampled.png',Uint8Array.from({length:w*h},(_,i)=>Math.round(row.projected[flip(i)]*255)),1),
      visible:write(prefix+'visible.png',Uint8Array.from({length:w*h},(_,i)=>Math.round(row.visible[flip(i)]*255)),1)
    };
  }
  return {picture:write('picture.png',rgb),coverage:write('coverage.png',color),mats};
}

function run(editor,input,directory,kit) {
  const spec=settings(input), world=editor.build(), {targets,target}=bind(world,spec,kit);
  const {w,h,raw}=spec, byId=new Map(targets.map((row,index)=>[row.id,index]));
  let previous;
  const frames=spec.views.map(sample=>{
    const {t=0,camera,cameraShot,zoom}=sample;
    pose(world,t,{kit,maxSteps:7200});
    const review=capture(targets,target);
    let resolvedCamera;
    const frame=R.render(world,{w,h,raw,t,camera,cameraShot,zoom,px:1,
      composite:false,renderGraph:false,inspection:false,renderGrid:false,shutter:false,cameraGuides:false,
      materialCoverageReview:review,...R.cameraCapture(null,info=>{resolvedCamera=info;})});
    const rows=review.rows();
    if (frame.w!==w || frame.h!==h || !rows || !resolvedCamera)
      throw new RangeError('Coverage review needs matched native color and geometry samples');
    const results=Object.fromEntries(targets.map((row,index)=>[row.id,metric(rows[index])]));
    const pairs=Object.fromEntries(spec.pairs.map(pair=>[pair.id,overlap(rows[byId.get(pair.front)],rows[byId.get(pair.back)])]));
    const checks=spec.checks.filter(row=>row.view===undefined || row.view===sample.id).map(row=>{
      const actual=(row.target===undefined ? pairs[row.pair] : results[row.target])[row.metric];
      return {...row,actual,pass:(row.min===undefined || actual>=row.min) && (row.max===undefined || actual<=row.max)};
    });
    const visiblePixelDelta=previous && Object.fromEntries(targets.map(({id})=>[id,results[id].visiblePixels-previous[id].visiblePixels]));
    previous=results;
    return {id:sample.id,time:t,camera:{...resolvedCamera,view:Array.from(resolvedCamera.view)},
      targets:results,pairs,checks,...(visiblePixelDelta && {visiblePixelDelta}),files:images(directory,sample,frame,targets,rows)};
  });
  const report={format:'ink-studio/tileset-coverage-review',version:1,grid:[w,h],targets,pairs:spec.pairs,legend:colors,frames,
    passed:frames.every(frame=>frame.checks.every(row=>row.pass))};
  files.json(path.join(directory,'report.json'),report);
  return report;
}

function command([file,...rest],options,kit,openEditor) {
  const {scene,out}=options;
  if (rest.length || ![file,scene,out].every(name) || !fields(options,['scene','out']))
    throw new TypeError('Use tileset coverage-review <review.json> --scene <scene.json> --out <directory>');
  const input=JSON.parse(fs.readFileSync(file,'utf8')), directory=path.resolve(out);
  const inputs=[file,scene].map(name=>path.resolve(name)), prefix=directory+path.sep;
  if (inputs.some(name=>name===directory || name.startsWith(prefix)))
    throw new RangeError('Write coverage evidence to a separate directory from its inputs');
  const report=run(openEditor(path.resolve(scene)),input,directory,kit);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if (!report.passed) process.exitCode=1;
}

module.exports={command,run};
