const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const R = require('./render.js');
const { pose } = require('./diarama-pose.js');
const { viewSettings, worldFor } = require('./mesh-native-view.js');

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const name = value => typeof value==='string' && !!value.trim();

function heatmap(frame, mesh, weights, K) {
  const {w,h,passes} = frame;
  const {meshTopology:topology,sceneMeshes:native} = K, doc = topology.sourceDocument(mesh);
  const ids = new Map(doc.faces.flatMap(row=>row.corners.map(corner=>[corner.id,corner.vertex])));
  const derived = new Map(), rgb = new Uint8Array(w*h*3);
  const ramps = [[31,42,68],[49,70,119],[49,129,156],[74,178,148],[215,204,123],[243,158,89],[255,218,152]];
  let pixels = 0;
  for (let p = 0; p < w*h; p++) {
    const slot = passes.surfaceSources[passes.sourceSurface[p]];
    if (slot?.kind!=='mesh' || slot.asset!==mesh.id || slot.object!==mesh.objectId ||
        (slot.part ?? undefined)!==mesh.partId) continue;
    const draw = slot.primitive/3+passes.sourceTriangle[p];
    if (!derived.has(draw)) {
      const triangle = topology.triangleSource(mesh,native.sourceTriangle(mesh,draw));
      derived.set(draw,triangle?.corners.map(id=>weights.get(ids.get(id)) ?? 0));
    }
    const corners = derived.get(draw);
    if (!corners) continue;
    const weight = corners.reduce((total,n,i)=>total+n*passes.sourceCoordinates[p*3+i],0);
    rgb.set(ramps[Math.max(0,Math.min(ramps.length-1,Math.round(weight*(ramps.length-1))))],p*3);
    pixels++;
  }
  return {w,h,rgb,pixels};
}

function preview(before, after, view, toolkit, editor, object, patch, outputs) {
  const {KIT:K} = toolkit, {pose:matrices,joint} = view;
  const sides = [before,after].map((doc,i)=>{
    const draft = i && editor && Object.keys(patch).length ? editor.fork() : editor;
    if (draft && draft!==editor) draft.editMeshTopology(object,patch);
    const world = draft ? draft.build() : worldFor(doc,view,toolkit,before);
    const mesh = draft ? world.topologyMeshes[object].mesh : world.meshes[0];
    const skinDoc = K.meshTopology.sourceDocument(mesh), skin = skinDoc.skin && K.meshTopology.skin.bind(mesh);
    pose(world,view.t,{kit:toolkit,maxSteps:7200});
    if (matrices && skin) skin.pose(matrices);
    const frame = R.render(world,{ w:view.w,h:view.h,t:view.t,px:1,camera:view.camera,raw:view.raw,
      passes:['sourceSurface'],renderGrid:false,shutter:false,cameraGuides:false });
    if (frame.w!==view.w || frame.h!==view.h) throw new RangeError('Skin review needs the requested native grid');
    const effective = skin ? K.meshTopology.skin.inspect(skinDoc).vertices : [];
    const weight = new Map(effective.map(row=>[row.id,row.effective?.[joint] ?? 0]));
    const positions = K.sceneMeshes.geometry(mesh).positions, points = new Map();
    for (let j=0; j<mesh.vertices; j++) points.set(K.meshTopology.sourceVertex(mesh,j),positions.subarray(j*3,j*3+3));
    return {frame, weights:heatmap(frame,mesh,weight,K), points};
  });
  const images = [sides[0].frame,sides[1].frame,sides[0].weights,sides[1].weights];
  const names = ['before','after','weights-before','weights-after'];
  images.forEach(({w,h,rgb},i)=>files.write(outputs[names[i]], PNG.encode(w,h,rgb)));
  const sheet = R.grid(images,2,['POSE BEFORE','POSE AFTER','WEIGHTS BEFORE','WEIGHTS AFTER']);
  files.write(outputs.comparison,PNG.encode(sheet.w,sheet.h,sheet.rgb));
  const displacement = [...sides[0].points].flatMap(([id,a])=>{
    const b = sides[1].points.get(id);
    const distance = b && Math.hypot(...a.map((n,k)=>n-b[k]));
    return distance>1e-7 ? [{id,distance,before:[...a],after:[...b]}] : [];
  });
  return { grid:[view.w,view.h], joint, posed:!!matrices, time:view.t, camera:view.camera,
    weightPixels:sides.map(row=>row.weights.pixels), displacement, images:Object.keys(outputs).map(name=>name+'.png') };
}

function command(file, input, rest, opt, toolkit, openEditor) {
  const {object,out,report,view,preview:directory} = opt, {KIT:{meshTopology}} = toolkit;
  if (!file || rest.length || [file,input,object,out,report,view,directory].some(arg=>arg!==undefined && !name(arg)) ||
      (out && !input) || (view && !directory) || (directory && !view))
    throw new TypeError('Use mesh-topology skin <mesh-or-scene.json> [request.json] [--object id] [--view file --preview dir] [--out file] [--report file]');
  const inputs = [file,input,view].filter(Boolean).map(arg=>path.resolve(arg));
  const images = directory && Object.fromEntries(['before','after','weights-before','weights-after','comparison']
    .map(name=>[name,path.resolve(directory,name+'.png')]));
  const outputs = [...[out,report].filter(Boolean).map(arg=>path.resolve(arg)),...Object.values(images ?? {})];
  if (new Set(outputs).size!==outputs.length || outputs.some(arg=>inputs.includes(arg)))
    throw new RangeError('Write skin outputs separately from their inputs');
  if (object && out && path.dirname(path.resolve(file))!==path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const source = read(file);
  if (source?.topologyMeshes && !object) throw new TypeError('Choose an editable scene mesh with --object');
  const editor = object && openEditor(file);
  const before = meshTopology.create(editor ? editor.meshTopology(object).document : source);
  const request = input && read(input);
  const plan = input && (editor ? editor.planMeshSkin(object,request) : meshTopology.skin.plan(before,request));
  const after = plan ? plan.document : before;
  let result = plan ? plan.report : meshTopology.skin.inspect(before);
  if (directory && result.canCommit!==false) {
    const raw = read(view);
    if (!raw || Object.getPrototypeOf(raw)!==Object.prototype ||
        Object.keys(raw).some(key=>!['w','h','t','camera','raw','materials','pose','joint'].includes(key)) ||
        !after.skin?.joints.includes(raw.joint))
      throw new TypeError('Skin view needs a named joint and optional pose matrices, camera and material settings');
    result = {...result,native:preview(before,after,{...viewSettings(raw,!editor),joint:raw.joint,pose:raw.pose},
      toolkit,editor,object,plan?.patch ?? {},images)};
  }
  if (!out) process.stdout.write(JSON.stringify(plan ? {patch:plan.patch,report:result} : result,null,2)+'\n');
  if (report) files.json(path.resolve(report),result);
  if (out) {
    if (!plan.report.canCommit) throw new RangeError('Skin weights exceed the locked influence budget');
    if (editor) editor.editMeshSkin(object,request);
    files.json(path.resolve(out),editor ? editor.snapshot() : after);
  }
}

module.exports = {command};
