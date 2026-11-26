const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { save, graphOutputs } = require('./graph-outputs.js');
const { readGraphProject } = require('./graph-project.js');
const { openMaterialGraph, readMaterialGraph, writeMaterialGraph } = require('./material-graph.js');
const { describeMaterialBitmap, editMaterialBitmap } = require('./material-bitmaps.js');
const { describeMaterialVector, editMaterialVector } = require('./material-vectors.js');
const { describeMaterialFont, editMaterialFont } = require('./material-fonts.js');
const { describeMaterialMetadata } = require('./material-metadata.js');
const { inspectMaterialVisibility } = require('./material-visibility.js');
const { editMaterialParameters, inspectMaterialParameters } = require('./material-parameters.js');
const { editMaterialPresets, inspectMaterialPresets, exportMaterialPresets } = require('./material-presets.js');
const MaterialPresets = require('../src/material-presets.js');
const { publishJson } = require('./asset-files.js');
const { searchMaterialLibrary, publishMaterialLibrary } = require('./material-library.js');
const { describeMaterialSubgraph, editMaterialSubgraph, publishMaterialSubgraph } = require('./material-subgraphs.js');
const { findGraphGroupUsers } = require('./graph-groups.js');
const { snapshotFormat, diffGraphs } = require('./graph-diff.js');
const { openGraphArtifactCache, engineFingerprint, fingerprint } = require('./graph-artifact-cache.js');
const { runBatch } = require('./graph-batch.js');
const { createGraphWorkers } = require('./graph-workers.js');
const host = require('./graph-host-command.js');
const catalog = require('./graph-catalog.js');

const cacheFlags=['cache','cache-bytes','cache-entries'];
const executionFlags=['workers',...cacheFlags];
const flags = {
  validate:['inputs','json'], plan:['inputs','json','memory'], dependencies:['json'], snapshot:['inputs','at','seed','json'],
  inspect:['inputs','at','seed','out','output','node','port','map','component','json',...executionFlags],
  'material-preview':['inputs','at','seed','out','json'],
  'displacement-preview':['inputs','at','seed','out','json'],
  run:['inputs','at','seed','out','json',...executionFlags],
  batch:['inputs','at','seed','out','json','resume','progress',...executionFlags],
  session:['protocol','out','workers'],
  clip:['inputs','seed','out','output','from','to','fps','warmup','cuts','clock','format','render-options','capture-options','json',...executionFlags]
};
for (const options of Object.values(flags)) options.push('instance','base-context');
const discoveryFlags = { nodes: ['json'], describe: ['json', 'example'] };
const analysisFlags = { impact: ['root', 'json'], diff: ['adapters', 'json'], material: ['id', 'out', 'base', 'output-usages', 'metadata'],
  subgraph: ['out', 'adapters'], 'publish-subgraph': ['out', 'revision', 'adapters'],
  'material-presets': ['out', 'instance', 'export', 'presets'],
  'material-parameters': ['out', 'instance', 'inputs', 'adapters'], 'material-bitmap': ['out'], 'material-vector': ['out'], 'material-font': ['out'],
  'texture-info': ['page', 'channels'],
  'material-visibility': ['inputs', 'instance', 'scope'], 'material-info': ['audience'], 'material-library': ['audience', 'query', 'tag', 'offset', 'limit', 'out'] };
const commandOptions = { ...flags, ...discoveryFlags, ...analysisFlags, ...host.commands };

async function sendText(text) {
  if (!process.stdout.write(text+'\n')) await once(process.stdout,'drain');
}

function send(value, compact=false) {
  return sendText(JSON.stringify(value,null,compact ? undefined : 2));
}

