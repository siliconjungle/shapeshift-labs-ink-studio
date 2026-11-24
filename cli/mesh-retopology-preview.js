'use strict';

const fs=require('node:fs');
const path=require('node:path');
const PNG=require('./png.js');
const R=require('./render.js');
const Camera=require('../src/camera-lens.js');
const files=require('./asset-files.js');
const {viewSettings,worldFor}=require('./mesh-native-view.js');
const {pose}=require('./diarama-pose.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const name=value=>typeof value==='string' && value.trim();
const colors={grid:[55,115,117],rail:[107,164,170],flow:[110,229,185],joint:[251,154,109],
  rim:[247,194,105],seam:[207,153,249],silhouette:[240,234,194],miss:[240,102,112]};
const imageNames=['before.png','reference.png','result.png','guides.png'];

function loadSurface(surface,file,api) {
  if (!surface || surface.object!==undefined || surface.document!==undefined || surface.volume!==undefined)
    throw new TypeError('Choose one retopology surface source');
  if (surface.kind==='sdf') return {...surface,volume:read(file)};
  if (/\.json$/i.test(file)) return {...surface,document:read(file)};
  // Geometry import retains the registered scene coordinates. This also reads
  // the opaque triangle primitive of an RGB-D mesh with residual splats.
  const mesh=require('../index.js').readMesh(file);
  const {pos,tri,tmat,mats}=mesh;
  if (tri.length/3>40000) throw new RangeError('The retopology reference exceeds its triangle budget');
  const document=api.fromIndexed({id:path.basename(file),positions:pos,indices:tri,
    materials:mats.map((row,i)=>(row.name || 'surface')+'/'+i),faceMaterials:tmat});
  return {...surface,document};
}

function overlay(frame,camera,report,K) {
  const {w,h}=frame,rgb=frame.rgb.map(n=>Math.round(n*.63)), points=new Map();
  const {eye,right,up,back}=Camera.fromView(camera.view), {V}=K;
  function project(p) {
    const delta=V.sub(p,eye), depth=-V.dot(back,delta);
    const scale=camera.ortho ? camera.focal : camera.focal/depth;
    return (camera.ortho || depth>1e-8) && [w/2+V.dot(right,delta)*scale-.5,h/2-V.dot(up,delta)*scale-.5];
  }
  for (const row of report.vertices) points.set(row.id,project(row.position));
  function dot(x,y,color) {
    x=Math.round(x); y=Math.round(y);
    if (x>=0 && x<w && y>=0 && y<h) rgb.set(color,(y*w+x)*3);
  }
  function line(a,b,color) {
    if (!a || !b || ![...a,...b].every(Number.isFinite)) return;
    const n=Math.max(1,Math.min(w*4+h*4,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]))));
    for(let i=0;i<=n;i++) dot(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,color);
  }
  for (const {vertices} of report.quads) for (const [i,id] of vertices.entries())
    line(points.get(id),points.get(vertices[(i+1)%vertices.length]),colors.grid);
  for (const {kind,vertices} of report.guides) for (let i=1;i<vertices.length;i++)
    line(points.get(vertices[i-1]),points.get(vertices[i]),colors[kind]);
  for (const row of report.vertices) {
    const at=points.get(row.id);
    if (!at || row.hit && !row.pins.length) continue;
    const color=row.hit ? colors[row.pins[0]] : colors.miss;
    for (const [x,y] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) dot(at[0]+x,at[1]+y,color);
  }
  return {w,h,rgb};
}

function captures(plan,source,reference,view,kit) {
  const {KIT:K,makeBuilder}=kit, {w,h,t}=view;
  const bounds=plan.report.bounds, span=Math.max(1,...K.V.sub(bounds.max,bounds.min));
  const fit={vertices:[bounds.min,bounds.max].map(position=>({position}))};
  const cam={target:K.V.lerp(bounds.min,bounds.max,.5),dist:span*2.05,yaw:-.48,pitch:.37,ortho:true};
  let snap;
  const draw=document=>{
    const world=document?.faces.length ? worldFor(document,view,kit,fit) :
      makeBuilder(23,[0x14242e]).finish({cam,radius:Math.max(5,span),dither:0});
    pose(world,t,{kit,maxSteps:7200});
    return R.render(world,{w,h,px:1,t,camera:view.camera,raw:view.raw,renderGrid:false,shutter:false,cameraGuides:false,
      ...R.cameraCapture(null,(raster,sample)=>{
        if (raster.width===w && raster.height===h)
          snap={view:raster.view,focal:sample.focal,ortho:sample.camera.orthographic!==false};
      })});
  };
  const before=draw(source), images={'before.png':before};
  if (reference?.faces.length) images['reference.png']=draw(reference);
  const result=plan.document ? images['result.png']=draw(plan.document) : draw(source);
  if (!snap) throw new RangeError('Retopology preview needs a matching native camera');
  images['guides.png']=overlay(result,snap,plan.report,K);
  return {images,report:{grid:[w,h],files:Object.keys(images),colors}};
}

function command(file,input,rest,opt,kit,openEditor) {
  const {object,surface,out,report,view,preview}=opt, {meshTopology:api}=kit.KIT;
  if (!file || !input || rest.length || [file,input,object,surface,out,report,view,preview].some(arg=>arg!==undefined && !name(arg)) ||
      ['operand','selection','from','visibility','projection','lineage','match-ids','pieces'].some(key=>opt[key]!==undefined))
    throw new TypeError('Use mesh-topology retopology <mesh-or-scene.json> <request.json> [--object id --surface file --view file --preview dir --out file --report file]');
  const inputs=[file,input,surface,view].filter(Boolean).map(arg=>path.resolve(arg));
  const destinations=[...[out,report].filter(Boolean).map(arg=>path.resolve(arg)),
    ...(preview ? imageNames.map(name=>path.resolve(preview,name)) : [])];
  if (new Set(destinations).size!==destinations.length || destinations.some(arg=>inputs.includes(arg)))
    throw new RangeError('Write retopology reports, meshes and images separately from their inputs');
  if (object && out && path.dirname(path.resolve(out))!==path.dirname(path.resolve(file)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const raw=read(file), request=read(input), editor=object && openEditor(file);
  if (!object && raw?.topologyMeshes) throw new TypeError('Choose an editable scene mesh with --object');
  if (surface) request.surface=loadSurface(request.surface,surface,api);
  const row=editor && editor.meshTopology(object), doc=api.create(row ? row.document : raw);
  const plan=editor ? editor.planMeshRetopology(object,request) : api.planRetopology(doc,request);
  let evidence=plan.report;
  if (view || preview) {
    const options=viewSettings({materials:row?.materials,...(view && read(view))},true);
    const reference=request.surface.document ?? (request.surface.object && request.surface.kind!=='sdf' &&
      editor?.meshTopology(request.surface.object,request.surface.part).document);
    const captured=captures(plan,doc,reference && api.create(reference),options,kit);
    evidence={...evidence,native:captured.report};
    if (preview) for (const [name,image] of Object.entries(captured.images))
      files.write(path.resolve(preview,name),PNG.encode(image.w,image.h,image.rgb));
  }
  if (report) files.json(path.resolve(report),evidence);
  if (!out) {
    process.stdout.write(JSON.stringify({patch:plan.patch,report:evidence},null,2)+'\n');
    return;
  }
  if (!plan.report.canCommit) throw new RangeError('Retopology patch failed guide or surface checks');
  if (editor) editor.retopologizeMeshTopology(object,request);
  files.json(path.resolve(out),editor ? editor.snapshot() : plan.document);
}

module.exports={command,captures};
