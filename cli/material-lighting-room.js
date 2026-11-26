const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const HDR = require('../src/hdr-environment.js');
const Rig = require('../src/lighting-room-rig.js');
const files = require('./asset-files.js');
const Geometry = require('./material-preview-geometry.js');
const { readTexture } = require('./texture-files.js');

const format = 'ink-studio/lighting-room';
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const integer = (n, lo, hi) => Number.isSafeInteger(n) && lo <= n && n <= hi;
const clamp = n => Math.max(0, Math.min(1, n));
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = data => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
const dataWire = data => bytes(data).toString('base64');
const formats = ['.hdr', '.rgbe', '.exr', '.pfm'];

function readRoomEnvironment(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (!formats.includes(extension)) throw new TypeError('Lighting room HDRI accepts Radiance HDR, OpenEXR or PFM');
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > HDR.maxFileBytes) throw new RangeError('HDR panorama file exceeds the room byte budget');
  if (extension === '.hdr' || extension === '.rgbe') return HDR.radiance(fs.readFileSync(filename));
  const source = readTexture(filename, extension === '.exr' ? { channels:['R','G','B'] } : {});
  if (source.channels !== 3 || !(source.data instanceof Float32Array))
    throw new TypeError('HDR panorama needs three floating-point color channels');
  return HDR.pack(source.width,source.height,(i,out)=>{
    out[0]=source.data[i*3]; out[1]=source.data[i*3+1]; out[2]=source.data[i*3+2];
  },source.profile.chromaticities);
}

function readRig(row, directory, onFile) {
  let rig = row, base = directory;
  if (typeof row === 'string') {
    const file = path.resolve(directory,row);
    onFile(file);
    base = path.dirname(file);
    rig = JSON.parse(fs.readFileSync(file,'utf8'));
  }
  const environment = rig?.environment;
  if (environment?.file !== undefined) {
    if (!fields(environment,['file','name','rotation','exposureEV','background']) ||
        typeof environment.file !== 'string' || !environment.file.trim() ||
        environment.name !== undefined && !Rig.name(environment.name))
      throw new TypeError('Room environment file needs a path and an optional display name');
    const { file, name, ...controls } = environment;
    const location = path.resolve(base,file);
    onFile(location);
    rig = { ...rig, environment: { ...controls,
      source:HDR.embedded(name ?? path.basename(file),readRoomEnvironment(location)) } };
  }
  return Rig.prepare(rig,HDR.unembed);
}

function configuration(plan) {
  if (!fields(plan,['format','version','label','source','maps','rigs','selected','carriers','view']) ||
      plan.format !== format || plan.version !== 1 || !Rig.name(plan.label) ||
      (plan.source === undefined) === (plan.maps === undefined))
    throw new TypeError('Supply a version 1 lighting room plan with a material graph source or maps');
  const watches = plan.source === undefined ? plan.maps : { source:plan.source };
  if (plan.maps !== undefined && (!fields(watches,['baseColor','normal','roughness','metalness','emission','opacity']) ||
      !Object.keys(watches).length) || !Object.values(watches).every(watch =>
        fields(watch,['output','map']) && Object.keys(watch).length === 1 && Rig.id(watch.output ?? watch.map)))
    throw new TypeError('Lighting room maps need a graph output or usage');
  const { width = 576, height = 416, textureSize = 512 } = plan.view ?? {};
  if (!fields(plan.view ?? {},['width','height','textureSize']) ||
      !integer(width,160,960) || !integer(height,120,720) || !integer(textureSize,32,1024) || width*height > 600000)
    throw new RangeError('Lighting room exceeds its native grid or texture budget');
  const carriers = plan.carriers ?? ['sphere','plane','cube'];
  if (!Array.isArray(carriers) || !integer(carriers.length,1,3) ||
      !Array.from(carriers).every(name=>['sphere','plane','cube'].includes(name)) ||
      new Set(carriers).size !== carriers.length)
    throw new TypeError('Choose distinct sphere, plane and cube room carriers');
  if (plan.rigs !== undefined && (!Array.isArray(plan.rigs) || plan.rigs.length > 8) ||
      plan.selected !== undefined && !Rig.id(plan.selected))
    throw new TypeError('Lighting room supports up to eight authored rigs and a selected rig ID');
  return { label:plan.label, watches, view:{width,height,textureSize}, carriers };
}

