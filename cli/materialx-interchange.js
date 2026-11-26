const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const Assets = require('./asset-files.js');
const Signals = require('./materialx-signals.js');
const Color = require('./color-management.js');
const MaterialGraph = require('./material-graph.js');
const { readGraphProject } = require('./graph-project.js');
const Textures = require('./texture-files.js');
const C = require('./texture-common.js');

const format='ink-studio/materialx-interchange', shader='open_pbr_surface';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const references={
  legacy:'https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/technical-issues/mdl-graph-iray-eol',
  designer:'https://experienceleague.adobe.com/en/docs/substance-3d-designer/using/release-notes/version-16-0',
  materialx:'https://materialx.org/Specification.html',
  openpbr:'https://academysoftwarefoundation.github.io/OpenPBR/#parameterreference'
};
const dropped=new Set(['dropped','approximated']);
const name=value=>typeof value==='string'&&value.trim()&&value.length<=4096&&!value.includes('\0');
const slug=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,68)||'surface';
const entryId=value=>/^[a-z]/.test(value)?value:'surface-'+value;
const link=(node,port='value')=>({node,port});

const standard={
  base:'base_weight',base_color:'base_color',diffuse_roughness:'base_diffuse_roughness',metalness:'base_metalness',
  specular:'specular_weight',specular_color:'specular_color',specular_roughness:'specular_roughness',
  specular_IOR:'specular_ior',specular_anisotropy:'specular_roughness_anisotropy',
  transmission:'transmission_weight',transmission_color:'transmission_color',
  subsurface:'subsurface_weight',subsurface_color:'subsurface_color',subsurface_anisotropy:'subsurface_scatter_anisotropy',
  sheen:'fuzz_weight',sheen_color:'fuzz_color',sheen_roughness:'fuzz_roughness',
  coat:'coat_weight',coat_color:'coat_color',coat_roughness:'coat_roughness',coat_anisotropy:'coat_roughness_anisotropy',
  coat_IOR:'coat_ior',coat_normal:'geometry_coat_normal',
  emission:'emission_luminance',emission_color:'emission_color',opacity:'geometry_opacity',thin_walled:'geometry_thin_walled',
  normal:'geometry_normal',tangent:'geometry_tangent'
};

function bridge(python,operation,input,output) {
  const executable=python??process.env.INK_SCENE_PYTHON??'python3';
  if(!name(executable)) throw new TypeError('Choose a Python interpreter with MaterialX 1.39');
  const command=spawnSync(executable,['-B',path.join(__dirname,'materialx_bridge.py'),operation,input,...(output?[output]:[])],
    {encoding:'utf8',maxBuffer:24*1024**2,timeout:120000,windowsHide:true});
  if(command.error||command.status!==0) {
    const message=command.error?.message??command.stderr.trim().slice(-2400);
    const hint=message.includes('ModuleNotFoundError')?'Install MaterialX 1.39 for the chosen interpreter. ':'';
    throw new Error('MaterialX '+operation+' failed. '+hint+message);
  }
  return JSON.parse(command.stdout);
}

function dependencyRows(inputs,base) {
  return [...inputs].sort().map(file=>({file:path.relative(base,file).split(path.sep).join('/'),sha256:hash(fs.readFileSync(file))}));
}

function summary(entries) {
  return Object.fromEntries(['preserved','converted','baked','dropped','approximated'].map(status=>
    [status,entries.filter(row=>row.status===status).length]));
}

