const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { readGraphProject } = require('./graph-project.js');
const { graphOutputs } = require('./graph-outputs.js');
const { patchNodes } = require('./patch-nodes.js');
const { createPatchGpu } = require('./patch-gpu.js');
const { videoFrames, audioSource, parseRate, parseSize } = require('./patch-media.js');
const edit = require('./patch-edit.js');
const { describeGraphNode, listGraphNodes, nodeText, listText } = require('./graph-catalog.js');

const usage = [
  'ink-studio patch init <project.json>',
  'ink-studio patch apply <project.json> <edits.json> [--out new.json]',
  'ink-studio patch wire <project.json> <source> <destination> [--out new.json]',
  'ink-studio patch bind <project.json> <source> <destination> --id name --from 0,1 --to 0,2',
  'ink-studio patch plan <project.json> [--json | --dot]',
  'ink-studio patch nodes [--json] | patch describe <operation>',
  'ink-studio patch run <project.json> [--video file|-] [--audio file.wav|video] [--watch name=node:port,...]',
  '  [--frames 120] [--fps 12] [--size 320x180] [--controls controls.json] [--out folder] [--keep] [--progress]',
  'ink-studio patch show <cues.json> [--rehearse] [--report rehearsal.json] [--ffmpeg path] [--gpu-module path]'
].join('\n');

const booleanOptions = new Set(['json','dot','keep','progress','rehearse']);
const flags = {
  init:[], apply:['out'], wire:['out'], bind:['id','from','to','out'], plan:['json','dot'], nodes:['json'], describe:['json'],
  run:['video','audio','frames','fps','size','controls','out','keep','progress','ffmpeg','gpu-module','watch'],
  show:['rehearse','report','ffmpeg','gpu-module']
};
const counts = { init:2, apply:3, wire:4, bind:4, plan:2, nodes:1, describe:2, run:2, show:2 };

async function print(value, compact=false) {
  const text=typeof value==='string' ? value : JSON.stringify(value,null,compact ? undefined : 2);
  if (!process.stdout.write(text+'\n')) await once(process.stdout,'drain');
}
function range(text) {
  return text?.split(',').map(s=>s.trim() ? Number(s) : NaN);
}
const watchName = /^[a-z][\w.-]{0,99}$/i;
function parseWatches(text, plan) {
  if (text===undefined) return Object.fromEntries(Object.keys(plan.outputs).map(output=>[output,{output}]));
  const used=new Set();
  return Object.fromEntries(text.split(',').map(pair=>{
    const [name,source,extra]=pair.split('=');
    if (!watchName.test(name)||['__proto__','prototype','constructor'].includes(name)||used.has(name.toLowerCase())||extra!==undefined)
      throw new TypeError('Use --watch name=node:port,name=\$output with unique names');
    const target=edit.endpoint(source);
    if (target.input) throw new TypeError('Watch a node port or a named output');
    used.add(name.toLowerCase());
    return [name,target];
  }));
}
function readControls(file, project) {
  let previous, inputs={}, error;
  return () => {
    if (!file) return {inputs};
    try {
      if (fs.statSync(file).size>65536) throw new RangeError('Patch controls exceed 64 KiB');
      const text=fs.readFileSync(file,'utf8');
      if (text!==previous) {
        previous=text;
        try {
          const values=JSON.parse(text);
          project.validate(values);
          inputs=values; error=undefined;
        } catch (cause) { error=cause.message; }
      }
    } catch (cause) { error=cause.message; previous=undefined; }
    return {inputs, error};
  };
}