function mapData(P, evaluated, limit) {
  const source = evaluated.source;
  const packet = source === undefined ? evaluated : P.materialChannels.valid(source) ?
    Object.fromEntries(Object.entries(source.channels).map(([name, row])=>[name,row.raster])) : { baseColor:source };
  const names = ['baseColor','normal','roughness','metalness','emission','opacity'];
  const selected = Object.fromEntries(Object.entries(packet).filter(([name])=>names.includes(name)));
  if (!Object.keys(selected).length) throw new TypeError('Room material needs one or more lighting channels');
  for (const [name,image] of Object.entries(selected)) {
    if (!P.graphImages.valid(image) || !P.materialChannels.validMap(name,image))
      throw new TypeError('The room needs a matching typed graph image for ' + name);
  }
  const largest = Object.values(selected).reduce((a,b)=>a.raster.width*a.raster.height >= b.raster.width*b.raster.height?a:b);
  const scale = limit / Math.max(limit,largest.raster.width,largest.raster.height);
  const width = Math.max(1,Math.round(scale*largest.raster.width)), height = Math.max(1,Math.round(scale*largest.raster.height));
  const count = width*height;
  const resize = image => P.graphImages.resize(image,width,height);
  function rgba(name, fallback) {
    const raster = selected[name] && P.graphImages.toDisplay(resize(selected[name]));
    const out = new Uint8Array(count * 4);
    for (let p=0; p<count; p++) {
      const i=p*(raster?.channels ?? 0);
      out.set(raster ? [raster.data[i],raster.data[i+1],raster.data[i+2],raster.channels===4?raster.data[i+3]:255] : fallback,p*4);
    }
    return out;
  }
  const shade = rgba('baseColor',[190,196,199,255]);
  const values = new Uint8Array(count*4);
  const scalars = ['roughness','metalness','opacity'].map(name=>{
    if (!selected[name]) return null;
    const {raster,descriptor} = resize(selected[name]);
    const max = ({ unorm8:255,unorm16:65535 })[descriptor.precision] ?? 1;
    return Uint8Array.from(raster.data,n=>Math.round(255*clamp(n/max)));
  });
  for (let p=0;p<count;p++) {
    values.set([scalars[0]?.[p]??100,scalars[1]?.[p]??0,255,255],p*4);
    if (scalars[2]) shade[p*4+3]=Math.round(shade[p*4+3]*scalars[2][p]/255);
  }
  const maps = { baseColor:shade, finish:values };
  if (selected.emission) maps.emission = rgba('emission',[0,0,0,255]);
  if (selected.normal) {
    const image=resize(selected.normal);
    if (image.descriptor.normalSpace==='world') throw new TypeError('Lighting room needs a tangent-space normal map');
    const normal=P.graphImages.normals.normalOrientation(image,{orientation:'opengl',precision:'float32'});
    const {raster:{data,channels},descriptor} = normal;
    const out = new Uint8Array(count*4);
    for (let p=0;p<count;p++) {
      const index=p*channels, gain=descriptor.alpha==='premultiplied'?data[index+3]:1;
      for (let c=0;c<3;c++) out[p*4+c]=gain?Math.round(clamp((data[index+c]/gain+1)*.5)*255):c===2?255:128;
      out[p*4+3]=255;
    }
    maps.normal = out;
  }
  return { width,height,maps:Object.fromEntries(Object.entries(maps).map(([name,data])=>[name,dataWire(data)])),
    hashes:Object.fromEntries(Object.entries(maps).map(([name,data])=>[name,hash(data)])) };
}

