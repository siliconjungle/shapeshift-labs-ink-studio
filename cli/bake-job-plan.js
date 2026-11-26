const fs=require('node:fs');
const path=require('node:path');
const Geometry=require('./geometry-masks.js');
const UV=require('./material-preview-geometry.js');

const format='ink-studio/bake-job', presetFormat='ink-studio/bake-preset';
const names=Object.freeze(['pigment','normal','roughness','metalness','emission','opacity','coverage',...Geometry.names]);
const geometryFields=['up','samples','cavityRadius','exposureDistance','thicknessScale','rayBias'];
const mapGeometry={slope:['up'],cavity:['samples','cavityRadius','rayBias'],
  exposure:['samples','exposureDistance','rayBias'],thickness:['thicknessScale','rayBias'],'thickness-valid':['rayBias']};
const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const id=value=>typeof value==='string'&&/^[a-z][\w-]{0,63}$/i.test(value)&&!['constructor','prototype'].includes(value);
const text=value=>typeof value==='string'&&value.trim()&&value.length<=140&&!/[\x00-\x1f]/.test(value);
const file=value=>typeof value==='string'&&value.trim()&&value.length<=4096&&!value.includes('\0');
const fields=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).every(key=>keys.includes(key));
const json=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));

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
  const defaults=options(value.defaults??{},['size','padding',...geometryFields]);
  const seen=new Set(), maps=Array.from(value.maps,row=>{
    if(!fields(row,['id','enabled','overrides'])||!names.includes(row.id)||seen.has(row.id)||
      row.enabled!==undefined&&typeof row.enabled!=='boolean')
      throw new TypeError('Use each supported bake map once and set enabled to a boolean');
    seen.add(row.id);
    return {id:row.id,enabled:row.enabled??true,overrides:options(row.overrides??{},
      ['size','padding',...(row.id==='normal'?['orientation']:[]),...(mapGeometry[row.id]??[])])};
  });
  if(!maps.some(row=>row.enabled))throw new RangeError('Enable at least one bake map');
  return {format:presetFormat,version:1,label:value.label,defaults,maps};
}
function defaults() {
  return preset({format:presetFormat,version:1,label:'Material maps',defaults:{size:128,padding:3},
    maps:names.map(id=>({id,enabled:['pigment','normal','roughness','coverage'].includes(id)}))});
}
function targets(rows) {
  if(!Array.isArray(rows)||!integer(rows.length,1,24))throw new RangeError('A bake job needs 1–24 targets');
  const ids=new Set();
  return Array.from(rows,row=>{
    if(!fields(row,['id','mesh','submeshes','slots','uvSet','tiles'])||!id(row.id)||ids.has(row.id.toLowerCase())||
      !(integer(row.mesh,0,2047)||text(row.mesh))||
      row.submeshes!==undefined&&(!Array.isArray(row.submeshes)||!row.submeshes.length||
        !Array.from(row.submeshes).every(n=>integer(n,0,255))||new Set(row.submeshes).size!==row.submeshes.length)||
      row.slots!==undefined&&(!Array.isArray(row.slots)||!row.slots.length||!Array.from(row.slots).every(text)||
        new Set(row.slots).size!==row.slots.length)||
      row.uvSet!==undefined&&!integer(row.uvSet,0,31)||row.tiles!==undefined&&
        (!Array.isArray(row.tiles)||!integer(row.tiles.length,1,32)))
      throw new TypeError('Targets need unique IDs, a mesh and optional submesh, slot, UV set and tile selectors');
    ids.add(row.id.toLowerCase());
    const tiles=Array.from(row.tiles??[1001],coord);
    if(new Set(tiles.map(UV.tileKey)).size!==tiles.length)throw new RangeError('Duplicate bake tile on '+row.id);
    return {...row,uvSet:row.uvSet??0,tiles};
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
  if(!fields(source,['format','version','label','source','targets','preset','refresh'])||
    source.format!==format||source.version!==1||!text(source.label)||!file(source.source)||
    !/\.(glb|gltf)$/i.test(source.source))
    throw new TypeError('Expected a version 1 bake job with a GLB or glTF source');
  let settings=presetValue??presetFile??source.preset;
  if(typeof settings==='string') {
    const f=path.resolve(presetFile&&!presetValue?process.cwd():baseDir,settings);
    onInput(f);
    settings=json(f);
  }
  const selected=targets(targetValues??source.targets), mesh=path.resolve(baseDir,source.source);
  onInput(mesh);
  return {location,label:source.label,source:mesh,targets:selected,preset:settings===undefined?defaults():preset(settings),
    refresh:bindings(source.refresh,baseDir,selected,onInput)};
}

function effective(preset,row) {
  const {size=128,padding=3,orientation='opengl',...geometry}={...preset.defaults,...row.overrides};
  if(padding*2>=size)throw new RangeError('Map padding must be less than half its size');
  return {size,padding,...(row.id==='normal'&&{orientation}),
    ...(Geometry.names.includes(row.id)&&{geometry:Geometry.settings(geometry)})};
}
module.exports={format,presetFormat,names,preset,readPlan,effective,id};
