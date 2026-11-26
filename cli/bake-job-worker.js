const Grid=require('./uv-bake-grid.js');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const Assets=require('./asset-files.js');
const Bitmap=require('../src/bitmap-resources.js');
const Linked=require('./bitmap-resources.js');
const {readMaterialGraph,writeMaterialGraph}=require('./material-graph.js');
const Plan=require('./bake-job-plan.js');
const Meshes=require('./bake-job-mesh.js');
const Projection=require('./bake-job-projection.js');
const Surface=require('./bake-job-surface.js');
const Occlusion=require('./bake-job-occlusion.js');
const Thickness=require('./thickness.js');
const Curvature=require('./bake-job-curvature.js');
const Attributes=require('./bake-job-attributes.js');
const Transfer=require('./bake-job-transfer.js');
const UVDebug=require('./bake-job-uv-debug.js');
const Output=require('./bake-output-controls.js');
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

function interpretation(row) {
  if(row.output?.kind==='texture-transfer') {
    const {intent,colorSpace,alpha}=row.output;
    return {intent,...(intent==='color'&&{colorSpace,alpha})};
  }
  if(row.output?.kind==='normal') {
    const {space,orientation}=row.output;
    return {intent:'normal',normalSpace:space,...(orientation&&{normalOrientation:orientation})};
  }
  if(row.output?.kind==='height')return {intent:'height',units:row.output.units,
    ...(row.output.range&&{heightRange:row.output.range})};
  if(row.output?.kind==='thickness'&&row.output.encoding!=='png8')return {intent:'height',units:row.output.units,
    ...(row.output.range&&{heightRange:row.output.range})};
  if(row.output?.kind==='position')return {intent:'data',layout:'xyz',vectorDomain:'raw',units:row.output.units};
  if(row.output?.kind==='id')return {intent:'data',units:'id',sampling:'nearest'};
  if(row.output?.kind==='direction')return {intent:'data',layout:'xyz'};
  if(row.output?.kind==='curvature')return {intent:'data',units:row.output.units,
    ...(row.output.range&&{valueRange:row.output.range})};
  if(['pigment','emission',UVDebug.outline].includes(row.map))return {intent:'color',colorSpace:'srgb'};
  return {intent:'mask'};
}

function sameInterpretation(prior,fresh) {
  const intent=prior.intent??'color';
  if(intent!==fresh.intent)return false;
  if(intent==='normal')return (prior.normalSpace??'tangent')===fresh.normalSpace&&
    (fresh.normalSpace==='world'||(prior.normalOrientation??'opengl')===fresh.normalOrientation);
  if(intent==='height')return (prior.units??'shape-units')===fresh.units&&
    JSON.stringify(prior.heightRange??null)===JSON.stringify(fresh.heightRange??null);
  if(intent==='data')return prior.layout===fresh.layout&&(prior.units??'unitless')===(fresh.units??'unitless')&&
    JSON.stringify(prior.valueRange??null)===JSON.stringify(fresh.valueRange??null)&&
    (prior.vectorDomain??'signed-unit')===(fresh.vectorDomain??'signed-unit')&&
    (!fresh.sampling||(prior.sampling??'nearest')===fresh.sampling);
  return intent!=='color'||(!prior.colorSpace||prior.colorSpace===fresh.colorSpace)&&
    (!fresh.alpha||(prior.alpha??'straight')===fresh.alpha);
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
    function read(row) {
      const encoding=path.extname(row.file).slice(1);
      return storage==='linked'?{file:row.file,encoding}:
        {base64:fs.readFileSync(directory(output,row.file)).toString('base64'),origin:row.file,encoding};
    }
    const fresh=interpretation(rows[0]), authored=prior?.interpretation??{};
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
      if(members.size>rows.length&&!sameInterpretation(authored,fresh))
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
  const {width,height}=Grid.dimensions(Grid.rasterGrid(settings)),{textures,registeredMaps,raster}=result;
  if(id==='pigment')return textures.base;
  if(id==='metalness')return PNG.encodeGray(width,height,Uint8Array.from(raster.footprint,(_,i)=>raster.pixels.surface[i*3+2]));
  return textures[id]??registeredMaps[id]??registeredMaps.masks[id];
}
function steps(plan,model,library,K,onInput) {
  const images=new Map(), enabled=plan.preset.maps.filter(row=>row.enabled);
  const hasOcclusion=enabled.some(row=>Occlusion.names.includes(row.id));
  const hasOther=enabled.some(row=>!Occlusion.names.includes(row.id));
  const selections=plan.targets.map(row=>Meshes.meshFor(model,row,K,images,{sceneSpace:hasOcclusion&&!hasOther}));
  const receivers=hasOcclusion&&selections.map((row,i)=>hasOther&&!plan.targets[i].projection?
    Meshes.meshFor(model,plan.targets[i],K,images,{sceneSpace:true}):row);
  const diagnostics=plan.preset.maps.some(row=>row.enabled&&Projection.maps.includes(row.id));
  const samplesMaterial=enabled.some(row=>!Occlusion.names.includes(row.id)&&!UVDebug.debugMap(row.id));
  const casts=selections.map((selection,i)=>{
    const {projection}=plan.targets[i];
    if(samplesMaterial&&(projection||diagnostics))return Projection.prepare(projection,selection,library,plan,K,images,onInput);
  });
  const totalTiles=selections.reduce((n,row)=>n+row.tiles.length,0), tasks=[];
  let pixels=0;
  for(const row of enabled) {
    const settings=Plan.effective(plan.preset,row);
    const {width=settings.size,height=settings.size,antialiasing=1}=settings.delivery??{};
    pixels+=width*height*antialiasing**2*totalTiles;
    if(pixels>12e6)throw new RangeError('Bake job exceeds twelve million raster samples');
    for(const [i,selection] of (settings.occlusion?receivers:selections).entries()) {
      const authored=plan.targets[i];
      for(const tile of selection.tiles)tasks.push({map:row.id,settings,tile,selection,authored,cast:casts[i]});
    }
  }
  if(tasks.length>192)throw new RangeError('Bake job exceeds 192 enabled map/target/tile tasks');
  return {tasks,receivers};
}