async function session(project, directory, inputs) {
  const reader=createInterface({input:process.stdin,terminal:false,crlfDelay:Infinity});
  let sequence=0;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      let request;
      sequence++;
      try {
        request=JSON.parse(line);
        if (!request || Object.getPrototypeOf(request)!==Object.prototype) throw new TypeError('Expected an NDJSON request object');
        const {id,op,...options}=request;
        if (id!==undefined && typeof id!=='string' && !Number.isSafeInteger(id))
          throw new TypeError('Session ID must be a string or integer');
        const empty=()=>{ if (Object.keys(options).length) throw new TypeError('Unexpected options for '+op); };
        if (op==='quit' || op==='clear' || op==='plan') {
          empty();
          if (op==='clear') project.clear();
          await send({id,code:0,...(op==='plan' && {report:project.plan()})},true);
          if (op==='quit') break;
          continue;
        }
        let result;
        if (op==='inspect') {
          const {output,node,port,map,component,...settings}=options;
          result=project.inspect({output,node,port,map,component},settings);
        } else if (op==='run') result=project.run(options);
        else throw new TypeError('Unknown graph session operation '+op);
        const folder=directory && 'request-'+sequence;
        if (folder) save(path.join(directory,folder),result,inputs);
        await send({id,code:result.report.passed===false ? 2 : 0,report:result.report,...(folder && {folder})},true);
      } catch (error) {
        const id=request?.id;
        await send({...(typeof id==='string' || Number.isSafeInteger(id) ? {id} : {}),code:1,error:error.message},true);
      }
    }
  } finally {
    reader.close();
    process.stdin.pause();
    project.clear();
  }
}

