'use strict';

const path = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');
const Camera = require('../src/camera-lens.js');
const Footprints = require('../src/splat-footprints.js');
const Render = require('./render.js');
const Layer = require('./export-layers.js');
const PNG = require('./png.js');
const { depthRange } = require('./pass-preview.js');
const { loadLevel } = require('./stream-splat-edit.js');

const stride = 16, id = /^[A-Za-z0-9_-]{1,96}$/;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const has = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const int = (n, min, max) => Number.isSafeInteger(n) && n>=min && n<=max;
const drawPasses = ['depth','coverage','normal','objectId','materialId','sourceSplat'];
const rgba = 'rgba8-png';
const rawDepth = {format:'float32-le',units:'scene',space:'camera-axis',empty:'+Infinity',headerBytes:0};

function viewsFor(input, previous, manifest) {
  if (!has(input,['budgetBytes','maxSplats','referenceSplats','targetPx','guardPixels','startsPerFrame','concurrency','exportLayers','views']))
    throw new TypeError('Unknown streamed review setting');
  const { budgetBytes=8*1024**2, maxSplats=90000, referenceSplats=240000, targetPx=2,
    guardPixels=12,startsPerFrame=32,concurrency=8,exportLayers=[],views }=input;
  if (!int(budgetBytes,80,128*1024**2) || !int(maxSplats,1,500000) || !int(referenceSplats,1,500000) ||
      !int(guardPixels,0,256) || !int(startsPerFrame,1,512) || !int(concurrency,1,32) ||
      !Number.isFinite(targetPx) || targetPx<=0 || targetPx>128 || !Array.isArray(views)||!int(views.length,1,16) ||
      !Array.isArray(exportLayers)||exportLayers.length>12||new Set(exportLayers).size!==exportLayers.length ||
      exportLayers.some(layer=>!manifest.chunks.some(chunk=>chunk.layer===layer)&&!previous?.chunks.some(chunk=>chunk.layer===layer)))
    throw new RangeError('Stream view schedule or budget exceeds supported limits');
  const currentIds=new Set(manifest.chunks.map(c=>c.id)), priorIds=new Set(previous?.chunks.map(c=>c.id));
  const used=new Set();
  let pixels=0, updated=false;
  const registered=views.map(row=>{
    const {id:name,w=256,h=192,camera,phase='after',selected=[]}=row??{};
    if (!has(row,['id','w','h','camera','phase','selected'])||typeof name!=='string'||!id.test(name)||used.has(name.toLowerCase())||
        !int(w,8,512)||!int(h,8,512)||(pixels+=w*h*(exportLayers.length+2))>12_000_000 ||
        camera!==undefined&&!record(camera)||!['before','after'].includes(phase)||phase==='before'&&(!previous||updated) ||
        !Array.isArray(selected)||selected.length>65536||new Set(selected).size!==selected.length||
        selected.some(key=>typeof key!=='string'||!(phase==='before'?priorIds:currentIds).has(key)))
      throw new RangeError('Invalid, duplicate, out-of-order or over-budget stream view');
    used.add(name.toLowerCase());
    updated ||= phase==='after';
    return {id:name,w,h,camera,phase,selected};
  });
  return {budgetBytes,maxSplats,referenceSplats,targetPx,guardPixels,startsPerFrame,concurrency,exportLayers,views:registered};
}

