const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const Assets=require('./asset-files.js');
const Bitmap=require('../src/bitmap-resources.js');
const Linked=require('./bitmap-resources.js');
const {readMaterialGraph,writeMaterialGraph}=require('./material-graph.js');
const Plan=require('./bake-job-plan.js');
const Meshes=require('./bake-job-mesh.js');
const Geometry=require('./geometry-masks.js');
const UV=require('./material-preview-geometry.js');
const bake=require('./glb-bake.js');
const PNG=require('./png.js');

const digest=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=filename=>digest(fs.readFileSync(filename));
const snapshot=(paths,file)=>{
  const location=path.resolve(file);
  if(!paths.has(location))paths.set(location,fingerprint(location));
};
const emit=row=>process.stdout.write(JSON.stringify(row)+'\n');
const directory=(root,...parts)=>path.join(root,...parts);

function interpretation(map,orientation) {
  if(map==='normal')return {intent:'normal',normalOrientation:orientation};
  if(['pigment','emission'].includes(map))return {intent:'color',colorSpace:'srgb'};
  return {intent:'mask'};
}

function refreshGraph(report,refresh,output,K) {
  if(!refresh)return;
  const graph=readMaterialGraph(refresh.material), materialFile=directory(output,'material.material.json');
  const document=writeMaterialGraph(materialFile,graph,{baseDir:path.dirname(refresh.material)});
  const resources=document.resources??={};
  report.refresh=[];
  for(const {target,map,resource,storage} of refresh.bindings) {
    const rows=report.maps.filter(row=>row.target===target&&row.map===map);
    if(!rows.length) {
      report.refresh.push({target,map,resource,storage,status:'disabled'});
      continue;
    }
    const entry=resources[resource], prior=entry?.definition;
    if(prior&&prior.format!=='bitmap')throw new TypeError('Bake cannot refresh a non-bitmap resource '+resource);
    const layout=prior&&Bitmap.layout(prior);
    if(layout?.kind==='sequence')throw new TypeError('Bake refresh targets a single image or a UV tile set');
    const read=row=>storage==='linked'?{file:row.file,encoding:'png'}:
      {base64:fs.readFileSync(directory(output,row.file)).toString('base64'),origin:row.file,encoding:'png'};
    const fresh=interpretation(map,rows[0].settings.orientation), authored=prior?.interpretation;
    const tiled=layout?.kind==='tiles'||rows.length>1||rows[0].tile.some(Boolean);
    let definition={format:'bitmap',interpretation:{...(authored?.sampling&&{sampling:authored.sampling}),
      ...(authored?.tiling&&{tiling:authored.tiling}),...fresh},...(prior?.missing&&{missing:prior.missing})};
    if(tiled) {
      const members=new Map(rows.map(row=>[UV.tileKey(row.tile),{uv:row.tile,source:read(row)}]));
      if(layout?.kind==='single'&&!members.has('0,0'))
        members.set('0,0',{uv:[0,0],source:prior.source});
      for(const [i,old] of (prior?.tiles??[]).entries()) {
        const key=layout.rows[i].key;
        if(!members.has(key))members.set(key,old);
        else if(old.udim!==undefined)members.set(key,{udim:old.udim,source:members.get(key).source});
      }
      if(members.size>rows.length&&authored&&
        ((authored.intent??'color')!==fresh.intent||fresh.intent==='normal'&&
        (authored.normalOrientation??'opengl')!==fresh.normalOrientation||
        fresh.intent==='color'&&authored.colorSpace&&authored.colorSpace!==fresh.colorSpace))
        throw new TypeError('Refresh would reinterpret untouched tiles on '+resource);
      definition.tiles=[...members.values()];
    } else definition.source=read(rows[0]);
    Bitmap.layout(definition);
    Linked.load(definition,{baseDir:output,declare:K.procedural.graphImages.declare});
    resources[resource]={...entry,definition};
    report.refresh.push({target,map,resource,storage,status:'refreshed',tiles:rows.map(row=>row.tileLabel)});
  }
  writeMaterialGraph(materialFile,document);
  report.material='material.material.json';
}

