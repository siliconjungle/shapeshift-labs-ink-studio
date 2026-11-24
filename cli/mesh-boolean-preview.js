'use strict';

const fs=require('node:fs');
const path=require('node:path');
const PNG=require('./png.js');
const files=require('./asset-files.js');
const {viewSettings,worldFor,render,cover}=require('./mesh-native-view.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const name=value=>typeof value==='string' && value.trim();

function captures(plan,source,view,toolkit) {
  const box=plan.report.bounds;
  const fit=box ? {vertices:[box.min,box.max].map(position=>({position}))} : source;
  const draw=document=>{
    if (!document.faces.length) {
      const {w,h}=view;
      return {w,h,rgb:Uint8Array.from({length:w*h*3},(_,i)=>[20,36,46][i%3]),
        passes:{depth:new Float64Array(w*h).fill(Infinity)}};
    }
    return render(worldFor(document,view,toolkit,fit),view,toolkit,['geometricNormal','materialId']);
  };
  const a=draw(source), images={'before.png':a};
  if (!plan.document) return {images,report:{grid:[a.w,a.h],available:false}};
  const b=images['result.png']=draw(plan.document);
  const reference=plan.reference ? images['reference.png']=draw(plan.reference) : a;
  const rgb=new Uint8Array(b.rgb.length);
  let silhouette=0,depth=0,material=0;
  const tolerance=plan.report.diagnostics?.edgeShape.tolerance ?? 1e-5;
  for (let i=0;i<b.w*b.h;i++) {
    const ref=cover(reference,i), out=cover(b,i);
    if (ref!==out) {
      silhouette++;
      rgb.set(out ? [111,219,188] : [237,123,105],i*3);
    } else if (ref) {
      const changedDepth=Math.abs(reference.passes.depth[i]-b.passes.depth[i])>tolerance;
      const slot=frame=>frame.passes.materials[frame.passes.materialId[i]];
      const changedMaterial=slot(reference)!==slot(b);
      if (changedDepth) depth++;
      if (changedMaterial) material++;
      rgb.set(changedMaterial ? [205,147,244] : changedDepth ? [249,182,95] : [59,78,83],i*3);
    } else rgb.set([20,36,46],i*3);
  }
  images['difference.png']={w:b.w,h:b.h,rgb};
  return {images,report:{grid:[b.w,b.h],available:true,reference:plan.reference ? 'mesh-boolean' : 'input',
    silhouette,depth,material,tolerance,files:Object.keys(images)}};
}

function command(file,input,rest,opt,toolkit,openEditor) {
  const {object,operand,out,report,view,preview}=opt;
  if (!file || !input || rest.length || [file,input,object,operand,out,report,view,preview].some(arg=>arg!==undefined && !name(arg)) ||
      ['selection','from','visibility','projection','lineage','match-ids','pieces'].some(key=>opt[key]!==undefined))
    throw new TypeError('Use mesh-topology boolean <mesh-or-scene.json> <request.json> [--object id --operand file --out file --report file --view file --preview dir]');
  const inputs=[file,input,operand,view].filter(Boolean).map(arg=>path.resolve(arg));
  const names=['before.png','result.png','reference.png','difference.png'];
  const destinations=[...[out,report].filter(Boolean).map(arg=>path.resolve(arg)),
    ...(preview ? names.map(name=>path.resolve(preview,name)) : [])];
  if (new Set(destinations).size!==destinations.length || destinations.some(arg=>inputs.includes(arg)))
    throw new RangeError('Write Boolean captures, reports and meshes separately from their inputs');
  if (object && out && path.dirname(path.resolve(out))!==path.dirname(path.resolve(file)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const raw=read(file), request=read(input), editor=object && openEditor(file), {meshTopology:api}=toolkit.KIT;
  if (!object && raw?.topologyMeshes) throw new TypeError('Choose an editable scene mesh with --object');
  if (operand!==undefined) {
    if (!request.operand || request.operand.document!==undefined || request.operand.object!==undefined)
      throw new TypeError('Choose a single Boolean operand source');
    request.operand={...request.operand,document:read(operand)};
  }
  const row=editor && editor.meshTopology(object), source=api.create(row ? row.document : raw);
  const plan=editor ? editor.planMeshBoolean(object,request) : api.planBoolean(source,request);
  let evidence=plan.report;
  if (preview || view) {
    const options=viewSettings({materials:plan.materials ?? row?.materials,...(view && read(view))},true);
    const capture=captures(plan,source,options,toolkit);
    evidence={...evidence,native:capture.report};
    if (preview) for (const [name,image] of Object.entries(capture.images))
      files.write(path.resolve(preview,name),PNG.encode(image.w,image.h,image.rgb));
  }
  if (report) files.json(path.resolve(report),evidence);
  if (!out) {
    process.stdout.write(JSON.stringify({patch:plan.patch,report:evidence},null,2)+'\n');
    return;
  }
  if (!plan.report.canCommit) throw new RangeError('Mesh Boolean failed geometry or scene checks');
  if (editor) editor.booleanMeshTopology(object,request);
  files.json(path.resolve(out),editor ? editor.snapshot() : plan.document);
}

module.exports={command,captures};
