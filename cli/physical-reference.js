const fs = require('node:fs');
const path = require('node:path');
const { prepare,format } = require('./physical-reference-scene.js');
const { makeTracer,auxiliaries,accumulate } = require('./physical-path-trace.js');
const { whiteNits } = require('./physical-openpbr.js');
const Film = require('./physical-reference-film.js');
const PNG = require('./png.js');
const EXR = require('./texture-exr.js');
const Color = require('./color-management.js');
const ColorFiles = require('./color-management-files.js');
const Assets = require('./asset-files.js');

const fixedFiles=['index.html','report.json','accumulation.bin','raw.png','denoised.png','raw.exr','variance.png','albedo.png','normals.png','depth.png'];
const reserved = name => fixedFiles.includes(name)||/^progress-\d{4}\.png$/.test(name);

function exr(width,height,rgb) {
  const planes={};
  for(const [i,name] of ['R','G','B'].entries())
    planes[name]=Float32Array.from({length:width*height},(_,p)=>rgb[p*3+i]);
  return EXR.write({width,height,planes},{bitDepth:32,profile:{chromaticities:[.64,.33,.3,.6,.15,.06,.3127,.329]}});
}

async function writePhysicalReference(filename, { directory, resume, toolkit=require('../index.js').load(), ...overrides }={}) {
  if(typeof directory!=='string'||!directory.trim()) throw new TypeError('Physical reference needs an output directory');
  const file=path.resolve(filename), root=path.resolve(directory);
  const paths=new Set([file]), plan=JSON.parse(fs.readFileSync(file,'utf8'));
  const scene=await prepare(plan,overrides,path.dirname(file),toolkit,source=>paths.add(path.resolve(source)));
  const managed=plan.colorManagement===undefined?null:Color.configure(plan.colorManagement,{baseDir:path.dirname(file),onFile:source=>paths.add(source)});
  const protectedFile=name=>reserved(name)||managed&&['display.png','working.exr'].includes(name);
  if([...paths].some(source=>protectedFile(path.relative(root,source))))
    throw new RangeError('Physical reference output would overwrite one of its inputs');
  const {width,height,samples,batch,exposure,denoise}=scene.options;
  const prior=resume===undefined?null:path.resolve(resume);
  if(prior && protectedFile(path.relative(root,prior)) && prior!==path.join(root,'accumulation.bin'))
    throw new RangeError('Physical reference output would overwrite its resume input');
  if(prior && fs.statSync(prior).size!==56+width*height*32+32)
    throw new RangeError('Physical reference checkpoint does not match the output grid');
  const state=prior ? Film.restore(fs.readFileSync(prior),scene) : {sums:new Float64Array(width*height*4),samples:0};
  const start=state.samples, end=start+samples;
  if(!end||end>4096) throw new RangeError('Physical reference needs 1–4096 accumulated samples');
  const tracer=makeTracer(scene), progress=[], png=(name,rgb)=>Assets.write(path.join(root,name),PNG.encode(width,height,rgb));
  const source=rgb=>({width,height,channels:3,data:rgb,alpha:'none'});
  function beauty(name,rgb) {
    if (managed) {
      const {value}=managed.output(source(rgb),{exposure,proofOnly:true});
      Assets.write(path.join(root,name),ColorFiles.proof(value));
    } else png(name,Film.visualize(rgb,exposure));
  }
  const save=()=>{
    const file='progress-'+String(state.samples).padStart(4,'0')+'.png';
    beauty(file,Film.resolve(state).rgb);
    progress.push({samples:state.samples,file});
  };
  if(start) save();
  while(state.samples<end) {
    accumulate(scene,tracer,state,Math.min(batch,end-state.samples));
    Assets.write(path.join(root,'accumulation.bin'),Film.checkpoint(state,scene));
    save();
  }
  if(!samples && prior!==path.join(root,'accumulation.bin'))
    Assets.write(path.join(root,'accumulation.bin'),Film.checkpoint(state,scene));

  const guide=auxiliaries(scene), raw=Film.resolve(state);
  const clean=denoise==='off'?null:Film.denoise(raw,guide,width,height,denoise);
  beauty('raw.png',raw.rgb);
  if(clean) beauty('denoised.png',clean);
  png('variance.png',Film.noise(raw.variance,exposure));
  for(const [name,rgb] of Object.entries(Film.diagnostics(guide))) png(name+'.png',rgb);
  Assets.write(path.join(root,'raw.exr'),exr(width,height,raw.rgb));
  const report={format,version:1,label:scene.label,settings:scene.options,camera:scene.lens.config,
    startSamples:start,totalSamples:end,signature:scene.signature,triangles:scene.triangles.length,
    stats:tracer.stats,progress,files:{raw:'raw.png',...(denoise!=='off'&&{denoised:'denoised.png'}),
      variance:'variance.png',albedo:'albedo.png',normals:'normals.png',depth:'depth.png',linear:'raw.exr',accumulation:'accumulation.bin'}};
  const openPbr = Object.fromEntries([...scene.materials].flatMap(([name, material]) =>
    material.openPbr ? [[name, material.openPbr]] : []));
  if (managed) {
    const presentation=managed.output(source(clean??raw.rgb),{exposure});
    const work=managed.workingImage(source(raw.rgb));
    Assets.write(path.join(root,'display.png'),ColorFiles.display(presentation.display,presentation.report.display.encoding));
    Assets.write(path.join(root,'working.exr'),ColorFiles.exr(work,managed.description));
    Object.assign(report.files,{display:'display.png',working:'working.exr'});
    report.colorManagement={...managed.description,presentation:presentation.report};
  }
  if (Object.keys(openPbr).length) report.openPbr = { whiteNits, metersPerUnit: scene.metersPerUnit, materials: openPbr };
  Assets.json(path.join(root,'report.json'),report);
  const template=fs.readFileSync(path.join(__dirname,'physical-reference.html'),'utf8');
  Assets.write(path.join(root,'index.html'),template.replace('/*PHYSICAL_REFERENCE*/',()=>JSON.stringify(report).replaceAll('<','\\u003c')));
  return { file:path.join(root,'index.html'),...report };
}
module.exports = { writePhysicalReference };
