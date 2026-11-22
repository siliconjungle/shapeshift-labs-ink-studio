/* Render configured views of one verified story, with a stock projector source. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { clockFor, stageAt } = require('./recorded-presentation.js');
const { readNativeRun } = require('./story-audio.js');
const { createPatchGpu } = require('./patch-gpu.js');
const { projectionSurfaces } = require('./patch-show-config.js');
const views = require('./story-presentation-views.js');
const Replay = require('./scene-replay.js');

const format='ink-studio/story-presentation-pack', planFormat='ink-studio/story-presentation-plan';
const usage='story present <recording|run-bundle> <plan.json> --out directory [--gpu-module path --ffmpeg executable]';
const token=value=>typeof value==='string' && value.trim().length>0 && value.length<=512;
const modes={
  debug:['width','height','bounds','entities','story'],
  puppet:['width','height','graph','output'],
  splat:['width','height','camera'],
  webgpu:['source','shader','channel','amount'],
  projector:['source','surfaces']
};
const serial=index=>String(index).padStart(6,'0');

function read(file,limit=8*1024*1024) {
  if (fs.statSync(file).size>limit) throw new RangeError('Presentation input exceeds its byte budget: '+file);
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
async function prepare(K, raw, resolve) {
  const {fields,id,record,check,finite}=K.procedural.musicInstruments;
  check(fields(raw,['format','version','id','window','markers','performance','effects','views']) &&
    raw.format===planFormat && raw.version===1 && id(raw.id) &&
    fields(raw.window??{},['fps','fromFrame','toFrame']) &&
    ['markers','performance','effects'].every(key=>raw[key]===undefined||token(raw[key])) &&
    record(raw.views) && Object.keys(raw.views).length>=1 && Object.keys(raw.views).length<=12,
  'Expected a version 1 story presentation plan with up to 12 views');
  const compiled=new Map();
  const widthRange=value=>Number.isSafeInteger(value)&&finite(value,64,1024);
  for (const [name,row] of Object.entries(raw.views)) {
    check(id(name) && Object.hasOwn(modes,row?.mode) && fields(row,['mode',...modes[row.mode]]),'Invalid presentation view '+name);
    const {mode}=row;
    if (mode==='webgpu'||mode==='projector') continue;
    const {width=320,height=180}=row;
    check(widthRange(width)&&widthRange(height),'Presentation view needs dimensions from 64 to 1024: '+name);
    if (mode==='debug') {
      check((row.entities===undefined||Array.isArray(row.entities)&&row.entities.length<=64&&row.entities.every(K.world.data.id)&&
        new Set(row.entities).size===row.entities.length) &&
        (row.story===undefined||typeof row.story==='string'&&row.story.split('/').length===2&&row.story.split('/').every(id)),
      'Debug view needs distinct entity IDs and an optional document/story ID');
      if (row.bounds!==undefined) K.world.fields.bounds(row.bounds);
    }
    if (mode==='splat' && row.camera!==undefined) check(fields(row.camera,['target','dist','yaw','pitch','fov']) &&
      (row.camera.target===undefined||K.world.data.vector(row.camera.target)) &&
      ['yaw','pitch'].every(key=>row.camera[key]===undefined||finite(row.camera[key],-1e4,1e4)) &&
      (row.camera.dist===undefined||finite(row.camera.dist,.01,1e5)) &&
      (row.camera.fov===undefined||finite(row.camera.fov,.01,3.13)),'Invalid splat camera for '+name);
    if (mode==='puppet') check(raw.performance && token(row.graph) && id(row.output??'picture'),
      'Puppet view needs a cast performance plan and graph');
    compiled.set(name,{...row,name,width,height});
  }
  for (const mode of ['webgpu','projector']) for (const [name,row] of Object.entries(raw.views)) {
    if (row.mode!==mode) continue;
    const source=compiled.get(row.source);
    check(source && ['splat','puppet',...(mode==='projector'?['webgpu']:[])].includes(source.mode),
      mode+' view '+name+' needs an art view as its source');
    const spec={...row,name,width:source.width,height:source.height};
    if (mode==='webgpu') {
      check(token(row.shader)&&(row.channel===undefined||id(row.channel)&&raw.effects)&&
        (row.amount===undefined||finite(row.amount,0,1)),'WebGPU view needs WGSL and an optional effect channel');
      const file=resolve(row.shader);
      if (fs.statSync(file).size>65536) throw new RangeError('Presentation WGSL exceeds 64 KiB');
      spec.wgsl=fs.readFileSync(file,'utf8');
    } else await projectionSurfaces(row.surfaces??[]);
    compiled.set(name,spec);
  }
  return compiled;
}
function projector(stage,spec,clock,ffmpeg) {
  const dir='views/'+spec.name, file=dir+'/feed.mkv', stem=dir+'/frame-%06d.png';
  const fps=clock.frameRate.numerator+'/'+clock.frameRate.denominator;
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin',
    '-framerate',fps,'-start_number','0','-i',stage.at(stem),'-an','-c:v','ffv1','-pix_fmt','bgr0',
    '-threads','1','-map_metadata','-1',stage.reserve(file)],{encoding:'utf8',maxBuffer:1024*1024});
  if (result.error||result.status!==0)
    throw new Error('Projector encoder failed: '+(result.error?.message??result.stderr.trim()));
  stage.json(dir+'/patch.json',{format:'ink-studio/graph-project',version:1,nodes:{
    feed:{op:'patch.video'}
  },outputs:{picture:{node:'feed'}}});
  const show=dir+'/show.json';
  stage.json(show,{format:'ink-studio/patch-show',version:1,patch:'patch.json',output:'picture',video:'feed.mkv',
    size:spec.width+'x'+spec.height,fps,frames:clock.frameCount,projector:{surfaces:spec.surfaces??[]}});
  return {file,show};
}

async function command(file,planFile,rest,opt,library) {
  if (!file||!planFile||rest.length||!token(opt.out)||
    Object.entries(opt).some(([key,value])=>!['out','gpu-module','ffmpeg'].includes(key)||!token(value)))
    throw new TypeError('Use '+usage);
  const kit=library(), K=kit.KIT, W=K.world, T=K.procedural.takeTime, R=W.runtime;
  const inputs=new Set(), onFile=entry=>{const absolute=path.resolve(entry); inputs.add(absolute); return absolute;};
  const plan=read(onFile(planFile)), root=path.dirname(path.resolve(planFile)), resolve=entry=>onFile(path.resolve(root,entry));
  const specs=await prepare(K,plan,resolve), recording=readNativeRun(onFile(file),kit,onFile);
  const clock=clockFor(K,recording,{...plan.window,width:64,height:64,video:false},
    recording.origin.world.takeClock?.sampleRate??48000);
  const pixels=[...specs.values()].reduce((n,spec)=>n+spec.width*spec.height,0);
  if (pixels*clock.frameCount>Replay.maxPixels) throw new RangeError('Presentation pack exceeds its combined frame pixel budget');
  const firstTick=clock.take.at(clock.fromFrame).tick, lastTick=clock.take.at(clock.toFrame-1).tick;
  const byTick=new Map(), markerPlan=plan.markers===undefined ? undefined : read(resolve(plan.markers));
  const timeline=W.storySceneTimeline.forRun(recording,{plan:markerPlan,fromTick:firstTick,toTick:lastTick});
  const markers=new Map();
  let beatCount=0;
  await W.storySceneTimeline.scan(recording,event=>{
    if (event.tick<firstTick||event.tick>lastTick) return;
    if (++beatCount*(specs.size+1)>50000) throw new RangeError('Presentation beat index exceeds its budget');
    const {tick,kind}=event, beatId=W.inspectionLinks.identify(event);
    const row=timeline.add(event);
    if (!byTick.has(tick)) byTick.set(tick,[]);
    if (row) markers.set(beatId,row);
    const rows=byTick.get(tick);
    if (rows.length>=4096) throw new RangeError('Presentation beat list exceeds its per-tick budget');
    rows.push({beatId,tick,kind});
  });
  const performance=plan.performance===undefined ? undefined : await W.actorPerformance.replay(recording,read(resolve(plan.performance)));
  const actor=performance&&W.actorPerformance.open(performance);
  const effectSheet=plan.effects===undefined ? undefined : await W.eventVisualEffects.replay(recording,read(resolve(plan.effects)));
  const effectTrack=effectSheet&&W.eventVisualEffects.open(effectSheet);
  const stage=stageAt(opt.out), gpu=createPatchGpu(root,opt['gpu-module']), graphs=new Map();
  try {
    if (performance) stage.json('performance.json',performance);
    if (effectSheet) stage.json('effects.json',effectSheet);
    stage.json('timeline.json',timeline.finish());
    for (const spec of specs.values()) if (spec.mode==='puppet') {
      const adapter=views.puppet(kit,resolve(spec.graph),spec.output??'picture');
      graphs.set(spec.name,adapter);
      adapter.graph.sourceFiles().forEach(onFile);
    }
    const run=R.openRecording(recording), frames=[], viewRows=Object.fromEntries([...specs].map(([name,spec])=>[name,{
      mode:spec.mode,width:spec.width,height:spec.height,...(spec.source&&{source:spec.source}),frames:[]
    }]));
    let through=firstTick-1, bytes=0;
    for (let index=clock.fromFrame;index<clock.toFrame;index++) {
      const take=clock.take.at(index), frame=run.advance(take.tick), query=run.query(), beats=[];
      for (let tick=through+1;tick<=take.tick;tick++) beats.push(...(byTick.get(tick)??[]));
      through=take.tick;
      const point=T.pack(T.requireFrame(take).start), offset=index-clock.fromFrame;
      const cueState=actor?.sample(point), activeFx=effectTrack?.sample(point,{
        world:frame.world.id,stream:frame.eventStream,throughTick:frame.tick
      });
      const samples=new Map();
      const receipt={frame:index,offset,tick:take.tick,time:take.start,timecode:point,firstSample:take.firstSample,
        endSample:take.endSample,shot:take.shot};
      frames.push({...receipt,beats:beats.map(row=>{
        const marker=markers.get(row.beatId);
        return marker ? {...row,label:marker.label,category:marker.category} : row;
      })});
      for (const spec of specs.values()) {
        let image, details, data;
        if (spec.mode==='debug') ({image,details}=views.debug(K,spec,frame,query,beats));
        if (spec.mode==='splat') ({image,details}=views.splat(kit,spec,frame,query,take,effectSheet));
        if (spec.mode==='puppet') {
          image=await graphs.get(spec.name).frame(take,performance,spec.width,spec.height);
          details={cast:Object.fromEntries(Object.entries(cueState.cast).map(([id,row])=>[id,row.visible])),cues:cueState.active};
        }
        if (spec.mode==='webgpu') {
          const {width,height,data:rgba}=samples.get(spec.source).image;
          const cue=spec.channel&&activeFx?.active.findLast(row=>row.kind==='shader'&&row.target===spec.channel);
          const amount=spec.channel ? (cue?.amount??0)*(spec.amount??1) : spec.amount??1;
          const position=cue?.at??[0,0,0];
          const result=await gpu.process({width,height,data:rgba,wgsl:spec.wgsl,time:take.start,amount,position});
          image={width,height,channels:4,data:result};
          details={amount,position,...(cue&&{cue:{beatId:cue.beatId,id:cue.id}})};
        }
        if (spec.mode==='projector') {
          const source=samples.get(spec.source);
          const opaque=source.image.data.every((value,i)=>i%4!==3||value===255);
          if (opaque) ({image,data}=source);
          else image=K.procedural.raster.blend(K.procedural.raster.canvas({
            width:spec.width,height:spec.height,color:[0,0,0,255]
          }),source.image);
        }
        image=views.rgba(K,image);
        data??=views.png(image);
        const name='views/'+spec.name+'/frame-'+serial(offset)+'.png';
        bytes+=data.length;
        if (bytes>Replay.maxReplayBytes) throw new RangeError('Presentation images exceed the PNG byte budget');
        stage.save(name,data);
        samples.set(spec.name,{image,data});
        viewRows[spec.name].frames.push({...receipt,file:name,sha256:createHash('sha256').update(data).digest('hex'),
          beats,...(details&&{details})});
      }
    }
    for (const spec of specs.values()) if (spec.mode==='projector')
      viewRows[spec.name].feed=projector(stage,spec,clock,opt.ffmpeg??'ffmpeg');
    stage.json('presentation.json',{format,version:1,id:plan.id,world:recording.origin.world.id,
      recording:createHash('sha256').update(JSON.stringify(recording)).digest('hex'),timeline:'timeline.json',
      ...(performance&&{performance:'performance.json'}),...(effectSheet&&{effects:'effects.json'}),
      clock:{frameRate:clock.frameRate,fromFrame:clock.fromFrame,toFrame:clock.toFrame,simulationPeriod:T.pack(clock.period),
        sampleRate:clock.rate,firstSample:clock.firstSample,endSample:clock.endSample},frames,views:viewRows});
    stage.publish(inputs);
  } finally {
    try { for (const {graph} of graphs.values()) graph.clear(); }
    finally { gpu.dispose(); stage.close(); }
  }
}

module.exports={command,usage};