function working(input,{python,material,colorSettings,toolkit=require('../index.js').load()}={}) {
  const file=fs.realpathSync(input), base=path.dirname(file), P=toolkit.KIT.procedural;
  const {version,valid,validation,materials,other}=bridge(python,'read',file);
  const inputs=new Set([file]), entries=[], rows=[];
  function note(status,path,reason,fields={}) { entries.push({status,path,reason,...fields}); }
  let managed;
  if(colorSettings!==undefined) {
    const config=path.resolve(colorSettings);
    inputs.add(config);
    managed=Color.configure(JSON.parse(fs.readFileSync(config,'utf8')),{baseDir:path.dirname(config),onFile:file=>inputs.add(file)});
  }
  const evaluate=Signals.evaluator({inputs,managed});
  for(const {path,reason} of other) note('dropped',path,reason);
  const selected=material===undefined?materials:materials.filter(row=>row.path===material||row.name===material);
  if(valid&&material!==undefined&&selected.length!==1)
    throw new RangeError('Choose an unambiguous MaterialX material name or element path');
  const ids=new Set();
  for(const source of selected) {
    const material=source.path, prefix=entryId(slug(material));
    let id=prefix, suffix=2;
    while(ids.has(id)) id=prefix+'-'+suffix++;
    ids.add(id);
    for(const slot of source.unsupportedSlots) note('dropped',material+'/'+slot,'Ink material graphs need a surface shader binding',{material});
    for(const attr of source.attributes) note('dropped',material+'/@'+attr,'Material-level metadata has no OpenPBR binding',{material});
    if(!source.inputs) {
      note('dropped',material,'Unsupported surface shader '+(source.category??'(unbound)'),{material});
      continue;
    }
    const converts=source.category==='standard_surface', constants={}, maps={};
    if(converts) note('approximated',source.shader,'Standard Surface lobes are translated into OpenPBR. Layering and transport can differ',
      {material});
    for(const [key,input] of Object.entries(source.inputs)) {
      const field=converts?standard[key]:Object.hasOwn(P.openPbr.inputs,key)?key:undefined;
      const where=input.signal?.path??input.path??source.shader+'/'+key;
      if(!field) {
        if(input.authored&&(!input.signal||input.signal.kind!=='constant'||input.signal.value!==0)) {
          const reason=converts&&['subsurface_radius','subsurface_scale','transmission_depth'].includes(key)?
            'Standard Surface scene lengths need a known scale to become OpenPBR centimeters':
            'No supported OpenPBR mapping for '+key;
          note('dropped',where,reason,{material,input:key});
        }
        continue;
      }
      if(input.error) { note('dropped',where,input.error,{material,input:field}); continue; }
      if(!input.signal||input.signal.value===null) continue;
      const info={material,input:field,sourceInput:key};
      try {
        const result=Signals.normalizeInput(P,field,input.signal,evaluate(input.signal),
          {gain:converts&&key==='emission'?100:1,monochrome:converts&&key==='opacity'});
        if(result.image) {
          maps[field]=result.image;
          note(input.signal.kind==='image'?'converted':'baked',where,input.signal.kind==='image'?
            'Saved the typed sample grid as a linked float texture':'Evaluated the supported texture chain on its native grid',
            {...info,texture:result.source,sourceColorSpace:result.sourceColorSpace,units:result.units,
              extent:[result.image.raster.width,result.image.raster.height]});
        } else {
          constants[field]=result.value;
          if(input.authored||converts&&!isDeepStrictEqual(P.openPbr.inputs[field].default,result.value))
            note(result.scaled||converts?'converted':'preserved',where,converts&&key==='emission'?
              'Used the 100-nit reference white for Standard Surface emission gain':result.scaled?
              'Converted the authored quantity to the OpenPBR parameter unit':
              converts?'Mapped the Standard Surface input':'Preserved the authored uniform value',
              {...info,value:result.value,units:result.units});
        }
      } catch(error) {
        if(!(error instanceof Signals.UnsupportedSignal||error instanceof RangeError||error instanceof TypeError)) throw error;
        note('dropped',where,error.message+'; using the OpenPBR default',{...info});
      }
    }
    const packet=P.openPbr.define(constants,maps);
    rows.push({id,label:source.name,material,packet,authored:constants,maps,category:source.category,
      definition:source.definition,definitionVersion:source.definitionVersion});
  }
  const report={format,version:1,operation:'inspect',source:path.basename(file),library:{name:'MaterialX',version,valid,messages:validation},
    materials:rows.map(({id,label,material,category,definition,definitionVersion,packet})=>({id,label,material,category,definition,definitionVersion,
      uniformCount:Object.keys(packet.parameters).length,mapInputs:Object.keys(packet.maps)})),
    entries,summary:summary(entries),dependencies:dependencyRows(inputs,base),...(managed&&{colorManagement:managed.description})};
  return {report,rows,inputs,P};
}

