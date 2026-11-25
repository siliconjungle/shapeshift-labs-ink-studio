const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const render = require('./render.js');
const { pose } = require('./diarama-pose.js');
const read = file => JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const named = value => typeof value==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,95}$/.test(value);

function review(program, {api,kit,build}, output) {
  const views=program?.views;
  if (program?.format!=='ink-studio/cable-gap-views'||program.version!==1||!Array.isArray(views)||
      !views.length||views.length>16)
    throw new RangeError('Supply 1–16 approved views in a version 1 cable gap view document');
  const ids=new Set();
  let pixels=0;
  for(const view of views) {
    if(!view||!Object.keys(view).every(key=>['id','w','h','camera','time','checks'].includes(key))||
        !named(view.id)||ids.has(view.id)||![view.w,view.h].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1024)||
        !Number.isFinite(view.time??0)||(view.time??0)<0)
      throw new RangeError('Each approved cable view needs a unique ID, native dimensions and a nonnegative time');
    ids.add(view.id);
    pixels+=view.w*view.h;
  }
  if(pixels>8000000)throw new RangeError('Cable views exceed their native pixel budget');
  const reports=[],images=[];
  for(const view of views){
    const world=build(), t=view.time??0;
    pose(world,t,{kit,maxSteps:7200});
    const frame=render.render(world,{w:view.w,h:view.h,px:1,t,camera:view.camera,raw:true,
      passes:['objectId','coverage'],curveMode:'curves',composite:false,renderGraph:false,renderGrid:false});
    const measured=api.measureView(frame,view.checks), preview=view.id+'.png';
    images.push([preview,PNG.encode(frame.w,frame.h,frame.rgb)]);
    reports.push({id:view.id,time:t,camera:view.camera,preview,...measured});
  }
  for(const [preview,bytes] of images)files.write(path.join(output,preview),bytes);
  return {format:'ink-studio/cable-gap-review',version:1,status:reports.every(row=>row.status==='ok')?'ok':'review',views:reports};
}

function command([action,input,settings,...extra],opt,kit,build) {
  const reviewing=action==='review', planning=action==='plan';
  const flags=reviewing?['out','strict']:['out','graph','strict'];
  if((!reviewing&&!planning)||!input||extra.length||(reviewing?!settings||!opt.out:settings!==undefined||!opt.graph)||
      Object.entries(opt).some(([key,value])=>!flags.includes(key)||typeof value!=='string')||
      opt.strict!==undefined&&!['on','off'].includes(opt.strict))
    throw new RangeError('Use cable-route plan <cable.json> --graph <scene-graph.json> or review <scene> <views.json> --out <directory>');
  const api=kit.KIT.procedural.cableRoutes, output=opt.out&&path.resolve(opt.out);
  const inputs=[input,settings,opt.graph].filter(Boolean).map(file=>path.resolve(file));
  if(output&&inputs.includes(output))throw new RangeError('Choose an output separate from the inputs');
  let result;
  if(reviewing){
    const program=read(settings);
    const names=[path.join(output,'report.json'),...(Array.isArray(program?.views)?program.views.filter(view=>named(view?.id))
      .map(view=>path.join(output,view.id+'.png')):[])];
    if(names.some(file=>inputs.includes(file)))throw new RangeError('Choose a review directory with distinct output paths');
    result=review(program,{api,kit,build:()=>build(input)},output);
    files.json(path.join(output,'report.json'),result);
  } else {
    const planned=api.plan(read(input),{graph:read(opt.graph)});
    result={...planned.report,...(planned.route&&{points:planned.route.points})};
    if(output)files.json(output,result);
  }
  if(!output)process.stdout.write(JSON.stringify(result,null,2)+'\n');
  else process.stdout.write(JSON.stringify({status:result.status,output},null,2)+'\n');
  if(opt.strict==='on'&&result.status!=='ok') process.exitCode=1;
}

module.exports={command,review};
