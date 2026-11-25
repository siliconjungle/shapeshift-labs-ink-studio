const PNG = require('./png.js');
const {render, viewSettings} = require('./mesh-native-view.js');
const topologyFormat='ink-studio/mesh-topology';

function geometry(value, K, signed) {
  if (value?.format===topologyFormat) return {kind:'topology',value};
  if (K.procedural.graphTypes.validator('mesh')(value)) return {kind:'mesh',value};
  if (signed && value?.bounds && K.procedural.graphTypes.validator('field')(value)) return {kind:'sdf',value};
  return null;
}

function bounds(row, K) {
  if (!row) return null;
  const {kind,value}=row;
  if (kind==='sdf') return value.bounds;
  if (kind==='topology') return value.vertices?.length ? K.procedural.spatial.boxOf(value.vertices.map(v=>v.position)) : null;
  const {lo,hi}=K.mesh.box(K.procedural.sceneGraph.mesh(value));
  return {min:lo,max:hi};
}

function cameraFor(before, after, K) {
  const boxes=[before,after].map(row=>bounds(row,K)).filter(Boolean);
  if (!boxes.length) return null;
  const {min,max}=K.procedural.spatial.boxOf(boxes.flatMap(box=>[box.min,box.max]));
  return {target:K.V.lerp(min,max,.5),dist:Math.max(.1,K.V.len(K.V.sub(max,min))*1.45),yaw:-.36,pitch:.22,ortho:true};
}

function renderSide(row,camera,view,kit) {
  const {KIT:K,makeBuilder}=kit, {kind,value}=row;
  if (kind==='sdf')
    return K.procedural.sceneGraph.renderSDF(value,{width:view.w,height:view.h,camera,time:view.t,
      background:'#14242e',color:'#c8b891'}).frame;
  let mesh;
  if (kind==='topology') {
    const document=K.meshTopology.create(value), colors=[0xc8b891,0x78b0a7,0xd7976e,0x91aac2];
    if (!document.faces.length) return null;
    const materials=[...new Set(document.faces.map(face=>face.material))].map(id=>
      ({id,color:colors[K.procedural.data.hash(id)%colors.length]}));
    mesh=K.meshTopology.toSceneMesh(document,{materials});
  } else {
    const source=K.procedural.sceneGraph.mesh(value);
    const materials=source.mats.map(({rgb},i)=>({id:'material-'+i,
      color:rgb.reduce((word,n)=>word*256+Math.round(n*255),0)}));
    mesh=K.sceneMeshes.create({id:'watched-mesh',positions:source.pos,indices:source.tri,normals:source.normals,
      uvs:source.uvs?.map(n=>Math.min(1,Math.max(0,n))) ?? new Float32Array(source.pos.length/3*2),
      materials,faceMaterials:source.tmat});
  }
  const world=makeBuilder(23,[0x14242e]).finish({meshes:[mesh],dither:0,radius:100,cam:camera});
  return render(world,{...view,camera:undefined},kit,[]);
}

function nativePair(before,after,{view,camera,draw,file}) {
  const artifacts=[], frames={}, errors={};
  const images={grid:[view.w,view.h],pixelSize:1,camera};
  for (const [name,row] of Object.entries({before,after})) if (row) {
    try {
      const frame=draw(row);
      if (!frame) continue;
      frames[name]=frame;
      const location=file(name);
      artifacts.push({file:location,format:'png',bytes:PNG.encode(frame.w,frame.h,frame.rgb)});
      images[name]=location;
    } catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      errors[name]=error.message;
    }
  }
  if (Object.keys(errors).length) images.errors=errors;
  if (frames.before && frames.after) {
    let changedPixels=0;
    const a=frames.before.rgb,b=frames.after.rgb;
    for(let i=0;i<a.length;i+=3)
      if (a[i]!==b[i] || a[i+1]!==b[i+1] || a[i+2]!==b[i+2]) changedPixels++;
    images.changedPixels=changedPixels;
  }
  return {native:images,artifacts};
}

function review(stage,{name,node,kit,time,view:settings,encodeArtifacts}) {
  const {KIT:K}=kit, diagnostics=K.procedural.modelingDiagnostics;
  const signed=stage.op.startsWith('sdf.');
  const inputOrder=['source','mesh','document','before',...Object.keys(stage.inputs)];
  const outputOrder=['value','mesh','document',...Object.keys(stage.outputs)];
  let before,after,input,output;
  for (const key of new Set(inputOrder)) {
    const raw=stage.inputs[key]?.value;
    before=geometry(Array.isArray(raw)?raw[0]:raw,K,signed);
    if (before) {input=key;break;}
  }
  for (const key of new Set(outputOrder)) {
    after=geometry(stage.outputs[key],K,signed);
    if (after) {output=key;break;}
  }
  const side=row=>row?.kind==='sdf' ? {summary:{identity:'signed-field',bounds:row.value.bounds}} :
    diagnostics.inspect(row?.value);
  const evidence=diagnostics.compare(side(before),side(after),{lineage:stage.modeling?.lineage??stage.outputs.lineage});
  const prefix=node.includes('/') ? node.slice(0,node.lastIndexOf('/')+1) : '';
  const upstream=Object.entries(stage.inputs).flatMap(([socket,row])=>row.node ? [{socket,node:prefix+row.node,port:row.port}] :
    row.input ? [{socket,input:row.input}] : []);
  const format=K.procedural.attributes.format;
  const from=Object.values(stage.inputs).find(row=>row.value?.format===format)?.value;
  const to=Object.values(stage.outputs).find(row=>row?.format===format);
  const attributeReport=stage.outputs.report?.format==='ink-studio/attribute-remap-report' && stage.outputs.report;
  const modifiers=stage.modeling?.stages??stage.outputs.report?.stages;
  const value={node,op:stage.op,status:stage.status,...(input&&{input}),...(output&&{output}),upstream,
    ...evidence,work:stage.work,...(stage.workOmitted&&{workOmitted:stage.workOmitted}),
    ...(Array.isArray(modifiers)&&{modifiers})};
  if (from||to) value.attributes=diagnostics.attributes(from,to,attributeReport);
  if (!encodeArtifacts) return {value,artifacts:[]};
  const view=viewSettings({...settings,t:time},true), camera=view.camera ?? cameraFor(before,after,K);
  const report=camera && nativePair(before,after,{view,camera,draw:row=>renderSide(row,camera,view,kit),
    file:side=>'previews/'+name+'/'+side+'.png'});
  return {value:{...value,...(report&&{native:report.native})},artifacts:report?.artifacts??[]};
}

module.exports = {review,nativePair};
