'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {document}=require('./glb-file.js');
const {addGaussians,writeMaterial}=require('./scan-mesh.js');
const {readDepthInput}=require('./depth.js');
const files=require('./asset-files.js');
const PNG=require('./png.js');
const Views=require('./scan-fusion-views.js');
const Surface=require('./scan-fusion-surface.js');
const Residuals=require('./scan-fusion-residuals.js');

const format='ink-studio/scan-fusion';
const color={observed:[72,155,146],conflict:[231,80,119],'approved-fill':[245,185,82],unobserved:[90,143,228]};
const stages=['observed','conflict','approved-fill','unobserved'];
const controls=['resolution','truncation','supportTolerance','conflictTolerance','maxCells','maxTriangles','paintRadius',
  'rgbThreshold','residualLimit','bounds','fills','name','toolkit'];
const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const matches=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));

function settings(options,viewCount) {
  if (!matches(options,controls)) throw new TypeError('Invalid scan fusion option');
  const {resolution=.04,truncation=resolution*3.25,supportTolerance=resolution*1.35,
    conflictTolerance=resolution*1.8,maxCells=180000,maxTriangles=40000,
    paintRadius=2,rgbThreshold=20,residualLimit=16000,name='Fused capture'}=options;
  const range=Views.inRange, integer=(n,min,max)=>Number.isSafeInteger(n)&&range(n,min,max);
  if (!range(resolution,.00001,1e3)||!range(truncation,resolution*1.5,resolution*12)||
      !range(supportTolerance,resolution*.25,truncation)||!range(conflictTolerance,resolution*.25,4*truncation)||
      !integer(maxCells,8,500000)||maxCells*viewCount>4_000_000||
      !integer(maxTriangles,1,65000)||!integer(paintRadius,0,5)||!range(rgbThreshold,1,255)||
      !integer(residualLimit,0,120000)||typeof name!=='string'||!name.trim()||name.length>160)
    throw new RangeError('Invalid scan fusion resolution, thresholds, or work budget');
  return {resolution,truncation,supportTolerance,conflictTolerance,maxCells,maxTriangles,
    paintRadius,rgbThreshold,residualLimit,name};
}

function indexed(rows,points) {
  const positions=[], uvs=[], indices=[], slots=new Map();
  for (const row of rows) for (const [i,vertex] of row.vertices.entries()) {
    const uv=row.uvs[i], key=[vertex,...uv].join(',');
    if (!slots.has(key)) {
      slots.set(key,positions.length/3);
      positions.push(...points[vertex]);
      uvs.push(...uv);
    }
    indices.push(slots.get(key));
  }
  return {positions:Float32Array.from(positions),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices)};
}

function encode(surface,atlas,cloud,kind,kit,report) {
  const doc=document(), {gltf,add,accessor,texture,finish}=doc;
  gltf.asset.extras={inkStudioScanSurface:1,inkStudioScanFusion:{version:1,kind,evidence:report.faces}};
  const addNode=(name,primitive)=>{
    const mesh=add('meshes',{name,primitives:[primitive]});
    gltf.scenes[0].nodes.push(add('nodes',{name,mesh}));
  };
  if (kind!=='source') {
    const diagnostic=kind==='evidence';
    const pigment=diagnostic ? undefined : add('materials',writeMaterial(atlas.image,null,texture));
    for (const status of stages) {
      const rows=surface.faces.filter(row=>(diagnostic ? row.diagnostic : row.status)===status);
      if (!rows.length) continue;
      const part=indexed(rows,surface.positions);
      const material=diagnostic ? add('materials',{name:status,pbrMetallicRoughness:{
        baseColorFactor:[...color[status].map(n=>n/255),1],metallicFactor:0,roughnessFactor:1}}) : pigment;
      addNode(status,{attributes:{POSITION:accessor(part.positions,'VEC3',{bounds:true,target:34962}),
        TEXCOORD_0:accessor(part.uvs,'VEC2',{target:34962})},indices:accessor(part.indices,'SCALAR',{target:34963}),material,
        extras:{inkStudioScanEvidence:status}});
    }
  }
  if (kind==='source'||kind==='hybrid') {
    const splats=addGaussians(doc,cloud,null,kit);
    if (splats) addNode(kind==='source' ? 'Registered observations' : 'Residual observations',splats);
  }
  return finish();
}

