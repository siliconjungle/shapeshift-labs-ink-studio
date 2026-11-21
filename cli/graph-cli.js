const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { save, graphOutputs } = require('./graph-outputs.js');
const { readGraphProject } = require('./graph-project.js');
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
  validate:['inputs','json'], plan:['inputs','json'], dependencies:['json'], snapshot:['inputs','at','seed','json'],
  inspect:['inputs','at','seed','out','output','node','port','json',...executionFlags],
  run:['inputs','at','seed','out','json',...executionFlags],
  batch:['inputs','at','seed','out','json','resume','progress',...executionFlags],
  session:['protocol','out','workers'],
  clip:['inputs','seed','out','output','from','to','fps','warmup','cuts','clock','format','render-options','json',...executionFlags]
};

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
          const {output,node,port,...settings}=options;
          result=project.inspect({output,node,port},settings);
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
    format: opt.format, clock, renderOptions: read('render-options') };
}

async function graphCommand(pos,opt,settings) {
  const [mode,file,caseFile]=pos;
  if (mode==='nodes' || mode==='describe') {
    const listing=mode==='nodes';
    if (pos.length!==(listing ? 1 : 2) || opt.json && opt.example ||
        Object.entries(opt).some(([key,value])=>value!==true || key!=='json' && (listing || key!=='example')))
      throw new TypeError('Use graph nodes [--json] or graph describe <op> [--json | --example]');
    const result=listing ? catalog.listGraphNodes(settings) : catalog.describeGraphNode(file,settings);
    if (opt.json) return send(result);
    if (opt.example) {
      if (!result.example) throw new RangeError('No catalog example supplied for '+file);
      return sendText(catalog.exampleText(result.example));
    }
    return sendText(listing ? catalog.listText(result) : catalog.nodeText(result));
  }
  if (mode==='impact') {
    if (pos.length!==2 || Object.entries(opt).some(([key,value])=>
      key==='json' ? value!==true : key!=='root' || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph impact <group.json> [--root directory] [--json]');
    return send(findGraphGroupUsers(file,{root:opt.root}),opt.json);
  }
  if (mode==='diff') {
    if (pos.length!==3 || Object.entries(opt).some(([key,value])=>
      key==='json' ? value!==true : key!=='adapters' || typeof value!=='string' || !value.trim()))
      throw new TypeError('Use graph diff <before.json> <after.json> [--json]');
    settings=await host.adapters(opt.adapters,settings);
    const read = source => {
      const document=JSON.parse(fs.readFileSync(source,'utf8'));
      return document?.format===snapshotFormat ? document : readGraphProject(source,settings);
    };
    return send(diffGraphs(read(file),read(caseFile)),opt.json);
  }
  if (Object.hasOwn(host.commands,mode)) return send(await host.execute(pos,opt,settings),opt.json);
  if (!Object.hasOwn(flags,mode) || pos.length!==(mode==='batch'?3:2) ||
      Object.entries(opt).some(([key,value])=>key!=='adapters' && !flags[mode].includes(key) ||
        (['json','resume'].includes(key) ? value!==true : key==='progress' ? value!=='ndjson' :
          typeof value!=='string' || !value.trim())) ||
      opt.port!==undefined && opt.node===undefined || opt.protocol!==undefined && opt.protocol!=='ndjson')
    throw new TypeError('Use graph validate|plan|dependencies|snapshot|inspect|run|batch|session|clip <project.json> [cases-or-sweep.json]. See ink-studio help');
  if (opt.cache===undefined && cacheFlags.slice(1).some(flag=>opt[flag]!==undefined))
    throw new TypeError('Graph cache limits need --cache directory');
  if (opt.resume && opt.out===undefined) throw new TypeError('Graph batch --resume needs --out directory');
  settings=await host.adapters(opt.adapters,settings);
  const workerPool=opt.workers===undefined ? undefined : createGraphWorkers(Number(opt.workers), {kit:settings.kit});
  try { return await projectCommand(mode,file,caseFile,opt,{...settings,workerPool}); }
  finally { workerPool?.close(); }
}

async function projectCommand(mode,file,caseFile,opt,settings) {
  const project=readGraphProject(file,settings), sources=project.sourceFiles();
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
  if (mode==='plan') return send(project.plan(inputs),opt.json);
  if (mode==='dependencies') return send(project.dependencies(),opt.json);
  if (mode==='snapshot') return send(project.snapshot(run),opt.json);
  if (mode==='session') return session(project,output,sources);
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
    const target={output:opt.output,node:opt.node,port:opt.port ?? 'value'};
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
