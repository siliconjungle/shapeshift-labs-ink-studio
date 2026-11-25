const fs=require('node:fs');
const path=require('node:path');
const R=require('./render.js');
const PNG=require('./png.js');
const files=require('./asset-files.js');
const Camera=require('../src/camera-lens.js');
const {viewSettings,worldFor}=require('./mesh-native-view.js');

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const colors={socket:[255,185,112],'curve-root':[121,223,182],'splat-group':[105,211,248]};

function capture(source,plan,settings,view,kit,directory) {
  const {KIT:K}=kit, {w,h}=view;
  const poses=[{id:null},...(plan.report.issues.some(row=>row.reason==='pose-skin-unavailable') ? [] : settings.poses??[])];
  return poses.map(({id,matrices},i)=>{
    const images=[source,plan.document].map((doc,side)=>{
      const restOnly=doc.skin&&!matrices ? K.meshTopology.edit(doc,{skin:null}) : doc;
      const world=worldFor(restOnly,view,kit,source);
      if (matrices&&doc.skin) {
        const skin=K.meshTopology.skin.bind(world.meshes[0]);
        skin.pose(matrices);
      }
      let camera;
      const image=R.render(world,{w,h,px:1,t:view.t,camera:view.camera,raw:view.raw,edges:false,
        renderGrid:false,shutter:false,cameraGuides:false,
        ...R.cameraCapture(null,(raster,sample)=>{camera={...raster,focal:sample.focal};})});
      if (!camera||image.w!==w||image.h!==h) throw new RangeError('Attachment review needs its requested native grid');
      const {eye,right,up,back}=Camera.fromView(camera.view);
      for (const row of plan.report.attachments) {
        const sample=id===null ? row.rest : row.poses.find(row=>row.id===id);
        const point=sample?.[side ? 'after' : 'before'];
        if (!point) continue;
        const delta=K.V.sub(point,eye), depth=-K.V.dot(back,delta);
        if (depth<camera.clipNear) continue;
        const scale=camera.focal/(camera.ortho ? 1 : depth);
        const x=Math.floor(w*.5+K.V.dot(right,delta)*scale), y=Math.floor(h*.5-K.V.dot(up,delta)*scale);
        for (const [a,b] of [[-2,0],[-1,0],[1,0],[2,0],[0,-2],[0,-1],[0,1],[0,2]]) {
          if (x+a>=0&&x+a<w&&y+b>=0&&y+b<h) image.rgb.set(colors[row.kind],((y+b)*w+x+a)*3);
        }
      }
      return image;
    });
    const sheet=R.grid(images,2,['SOURCE','TRANSFER']);
    const file='pose-'+String(i).padStart(2,'0')+'.png';
    files.write(path.join(directory,file),PNG.encode(sheet.w,sheet.h,sheet.rgb));
    return {pose:id,file};
  });
}

function command(args,opt,kit) {
  const {attachments,settings,view,preview,out,report}=opt;
  const required=[...args,attachments,settings,view,preview,out,report].filter(n=>n!==undefined);
  if (args.length!==3||required.some(n=>typeof n!=='string'||!n.trim())||view&&!preview||
      Object.keys(opt).some(key=>!['attachments','settings','view','preview','out','report'].includes(key)))
    throw new TypeError('Use mesh-topology transfer-attachments <before.json> <replacement.json> <map.json> [--attachments file --settings file --view file --preview dir --out bundle.json --report file]');
  const knobs=settings ? read(settings) : {};
  if (!knobs||Object.getPrototypeOf(knobs)!==Object.prototype||Object.hasOwn(knobs,'attachments'))
    throw new TypeError('Supply the attachment manifest using --attachments');
  if (attachments) knobs.attachments=read(attachments);
  const [before,after,map]=args.map(read);
  const plan=kit.KIT.meshTopology.transferAttachments(before,after,map,knobs);
  const destinations=[out,report,...(preview ? Array.from({length:1+(knobs.poses?.length??0)},(_,i)=>
    path.join(preview,'pose-'+String(i).padStart(2,'0')+'.png')) : [])].filter(Boolean).map(p=>path.resolve(p));
  const inputs=new Set([...args,attachments,settings,view].filter(Boolean).map(p=>path.resolve(p)));
  if (new Set(destinations).size!==destinations.length||destinations.some(p=>inputs.has(p)))
    throw new RangeError('Write transfer outputs separately from the inputs');
  const images=preview && capture(before,plan,knobs,viewSettings(view&&read(view),true),kit,path.resolve(preview));
  const evidence={...plan.report,...(images&&{images})};
  if (report) files.json(path.resolve(report),evidence);
  if (!out) return process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
  if (!evidence.canCommit) throw Object.assign(new RangeError('Mesh attachment transfer needs review'),{report:evidence});
  files.json(path.resolve(out),{format:'ink-studio/mesh-attachment-transfer',version:1,
    document:plan.document,attachments:plan.attachments});
}

module.exports={command};