function renderGeometry(task,K) {
  const {tile,settings,selection,map,authored}=task,{mesh,faces,normals,uvs,source}=tile;
  const parts=settings.thickness&&authored.thicknessParts;
  if(parts&&Object.keys(parts).some(index=>!selection.asset.parts[index]))
    throw new RangeError('Thickness part labels refer to an unknown submesh on '+authored.id);
  const raw=map==='thickness'&&settings.encoding!=='png8'&&new Float32Array(Grid.count(Grid.rasterGrid(settings)));
  const kernel=settings.geometry&&Geometry.prepare(selection.points,selection.faces,selection.geometryNormals,
    settings.geometry,K,[map],{thickness:settings.thickness,raw,parts:parts&&selection.metadata.map(row=>parts[row.i])});
  const geometry=kernel&&{calculate:{forFace:(i,layers)=>kernel.forFace(source[i],layers),report:kernel.report},
    ...(raw&&{copy:(i,j)=>{raw[j]=raw[i];}})};
  const result=bake(mesh,faces,uvs,normals,Grid.rasterGrid(settings),settings.padding,K,{registered:true,
    chartBake:{state:{faceCharts:faces.map(()=>0)},...(geometry&&{geometry})}});
  const output=map==='thickness'?{...Thickness.output(result,raw,settings),validity:result.registeredMaps.masks['thickness-valid']}:
    {bytes:mapBytes(result,map,settings)};
  return {...output,texels:result.sampledTexels,coverage:result.coverage,
    ...(result.geometryMasks&&{geometry:result.geometryMasks})};
}