async function scanFusion(inputs,options={}) {
  const {toolkit=require('../index.js').load()}=options, kit=toolkit.KIT??toolkit;
  const config=settings(options,Array.isArray(inputs) ? inputs.length : 0);
  const views=Views.prepare(inputs,kit), fills=Surface.fillsFor(options.fills??[],views);
  const bounds=Surface.boundsFor(views,options.bounds,config.truncation);
  const surface=Surface.reconstruct(views,fills,bounds,config,kit), atlas=Views.atlas(views,fills,config.paintRadius);
  const byId=new Map(views.map(view=>[view.id,view]));
  for (const row of surface.faces) {
    const source=byId.get(row.primary);
    const reference=row.views?.find(view=>view.id===row.primary)?.pixel??[0,0];
    row.uvs=row.vertices.map(i=>{
      const p=source?.raster(surface.positions[i]);
      return atlas.uv(row.primary,...(p ? [p.u,p.v] : reference));
    });
    row.diagnostic=row.status==='observed'&&surface.boundaryFaces.has(row.id) ? 'unobserved' : row.status;
  }
  const proxy=kit.meshTopology.create({
    id:'scan-fusion',
    vertices:surface.positions.map((position,i)=>({id:'vertex-'+i,position})),
    faces:surface.faces.map(row=>({id:row.id,material:row.status,
      corners:row.vertices.map((v,i)=>({id:row.id+'/'+i,vertex:'vertex-'+v,uv:row.uvs[i]}))}))
  });
  const flat=indexed(surface.faces,surface.positions);
  const mesh=kit.sceneMeshes.create({id:'fusion-surface',...flat,
    materials:[{id:'registered-pigment',texture:atlas.image}]});
  const residual=Residuals.collect(views,mesh,config,kit), cloud=Residuals.cloud(residual.chosen);
  const faces=Object.fromEntries(stages.map(key=>[key,surface.faces.filter(face=>face.status===key).length]));
  delete faces.unobserved;
  const viewReport=views.map(v=>{
    const {scaleAt,...camera}=v.camera;
    return {id:v.id,width:v.width,height:v.height,validPixels:v.valid,missingPixels:v.d.length-v.valid,
      weight:v.weight,camera,stride:v.model.stride,maxDepthJump:Number.isFinite(v.model.maxDepthJump) ? v.model.maxDepthJump : null,
      pose:{position:v.position,rotation:v.rotation},primaryFaces:surface.faces.filter(face=>face.primary===v.id).length};
  });
  const report={format,version:1,name:config.name,bounds,settings:config,sampling:surface.sampling,
    fieldSamples:surface.samples,discardedUnsupportedFaces:surface.unsupportedFaces,
    vertices:proxy.vertices.length,triangles:proxy.faces.length,faces,openBoundaryEdges:surface.boundaries.length,
    atlas:{width:atlas.image.width,height:atlas.image.height,downsample:atlas.divisor},
    views:viewReport,sourceSplats:residual.sources.length,
    residualSplats:residual.chosen.length,residualReasons:residual.reasons,sourceStride:residual.sourceStride,
    approvedFills:fills.map(({id,approval})=>({id,approval}))};
  const evidence={format:'ink-studio/scan-fusion-evidence',version:1,proxy:proxy.id,
    faces:surface.faces.map(({vertices,uvs,...row})=>row),
    boundaries:surface.boundaries.map(({vertices,...row})=>({...row,vertices:vertices.map(i=>'vertex-'+i)})),
    residuals:residual.chosen.map(({view,pixel,reason},index)=>({index,view,pixel,reason}))};
  const glb=encode(surface,atlas,cloud,'hybrid',kit,report);
  const diagnostic=encode(surface,atlas,cloud,'evidence',kit,report);
  const {gaussianGltfWorld}=await import('../src/gaussian-gltf.mjs');
  const decodeImage=require('./gltf-image.js');
  const world=(kind='hybrid')=>{
    if (!['source','mesh','hybrid','evidence'].includes(kind)) throw new RangeError('Unknown scan fusion world '+kind);
    const bytes=kind==='hybrid' ? glb : kind==='evidence' ? diagnostic :
      encode(surface,atlas,kind==='source' ? Residuals.cloud(residual.sources) : cloud,kind,kit,report);
    return gaussianGltfWorld(bytes,{toolkit,decodeImage});
  };
  return {glb,diagnostic,atlas:PNG.encode(atlas.image.width,atlas.image.height,atlas.image.pixels,4),
    proxy,evidence,report,world};
}

