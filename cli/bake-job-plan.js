const fs=require('node:fs');
const path=require('node:path');
const Geometry=require('./geometry-masks.js');
const UV=require('./material-preview-geometry.js');
const {maps:projectionMaps}=require('./bake-job-projection.js');
const Surface=require('./bake-job-surface.js');
const Occlusion=require('./bake-job-occlusion.js');
const Thickness=require('./thickness.js');
const Curvature=require('./bake-job-curvature.js');
const Attributes=require('./bake-job-attributes.js');
const Transfer=require('./bake-job-transfer.js');
const UVDebug=require('./bake-job-uv-debug.js');
const Output=require('./bake-output-controls.js');

const format='ink-studio/bake-job', presetFormat='ink-studio/bake-preset';
const names=Object.freeze(['pigment','normal','world-normal','height','roughness','metalness','emission','opacity','coverage',...Geometry.names,
  ...projectionMaps,...Occlusion.names,...Curvature.names,...Attributes.names,Transfer.name,UVDebug.outline]);
const geometryFields=['up','samples','cavityRadius','exposureDistance','thicknessScale','rayBias'];
const mapGeometry={slope:['up'],cavity:['samples','cavityRadius','rayBias'],
  exposure:['samples','exposureDistance','rayBias'],thickness:['thicknessScale','rayBias'],'thickness-valid':['rayBias']};
const mapSurface={normal:['space','orientation','encoding'],'world-normal':['encoding'],height:['normalization','range','encoding']};
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const id=value=>typeof value==='string'&&/^[a-z][\w-]{0,63}$/i.test(value)&&!['constructor','prototype'].includes(value);
const text=value=>typeof value==='string'&&value.trim()&&value.length<=140&&!/[\x00-\x1f]/.test(value);
const file=value=>typeof value==='string'&&value.trim()&&value.length<=4096&&!value.includes('\0');
const fields=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).every(key=>keys.includes(key));
const json=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
const mesh=value=>integer(value,0,2047)||text(value);
const meshFile=value=>file(value)&&/\.(glb|gltf)$/i.test(value);
const distance=value=>Number.isFinite(value)&&value>=0&&value<=1e5;