async function run(file,opt,settings) {
  const fps=parseRate(opt.fps), dimensions=parseSize(opt.size);
  const limit=Number(opt.frames??(opt.video ? 120 : 1));
  if (!Number.isInteger(limit)||limit<1||limit>36000) throw new RangeError('Patch frames must be 1–36,000');
  if (opt.keep && !opt.out) throw new TypeError('--keep needs an output directory');
  const media={}, gpu=createPatchGpu(path.dirname(path.resolve(file)),opt['gpu-module']);
  const operations={...settings.operations,...patchNodes(settings.kit,media,gpu)};
  const project=readGraphProject(file,{...settings,operations});
  const plan=project.plan(), watches=parseWatches(opt.watch,plan);
  const sourceFiles=project.sourceFiles().concat([opt.video,opt.audio,opt.controls].filter(value=>value&&value!=='-'&&value!=='video'));
  const fsWriter=opt.out && graphOutputs(sourceFiles.filter(name=>fs.existsSync(name)));
  const take=readControls(opt.controls,project);
  const abort=new AbortController();
  let interrupted;
  const interrupt=code=>{ interrupted=code; abort.abort(new Error('Patch interrupted')); };
  const stopInt=()=>interrupt(130), stopTerm=()=>interrupt(143);
  process.once('SIGINT',stopInt);
  process.once('SIGTERM',stopTerm);
  const mediaOptions={...dimensions,rate:opt.fps??'12',executable:opt.ffmpeg,signal:abort.signal};
  const frames=opt.video ? videoFrames(opt.video,mediaOptions) :
    (async function*(){ for (let i=0;i<limit;i++) yield undefined; })();
  let index=0, bytes=0, report, passed=true;
  try {
    if (opt.audio) media.audio=await audioSource(opt.audio,{video:opt.video,executable:opt.ffmpeg,duration:limit/fps,signal:abort.signal});
    for await (const frame of frames) {
      if (interrupted) break;
      media.frame=frame;
      const {inputs,error}=take();
      if (index===0 && error) throw new Error('Invalid initial patch controls: '+error);
      const result=await project.previewFrame(watches,{inputs,time:index/fps},{profile:true});
      const frameFolder=opt.keep && 'frames/'+String(index).padStart(6,'0');
      report={...result.report,frame:index,fps,...(frameFolder && {frameFolder}),...(error && {controlsError:error})};
      passed&&=report.passed;
      if (fsWriter) {
        const entries=[...result.artifacts,{file:'report.json',document:report}];
        if (opt.keep) {
          bytes+=entries.reduce((sum,row)=>sum+(row.bytes?.length??Buffer.byteLength(JSON.stringify(row.document))),0);
          if (bytes>512*1024*1024) throw new RangeError('Patch frame archive exceeds 512 MiB');
          fsWriter.write(path.join(opt.out,frameFolder),entries);
        }
        fsWriter.write(opt.out,entries);
      }
      if (opt.progress) await print(report,true);
      if (++index===limit) break;
    }
    if (!index && !interrupted) throw new Error('Patch source produced no complete frames');
    if (!opt.progress && index) await print({...report,frames:index,passed});
    process.exitCode=interrupted ?? (passed ? 0 : 2);
  } catch (error) {
    if (!interrupted) throw error;
    process.exitCode=interrupted;
  } finally {
    process.off('SIGINT',stopInt);
    process.off('SIGTERM',stopTerm);
    try { project.clear(); }
    finally { gpu.dispose(); }
  }
}

async function patchCommand(pos,opt,settings) {
  const [mode,file,source,sink]=pos;
  if (!mode||mode==='help') return print(usage);
  if (!Object.hasOwn(flags,mode)||pos.length!==counts[mode]||
      Object.entries(opt).some(([key,value])=>!flags[mode].includes(key)||(booleanOptions.has(key) ? value!==true : typeof value!=='string'))||
      opt.json&&opt.dot) throw new TypeError(usage);
  if (mode==='show') return require('./patch-show.js').runShow(file,opt,settings,value=>print(value,true));
  const context={...settings,operations:{...settings.operations,...patchNodes(settings.kit)}};
  if (mode==='run') return run(file,opt,settings);
  if (mode==='init') return print(edit.init(file));
  if (mode==='nodes') {
    const listing=listGraphNodes(context);
    if (opt.json) return print(listing);
    return print(listText(listing));
  }
  if (mode==='describe') {
    const descriptor=describeGraphNode(file,context);
    return print(opt.json ? descriptor : nodeText(descriptor));
  }
  if (mode==='plan') {
    const plan=readGraphProject(file,{...context,planAssets:true}).plan();
    return print(opt.json ? plan : opt.dot ? edit.dot(plan) : edit.wiring(plan));
  }
  const changes=mode==='apply' ? edit.root(source) :
    mode==='wire' ? [{op:'wire',from:source,to:sink}] :
    [{op:'bind',id:opt.id,from:source,to:sink,source:range(opt.from),range:range(opt.to)}];
  return print(edit.apply(file,changes,{out:opt.out,settings:context}));
}

module.exports=patchCommand;
