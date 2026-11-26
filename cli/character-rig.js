const fs=require('node:fs');
const path=require('node:path');
const { assemble, compile, templates, fields, record, range, sha }=require('./character-rig-assembly.js');
const { solve, openPose }=require('./character-rig-solve.js');
const { buildBinding, loadBinding, read }=require('./character-rig-bind.js');
const files=require('./asset-files.js');
const { graphOutputs }=require('./graph-outputs.js');
const { claim }=require('./graph-batch.js');
const PNG=require('./png.js');

function inspect(rig, pose, K) {
  const joints=rig.joints.map(joint=>({id:joint.id,parent:joint.parent<0?null:rig.joints[joint.parent].id,
    at:joint.at,length:joint.length,limit:joint.limit}));
  return {format:'ink-studio/character-rig-inspection',version:1,id:rig.id,rigHash:rig.hash,
    components:rig.document.components,joints,degreesOfFreedom:rig.parameters.filter(row=>row.min!==row.max).length,
    ...(pose&&{pose:openPose(rig,pose,K),solve:pose.solve})};
}

function preview(rig, binding, bindingFile, pose, view, output, sources, kit) {
  if (!fields(view,['w','h','camera','raw','proxies']) || !Number.isSafeInteger(view.w ?? 224) ||
      !Number.isSafeInteger(view.h ?? 224) || ![view.w ?? 224,view.h ?? 224].every(n=>range(n,8,1024)) ||
      view.camera!==undefined && !record(view.camera) ||
      view.raw!==undefined && typeof view.raw!=='boolean' || view.proxies!==undefined && typeof view.proxies!=='boolean')
    throw new TypeError('Character preview needs bounded dimensions and camera options');
  const {w=224,h=224,camera,raw=true,proxies=true}=view;
  if (w*h>524288) throw new RangeError('Character preview exceeds its pixel budget');
  const {world,apply,snapshot,assets}=loadBinding(rig,binding,path.dirname(bindingFile),kit);
  const frame=apply(pose), carriers=snapshot();
  const render=require('./render.js').render(world,{w,h,px:1,t:0,raw,
    ...(camera!==undefined&&{camera:kit.KIT.procedural.sceneGraph.camera(camera)}),splatDepthProxies:proxies,
    passes:['proxyDepth','proxyRejected'],shutter:false,renderGrid:false});
  const previewBytes=PNG.encode(render.w,render.h,render.rgb,3,{srgb:true});
  const {proxyDepth,proxyRejected}=render.passes ?? {};
  const report={format:'ink-studio/character-preview',version:1,rig:rig.id,rigHash:rig.hash,solve:pose.solve,
    cap:{w:render.w,h:render.h,proxies},joints:frame.joints,maxBoneDrift:frame.maxBoneDrift,
    carriers:carriers.map(({id,type,report})=>({id,type,...report})),
    depthProxyPixels:proxyDepth?.reduce((n,v)=>n+Number(Number.isFinite(v)),0) ?? 0,
    rejectedFragments:proxyRejected?.reduce((n,v)=>n+v,0) ?? 0,
    files:{image:'preview.png',geometry:'posed-carriers.json'},previewSha256:sha(previewBytes)};
  const root=path.resolve(output), latest=path.join(root,'latest.json'), release=claim(root,'character preview');
  let staged;
  try {
    graphOutputs([...sources,...assets]).protect(fs.statSync(latest,{throwIfNoEntry:false}));
    staged=fs.mkdtempSync(path.join(root,'.pose-'));
    files.write(path.join(staged,report.files.image),previewBytes);
    files.json(path.join(staged,report.files.geometry),{format:'ink-studio/posed-character-carriers',version:1,rig:rig.id,
      rigHash:rig.hash,carriers:carriers.map(({report,...row})=>row)});
    files.json(path.join(staged,'report.json'),report);
    const folder='pose-'+path.basename(staged).slice('.pose-'.length), destination=path.join(root,'poses');
    fs.mkdirSync(destination,{recursive:true});
    fs.renameSync(staged,path.join(destination,folder));
    staged=undefined;
    const marker={format:report.format,version:1,rig:rig.id,
      image:'poses/'+folder+'/preview.png',geometry:'poses/'+folder+'/posed-carriers.json',report:'poses/'+folder+'/report.json'};
    files.json(latest, marker);
    return marker;
  } finally {
    if(staged)fs.rmSync(staged,{force:true,recursive:true});
    release();
  }
}

const actions = {
  templates:{count:0,flags:[]},
  assemble:{count:1,flags:['out']},
  inspect:{count:1,flags:['out','pose']},
  solve:{count:2,flags:['out','require-solved']},
  bind:{count:2,flags:['out']},
  preview:{count:3,flags:['out','view']}
};

function command([mode,...args], options, kit) {
  const choice=Object.hasOwn(actions,mode)&&actions[mode], {KIT:K}=kit;
  if (!choice||args.length!==choice.count||Object.entries(options).some(([key,value])=>
    !choice.flags.includes(key)||(key==='require-solved'?value!==true:typeof value!=='string'||!value.trim()))||
    ['bind','preview'].includes(mode)&&!options.out)
    throw new TypeError('Use character-rig templates|assemble|inspect|solve|bind|preview. See ink-studio help.');
  const emit=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if (mode==='templates') return emit({format:'ink-studio/character-rig-templates',version:1,templates});
  const documents=args.map(file=>path.resolve(file)), [rigFile,requestFile,poseFile]=documents;
  const source=read(rigFile).document;
  let result;
  if (mode==='assemble') result=assemble(source,K);
  else {
    const rig=compile(source,K);
    if (mode==='inspect') {
      if(options.pose)documents.push(path.resolve(options.pose));
      result=inspect(rig,options.pose&&read(path.resolve(options.pose)).document,K);
    } else if (mode==='solve') {
      result=solve(rig,read(requestFile).document,K);
      if (options['require-solved']&&!result.solve.passed) process.exitCode=2;
    } else if (mode==='bind') {
      const planned=buildBinding(rig,read(requestFile).document,path.dirname(requestFile),path.dirname(path.resolve(options.out)),K);
      result=planned.document;
      documents.push(...planned.sources);
    } else {
      if (options.view) documents.push(path.resolve(options.view));
      return emit(preview(rig,read(requestFile).document,requestFile,read(poseFile).document,
        options.view?read(path.resolve(options.view)).document:{},options.out,documents,kit));
    }
  }
  if (options.out) {
    const file=path.resolve(options.out);
    graphOutputs(documents).protect(fs.statSync(file,{throwIfNoEntry:false}));
    if (mode==='bind') {
      files.write(file,Buffer.from(JSON.stringify(result)+'\n'));
      return emit({file,rig:result.rig,rigHash:result.rigHash,
        carriers:result.carriers.map(({id,type,mode,weights})=>({id,type,mode,points:weights.length}))});
    }
    files.json(file,result);
  }
  return emit(result);
}

module.exports={command};
