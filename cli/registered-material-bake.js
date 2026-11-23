const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const projection = require('./material-projection.js');
const charts = require('./material-chart-rebake.js');

function prepare({bakeDir,paintViews,capturePaint,rebakeFrom,chartEdits}) {
  if ([bakeDir,paintViews,capturePaint,rebakeFrom,chartEdits].every(value=>value===undefined)) return null;
  if(chartEdits!==undefined && rebakeFrom===undefined)throw new TypeError('Chart edits need a rebake baseline');
  if(typeof bakeDir!=='string'||!bakeDir || paintViews!==undefined && capturePaint!==undefined)
    throw new TypeError('Registered baking needs a bake directory and one paint or capture plan at a time');
  const directory=path.resolve(bakeDir), meshes=[], output=new Map(), captures=[];
  const baseline=charts.readBaseline(rebakeFrom), edits=charts.readPlan(chartEdits);
  const sameDirectory=baseline && fs.existsSync(directory) && fs.realpathSync(directory)===baseline.directory;
  const paint=projection.read(paintViews,'paint'), capture=projection.read(capturePaint,'camera');
  if (capture.length && (fs.existsSync(path.join(directory,'paint-views','approved.json')) ||
      capture.some(({id})=>fs.existsSync(path.join(directory,'paint-views',id+'-paint.png')))))
    throw new Error('Choose a fresh paint capture directory to preserve the existing paint files');
  function validate(count) {
    if([...paint,...capture,...edits].some(row=>row.mesh>=count))throw new RangeError('Material bake plan references a missing mesh index');
    if(baseline && baseline.document.meshes.length!==count)throw new Error('Chart rebake needs the baseline mesh count');
  }

  function record(index, mesh, faces, uvs, size, padding, baked, chartBake, plan, source, kit) {
    const folder='mesh-'+String(index).padStart(3,'0'), {textures,registeredMaps,strength,coverage}=baked;
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
      coverage:map('coverage',registeredMaps.coverage,'linear')
    };
    const masks=Object.fromEntries(Object.entries(registeredMaps.masks).map(([name,bytes])=>[name,map('mask-'+name,bytes,'linear')]));
    const {state,dirty,reproject,previous}=chartBake;
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
      sampledTexels:baked.sampledTexels
    };
    const row={index,name:mesh.name,geometry:projection.geometryHash(mesh.points,faces),
      uvLayout:projection.digest(JSON.stringify([faces,uvs])),texCoord:0,width:size,height:size,padding,
      coverage,emissionStrength:strength,maps,masks,paintViews:[...paintReceipts.values()],
      charts:state.charts.map(({id,faces,bounds})=>({id,faces,bounds})),
      chartLayout:sidecar('chart-layout','json',Buffer.from(JSON.stringify(state))),
      rebakeState:{owners:sidecar('chart-owners','deflate',previous?.packedOwners??charts.pack(baked.owners)),
        ...(baked.stamp && {paint:sidecar('uv-paint','deflate',(!reproject.size&&previous?.packedPaint)||charts.pack(baked.stamp))})},
      chartReport};
    meshes.push(row);
    const authored=projection.cameraCapture(mesh,faces,capture.filter(v=>v.mesh===index),kit);
    for(const {id,guide,blank,...view} of authored) {
      output.set('paint-views/'+id+'-guide.png',guide);
      output.set('paint-views/'+id+'-paint.png',blank);
      captures.push({id,...view,paint:id+'-paint.png'});
    }
    return {index,width:size,height:size,uvLayout:row.uvLayout,chartReport,paintViews:row.paintViews.map(({id,texels})=>({id,texels}))};
  }

  function write(glb) {
    const document={format:'ink-studio/registered-material-bake',version:1,
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
    const views=paint.filter(view=>view.mesh===index);
    const chartBake=charts.planMesh({...input,baseline,views,edits:edits.filter(edit=>edit.mesh===index)});
    const projected=chartBake.reproject.size ? projection.prepare(input.mesh.points,input.faces,views,kit) : undefined;
    return {chartBake,projection:projected};
  }

  return {validate,record,write,plan,name:index=>baseline?.document.meshes[index]?.name,
    layout:(index,mesh)=>charts.baselineLayout(baseline,index,mesh)};
}

module.exports = {prepare};
