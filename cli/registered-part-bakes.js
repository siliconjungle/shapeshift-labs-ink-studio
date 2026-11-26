const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const Plan = require('./registered-part-plan.js');
const Seams = require('./registered-part-seams.js');
const { claim } = require('./graph-batch.js');

const format='ink-studio/registered-part-results';
const nonempty=value=>typeof value==='string'&&value.trim();
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function publicPlan(plan) {
  return {format:Plan.format,version:1,planSha256:plan.sha256,preset:plan.preset,budget:plan.budget,
    ...(plan.palette&&{palette:plan.palette}),targets:plan.targets.map(row=>row.info)};
}

function stageRun(input, directory, studio, K) {
  const root=path.resolve(directory), latest=path.join(root,'latest.json');
  if(input===latest)throw new RangeError('Bake output must keep its plan separate');
  const release=claim(root,'registered part bake');
  let staging;
  try {
    const plan=Plan.plan(input,studio,K), manifest=publicPlan(plan);
    staging=fs.mkdtempSync(path.join(root,'.part-bake-'));
    const targets=[];
    for(const target of plan.targets) {
      const id=target.info.id, folder=path.join(staging,id), glb=path.join(folder,'model.glb');
      const native=studio.exportGlb({meshes:target.pages.map(page=>page.model)},{
        out:glb,bakeDir:folder,cageBake:{format:'ink-studio/material-cage-bake',version:1,receivers:target.receivers},
        registeredPages:target.pages.map(page=>page.options)
      });
      const bake=json(native.materialBake), report=Seams.inspect(target,bake,folder,plan.preset.seams,K);
      files.json(path.join(folder,'seams.json'),report);
      const cages=bake.meshes.map(row=>row.cageBake), fields=['sampled','hits','misses','crossPart','rejectedCrossPart','backfaces'];
      const totals=Object.fromEntries(fields.map(key=>[key,cages.reduce((sum,row)=>sum+(row?.[key]??0),0)]));
      targets.push({ ...target.info, model:id+'/model.glb', materialBake:id+'/material-bake.json', seams:id+'/seams.json',
        samplingTotals:totals, seamSummary:{edges:report.edges,flagged:report.flagged,sampled:report.sampled,missing:report.missing},
        palettePins:bake.meshes.flatMap((row,i)=>(row.palette?.pins??[]).map(pin=>({...pin,tile:target.pages[i].at}))) });
    }
    const {format:_format,...header}=manifest;
    const document={...header,format,targets};
    files.json(path.join(staging,'manifest.json'),document);
    const revisions=path.join(root,'revisions');
    fs.mkdirSync(revisions,{recursive:true});
    // Keep earlier packages available and publish the pointer only after all targets finish.
    const revision='part-'+path.basename(staging).slice('.part-bake-'.length), destination=path.join(revisions,revision);
    fs.renameSync(staging,destination);
    staging=null;
    files.json(latest,{format,version:1,revision,manifest:'revisions/'+revision+'/manifest.json'});
    return {revision,directory:destination,...document};
  } finally {
    if(staging)fs.rmSync(staging,{recursive:true,force:true});
    release();
  }
}

module.exports=function command([action,input,...rest],opt,kit) {
  if(!['inspect','run','preset'].includes(action)||!nonempty(input)||rest.length||
    Object.entries(opt).some(([key,value])=>key!=='out'||!nonempty(value))||
    action==='run'&&!opt.out||action==='inspect'&&opt.out)
    throw new RangeError('Use material-bake inspect|run <plan.json> or material-bake preset <name>');
  const studio=require('../index.js'), {KIT:K}=kit;
  let result;
  if(action==='preset'){
    result=Plan.preset(input);
    if(opt.out)files.json(path.resolve(opt.out),result);
  }else{
    const file=path.resolve(input);
    result=action==='inspect'?publicPlan(Plan.plan(file,studio,K)):stageRun(file,opt.out,studio,K);
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
};