function mapBytes(result,id,settings) {
  const {size}=settings,{textures,registeredMaps,raster}=result;
  if(id==='pigment')return textures.base;
  if(id==='normal'&&settings.orientation==='directx') {
    const data=raster.pixels.normal.slice();
    for(let i=0;i<data.length;i+=3)if(data[i]||data[i+1]||data[i+2])data[i+1]=255-data[i+1];
    return PNG.encode(size,size,data);
  }
  if(id==='metalness')return PNG.encodeGray(size,size,Uint8Array.from(raster.footprint,(_,i)=>raster.pixels.surface[i*3+2]));
  return textures[id]??registeredMaps[id]??registeredMaps.masks[id];
}
function steps(plan,model,K) {
  const images=new Map(), selections=plan.targets.map(row=>Meshes.meshFor(model,row,K,images));
  const totalTiles=selections.reduce((n,row)=>n+row.tiles.length,0), tasks=[];
  let pixels=0;
  for(const row of plan.preset.maps) {
    if(!row.enabled)continue;
    const settings=Plan.effective(plan.preset,row);
    pixels+=settings.size**2*totalTiles;
    if(pixels>12e6)throw new RangeError('Bake job exceeds twelve million output texels');
    for(const [i,selection] of selections.entries()) {
      const authored=plan.targets[i];
      for(const tile of selection.tiles)tasks.push({map:row.id,settings,tile,selection,authored});
    }
  }
  if(tasks.length>192)throw new RangeError('Bake job exceeds 192 enabled map/target/tile tasks');
  return tasks;
}

function render(task,K) {
  const {tile,settings,selection,map}=task,{mesh,faces,normals,uvs,source}=tile;
  const kernel=settings.geometry&&Geometry.prepare(selection.points,selection.faces,selection.geometryNormals,
    settings.geometry,K,[map]);
  const geometry=kernel&&{calculate:{forFace:(i,layers)=>kernel.forFace(source[i],layers),report:kernel.report}};
  const result=bake(mesh,faces,uvs,normals,settings.size,settings.padding,K,{registered:true,
    chartBake:{state:{faceCharts:faces.map(()=>0)},...(geometry&&{geometry})}});
  return {bytes:mapBytes(result,map,settings),texels:result.sampledTexels,coverage:result.coverage,
    ...(result.geometryMasks&&{geometry:result.geometryMasks})};
}

function main(request,base) {
  const {KIT:K}=require('../index.js').load(), inputs=new Map();
  const record=file=>snapshot(inputs,file);
  const plan=Plan.readPlan(request.file,{...request.settings,onInput:record});
  const model=Meshes.load(plan.source,directory(base,'source-textures'),record);
  if(request.mode==='inspect') {
    Assets.json(directory(base,'inspection.json'),{label:plan.label,preset:plan.preset,targets:plan.targets,
      catalog:Meshes.catalog(model),refresh:plan.refresh?.bindings??[]});
    return;
  }
  const out=path.dirname(base), pending=steps(plan,model,K);
  const report={format:'ink-studio/bake-job-report',version:1,label:plan.label,preset:plan.preset,targets:plan.targets,
    catalog:Meshes.catalog(model),maps:[],inputs:[]};
  emit({event:'planned',completed:0,total:pending.length});
  const shared=new Map();
  for(const [i,task] of pending.entries()) {
    const {map,tile,selection,authored,settings}=task;
    const detail={map,target:authored.id,tile:tile.label,total:pending.length};
    emit({event:'map-started',...detail,completed:i});
    const key=JSON.stringify([authored.id,tile.tile,settings.size,settings.padding]);
    let result;
    if(!settings.geometry) {
      // Both normal conventions are kept in the same registered raster.
      if(!shared.has(key)) {
        const {mesh,faces,uvs,normals}=tile;
        const value=bake(mesh,faces,uvs,normals,settings.size,settings.padding,K,{registered:true,
          chartBake:{state:{faceCharts:faces.map(()=>0)}}});
        shared.set(key,value);
        if(shared.size>3)shared.delete(shared.keys().next().value);
      }
      const cache=shared.get(key);
      result={bytes:mapBytes(cache,map,settings),texels:cache.sampledTexels,coverage:cache.coverage};
    } else result=render(task,K);
    const [u,v]=tile.tile, relative='maps/'+authored.id+'/'+u+'_'+v+'/'+map+'.png';
    Assets.write(directory(out,relative),result.bytes);
    const {bytes,...rest}=result;
    report.maps.push({target:authored.id,mesh:selection.mesh,meshIndex:selection.index,uvSet:authored.uvSet,
      tile:tile.tile,tileLabel:tile.label,map,settings,file:relative,sha256:digest(bytes),...rest});
    emit({event:'map-finished',...detail,completed:i+1});
  }
  refreshGraph(report,plan.refresh,out,K);
  for(const [file,sha256] of inputs) {
    if(fingerprint(file)!==sha256)throw new Error('Bake input changed while the job ran');
    report.inputs.push({file:path.relative(path.dirname(plan.location),file),sha256});
  }
  Assets.json(directory(base,'inputs.json'),[...inputs]);
  Assets.json(directory(out,'report.json'),report);
  Assets.json(directory(out,'preset.json'),plan.preset);
}

if(require.main===module) {
  try {
    const request=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
    main(request,process.argv[4]);
  } catch(error) {
    process.stderr.write(error.message+'\n');
    process.exitCode=1;
  }
}
