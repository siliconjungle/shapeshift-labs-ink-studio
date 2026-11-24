/* Rebuild the Warden's native reference plates and evaluate delivery frames. */
const path = require('node:path');
const ink = require('../..');
const {pose:animate} = require('../../cli/diarama-pose.js');
const {render,cameraCapture} = require('../../cli/render.js');
const {fit,coverageOf} = require('../../cli/splat-fit.js');
const {bake} = require('../../cli/traced-lighting.js');
const {write,json} = require('../../cli/asset-files.js');
const {encode} = require('../../cli/png.js');

const kit=ink.load(), shot=require('./warden-relay.js')(kit);
const world=shot.build(shot.seed);
const output=path.resolve(process.argv[2] ?? 'warden-review');
const w=176, h=136;
const subjects=['head','chest','lower-L','hand-L','lower-R','hand-R','staff'];
const select=subjects.map(object=>({object}));
const views=[
  {time:0,camera:{yaw:-.43}},
  {time:.8,camera:{yaw:-.29}},
  {time:1.8,camera:{yaw:.10}},
  {time:1.2,camera:{yaw:-.12},holdout:true}
];
const view=extra=>({w,h,px:1,fragmentBudget:1500000,...extra});
const pose=(scene,time)=>animate(scene,time,{kit});
const exact={posed:true};
const options={w,h,px:1,t:.8,...views[1].camera};
pose(world,.8);
let camera;
render(world,{...options,...cameraCapture(options,value=>{camera=value;})});
const light=bake(world,options,camera,{samples:96,spacing:.063,bounces:2,posed:true,select});
json(path.join(output,'traced-lighting.json'),light);

function rgba(frame,alpha) {
  const data=Buffer.alloc(w*h*4);
  for (let p=0;p<w*h;p++) {
    data.set(frame.rgb.subarray(p*3,p*3+3),p*4);
    data[p*4+3]=Math.round(255*alpha[p]);
  }
  return data;
}

for (const [index,entry] of views.entries()) {
  pose(world,entry.time);
  const settings=view({t:entry.time,...entry.camera});
  const reference=render(world,{...settings,sdfAssist:exact,objectMattes:subjects,
    passes:['objectId','depth','emission','normal']});
  const coverage=coverageOf(reference), pixels=rgba(reference,coverage), mask=Buffer.alloc(w*h*4);
  for (let p=0;p<w*h;p++) {
    const name=reference.passes.objects[reference.passes.objectId[p]];
    const lit=(reference.rgb[p*3]+reference.rgb[p*3+1]+reference.rgb[p*3+2])/3;
    if (name==='head' && lit>109 && lit<226 || name==='staff' && lit>110 || name?.startsWith('hand-')) {
      const strength=name?.startsWith('hand-') ? 230 : 150;
      mask.set([strength,strength,strength,255],p*4);
    }
  }
  entry.reference={w,h,data:pixels,max:255};
  entry.mask={w,h,data:mask,max:255};
  write(path.join(output,'view-'+index+'-reference.png'),encode(w,h,pixels,4));
  write(path.join(output,'view-'+index+'-mask.png'),encode(w,h,mask,4));
}
const plan={width:w,height:h,objects:subjects,select,rounds:4,prune:.08,sdfAssist:exact};
json(path.join(output,'approvals.json'),{...plan,views:views.map(({time,camera,holdout},i)=>({
  time,camera,holdout,reference:'view-'+i+'-reference.png',mask:'view-'+i+'-mask.png'
}))});
const fitted=fit(world,{...plan,views,pose,view});
json(path.join(output,'splat-fit.json'),fitted);

const variants={
  baseline:{sdfAssist:false,tracedLighting:false,splatFit:false},
  surface:{sdfAssist:exact,tracedLighting:false,splatFit:false},
  fit:{sdfAssist:false,tracedLighting:false,splatFit:fitted},
  final:{sdfAssist:exact,tracedLighting:{asset:light,strength:.68},splatFit:fitted}
};
const checks=[];
for (const [i,entry] of views.entries()) {
  pose(world,entry.time);
  const made={};
  for (const [id,configuration] of Object.entries(variants)) {
    const frame=render(world,{...view({t:entry.time,...entry.camera}),...configuration,objectMattes:subjects,
      passes:['depth','objectId','position','normal']});
    write(path.join(output,'view-'+i+'-'+id+'.png'),encode(w,h,frame.rgb));
    made[id]=frame;
  }
  const coverage=Object.fromEntries(Object.entries(made).map(([id,frame])=>[id,coverageOf(frame)]));
  const counts={missing:0,extra:0,depth:0,finalCoverageDelta:0,fillChanged:0};
  const reference=made.surface;
  for (let p=0;p<w*h;p++) {
    if (coverage.surface[p]-coverage.baseline[p]>.28) counts.missing++;
    if (coverage.baseline[p]-coverage.surface[p]>.28) counts.extra++;
    if (coverage.surface[p]>.95 && coverage.baseline[p]>.95 &&
        Math.abs(made.baseline.passes.depth[p]-reference.passes.depth[p])>.042) counts.depth++;
    if (Math.abs(coverage.final[p]-coverage.surface[p])>.05) counts.finalCoverageDelta++;
    if (coverage.surface[p]>.95 && [0,1,2].some(c=>Math.abs(made.final.rgb[3*p+c]-reference.rgb[3*p+c])>=8))
      counts.fillChanged++;
  }
  checks.push({time:entry.time,...counts});
}
json(path.join(output,'report.json'),{light:light.stats,fit:fitted.report,coverage:checks});
console.log(JSON.stringify({light:light.stats,fit:fitted.report,coverage:checks}));
