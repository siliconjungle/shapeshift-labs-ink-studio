const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const projection = require('./material-projection.js');
const charts = require('./material-chart-rebake.js');
const {writeMips} = require('./registered-material-mips.js');
const Geometry = require('./geometry-masks.js');
const Cage = require('./material-cage.js');
const UV = require('../src/material-uv.js');

function prepare({bakeDir,paintViews,capturePaint,rebakeFrom,chartEdits,geometryMasks,cageBake}) {
  if ([bakeDir,paintViews,capturePaint,rebakeFrom,chartEdits,cageBake].every(value=>value===undefined) &&
      (geometryMasks === undefined || geometryMasks === false)) return null;
  if(chartEdits!==undefined && rebakeFrom===undefined)throw new TypeError('Chart edits need a rebake baseline');
  if(geometryMasks!==undefined && geometryMasks!==false && !bakeDir)
    throw new TypeError('Geometry masks need a registered bake directory');
  if(typeof bakeDir!=='string'||!bakeDir || paintViews!==undefined && capturePaint!==undefined)
    throw new TypeError('Registered baking needs a bake directory and one paint or capture plan at a time');
  const directory=path.resolve(bakeDir), meshes=[], atlases=new Map(), output=new Map(), captures=[];
  const baseline=charts.readBaseline(rebakeFrom), edits=charts.readPlan(chartEdits);
  const geometrySettings=Geometry.settings(geometryMasks === undefined ? baseline?.document.geometryMasks : geometryMasks);
  const sameDirectory=baseline && fs.existsSync(directory) && fs.realpathSync(directory)===baseline.directory;
  const cages=Cage.read(cageBake);
  const paint=projection.read(paintViews,'paint'), capture=projection.read(capturePaint,'camera');
  if (capture.length && (fs.existsSync(path.join(directory,'paint-views','approved.json')) ||
      capture.some(({id})=>fs.existsSync(path.join(directory,'paint-views',id+'-paint.png')))))
    throw new Error('Choose a fresh paint capture directory to preserve the existing paint files');
  function validate(count) {
    if([...paint,...capture,...edits].some(row=>row.mesh>=count))throw new RangeError('Material bake plan references a missing mesh index');
    if ([...cages.keys()].some(index=>index>=count)) throw new RangeError('Material cage plan references a missing receiver mesh');
    if(baseline && baseline.document.meshes.length!==count)throw new Error('Chart rebake needs the baseline mesh count');
  }

  function record(index, mesh, faces, uvs, size, padding, baked, chartBake, plan, source, kit, set, primary) {
    const folder='mesh-'+String(index).padStart(3,'0')+(set===primary?'':'/uv-'+set), {textures,registeredMaps,strength,coverage}=baked;
    function sidecar(name,extension,bytes) {
      const sha256=projection.digest(bytes);
      const file=folder+'/'+name+(sameDirectory?'-'+sha256:'')+'.'+extension;
      output.set(file,bytes);
      return {file,sha256};
    }
    function map(name,bytes,colorSpace) {
      return {...sidecar(name,'png',bytes),colorSpace};
    }
    const maps={
      pigment:map('pigment',textures.base,'sRGB'),
      normal:map('normal',textures.normal,'linear'),
      roughness:map('roughness',registeredMaps.roughness,'linear'),
      emission:map('emission',textures.emission,'sRGB'),
      metallicRoughness:map('metallic-roughness',textures.surface,'linear'),
      coverage:map('coverage',registeredMaps.coverage,'linear'),
      ...(registeredMaps.opacity&&{opacity:map('opacity',registeredMaps.opacity,'linear')})
    };
    const masks=Object.fromEntries(Object.entries(registeredMaps.masks).map(([name,bytes])=>[name,map('mask-'+name,bytes,'linear')]));
    const {state,dirty,reproject,previous,layout}=chartBake;
    const paintReceipts=new Map((source?.row.paintViews??[]).map(view=>[view.id,view]));
    for(const view of plan?.report()??[]) {
      if(source) {
        view.scope='updated-charts';
        view.charts=[...reproject].sort((a,b)=>a-b);
      }
      paintReceipts.set(view.id,view);
    }
    const chartReport={
      updated:state.charts.filter(chart=>dirty.has(chart.id)).map(chart=>chart.id),
      reused:state.charts.filter(chart=>!dirty.has(chart.id)).map(chart=>chart.id),
      sampledTexels:baked.sampledTexels,
      ...(layout && {layout}),
      ...(baked.geometryMasks && {geometryMaskTexels:chartBake.geometry.calculate ? baked.geometryMasks.texels : 0})
    };
    const mipmaps=writeMips(baked,size,dirty,source?.row.mipmaps,baseline?.read,map,sidecar);
    const row={index,name:mesh.name,geometry:projection.geometryHash(mesh.points,faces),
      uvLayout:projection.digest(JSON.stringify([faces,uvs])),texCoord:set,width:size,height:size,padding,
      coverage,emissionStrength:strength,maps,masks,mipmaps,paintViews:[...paintReceipts.values()],
      ...(baked.geometryMasks && {geometryMasks:baked.geometryMasks}),
      ...(baked.cageBake && {cageBake:baked.cageBake}),
      charts:state.charts.map(({id,faces,bounds})=>({id,faces,bounds})),
      chartLayout:sidecar('chart-layout','json',Buffer.from(JSON.stringify(state))),
      rebakeState:{owners:sidecar('chart-owners','deflate',(!baked.layoutRevised && previous?.packedOwners) || charts.pack(baked.owners)),
        ...(baked.stamp && {paint:sidecar('uv-paint','deflate',(!baked.layoutRevised && !reproject.size && previous?.packedPaint) || charts.pack(baked.stamp))})},
      chartReport};
    if(!atlases.has(index)) atlases.set(index,new Map());
    atlases.get(index).set(set,row);
    const authored=projection.cameraCapture(mesh,faces,set===primary ? capture.filter(v=>v.mesh===index) : [],kit);
    for(const {id,guide,blank,...view} of authored) {
      output.set('paint-views/'+id+'-guide.png',guide);
      output.set('paint-views/'+id+'-paint.png',blank);
      captures.push({id,...view,paint:id+'-paint.png'});
    }
    return {index,width:size,height:size,uvLayout:row.uvLayout,chartReport,
      ...(baked.cageBake && {cageBake:baked.cageBake}),
      mipmaps:mipmaps.levels.map(({level,width,height,filteredTexels,changedOwners,clearedTexels})=>
        ({level,width,height,filteredTexels,...(changedOwners !== undefined && {changedOwners,clearedTexels})})),
      paintViews:row.paintViews.map(({id,texels})=>({id,texels}))};
  }

  function compose(index,bindings,primary,report) {
    const layouts=atlases.get(index), main=layouts.get(primary);
    if(edits.some(row=>row.mesh===index&&row.uvSet!==undefined&&!layouts.has(row.uvSet)))
      throw new RangeError('A chart edit references an unbaked UV set');
    if(!bindings || !Object.keys(bindings).length) {
      meshes.push(main);
      return report;
    }
    const setFor=name=>UV.resolve(bindings,name==='roughness' ? 'metallicRoughness' :
      ['opacity','coverage'].includes(name) ? 'pigment' : name);
    const paintMasks=new Set(main.paintViews.flatMap(({id})=>['projected-paint','paint-'+id]));
    function selected(base, mask, level) {
      return Object.fromEntries(Object.keys(base).map(name=>{
        const texCoord=mask ? paintMasks.has(name) ? primary : UV.resolve(bindings,'mask/'+name) : setFor(name);
        const row=layouts.get(texCoord), source=level===undefined ? row : row.mipmaps.levels[level];
        const descriptor=source[mask?'masks':'maps'][name];
        if(!descriptor) throw new Error('Missing registered channel '+name+' on UV set '+texCoord);
        return [name,{...descriptor,texCoord}];
      }));
    }
    const row={...main,uvBindings:bindings,uvAtlases:Object.fromEntries(layouts),
      maps:selected(main.maps,false),masks:selected(main.masks,true),
      mipmaps:{...main.mipmaps,levels:main.mipmaps.levels.map((level,i)=>({...level,
        maps:selected(level.maps,false,i),masks:selected(level.masks,true,i)}))}};
    meshes.push(row);
    return {...report,uvBindings:bindings,uvAtlases:[...layouts].map(([texCoord,row])=>
      ({texCoord,uvLayout:row.uvLayout,chartReport:row.chartReport}))};
  }

  function write(glb) {
    const document={format:'ink-studio/registered-material-bake',version:1,
      ...(geometrySettings && {geometryMasks:geometrySettings}),
      glb:path.relative(directory,glb).split(path.sep).join('/'),meshes};
    for(const [file,bytes] of output)files.write(path.join(directory,file),bytes);
    if(captures.length) {
      document.paintManifest='paint-views/approved.json';
      files.json(path.join(directory,document.paintManifest),{
        format:projection.paintFormat,version:1,views:captures
      });
    }
    const file=path.join(directory,'material-bake.json');
    files.json(file,document);
    return file;
  }

  function plan(index, input, kit) {
    const {set=0,primary=0}=input;
    const views=set===primary ? paint.filter(view=>view.mesh===index) : [];
    const baseMesh=baseline?.document.meshes[index];
    const changedPrimary=set===primary && baseMesh && baseMesh.texCoord!==primary;
    if (changedPrimary && baseMesh.paintViews?.length && !views.length)
      throw new RangeError('Supply approved paint views after changing the pigment UV binding');
    const spec=cages.get(index), prior=input.source?.row;
    if (!spec && prior?.cageBake) throw new RangeError('Resupply the cage plan when rebaking a cage receiver');
    const cage=spec && Cage.prepare(spec,input.mesh,require('../index.js'),kit);
    const mesh=cage ? {...input.mesh,maskNames:[...(input.mesh.maskNames ?? []),...cage.maskNames]} : input.mesh;
    const chartBake=charts.planMesh({...input,mesh,baseline,views,forcePaint:changedPrimary && views.length>0,edits:edits.filter(edit=>edit.mesh===index &&
      (edit.uvSet===undefined ? !edit.charts || set===primary : edit.uvSet===set))});
    if (set!==primary && mesh.materials.some(row=>row.texture)) {
      const key=projection.digest(JSON.stringify(input.pigmentUVs));
      if (key!==input.source?.state.pigmentLayout)
        for (const {id} of chartBake.state.charts) chartBake.dirty.add(id);
      chartBake.state.pigmentLayout=key;
    }
    if (cage) {
      chartBake.cage=cage;
      for (const {id} of chartBake.state.charts) chartBake.dirty.add(id);
    }
    if (geometrySettings) {
      const {mesh,faces,faceNormals,source} = input;
      const conflict = Geometry.names.find(name => chartBake.state.maskNames.includes(name));
      if (conflict) throw new TypeError('Geometry mask ID is already authored: '+conflict);
      const same = source?.row.geometryMasks && JSON.stringify(geometrySettings) ===
        JSON.stringify(Geometry.settings(baseline.document.geometryMasks)) &&
        source.row.geometry === projection.geometryHash(mesh.points,faces);
      if (same && !chartBake.rebuild.size) chartBake.geometry={previous:source.row.geometryMasks};
      else {
        // A moving wall can change exposure or thickness on an otherwise identical chart.
        if (!same) for (const {id} of chartBake.state.charts) chartBake.dirty.add(id);
        chartBake.geometry={calculate:Geometry.prepare(mesh.points,faces,faceNormals,geometrySettings,kit),
          ...(same && { scope:'updated-charts' })};
      }
    }
    const projected=chartBake.reproject.size ? projection.prepare(input.mesh.points,input.faces,views,kit) : undefined;
    return {chartBake,projection:projected};
  }

  return {validate,record,compose,write,plan,name:index=>baseline?.document.meshes[index]?.name,
    layout:(index,mesh,set)=>charts.baselineLayout(baseline,index,mesh,set)};
}

module.exports = {prepare};