function makeStream(kit,api,config,{reference=false}={}) {
  let description={rows:[],directory:null}, requests=[], evicted=[], totalBytes=0, serial=0;
  const maxSplats=reference?config.referenceSplats:config.maxSplats;
  const bound=reference?maxSplats*80:config.budgetBytes;
  const planner=kit.procedural.chunks.createSceneStream({budgetBytes:bound,maxSplats,maxPortals:0,maxCandidates:65536,
    startsPerFrame:config.startsPerFrame,concurrency:config.concurrency,guardPixels:reference?0:config.guardPixels,
    projectedError:reference?undefined:{targetPx:config.targetPx,hysteresis:.2},query:()=>description.rows,
    load({chunk,level,input,splats}) {
      const { data,bytes }=loadLevel(input.directory,api,input.level);
      const note={chunk,level,file:input.level.file,bytes};
      if ((totalBytes+=bytes)>512*1024**2) throw new RangeError('Review payload read budget exceeded');
      requests.push(note);
      return {data,serial:serial++,chunk,level,splats,bytes:splats*64+16,layer:input.layer,footprints:input.footprints};
    },
    sizeOf:value=>value.bytes,splatsOf:value=>value.splats,release(value){evicted.push({chunk:value.chunk,level:value.level});}
  });
  return {
    update(manifest,directory) {
      description={directory, rows:manifest.chunks.map(chunk=>({...chunk,
        levels:(reference?chunk.levels.slice(-1):chunk.levels).map(level=>({...level, bytes:level.splats*64+16,
          revision:JSON.stringify([level.revision,level.file,chunk.footprintRevision??(chunk.footprints ?
            JSON.stringify(manifest.footprints??[]):null)]),
          input:{directory,level,layer:chunk.layer,footprints:chunk.footprints}}))}))};
    },
    async frame(manifest,view) {
      const o={camera:view.camera,lockCamera:true};
      const lens=Camera.frame(manifest.world,o,view.w,view.h);
      const {pose,aspect,ortho,tangent,dist,clipNear:near,clipFar:far,setback}=lens;
      const camera={...pose,aspect,ortho,tangent:ortho?dist*tangent:tangent,near,far,pixelHeight:view.h,
        observer:pose.eye.map((n,i)=>n-pose.back[i]*setback)};
      const query={place:'cloud',camera,selected:reference?[]:view.selected};
      let frame=planner.advance(query), first=frame.budget.ready, ticks=1;
      while (frame.budget.ready<frame.budget.admitted) {
        await nextTurn();
        const failed=planner.failures()[0];
        if (failed) throw new Error(failed.chunk+' '+failed.level+': '+failed.message);
        if (++ticks>1024) throw new RangeError('Stream view did not settle within its scheduler tick budget');
        frame=planner.advance(query);
      }
      if (reference && frame.budget.ready!==frame.budget.visible)
        throw new RangeError('Finest visible reference exceeds budget. Raise referenceSplats or narrow the view.');
      const {bytes,reservedBytes}=planner.stats();
      const receipt={...frame.budget,residentBytes:bytes,reservedBytes,ticks,readyOnFirstTick:first,
        requests,evicted,payloadBytes:requests.reduce((sum,row)=>sum+row.bytes,0),
        levels:frame.views[0].entries.map(({chunk,layer,level,errorPx})=>({chunk,layer,level,errorPx}))};
      requests=[]; evicted=[];
      return {entries:frame.views[0].entries,receipt};
    },
    dispose(){planner.dispose();}
  };
}

function worldFor(manifest, entries, layer) {
  const ordered=entries.filter(row=>layer===undefined||row.layer===layer)
    .sort((a,b)=>a.chunk<b.chunk?-1:a.chunk>b.chunk?1:0);
  const count=ordered.reduce((sum,row)=>sum+row.splats,0), data=new Float32Array(count*stride);
  const labels=[null,...new Set(manifest.chunks.map(row=>row.layer))], slots=new Map(labels.map((value,i)=>[value,i]));
  const ids=new Uint32Array(count), indices=new Uint16Array(count), styles=[], remap=new Map();
  let first=0;
  for(const {layer,value,splats} of ordered){
    data.set(value.data,first*stride);
    ids.fill(slots.get(layer),first,first+splats);
    if(value.footprints) for(let i=0;i<splats;i++){
      const row=(first+i)*stride, slot=data[row+11];
      if(!slot)continue;
      const style=manifest.footprints?.[slot-1];
      if (!Number.isInteger(slot)||!style||!Number.isFinite(data[row+12])||data[row+12]<=0)
        throw new RangeError('Invalid streamed footprint slot');
      if(!remap.has(slot))remap.set(slot,styles.push(style));
      indices[first+i]=remap.get(slot);
      data[row+11]=0;
      data[row+12]=0;
    }
    first+=splats;
  }
  const color=manifest.world.bg.reduce((n,c)=>n*256+Math.round(c),0);
  return {...manifest.world,count,data,gaussianCloud:true,seed:1,detail:14,pal:[color,0xa9c0bf],dither:0,
    fog:{c:0,start:1,max:0},outline:{c:0,edge:0},moving:new Int32Array(),back:new Int32Array(),
    renderMetadata:{objects:labels,objectIds:ids,materials:labels,materialIds:ids},
    ...(styles.length&&{splatFootprints:Footprints.layout(count,styles,indices)})};
}

function capture(manifest,entries,view,layer) {
  let camera;
  const frame=Render.render(worldFor(manifest,entries,layer),{w:view.w,h:view.h,camera:view.camera,
    lockCamera:true,px:1,raw:true,transparent:true,passes:drawPasses,snap:false,
    gaussianFilter:{footprint:'compensated'},...Render.cameraCapture(null, value=>{camera=value;})});
  if(!camera||!frame.alpha||!frame.passes?.sourceSplatDepth)throw new Error('Stream review did not capture the native art grid');
  // The strongest visible splat supplies depth for translucent contributions.
  const {sourceSplatDepth,sourceSplatWeight}=frame.passes, front=new Float32Array(frame.alpha.length).fill(Infinity);
  const lanes=sourceSplatDepth.length/front.length;
  for(let p=0;p<front.length;p++) if (sourceSplatWeight[p*lanes]>0&&Number.isFinite(sourceSplatDepth[p*lanes]))
    front[p]=sourceSplatDepth[p*lanes];
  return {frame,camera,front};
}