function renderOcclusion(tasks,scene,K) {
  const byTask=new Map(), groups=new Map(), cache=new Map();
  for(const task of tasks) {
    const {authored,tile,map,selection,settings}=task;
    if(!settings.occlusion)continue;
    const config=Occlusion.resolve(map,settings.occlusion,selection,K);
    const key=JSON.stringify([authored.id,tile.tile,Grid.rasterGrid(settings),settings.padding,config]);
    if(!groups.has(key))groups.set(key,{requested:[],config});
    groups.get(key).requested.push(map);
    byTask.set(task,key);
  }
  return task=>{
    const key=byTask.get(task), {tile,selection,map,settings}=task;
    const group=groups.get(key);
    if(!cache.has(key)) {
      const {config,requested}=group, {mesh,faces,uvs,normals}=tile;
      const buffers=Occlusion.prepare(selection,tile,Grid.rasterGrid(settings),config,requested,scene,K);
      const result=bake(mesh,faces,uvs,normals,Grid.rasterGrid(settings),settings.padding,K,{registered:true,
        chartBake:{state:{faceCharts:faces.map(()=>0)},visibility:buffers}});
      // The output-texel budget also bounds these buffers. Keep no material raster
      // while waiting for later maps that share this ray pass.
      cache.set(key,{buffers,texels:result.sampledTexels,coverage:result.coverage,remaining:requested.length});
    }
    const entry=cache.get(key), {buffers,texels,coverage}=entry;
    if(--entry.remaining===0)cache.delete(key);
    return {...Occlusion.encode(map,buffers,settings),texels,coverage,occlusion:buffers.report()};
  };
}

function renderTasks(tasks,model,receivers,{normalInputs,textureInputs},onInput,K) {
  const shared=new Map(), details=new Map(), heightTasks=new Map(), heightGroups=new Map();
  const occlusion=receivers&&renderOcclusion(tasks,Occlusion.scene(model,receivers,K),K);
  const curvature=Curvature.render(tasks,normalInputs,onInput,K);
  const attributes=Attributes.render(tasks,model,K);
  const transfer=Transfer.render(tasks,textureInputs,onInput,K);
  const rasterKey=({authored,tile,settings})=>JSON.stringify([authored.id,tile.tile,Grid.rasterGrid(settings),settings.padding]);
  for(const task of tasks) {
    const {map,settings,authored}=task, key=rasterKey(task);
    if(settings.space==='world'||settings.space==='tangent'&&settings.encoding!=='png8'||map==='height') {
      if(!details.has(key))details.set(key,{});
      details.get(key)[map==='height'?'height':settings.space]=true;
    }
    if(map==='height') {
      if(!heightTasks.has(authored.id))heightTasks.set(authored.id,[]);
      heightTasks.get(authored.id).push(task);
    }
  }
  function raster(task) {
    const key=rasterKey(task);
    if(!shared.has(key)) {
      const {authored,tile,settings,selection}=task,{mesh,faces,uvs,normals,source}=tile;
      const cage=task.cast?.(tile,Grid.rasterGrid(settings)), detail=details.get(key);
      const worldNormal=detail?.world&&!authored.projection&&Meshes.sceneTransform(model,selection.index,K)?.normal;
      const value=bake(mesh,faces,uvs,normals,Grid.rasterGrid(settings),settings.padding,K,{registered:true,sourceFaces:source,
        chartBake:{state:{faceCharts:faces.map(()=>0)},cage}, ...(detail&&{samples:{...detail,worldNormal}})});
      shared.set(key,value);
      if(shared.size>3)shared.delete(shared.keys().next().value);
    }
    return shared.get(key);
  }
  const info=cache=>({texels:cache.sampledTexels,coverage:cache.coverage,...(cache.cageBake&&{projection:cache.cageBake})});
  return task=>{
    const {map,settings,authored}=task;
    if(settings.occlusion)return occlusion(task);
    if(settings.curvature)return curvature(task);
    if(settings.attribute)return attributes(task);
    if(settings.transfer)return transfer(task);
    if(settings.geometry)return renderGeometry(task,K);
    if(map==='height') {
      if(!heightGroups.has(authored.id)) {
        const tiles=new Map(heightTasks.get(authored.id).map(row=>{
          const cache=raster(row);
          return [row,{...Surface.measureHeight(cache),info:info(cache)}];
        }));
        heightGroups.set(authored.id,{tiles,scale:Surface.heightScale(tiles.values(),settings)});
      }
      const {tiles,scale}=heightGroups.get(authored.id), row=tiles.get(task);
      tiles.delete(task);
      return {...Surface.height(row,scale,settings),...row.info};
    }
    const cache=raster(task), result=settings.space?Surface.normal(cache,settings):{bytes:mapBytes(cache,map,settings)};
    return {...result,...info(cache)};
  };
}

