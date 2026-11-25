const fs=require('node:fs');
const path=require('node:path');
const files=require('./asset-files.js');
const PNG=require('./png.js');
const R=require('./render.js');
const {pose}=require('./diarama-pose.js');
const {viewSettings,worldFor}=require('./mesh-native-view.js');

const format='ink-studio/mesh-shape-revision';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const name=arg=>typeof arg==='string'&&!!arg.trim();
const record=(row,fields)=>row&&Object.getPrototypeOf(row)===Object.prototype&&
  Object.keys(row).every(key=>fields.includes(key));

function captures(before,after,raw,request,kit,worlds,object,outputs) {
  const {KIT:K}=kit, T=K.meshTopology;
  if (!record(raw,['w','h','t','camera','raw','materials','poses']) ||
      raw.poses!==undefined&&(!Array.isArray(raw.poses)||raw.poses.length>16||
        !Array.from(raw.poses).every(row=>record(row,['id','matrices','rotations'])&&name(row.id)&&row.id!=='rest')||
        new Set(raw.poses.map(row=>row.id)).size!==raw.poses.length))
    throw new RangeError('Shape key view needs a native grid and up to 16 named poses');
  const view=viewSettings(raw,!object);
  const views=(raw.poses??[]).map(row=>row.id===request?.pose?.id ? request.pose : row);
  if (request?.pose&&!views.some(row=>row.id===request.pose.id)) views.push(request.pose);
  const samples=[{id:'rest'},...views];
  const images=[], reports=[];
  for (const [i,sample] of samples.entries()) {
    const sides=[before,after].map(({document,shapeKeys},j)=>{
      const world=worlds ? worlds[j].build() : worldFor(document,view,kit,before.document);
      const mesh=object ? world.topologyMeshes[object].mesh : world.meshes[0];
      const source=T.sourceDocument(mesh);
      const keys=T.shapeKeys.status(source,shapeKeys)==='ready' ? T.shapeKeys.bind(mesh,shapeKeys) : null;
      const skin=source.skin && T.skin.bind(mesh);
      pose(world,view.t,{kit,maxSteps:7200});
      if (sample.id==='rest') keys?.rest();
      else if (keys) keys.pose(sample.matrices,{rotations:sample.rotations});
      else if (skin) skin.pose(sample.matrices);
      const image=R.render(world,{w:view.w,h:view.h,t:view.t,px:1,raw:view.raw,camera:view.camera,edges:false,
        lockCamera:true,renderGrid:false,shutter:false,cameraGuides:false});
      if (image.w!==view.w||image.h!==view.h) throw new RangeError('Shape key review needs its requested native grid');
      return {image,keys:keys?.state()??[]};
    });
    const pair=sides.map(row=>row.image);
    let changedPixels=0;
    for (let p=0;p<pair[0].rgb.length;p+=3)
      if ([0,1,2].some(k=>pair[0].rgb[p+k]!==pair[1].rgb[p+k])) changedPixels++;
    const sheet=R.grid(pair,2,['BEFORE','AFTER']);
    const file='view-'+String(i).padStart(2,'0')+'.png';
    images.push({file,w:sheet.w,h:sheet.h,rgb:sheet.rgb});
    reports.push({pose:sample.id,changedPixels,before:sides[0].keys,after:sides[1].keys,image:file});
  }
  const paths=images.map(row=>path.resolve(outputs.directory,row.file));
  if (paths.some(file=>outputs.reserved.has(file))) throw new RangeError('Write pose images separately from file inputs and outputs');
  images.forEach(({w,h,rgb},i)=>files.write(paths[i],PNG.encode(w,h,rgb)));
  return {grid:[view.w,view.h],views:reports};
}

function command(file,input,rest,opt,toolkit,openEditor) {
  const {object,out,report,view,preview:directory}=opt, T=toolkit.KIT.meshTopology;
  if (!file||rest.length||[file,input,object,out,report,view,directory].some(n=>n!==undefined&&!name(n))||
      Object.keys(opt).some(key=>!['object','out','report','view','preview'].includes(key))||
      Boolean(view)!==Boolean(directory)||out&&!input)
    throw new TypeError('Use mesh-topology shape-keys <mesh-or-scene.json> [request.json] [--object id] [--view file --preview dir] [--out file] [--report file]');
  const inputs=[file,input,view].filter(Boolean).map(n=>path.resolve(n)), outputs=[out,report].filter(Boolean).map(n=>path.resolve(n));
  if (outputs.length!==new Set(outputs).size||outputs.some(n=>inputs.includes(n)))
    throw new RangeError('Write shape revision outputs separately from the inputs');
  if (object&&out&&path.dirname(path.resolve(file))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const stored=read(file);
  if (stored.topologyMeshes&&!object) throw new RangeError('Choose an editable scene mesh with --object');
  const editor=object&&openEditor(file), row=editor ? editor.meshTopology(object) :
    stored.format===format&&stored.version===1 ? stored : {document:stored};
  const before={document:T.create(row.document),shapeKeys:row.shapeKeys};
  const request=input&&read(input);
  const plan=request&&(editor ? editor.planMeshShapeKeys(object,request) :
    T.shapeKeys.plan(before.document,request,{shapeKeys:before.shapeKeys}));
  let evidence=plan ? plan.report : T.shapeKeys.inspect(before.document,before.shapeKeys);
  const after=plan||before;
  if (directory) {
    const draft=editor&&request ? editor.fork() : editor;
    if (draft&&request) draft.editMeshShapeKeys(object,request);
    evidence={...evidence,native:captures(before,after,read(view),request,toolkit,
      editor&&[editor,draft],object,{directory,reserved:new Set([...inputs,...outputs])})};
  }
  if (report) files.json(path.resolve(report),evidence);
  if (out) {
    if (editor) editor.editMeshShapeKeys(object,request);
    files.json(path.resolve(out), editor ? editor.snapshot() :
      {format,version:1,document:after.document,...(after.shapeKeys&&{shapeKeys:after.shapeKeys})});
  } else process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
}

module.exports={command};