function clipOptions(opt, sources, defaultClock) {
  if (!opt.out) throw new TypeError('Graph clip needs --out directory');
  const read = key => {
    if (opt[key] === undefined) return undefined;
    const file = path.resolve(opt[key]);
    sources.push(file);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const document = read('clock');
  const settings = document?.format === 'ink-studio/take' && document.version === 1 ? document.clock ?? {} : document ?? defaultClock ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Graph clip clock needs a settings object');
  const clock = { ...settings };
  if (opt.fps !== undefined) {
    const parts = /^(\d+)\/(\d+)$/.exec(opt.fps.trim());
    clock.fps = parts ? { numerator: Number(parts[1]), denominator: Number(parts[2]) } : Number(opt.fps);
  }
  if (opt.cuts !== undefined) {
    const cuts = opt.cuts.split(',').map(item => {
      if (!/^\d+$/.test(item.trim())) throw new TypeError('Graph clip cuts need comma-separated integer frame indices');
      const frame = Number(item);
      return { frame, id: 'cut-' + frame };
    });
    if (clock.cuts !== undefined && !Array.isArray(clock.cuts)) throw new TypeError('Graph clip clock cuts must be an array');
    clock.cuts = [...(clock.cuts ?? []), ...cuts];
  }
  return { output: opt.output, from: opt.from === undefined ? undefined : Number(opt.from),
    to: opt.to === undefined ? undefined : Number(opt.to), warmup: opt.warmup === undefined ? undefined : Number(opt.warmup),
    format: opt.format, clock, renderOptions: read('render-options'), capture: read('capture-options') };
}

async function graphCommand(pos,opt,settings) {
  const [mode,file,caseFile]=pos;
  if (mode==='texture-info') {
    if (pos.length!==2 || Object.entries(opt).some(([key,value])=>
      !analysisFlags['texture-info'].includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph texture-info <texture> [--page N | --channels R,G,B,A]');
    return send(require('./texture-files.js').reportTexture(path.resolve(file),{
      ...(opt.page!==undefined&&{page:Number(opt.page)}),
      ...(opt.channels!==undefined&&{channels:opt.channels.split(',').map(name=>name.trim())})
    }));
  }
  if (Object.hasOwn(discoveryFlags, mode)) {
    const listing=mode==='nodes';
    if (pos.length!==(listing ? 1 : 2) || opt.json && opt.example ||
        Object.entries(opt).some(([key,value])=>value!==true || !discoveryFlags[mode].includes(key)))
      throw new TypeError('Use graph nodes [--json] or graph describe <op> [--json | --example]');
    const result=listing ? catalog.listGraphNodes(settings) : catalog.describeGraphNode(file,settings);
    if (opt.json) return send(result);
    if (opt.example) {
      if (!result.example) throw new RangeError('No catalog example supplied for '+file);
      return sendText(catalog.exampleText(result.example));
    }
    return sendText(listing ? catalog.listText(result) : catalog.nodeText(result));
  }
  if (mode==='material') {
    if (pos.length!==2 || Object.entries(opt).some(([key,value])=>
      !analysisFlags.material.includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph material <project-or-material.json> [--id ID] [--base settings.json] [--output-usages maps.json] [--metadata metadata.json] [--out material.json]');
    let document=readMaterialGraph(file,{id:opt.id});
    for (const [flag,key] of [['base','base'],['output-usages','outputUsages'],['metadata','metadata']]) {
      if (opt[flag]===undefined) continue;
      if (opt.out!==undefined && path.resolve(opt[flag])===path.resolve(opt.out))
        throw new TypeError('Choose a material output separate from the '+flag+' settings file');
      const value=JSON.parse(fs.readFileSync(path.resolve(opt[flag]),'utf8'));
      document=openMaterialGraph(key==='metadata' ? {...document,metadata:value} :
        {...document,settings:{...document.settings,[key]:value}});
    }
    if (opt.out===undefined) return send(document);
    const result=writeMaterialGraph(opt.out,document,{baseDir:path.dirname(path.resolve(file))});
    return send({file:path.resolve(opt.out),format:result.format,version:result.version,id:result.id});
  }
  if (mode==='material-presets') {
    const exporting=opt.export!==undefined;
    if (![2,3].includes(pos.length) || Object.entries(opt).some(([key,value])=>
      !analysisFlags[mode].includes(key) || typeof value!=='string' || !value.trim()) ||
      caseFile && (opt.instance!==undefined || exporting) ||
      !caseFile && opt.out!==undefined || !exporting && opt.presets!==undefined ||
      exporting && opt.instance!==undefined)
      throw new TypeError('Use graph material-presets <material.json> [--instance ID], <material.json> <request-or-package.json> [--out material.json], or <material.json> --export presets.json [--presets ID,ID]');
    const sourceFile=path.resolve(file), document=readMaterialGraph(sourceFile), options={kit:settings.kit};
    if (exporting) {
      const ids=opt.presets?.split(',').map(id=>id.trim());
      const bundle=exportMaterialPresets(document,{...options,ids}), target=path.resolve(opt.export);
      publishJson(target,bundle,'Choose a separate destination for the preset package');
      return send({file:target,...bundle});
    }
    if (!caseFile) return send(inspectMaterialPresets(document,{...options,instance:opt.instance}));
    const requestFile=path.resolve(caseFile);
    if (opt.out && path.resolve(opt.out)===requestFile)
      throw new TypeError('Choose a material output separate from the preset request or package');
    const input=JSON.parse(fs.readFileSync(requestFile,'utf8'));
    const request=input?.format===MaterialPresets.format ? {kind:'import',bundle:input} : input;
    const result=editMaterialPresets(document,request,options);
    if (!opt.out) return send(result);
    const saved=writeMaterialGraph(opt.out,result.document,{baseDir:path.dirname(sourceFile)});
    return send({file:path.resolve(opt.out),id:saved.id,inspector:result.inspector});
  }
  if (mode==='material-parameters') {
    if (![2,3].includes(pos.length) || Object.entries(opt).some(([key,value])=>
      !analysisFlags[mode].includes(key) || typeof value!=='string' || !value.trim()) ||
      caseFile && (opt.instance!==undefined || opt.inputs!==undefined) ||
      !caseFile && (opt.out!==undefined || opt.adapters!==undefined))
      throw new TypeError('Use graph material-parameters <material.json> [--instance ID] [--inputs values.json] or <material.json> <request.json> [--out material.json]');
    const sourceFile=path.resolve(file), baseDir=path.dirname(sourceFile), document=readMaterialGraph(sourceFile);
    if (!caseFile) {
      const inputs=opt.inputs===undefined ? undefined : JSON.parse(fs.readFileSync(path.resolve(opt.inputs),'utf8'));
      return send(inspectMaterialParameters(document,{kit:settings.kit,instance:opt.instance,inputs}));
    }
    const requestFile=path.resolve(caseFile);
    if (opt.out && path.resolve(opt.out)===requestFile)
      throw new TypeError('Choose a material output separate from the parameter request');
    settings=await host.adapters(opt.adapters,settings);
    const result=editMaterialParameters(document,JSON.parse(fs.readFileSync(requestFile,'utf8')),
      {...settings,baseDir,sourceFile});
    if (!opt.out) return send(result);
    const saved=writeMaterialGraph(opt.out,result.document,{baseDir});
    return send({file:path.resolve(opt.out),id:saved.id,inspector:result.inspector});
  }
  const resourceCommands = {
    'material-bitmap': ['bitmap', describeMaterialBitmap, editMaterialBitmap],
    'material-vector': ['vector', describeMaterialVector, editMaterialVector],
    'material-font': ['font', describeMaterialFont, editMaterialFont]
  };
  if (Object.hasOwn(resourceCommands, mode)) {
    const [kind, describe, edit] = resourceCommands[mode];
    if (pos.length !== 3 || Object.entries(opt).some(([key, value]) =>
      key !== 'out' || typeof value !== 'string' || !value.trim()))
      throw new TypeError('Use graph '+mode+' <material.json> <id|request.json> [--out material.json]');
    const sourceFile = path.resolve(file), baseDir = path.dirname(sourceFile);
    const document = readMaterialGraph(sourceFile);
    if (!caseFile.toLowerCase().endsWith('.json') || Object.hasOwn(document.resources ?? {}, caseFile)) {
      if (opt.out !== undefined) throw new TypeError('A '+kind+' inspection does not take --out');
      return send(describe(document, caseFile, { baseDir }));
    }
    const requestFile = path.resolve(caseFile);
    if (opt.out && path.resolve(opt.out) === requestFile)
      throw new TypeError('Choose a material output separate from the '+kind+' edit request');
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    const result = edit(document, request, { ...settings, baseDir });
    if (!opt.out) return send(result);
    writeMaterialGraph(opt.out, result.document, { baseDir });
    return send({ file: path.resolve(opt.out), id: result.document.id, [kind]: result[kind] });
  }
  if (mode==='material-visibility') {
    if (pos.length!==2 || Object.entries(opt).some(([key,value])=>
      !analysisFlags[mode].includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph material-visibility <material.json> [--inputs values.json] [--instance ID] [--scope GROUP/PATH]');
    const inputs=opt.inputs===undefined ? undefined : JSON.parse(fs.readFileSync(path.resolve(opt.inputs),'utf8'));
    return send(inspectMaterialVisibility(readMaterialGraph(file),{kit:settings.kit,inputs,
      instance:opt.instance,scope:opt.scope?.split('/')}));
  }
  if (mode==='material-info' || mode==='material-library') {
    const missingMaterial=mode==='material-info'&&pos.length!==2;
    if (missingMaterial||pos.length>2 || Object.entries(opt).some(([key,value])=>
      !analysisFlags[mode].includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph material-info <material.json> [--audience workspace|publication] or graph material-library [registry.json] [--audience NAME] [--query TEXT] [--tag TAG] [--out directory]');
    if (mode==='material-info') return send(describeMaterialMetadata(file,{audience:opt.audience}));
    const {audience,query,tag,out}=opt;
    const options={kit:settings.kit,audience,query,tag,
      offset:opt.offset===undefined ? undefined : Number(opt.offset), limit:opt.limit===undefined ? undefined : Number(opt.limit)};
    return send(out===undefined ? searchMaterialLibrary(file,options) : publishMaterialLibrary(file,{...options,out}));
  }
  if (mode==='subgraph' || mode==='publish-subgraph') {
    const publish=mode==='publish-subgraph';
    if (pos.length!==(publish ? 2 : 3) || publish && !opt.out || Object.entries(opt).some(([key,value])=>
      !analysisFlags[mode].includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph subgraph <material.json> <request.json> [--out material.json] or graph publish-subgraph <material.json> --out group.json [--revision N]');
    settings=await host.adapters(opt.adapters,settings);
    const sourceFile=path.resolve(file), baseDir=path.dirname(sourceFile);
    const document=readMaterialGraph(sourceFile), options={...settings,baseDir,sourceFile};
    if (publish) return send(publishMaterialSubgraph(opt.out,document,
      {...options,revision:opt.revision===undefined ? undefined : Number(opt.revision)}));
    const requestFile=path.resolve(caseFile), request=JSON.parse(fs.readFileSync(requestFile,'utf8'));
    if (request?.kind==='inspect') {
      if (opt.out) throw new TypeError('A subgraph inspection does not take --out');
      const { kind, ...target }=request;
      return send(describeMaterialSubgraph(document,target,options));
    }
    if (opt.out && path.resolve(opt.out)===requestFile)
      throw new TypeError('Choose a material output separate from the subgraph request');
    const edited=editMaterialSubgraph(document,request,options);
    if (!opt.out) return send(edited);
    const saved=writeMaterialGraph(opt.out,edited.document,{baseDir});
    const materialFile=path.resolve(opt.out);
    const source=edited.subgraph.source;
    if (source.file===sourceFile && source.kind==='inline') source.file=materialFile;
    return send({file:materialFile,id:saved.id,subgraph:edited.subgraph});
  }
  if (mode==='impact') {
    if (pos.length!==2 || Object.entries(opt).some(([key,value])=>
      key==='json' ? value!==true : !analysisFlags.impact.includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph impact <group.json> [--root directory] [--json]');
    return send(findGraphGroupUsers(file,{root:opt.root}),opt.json);
  }
  if (mode==='diff') {
    if (pos.length!==3 || Object.entries(opt).some(([key,value])=>
      key==='json' ? value!==true : !analysisFlags.diff.includes(key) || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph diff <before.json> <after.json> [--json]');
    settings=await host.adapters(opt.adapters,settings);
    const read = source => {
      const document=JSON.parse(fs.readFileSync(source,'utf8'));
      return document?.format===snapshotFormat ? document : readGraphProject(source,settings);
    };
    return send(diffGraphs(read(file),read(caseFile)),opt.json);
  }
  if (Object.hasOwn(host.commands,mode)) {
    const result=await host.execute(pos,opt,settings);
    if (result.passed===false) process.exitCode=2;
    return send(result,opt.json);
  }
  if (!Object.hasOwn(flags,mode) || pos.length!==(['batch','material-preview','displacement-preview'].includes(mode)?3:2) ||
      Object.entries(opt).some(([key,value])=>key!=='adapters' && !flags[mode].includes(key) ||
        (['json','resume','memory'].includes(key) ? value!==true : key==='progress' ? value!=='ndjson' :
          typeof value!=='string' || !value.trim())) ||
      opt.port!==undefined && opt.node===undefined || opt.component!==undefined && opt.map===undefined || opt.protocol!==undefined && opt.protocol!=='ndjson')
    throw new TypeError('Use graph validate|plan|dependencies|snapshot|inspect|material-preview|displacement-preview|run|batch|session|clip <project.json> [cases-or-sweep.json]. See ink-studio help');
  if (opt.cache===undefined && cacheFlags.slice(1).some(flag=>opt[flag]!==undefined))
    throw new TypeError('Graph cache limits need --cache directory');
  if (opt.resume && opt.out===undefined) throw new TypeError('Graph batch --resume needs --out directory');
  settings=await host.adapters(opt.adapters,settings);
  const workerPool=opt.workers===undefined ? undefined : createGraphWorkers(Number(opt.workers), {kit:settings.kit});
  try { return await projectCommand(mode,file,caseFile,opt,{...settings,workerPool}); }
  finally { workerPool?.close(); }
}

async function projectCommand(mode,file,caseFile,opt,settings) {
  const contextFile=opt['base-context']===undefined ? undefined : path.resolve(opt['base-context']);
  const baseContext=contextFile===undefined ? undefined : JSON.parse(fs.readFileSync(contextFile,'utf8'));
  const project=readGraphProject(file,{...settings,planAssets:opt.memory===true,instance:opt.instance,baseContext});
  const sources=project.sourceFiles();
  if (contextFile) sources.push(contextFile);
  if (settings.adapterFile) sources.push(settings.adapterFile);
  let inputs, result;
  if (opt.inputs!==undefined) {
    const file=path.resolve(opt.inputs);
    inputs=JSON.parse(fs.readFileSync(file,'utf8'));
    sources.push(file);
  }
  const run={...(opt.inputs!==undefined && {inputs}),...(opt.at!==undefined && {time:Number(opt.at)}),
    ...(opt.seed!==undefined && {seed:Number(opt.seed)})};
  const output=opt.out===undefined ? undefined : path.resolve(opt.out);
  if (mode==='validate') return send(project.validate(inputs),opt.json);
  if (mode==='plan') return send(project.plan(inputs,{memory:opt.memory===true}),opt.json);
  if (mode==='dependencies') return send(project.dependencies(),opt.json);
  if (mode==='snapshot') return send(project.snapshot(run),opt.json);
  if (mode==='session') return session(project,output,sources);
  if (mode==='material-preview') {
    const result=await require('./linked-material-preview.js').writeLinkedMaterialPreview(project,caseFile,
      {directory:output,toolkit:settings.kit,run,sources});
    return send(result,opt.json);
  }
  if (mode==='displacement-preview') {
    const result=await require('./material-displacement-preview.js').writeDisplacementPreview(project,caseFile,
      {directory:output,toolkit:settings.kit,run,sources});
    return send(result,opt.json);
  }
  const artifactCache=opt.cache===undefined ? undefined : openGraphArtifactCache(opt.cache,{
    kit:settings.kit, maxBytes:opt['cache-bytes']===undefined ? undefined : Number(opt['cache-bytes']),
    maxEntries:opt['cache-entries']===undefined ? undefined : Number(opt['cache-entries'])
  });
  const cache=artifactCache && ((kind,identity,request,...rest)=>artifactCache(kind,identity,
    settings.workerPool ? {request,workers:Number(opt.workers)} : request,...rest));
  const execute=(settings,work)=>cache ? cache(mode,project.artifactIdentity(),settings,work) : work();
  if (mode==='clip') {
    const options={...run,...clipOptions(opt,sources,project.takeClock)};
    result=execute(options,()=>project.clip(options));
  } else if (mode==='inspect') {
    const target={output:opt.output,node:opt.node,port:opt.port,map:opt.map,component:opt.component};
    result=execute([target,run],()=>project.inspect(target,run));
  } else if (mode==='batch') {
    const cases=path.resolve(caseFile);
    sources.push(cases);
    const definition=JSON.parse(fs.readFileSync(cases,'utf8'));
    if (opt.resume || opt.progress) {
      const config=path.resolve('ink-studio.config.js');
      const hostFiles=[settings.adapterFile];
      if (process.env.INK_STUDIO_PORTABLE_SHOT!=='1' && fs.existsSync(config)) {
        hostFiles.push(config);
        sources.push(config);
      }
      const runtime=fingerprint([engineFingerprint(settings.kit,{allowCustom:true}),
        hostFiles.filter(Boolean).map(file=>fs.readFileSync(file))]);
      const {code,report}=await runBatch(project,project.prepareBatch(definition,run),{
        output, resume:opt.resume, stream:opt.progress && sendText, writer:output && graphOutputs(sources),
        identity:project.artifactIdentity(), runtime, cache
      });
      if (code) process.exitCode=code;
      if (!opt.progress) await send(report,opt.json);
      return;
    }
    result=execute([definition,run],()=>project.batch(definition,run));
  } else result=execute(run,()=>project.run(run));
  if (output) save(output,result,sources);
  await send(result.report,opt.json);
  if (result.report.passed===false) process.exitCode=2;
}

module.exports=graphCommand;
module.exports.commandOptions=commandOptions;