async function command(file,opt,toolkit) {
  if (!file||typeof opt.out!=='string'||path.extname(opt.out).toLowerCase()!=='.glb')
    throw new TypeError('Use scan-fuse <manifest.json> --out asset.glb');
  const manifest=path.resolve(file), source=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if (!matches(source,['format','version','views','options','fills','bounds','name'])||source.format!==format||
      source.version!==1||!Array.isArray(source.views)||source.views.length<2||source.views.length>12)
    throw new TypeError('Expected a version 1 Ink Studio scan fusion manifest with 2 to 12 views');
  const base=path.dirname(manifest), inputs=new Set([manifest]);
  function input(name) {
    if (typeof name!=='string'||!name.trim()) throw new TypeError('Scan fusion capture paths must name a file');
    const p=path.resolve(base,name);
    inputs.add(p);
    return p;
  }
  const out=path.resolve(opt.out), stem=out.slice(0,-4);
  const outputs=[out,...['.scan.json','.proxy.json','.atlas.png','.evidence.json','.evidence.glb'].map(ext=>stem+ext)];
  const views=source.views.map(view=>{
    if (!matches(view,['id','depth','image','camera','depthOptions','pose','weight'])||
        view.depthOptions!==undefined&&!matches(view.depthOptions,
          ['near','far','white-near','depth-scale','depth-offset','invalid','channel','stride','max-jump','alpha-mask'])||
        view.camera!==undefined&&!matches(view.camera,['type','height','fx','fy','cx','cy','fov']))
      throw new TypeError('Invalid scan fusion manifest view');
    const capture=readDepthInput(input(view.depth),{...view.depthOptions,...(view.image!==undefined && {image:input(view.image)})});
    if (view.camera) capture.camera={...capture.camera,...view.camera};
    return {id:view.id,capture,pose:view.pose,weight:view.weight};
  });
  if (outputs.some(output=>inputs.has(output))) throw new RangeError('Scan fusion outputs must be separate from input files');
  if (source.options!==undefined&&!matches(source.options,controls.filter(key=>!['toolkit','name','fills','bounds'].includes(key))))
    throw new TypeError('Invalid scan fusion manifest options');
  const result=await scanFusion(views,{...source.options,toolkit,bounds:source.bounds,fills:source.fills,name:source.name});
  files.write(out,result.glb);
  files.json(stem+'.scan.json',result.report);
  files.json(stem+'.proxy.json',result.proxy);
  files.write(stem+'.atlas.png',result.atlas);
  files.json(stem+'.evidence.json',result.evidence);
  files.write(stem+'.evidence.glb',result.diagnostic);
  console.log('Wrote',out,'with',result.report.triangles,'proxy faces and',result.report.residualSplats,'residual splats');
}

module.exports={scanFusion,command};