function quality(actual,reference,background) {
  const a=actual.frame,b=reference.frame,residual=new Uint8Array(a.rgb.length), n=a.alpha.length;
  let squared=0, abs=0, alpha=0, intersection=0, union=0, depthSquared=0, both=0, unmatched=0;
  for(let p=0;p<n;p++){
    const x=a.alpha[p]/255,y=b.alpha[p]/255;
    alpha+=Math.abs(x-y);
    intersection+=x>=.5&&y>=.5;
    union+=x>=.5||y>=.5;
    for(let c=0;c<3;c++){
      const i=p*3+c, delta=x*a.rgb[i]+(1-x)*background[c]-y*b.rgb[i]-(1-y)*background[c];
      abs+=Math.abs(delta)/255;
      squared+=(delta/255)**2;
      residual[i]=Math.min(255,Math.round(3*Math.abs(delta)));
    }
    const z=actual.front[p], u=reference.front[p];
    if(Number.isFinite(z)&&Number.isFinite(u)){both++;depthSquared+=(z-u)**2;}
    else if(Number.isFinite(z)||Number.isFinite(u))unmatched++;
  }
  return {metrics:{rgbMae:abs/(n*3),psnrDb:squared?-10*Math.log10(squared/(n*3)):null,alphaMae:alpha/n,
    silhouetteIoU:union?intersection/union:1,visibleDepthRmse:both?Math.sqrt(depthSquared/both):null,depthOverlap:both,unmatchedDepthPixels:unmatched},
    residual};
}

function layerFiles(capture,prefix,artifacts) {
  const {frame,camera,front}=capture;
  function write(channel,ext,bytes){
    const file=channel+'.'+ext;
    artifacts.push({file:prefix+'/'+file,bytes});
    return file;
  }
  const native=Layer.writeFrame(frame,camera,frame.w,frame.h,write);
  const range=depthRange(front), gray=new Uint16Array(front.length), bytes=Buffer.alloc(front.length*4);
  for(let i=0;i<front.length;i++){
    const z=front[i];
    bytes.writeFloatLE(z,i*4);
    if(Number.isFinite(z))gray[i]=1+Math.round(65534*(z-range.near)/(range.far-range.near||1));
  }
  const contributionDepth={range,png:write('contribution-depth','png',PNG.encodeGray(frame.w,frame.h,gray)),
    float:write('contribution-depth','f32le',bytes)};
  artifacts.push({file:prefix+'/layers.json',document:{version:1,rows:'top-down',encodings:{...Layer.encodings,
    contributionDepth:rawDepth,contributionDepthImage:Layer.encodings.depth},frames:[{index:0,time:0,...native,contributionDepth}]}});
  return {manifest:prefix+'/layers.json',...native,contributionDepth};
}

async function review(kit,api,current,previous,input) {
  const config=viewsFor(input,previous?.manifest,current.manifest), live=makeStream(kit,api,config),
    finest=makeStream(kit,api,config,{reference:true}), artifacts=[], rows=[];
  let asset, handles=new Map();
  try {
    for(const view of config.views){
      const next=view.phase==='before'?previous:current;
      if(next!==asset){
        asset=next;
        live.update(asset.manifest,path.dirname(asset.file));
        finest.update(asset.manifest,path.dirname(asset.file));
      }
      const streamed=await live.frame(asset.manifest,view), reference=await finest.frame(asset.manifest,view);
      const reused=streamed.entries.filter(row=>handles.get(row.chunk)===row.value.serial).map(row=>row.chunk);
      handles=new Map(streamed.entries.map(row=>[row.chunk,row.value.serial]));
      const drawn=capture(asset.manifest,streamed.entries,view), source=capture(asset.manifest,reference.entries,view);
      const {metrics,residual}=quality(drawn,source,asset.manifest.world.bg), folder='views/'+view.id;
      const display=layerFiles(drawn,folder+'/streamed',artifacts);
      const truth=layerFiles(source,folder+'/finest',artifacts);
      const layers=config.exportLayers.map(layer=>({layer,...layerFiles(capture(asset.manifest,streamed.entries,view,layer),
        folder+'/layers/'+layer,artifacts)}));
      const file=folder+'/rgb-error-x3.png';
      artifacts.push({file,bytes:PNG.encode(view.w,view.h,residual)});
      rows.push({id:view.id,phase:view.phase,epoch:asset.manifest.epoch??null,width:view.w,height:view.h,
        streaming:{...streamed.receipt,reused},reference:{splats:reference.receipt.drawSplats,visible:reference.receipt.visible},
        quality:metrics,artifacts:{streamed:display,finest:truth,layers,residual:file}});
    }
  } finally { live.dispose(); finest.dispose(); }
  const report={format:'ink-studio/stream-splat-review',version:1,asset:current.manifest.edit?.asset??null,
    budget:{bytes:config.budgetBytes,splats:config.maxSplats,referenceSplats:config.referenceSplats,targetPx:config.targetPx},views:rows};
  return {report,artifacts};
}

module.exports={review};