function inspectMaterialX(input,options) {
  return working(input,options).report;
}

function protect(file,inputs,bytes) {
  const current=fs.existsSync(file)?fs.realpathSync(file):file;
  if((inputs.has(file)||inputs.has(current))&&(!bytes||!fs.readFileSync(file).equals(bytes)))
    throw new RangeError('MaterialX output would overwrite an input dependency: '+path.basename(file));
}

function importMaterialX(input,{directory,strict=false,...options}={}) {
  if(!name(directory)) throw new TypeError('MaterialX import needs an output directory');
  const {report,rows,inputs,P}=working(input,options), root=path.resolve(directory);
  const reportFile=path.join(root,'materialx-report.json');
  protect(reportFile,inputs);
  const blocked=!report.library.valid||!rows.length||strict&&report.entries.some(row=>dropped.has(row.status));
  report.operation='import';
  report.status=blocked?'blocked':'written';
  report.files=[];
  if(!blocked) {
    const textures=new Map(), graphs=[];
    for(const row of rows) {
      const assets={}, nodes={}, bindings={};
      for(const [key,image] of Object.entries(row.maps)) {
        const {descriptor}=image;
        const bytes=Textures.encodeTexture(P,image,{encoding:'exr',bitDepth:32});
        const file='textures/'+hash(bytes)+'.exr', alias='map-'+key;
        textures.set(path.join(root,file),bytes);
        assets[alias]={format:'bitmap',source:{file},interpretation:{intent:descriptor.intent,units:descriptor.units,
          sampling:descriptor.sampling,tiling:descriptor.tiling,
          ...(descriptor.colorSpace!=='none'&&{colorSpace:descriptor.colorSpace}),
          ...(descriptor.normalSpace&&{normalSpace:descriptor.normalSpace}),
          ...(descriptor.normalOrientation&&{normalOrientation:descriptor.normalOrientation})}};
        nodes[alias]={op:'bitmapAsset',inputs:{name:alias}};
        bindings[key]=link(alias);
      }
      nodes.maps={op:'data.record',inputs:bindings};
      nodes.surface={op:'material.openPbr',inputs:{parameters:row.authored,maps:link('maps')}};
      const document={format:'ink-studio/graph-project',version:1,assets,nodes,
        outputs:{surface:link('surface'),inputs:link('surface','report')}};
      const graph=MaterialGraph.openMaterialGraph(document,{id:row.id});
      graph.label=row.label;
      graph.metadata={materialModel:shader};
      const member=row.id+'.material.json';
      graphs.push([path.join(root,member),graph]);
      report.files.push({id:row.id,file:member,output:'surface'});
    }
    for(const [file,bytes] of textures) protect(file,inputs,bytes);
    for(const [file] of graphs) protect(file,inputs);
    for(const [file,bytes] of textures) if(!inputs.has(file)) Assets.write(file,bytes);
    for(const [file,graph] of graphs) MaterialGraph.writeMaterialGraph(file,graph);
  }
  Assets.json(reportFile,report);
  return {...report,reportFile};
}

const channels={baseColor:'base_color',roughness:'specular_roughness',metalness:'base_metalness',
  opacity:'geometry_opacity',normal:'geometry_normal',emission:'emission_color'};