function coord(value) {
  if(integer(value,1001,9999)) return [(value-1001)%10,Math.floor((value-1001)/10)];
  if(Array.isArray(value)&&value.length===2&&Array.from(value).every(n=>integer(n,-1000,1000)))return value.slice();
  throw new TypeError('Bake tiles need a UDIM number or a signed UV pair');
}
function options(data,allowed) {
  if(!fields(data,allowed)||data.size!==undefined&&!integer(data.size,8,1024)||
    data.padding!==undefined&&!integer(data.padding,0,32)||
    data.orientation!==undefined&&!['opengl','directx'].includes(data.orientation))
    throw new RangeError('Invalid map options, orientation, size (8–1024) or padding (0–32)');
  if(geometryFields.some(key=>Object.hasOwn(data,key))) Geometry.settings(
    Object.fromEntries(geometryFields.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])));
  return {...data};
}
function preset(value) {
  if(!fields(value,['format','version','label','defaults','maps'])||value.format!==presetFormat||value.version!==1||
      !text(value.label)||!Array.isArray(value.maps)||!integer(value.maps.length,1,names.length))
    throw new TypeError('Expected a named version 1 bake preset with ordered maps');
  const defaults=options(value.defaults??{},['size','padding','width','height',...geometryFields]);
  const seen=new Set(), maps=Array.from(value.maps,row=>{
    if(!fields(row,['id','enabled','overrides'])||!names.includes(row.id)||seen.has(row.id)||
      row.enabled!==undefined&&typeof row.enabled!=='boolean')
      throw new TypeError('Use each supported bake map once and set enabled to a boolean');
    seen.add(row.id);
    const overrides=options(row.overrides??{},['size','padding',...Output.fields,...(mapSurface[row.id]??[]),...(mapGeometry[row.id]??[]),
      ...(Occlusion.names.includes(row.id)?Occlusion.fields:[]),...(Thickness.names.includes(row.id)?Thickness.fields:[]),
      ...(row.id==='thickness'?['encoding']:[]),...(Curvature.names.includes(row.id)?Curvature.fields:[]),...Transfer.fields(row.id)]);
    Surface.settings(row.id,overrides);
    Occlusion.settings(row.id,overrides);
    Thickness.settings(row.id,overrides);
    Curvature.settings(row.id,overrides);
    Transfer.settings(row.id,overrides);
    const validated={id:row.id,enabled:row.enabled??true,overrides};
    if(validated.enabled&&Output.fields.some(key=>overrides[key]!==undefined||defaults[key]!==undefined))
      effective({defaults,maps:[]},validated);
    return validated;
  });
  if(!maps.some(row=>row.enabled))throw new RangeError('Enable at least one bake map');
  return {format:presetFormat,version:1,label:value.label,defaults,maps};
}
function defaults() {
  return preset({format:presetFormat,version:1,label:'Material maps',defaults:{size:128,padding:3},
    maps:names.map(id=>({id,enabled:['pigment','normal','roughness','coverage'].includes(id)}))});
}
function projection(value,sources,skewMaps) {
  if(value===undefined)return undefined;
  if(!fields(value,['mode','high','mesh','match','lowSuffix','highSuffix','front','back','units','normals',
    'cage','backfaces','skew','invertSkew']))throw new TypeError('Invalid bake projection fields');
  if(value.mode==='self') {
    if(Object.keys(value).length!==1)throw new TypeError('Self-bake uses the receiving surface directly');
    return {mode:'self'};
  }
  const {mode,high,mesh:highMesh,match=highMesh===undefined?'all':'selection',lowSuffix='',highSuffix='',
    front=.1,back=.05,units='scene',normals='authored',cage,backfaces='ignore',skew,invertSkew=false}=value;
  const known=name=>name==='$receiver'||sources.has(name);
  const suffix=value=>typeof value==='string'&&(value===''||text(value));
  if(mode!=='project'||!known(high)||!['all','selection','name'].includes(match)||
    (match==='selection'?!mesh(highMesh):highMesh!==undefined)||!suffix(lowSuffix)||!suffix(highSuffix)||
    match!=='name'&&(lowSuffix||highSuffix)||!distance(front)||!distance(back)||!cage&&front+back<1e-7||
    !['scene','bounds'].includes(units)||!['authored','average','face'].includes(normals)||
    !['ignore','block','accept'].includes(backfaces)||typeof invertSkew!=='boolean'||
    skew!==undefined&&(!skewMaps.has(skew)||cage)||invertSkew&&skew===undefined||
    cage!==undefined&&(!fields(cage,['source','mesh'])||!known(cage.source)||cage.mesh!==undefined&&!mesh(cage.mesh)))
    throw new RangeError('Check projection source, matching, cage, distance and skew settings');
  return {mode,high,match,...(highMesh!==undefined&&{mesh:highMesh}),...(match==='name'&&{lowSuffix,highSuffix}),
    ...(!cage&&{front,back,units,normals}),...(cage&&{cage}),backfaces,...(skew!==undefined&&{skew,invertSkew})};
}
function libraries(source,baseDir) {
  function entries(value,label,read) {
    if(value===undefined)return new Map();
    if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length>24)
      throw new TypeError('Use up to 24 named '+label);
    return new Map(Object.entries(value).map(([key,row])=>{
      if(!id(key))throw new TypeError('Invalid '+label+' ID');
      return [key,read(row)];
    }));
  }
  const sources=entries(source.projectionSources,'projection sources',value=>{
    if(!meshFile(value))throw new TypeError('Projection sources need a GLB or glTF file');
    return path.resolve(baseDir,value);
  });
  function png(value) {
    if(!file(value)||!(/\.png$/i.test(value)))throw new TypeError('Skew maps need PNG files');
    return path.resolve(baseDir,value);
  }
  const skewMaps=entries(source.skewMaps,'skew maps',value=>{
    if(typeof value==='string')return png(value);
    if(!fields(value,['tiles'])||!Array.isArray(value.tiles)||!integer(value.tiles.length,1,32))
      throw new TypeError('Specify one skew PNG or a set of explicit tiles');
    const tiles=new Map();
    for(const row of value.tiles) {
      if(!fields(row,['tile','file']))throw new TypeError('Skew tiles need a tile coordinate and PNG filename');
      const key=UV.tileKey(coord(row.tile));
      if(tiles.has(key))throw new RangeError('Duplicate skew tile '+key);
      tiles.set(key,png(row.file));
    }
    return tiles;
  });
  const normalInputs=entries(source.normalInputs,'curvature normal inputs',value=>{
    if(!fields(value,['file','tiles','space','orientation'])||Object.hasOwn(value,'file')===Object.hasOwn(value,'tiles'))
      throw new TypeError('Curvature normal inputs need a file or tile set');
    const {space='tangent',orientation}=value;
    if(!['tangent','world'].includes(space)||orientation!==undefined&&
      (space==='world'||!['opengl','directx'].includes(orientation)))
      throw new TypeError('Normal inputs need tangent or world space, with Y orientation for tangent space');
    function location(name) {
      if(!file(name)||!(/\.(png|exr)$/i.test(name)))throw new TypeError('Curvature normal input files need PNG or EXR');
      return path.resolve(baseDir,name);
    }
    const descriptor={space,...(space==='tangent'&&{orientation:orientation??'opengl'})};
    if(value.file!==undefined)return {...descriptor,file:location(value.file)};
    if(!Array.isArray(value.tiles)||!integer(value.tiles.length,1,32))throw new TypeError('Use 1–32 normal input tiles');
    const tiles=new Map();
    for(const row of value.tiles) {
      if(!fields(row,['tile','file']))throw new TypeError('Normal tiles need a tile coordinate and filename');
      const key=UV.tileKey(coord(row.tile));
      if(tiles.has(key))throw new RangeError('Duplicate normal input tile '+key);
      tiles.set(key,location(row.file));
    }
    return {...descriptor,tiles};
  });
  const textureInputs=entries(source.textureInputs,'bake texture inputs',value=>{
    if(!fields(value,['file','tiles'])||Object.hasOwn(value,'file')===Object.hasOwn(value,'tiles'))
      throw new TypeError('Texture inputs need a file or a tile set');
    function locate(name) {
      if(!file(name)||!(/\.(png|tiff?|exr)$/i.test(name)))throw new TypeError('Texture inputs need PNG, TIFF or OpenEXR files');
      return path.resolve(baseDir,name);
    }
    if(value.file!==undefined)return {file:locate(value.file)};
    if(!Array.isArray(value.tiles)||!integer(value.tiles.length,1,32))throw new TypeError('Use 1–32 texture input tiles');
    const tiles=new Map();
    for(const row of value.tiles) {
      if(!fields(row,['tile','file']))throw new TypeError('Texture tiles need a tile coordinate and filename');
      const key=UV.tileKey(coord(row.tile));
      if(tiles.has(key))throw new RangeError('Duplicate texture input tile '+key);
      tiles.set(key,locate(row.file));
    }
    return {tiles};
  });
  return {sources,skewMaps,normalInputs,textureInputs};
}
function targets(rows,{sources,skewMaps}) {
  if(!Array.isArray(rows)||!integer(rows.length,1,24))throw new RangeError('A bake job needs 1–24 targets');
  const ids=new Set();
  return Array.from(rows,row=>{
    if(!fields(row,['id','mesh','submeshes','slots','uvSet','tiles','projection','thicknessParts','positionNode'])||!id(row.id)||ids.has(row.id.toLowerCase())||
      !mesh(row.mesh)||row.positionNode!==undefined&&!(integer(row.positionNode,0,Number.MAX_SAFE_INTEGER)||text(row.positionNode))||
      row.submeshes!==undefined&&(!Array.isArray(row.submeshes)||!row.submeshes.length||
        !Array.from(row.submeshes).every(n=>integer(n,0,255))||new Set(row.submeshes).size!==row.submeshes.length)||
      row.slots!==undefined&&(!Array.isArray(row.slots)||!row.slots.length||!Array.from(row.slots).every(text)||
        new Set(row.slots).size!==row.slots.length)||
      row.thicknessParts!==undefined&&(!row.thicknessParts||Object.getPrototypeOf(row.thicknessParts)!==Object.prototype||
        Object.entries(row.thicknessParts).some(([key,value])=>!/^(0|[1-9][0-9]{0,2})$/.test(key)||+key>255||!text(value)))||
      row.uvSet!==undefined&&!integer(row.uvSet,0,31)||row.tiles!==undefined&&
        (!Array.isArray(row.tiles)||!integer(row.tiles.length,1,32)))
      throw new TypeError('Targets need unique IDs, a mesh and optional submesh, slot, UV set and tile selectors');
    ids.add(row.id.toLowerCase());
    const tiles=Array.from(row.tiles??[1001],coord);
    if(new Set(tiles.map(UV.tileKey)).size!==tiles.length)throw new RangeError('Duplicate bake tile on '+row.id);
    const cast=projection(row.projection,sources,skewMaps);
    return {...row,uvSet:row.uvSet??0,tiles,...(cast&&{projection:cast})};
  });
}
function bindings(value,baseDir,selected,onInput) {
  if(value===undefined)return undefined;
  if(!fields(value,['material','bindings'])||!file(value.material)||!Array.isArray(value.bindings)||!value.bindings.length||
     value.bindings.length>64)
    throw new TypeError('Refresh needs an editable material graph and resource bindings');
  const material=path.resolve(baseDir,value.material), resources=new Set();
  onInput(material);
  const list=Array.from(value.bindings,row=>{
    if(!fields(row,['target','map','resource','storage'])||!selected.some(target=>target.id===row.target)||
      !names.includes(row.map)||!id(row.resource)||resources.has(row.resource)||!['linked','embedded'].includes(row.storage))
      throw new TypeError('Each refresh needs a target, supported map, unique resource and linked or embedded storage');
    resources.add(row.resource);
    return row;
  });
  return {material,bindings:list};
}
function readPlan(filename,{presetFile,presetValue,targetValues,onInput=()=>{}}={}) {
  const location=path.resolve(filename), baseDir=path.dirname(location);
  onInput(location);
  const source=json(location);
  if(!fields(source,['format','version','label','source','targets','preset','refresh','projectionSources','skewMaps','normalInputs','textureInputs'])||
    source.format!==format||source.version!==1||!text(source.label)||!meshFile(source.source))
    throw new TypeError('Expected a version 1 bake job with a GLB or glTF source');
  let settings=presetValue??presetFile??source.preset;
  if(typeof settings==='string') {
    const f=path.resolve(presetFile&&!presetValue?process.cwd():baseDir,settings);
    onInput(f);
    settings=json(f);
  }
  const catalogs=libraries(source,baseDir), selected=targets(targetValues??source.targets,catalogs), receiver=path.resolve(baseDir,source.source);
  onInput(receiver);
  const chosen=settings===undefined?defaults():preset(settings);
  for(const row of chosen.maps)if(row.enabled) {
    if(row.overrides.curvatureSource==='normal'&&!catalogs.normalInputs.has(row.overrides.normalInput))
      throw new RangeError('Unknown curvature normal input '+row.overrides.normalInput);
    const {textureInput}=row.overrides;
    if(row.id===Transfer.name&&!textureInput)throw new RangeError('Texture transfer needs a named texture input');
    if(textureInput&&!catalogs.textureInputs.has(textureInput))throw new RangeError('Unknown bake texture input '+textureInput);
  }
  return {location,label:source.label,source:receiver,targets:selected,...catalogs,preset:chosen,
    refresh:bindings(source.refresh,baseDir,selected,onInput)};
}

function effective(preset,row) {
  const thickness=row.id==='thickness-valid'&&preset.maps.find(other=>other.id==='thickness'&&other.enabled);
  const shared=thickness&&Object.fromEntries(Object.entries(thickness.overrides)
    .filter(([key])=>['size','width','height','padding','antialiasing','dilation','gutters','mipmaps','rayBias',...Thickness.fields].includes(key)));
  const {size=128,padding=3,...tuning}={...preset.defaults,...shared,...row.overrides};
  const base={size,padding,...Surface.settings(row.id,tuning),...Occlusion.settings(row.id,tuning),...Thickness.settings(row.id,tuning),
    ...Curvature.settings(row.id,tuning),...Attributes.settings(row.id),...Transfer.settings(row.id,tuning),
    ...(Geometry.names.includes(row.id)&&{geometry:Geometry.settings(Object.fromEntries(
      Object.entries(tuning).filter(([key])=>geometryFields.includes(key))))})};
  const delivery=Output.controls(row.id,base,tuning);
  if(!delivery&&padding*2>=size)throw new RangeError('Map padding must be less than half its size');
  return {...base,...(delivery&&{delivery})};
}
module.exports={format,presetFormat,names,preset,readPlan,effective,id};