function main(request,base) {
  const {KIT:K}=require('../index.js').load(), inputs=new Map();
  const record=file=>snapshot(inputs,file);
  const plan=Plan.readPlan(request.file,{...request.settings,onInput:record});
  const model=Meshes.load(plan.source,directory(base,'source-textures'),record);
  const library=Projection.sceneLibrary(plan,model,directory(base,'projection-textures'),record);
  if(request.mode==='inspect') {
    Assets.json(directory(base,'inspection.json'),{label:plan.label,preset:plan.preset,targets:plan.targets,
      catalog:Meshes.catalog(model),refresh:plan.refresh?.bindings??[],projectionCatalog:library.describe(),normalInputs:[...plan.normalInputs.keys()],textureInputs:[...plan.textureInputs.keys()]});
    return;
  }
  const out=path.dirname(base), {tasks:pending,receivers}=steps(plan,model,library,K,record);
  const report={format:'ink-studio/bake-job-report',version:1,label:plan.label,preset:plan.preset,targets:plan.targets,
    catalog:Meshes.catalog(model),maps:[],inputs:[],...(plan.normalInputs.size&&{normalInputs:[...plan.normalInputs.keys()]}),
    ...(plan.textureInputs.size&&{textureInputs:[...plan.textureInputs.keys()]})};
  emit({event:'planned',completed:0,total:pending.length});
  const nativeTasks=pending.map(Output.sampling);
  const render=renderTasks(nativeTasks,model,receivers,plan,record,K);
  const uvDebug=UVDebug.create(pending,(file,bytes)=>{
    Assets.write(directory(out,file),bytes);
    return digest(bytes);
  },K);
  for(const [i,task] of pending.entries()) {
    const {map,tile,selection,authored,settings}=task;
    const detail={map,target:authored.id,tile:tile.label,total:pending.length};
    emit({event:'map-started',...detail,completed:i});
    const {delivery}=settings, rendered=nativeTasks[i], [u,v]=tile.tile;
    const stem='maps/'+authored.id+'/'+u+'_'+v+'/'+map;
    let result;
    if(delivery) {
      const ownership=uvDebug.samples(rendered), {width,height}=Grid.dimensions(Grid.rasterGrid(rendered.settings));
      const native=map==='coverage'?{bytes:PNG.encodeGray(width,height,
        Uint8Array.from(ownership.owners,id=>id?255:0))}:
        map===UVDebug.outline?{bytes:uvDebug.outline(rendered)}:render(rendered);
      result=Output.finalize(task,native,ownership);
    } else if(!UVDebug.debugMap(map))result=render(rendered);
    const debug=uvDebug.filesFor(task,result?.debug);
    if(debug&&debug.index===undefined)debug.index=(report.uvDebug??=[]).push(debug.entry)-1;
    let relative,rest;
    function writeLevel(level,root) {
      const extension=delivery?Output.extensions[delivery.format]:Surface.ext(settings.encoding);
      const file=root+'.'+extension, previewFile=level.preview&&root+'.preview.png', validityFile=level.validity&&root+'.valid.png';
      Assets.write(directory(out,file),level.bytes);
      if(previewFile)Assets.write(directory(out,previewFile),level.preview);
      if(validityFile)Assets.write(directory(out,validityFile),level.validity);
      return {file,sha256:digest(level.bytes),...(previewFile&&{previewFile}),
        ...(validityFile&&{validityFile,validitySha256:digest(level.validity)})};
    }
    if(!result) {
      const key=map==='coverage'?'coverage':'outline', {entry}=debug;
      relative={file:entry.files[key],sha256:debug.hashes[key]};
      rest={texels:entry.texels,coverage:entry.texels/settings.size**2};
    } else {
      const {bytes,preview,validity,mips,debug:_debug,width,height,level,bitDepth,...info}=result;
      relative=writeLevel({bytes,preview,validity},stem);
      rest={...info,...(width&&{width,height}),...(mips?.length&&{mips:mips.map(row=>({
        level:row.level,width:row.width,height:row.height,...writeLevel(row,stem+'.mip-'+row.level)
      }))})};
    }
    report.maps.push({target:authored.id,mesh:selection.mesh,meshIndex:selection.index,uvSet:authored.uvSet,
      tile:tile.tile,tileLabel:tile.label,map,settings,...relative,...(debug&&{uvDebug:debug.index}),...rest});
    emit({event:'map-finished',...detail,completed:i+1});
  }
  if(plan.sources.size||plan.skewMaps.size||plan.targets.some(row=>row.projection))
    report.projectionCatalog=library.describe();
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