function fromPacket(P,source,entries) {
  if(source?.format===P.openPbr.format) return P.openPbr.read(source);
  if(!P.materialChannels.valid(source)) throw new TypeError('Export a material.openPbr value or a typed material channel packet');
  const parameters={}, maps={};
  for(const [key,{raster}] of Object.entries(source.channels)) {
    const field=channels[key];
    if(!field||!P.graphImages.valid(raster)) {
      entries.push({status:'dropped',input:key,path:'channels/'+key,reason:field?
        'Declare the channel as a typed image before interchange':'Channel has no standard OpenPBR input'});
      continue;
    }
    try { P.openPbr.define({}, {[field]:raster}); }
    catch(error) {
      if(!(error instanceof TypeError||error instanceof RangeError)) throw error;
      entries.push({status:'dropped',input:key,path:'channels/'+key,reason:error.message});
      continue;
    }
    maps[field]=raster;
    if(key==='emission') parameters.emission_luminance=100;
    entries.push({status:'converted',input:field,path:'channels/'+key,reason:key==='emission'?
      'Mapped the linear RGB emission channel at the 100-nit reference white':'Mapped the named Ink channel to OpenPBR'});
  }
  return P.openPbr.define(parameters,maps);
}

async function exportMaterialX(input,{out,output,python,strict=false,toolkit=require('../index.js').load()}={}) {
  if(!name(out)||path.extname(out).toLowerCase()!=='.mtlx') throw new TypeError('MaterialX export needs an .mtlx destination file');
  const source=path.resolve(input), destination=path.resolve(out), root=path.dirname(destination),
    reportFile=destination+'.report.json';
  const P=toolkit.KIT.procedural, project=readGraphProject(source,{kit:toolkit});
  const plan=project.plan(), outputs=Object.keys(plan.outputs);
  if(output===undefined&&outputs.length===1) output=outputs[0];
  if(!outputs.includes(output)) throw new RangeError('Choose a published material graph output');
  const rendered=await project.previewFrame({selected:{output}},{},{encodeArtifacts:false});
  if(!rendered.report.passed) throw new RangeError('Material graph assertions failed before interchange');
  const entries=[], packet=fromPacket(P,rendered.values.selected,entries), inputs=new Set(project.sourceFiles());
  protect(destination,inputs);
  protect(reportFile,inputs);
  const basename=path.basename(source).replace(/(?:\.material)?\.json$/i,'');
  const document=JSON.parse(fs.readFileSync(source,'utf8'));
  const authored=document.format===MaterialGraph.format?document:null;
  const id=entryId(slug(authored?.id??basename));
  const exported={id,label:authored?.label??basename,uniforms:{},maps:{}};
  const storage=new Map();
  for(const [key,v] of Object.entries(packet.parameters)) {
    const {type,units}=P.openPbr.inputs[key];
    if(v!==null) exported.uniforms[key]={type,value:v};
    if(Object.hasOwn(packet.maps,key)) {
      try {
        const {bytes,conversions,precisionLoss,width,height,...texture}=Signals.writeMap(P,key,packet.maps[key]);
        const file='textures/'+hash(bytes)+'.exr';
        storage.set(file,bytes);
        exported.maps[key]={file,...texture};
        entries.push({status:conversions.length||packet.maps[key].descriptor.precision!=='float32'?'converted':'preserved',
          input:key,path:'maps/'+key,reason:conversions.join(', ')||'Preserved the evaluated texture on its original grid',
          file,units,extent:[width,height],maxFloatPackingError:precisionLoss});
      } catch(error) {
        if(!(error instanceof Signals.UnsupportedSignal||error instanceof TypeError||error instanceof RangeError)) throw error;
        entries.push({status:'dropped',input:key,path:'maps/'+key,reason:error.message+'; exporting the uniform fallback'});
      }
    } else if(v!==null) entries.push({status:'preserved',input:key,path:'parameters/'+key,
      reason:'Wrote a standard OpenPBR uniform',value:v,units});
  }
  entries.push({status:'baked',path:output,reason:'Published the evaluated material. Ink node history and presets stay in the source graph'});
  const report={format,version:1,operation:'export',source:path.basename(source),output,
    dependencies:dependencyRows(inputs,path.dirname(source)),entries,summary:summary(entries)};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-materialx-'));
  try {
    const staging=path.join(dir,path.basename(destination)), sheet=path.join(dir,'material.json');
    for(const [file,bytes] of storage) {
      protect(path.join(root,file),inputs,bytes);
      Assets.write(path.join(dir,file),bytes);
    }
    Assets.json(sheet,exported);
    const verified=bridge(python,'write',sheet,staging);
    report.library={name:'MaterialX',version:verified.version,valid:verified.valid,messages:verified.validation};
    if(!verified.valid) {
      entries.push({status:'dropped',path:output,reason:'MaterialX validation rejected the staged surface'});
      report.summary=summary(entries);
      report.status='blocked';
      report.files=[];
      Assets.json(reportFile,report);
      return {...report,reportFile};
    }
    const reopened=working(staging,{python,toolkit});
    const row=reopened.rows[0];
    const fields=Object.keys(exported.uniforms).filter(key=>!exported.maps[key]);
    const mapChecks=Object.entries(exported.maps).map(([key,expected])=>{
      const actual=row?.maps[key]&&Signals.writeMap(P,key,row.maps[key]);
      const binding=Boolean(actual&&['type','normal','u','v','filter'].every(field=>actual[field]===expected[field]));
      return {input:key,binding,sameTexture:Boolean(actual?.bytes.equals(storage.get(expected.file)))};
    });
    function near(a,b) {
      if(typeof a==='number'&&typeof b==='number') return Math.abs(a-b)<=2e-6*Math.max(1,Math.abs(a),Math.abs(b));
      if(Array.isArray(a)&&Array.isArray(b)) return a.length===b.length&&a.every((n,i)=>near(n,b[i]));
      return a===b;
    }
    const uniforms=fields.map(key=>({input:key,equal:near(exported.uniforms[key].value,row?.packet.parameters[key])}));
    const verifiedRoundTrip=!!row&&reopened.report.library.valid&&uniforms.every(row=>row.equal)&&
      mapChecks.every(row=>row.binding&&row.sameTexture)&&!reopened.report.entries.some(row=>dropped.has(row.status));
    report.roundTrip={passed:verifiedRoundTrip,definitionVersion:row?.definitionVersion,uniforms,maps:mapChecks};
    if(!verifiedRoundTrip) entries.push({status:'dropped',path:output,reason:'The independently reopened MaterialX output did not reproduce its staged inputs'});
    report.summary=summary(entries);
    const blocked=!verified.valid||!verifiedRoundTrip||strict&&entries.some(row=>dropped.has(row.status));
    report.status=blocked?'blocked':'written';
    report.files=blocked?[]:[path.basename(destination),...storage.keys()];
    if(!blocked) {
      for(const [file,bytes] of storage) if(!inputs.has(path.join(root,file))) Assets.write(path.join(root,file),bytes);
      Assets.write(destination,fs.readFileSync(staging));
    }
    Assets.json(reportFile,report);
    return {...report,reportFile,...(!blocked&&{file:destination})};
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

function materialMigration(input) {
  const file=path.resolve(input), extension=path.extname(file).toLowerCase();
  if(!['.mdl','.mi','.iray'].includes(extension))
    throw new TypeError('Choose a legacy MDL or Iray reference file (.mdl, .mi or .iray)');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>C.maxBytes) throw new RangeError('Invalid legacy material reference size');
  return {format,version:1,operation:'migration',source:path.basename(file),sha256:hash(fs.readFileSync(file)),
    engine:extension==='.mdl'?'MDL':'Iray',status:'reference',
    actions:[
      'Preserve the original material, color settings and approved reference renders.',
      'Bake stable UV maps with a known color interpretation and record units for height, transmission and relief.',
      'Rebuild the supported surface parameters in OpenPBR and compare under matched cameras and lights.',
      'Retain renderer-specific lighting, volumetric effects and procedural graphs as migration evidence.'
    ],references};
}

module.exports={inspectMaterialX,importMaterialX,exportMaterialX,materialMigration};