function carrier(kind,K,toolkit) {
  const { geometry } = Geometry.split(Geometry.load({kind,slot:'material',uvGrid:[1,1]},toolkit,()=>{}),K);
  const { positions, normals, uvs } = geometry, count = positions.length/3, data = Buffer.alloc(count*32);
  for(let p=0;p<count;p++) {
    const values = [...positions.slice(p*3,p*3+3),...normals.slice(p*3,p*3+3),...uvs.slice(p*2,p*2+2)];
    values.forEach((value,c)=>data.writeFloatLE(value,p*32+c*4));
  }
  return { kind,count,data:data.toString('base64') };
}

async function createLightingRoom(project, plan, {toolkit = require('../index.js').load(),run = {},baseDir = process.cwd(),
  onFile = () => {}} = {}) {
  const { KIT: K } = toolkit, config = configuration(plan);
  const rigs = [...Object.keys(Rig.presets).map(Rig.builtin),
    ...Array.from(plan.rigs ?? [],row=>readRig(row,baseDir,onFile))];
  if (new Set(rigs.map(row=>row.id.toLowerCase())).size !== rigs.length)
    throw new RangeError('Lighting room rig IDs need to be distinct');
  const selected = plan.selected ?? rigs[0].id;
  if (!rigs.some(row=>row.id===selected)) throw new RangeError('Unknown selected room rig');
  const evaluated = await project.previewFrame(config.watches,run,{encodeArtifacts:false});
  if (!evaluated.report.passed) throw new RangeError('Material graph assertions failed in the lighting room');
  const material = mapData(K.procedural,evaluated.values,config.view.textureSize);
  return { format,version:1,label:config.label,view:config.view,rigs,selected,material,
    carriers:config.carriers.map(kind=>carrier(kind,K,toolkit)) };
}

async function writeLightingRoom(project, filename, {directory,toolkit,run,sources=[]}={}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Lighting room needs --out directory');
  const plan = path.resolve(filename), root = path.resolve(directory);
  const inputs = new Set([...sources,...project.sourceFiles(),plan].map(file=>path.resolve(file)));
  const data = await createLightingRoom(project,JSON.parse(fs.readFileSync(plan,'utf8')),
    {toolkit,run,baseDir:path.dirname(plan),onFile:file=>inputs.add(file)});
  const entries = new Map([
    ['index.html','lighting-room.html'], ['renderer.js','lighting-room-render.js'], ['shaders.js','lighting-room-shaders.js'],
    ['live.js','lighting-room.browser.js'], ['hdr-environment.js','../src/hdr-environment.js'],
    ['camera-lens.js','../src/camera-lens.js'], ['rig.js','../src/lighting-room-rig.js']
  ].map(([name,file])=>[name,fs.readFileSync(path.join(__dirname,file))]));
  const { maps: payload,...material } = data.material;
  const summary = { ...data,material,carriers:data.carriers.map(({data,...rest})=>rest),
    rigs:data.rigs.map(row=>{
      const { source,...controls }=row.environment;
      if (typeof source==='string') return row;
      const {data,...info}=source;
      return { ...row,environment:{ ...controls,source:{ ...info,sha256:hash(Buffer.from(data,'base64')) } }};
    }) };
  entries.set('room.json',JSON.stringify(summary,null,2)+'\n');
  entries.set('data.js','const lightingRoom = '+JSON.stringify(data)+';\n');
  for(const rig of data.rigs)entries.set('rigs/'+rig.id+'.json',JSON.stringify(rig,null,2)+'\n');
  if ([...entries.keys()].some(file=>inputs.has(path.join(root,file))))
    throw new RangeError('Choose a lighting room directory that keeps its source files intact');
  for(const [name,content] of entries)files.write(path.join(root,name),content);
  return { file:path.join(root,'index.html'),...summary };
}

module.exports = { readRoomEnvironment, createLightingRoom, writeLightingRoom };
