'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Files = require('./asset-files.js');
const Pack = require('./gaussian-pack-files.js');
const Stream = require('./stream-splat-edit.js');
const { claim } = require('./graph-batch.js');
const { graphOutputs } = require('./graph-outputs.js');

function inputPath(s) {
  if (typeof s!=='string'||!s.trim()) throw new TypeError('Expected a stream filename');
  return path.resolve(s);
}

function outputPaths(directory, manifest, inputs, outputs) {
  const files=new Set(manifest.chunks.flatMap(chunk=>[chunk.rowIndex,...chunk.levels.map(level=>level.file)]).filter(Boolean));
  if(outputs.some(file=>path.dirname(file)===directory &&
      (files.has(path.basename(file))||/^(rows|edit)-[a-f0-9]{20}\.json$/.test(path.basename(file)))) ||
      new Set(outputs).size!==outputs.length || outputs.some(file=>inputs.includes(file)))
    throw new RangeError('Choose distinct outputs outside the packed payload and ledger filenames');
  const guard=graphOutputs([...inputs,...[...files].map(file=>path.join(directory,file)).filter(file=>
    outputs.some(out=>path.basename(out)===file) && fs.existsSync(file))]);
  for(const file of outputs) guard.protect(fs.statSync(file,{throwIfNoEntry:false}));
}

function packingOptions(opt) {
  if(!['cell-size','voxels','encoding'].some(key=>opt[key]!==undefined))return;
  if(typeof opt['cell-size']!=='string'||typeof opt.voxels!=='string'||
      opt.encoding!==undefined&&typeof opt.encoding!=='string')
    throw new TypeError('Legacy indexing needs --cell-size and --voxels, with optional --encoding');
  const encoding=opt.encoding??'raw';
  return {cellSize:Number(opt['cell-size']),voxelSizes:opt.voxels.split(',').map(Number),encoding,lossless:encoding==='irc1'};
}

function metadata(manifest) {
  const {packing}=Stream.ensureIndexed(manifest);
  return {format:'ink-studio/stream-splat-catalog',version:1,asset:manifest.edit.asset,epoch:manifest.epoch,packing,
    lastReceipt:manifest.edit.lastReceipt??null,redirected:manifest.edit.redirects.length,retired:manifest.edit.retired.length,
    chunks:manifest.chunks.map(chunk=>({id:chunk.id,layer:chunk.layer,cell:chunk.cell,bounds:chunk.bounds,
      rows:chunk.levels.at(-1).splats,levels:chunk.levels.map(({id,splats,payloadBytes,revision})=>({id,splats,bytes:payloadBytes??splats*64,revision}))}))};
}

function inspect(api,file,manifest,opt) {
  const catalog=metadata(manifest);
  if(opt.start!==undefined||opt.limit!==undefined)if(opt.chunk===undefined)throw new RangeError('Row paging needs --chunk');
  if(opt.chunk!==undefined){
    const chunk=manifest.chunks.find(chunk=>chunk.id===opt.chunk);
    if(!chunk)throw new RangeError('Unknown stream chunk '+opt.chunk);
    const {rows}=Stream.readChunk(path.dirname(file),api,manifest,chunk);
    const start=Number(opt.start??0), limit=Number(opt.limit??5000);
    if(!Number.isSafeInteger(start)||start<0||start>rows.size||!Number.isSafeInteger(limit)||limit<1||limit>32768)
      throw new RangeError('Choose an in-bounds start and a row limit in 1..32768');
    delete catalog.chunks;
    catalog.chunk={id:chunk.id,layer:chunk.layer,total:rows.size,start,rows:[...rows].slice(start,start+limit).map(([id,{data,locked}])=>{
      const pigment=data[7];
      return {id,position:Array.from(data.subarray(0,3)),opacity:data[3],
        pigment:(pigment&255)<<16 | pigment&0xff00 | pigment>>>16&255,
        covariance:[4,5,6,8,9,10].map(k=>data[k]),footprint:chunk.footprints?data[11]:0,locked};
    })};
  }
  if(opt.out!==undefined){
    const out=inputPath(opt.out);
    outputPaths(path.dirname(file),manifest,[file],[out]);
    Files.json(out,catalog);
  } else console.log(JSON.stringify(catalog,null,2));
}

async function command(pos,opt,kit) {
  const [action,input,settings]=pos;
  const allowed={index:['cell-size','voxels','encoding'],inspect:['chunk','start','limit','out'],edit:['previous','out'],review:['previous','out']};
  if(!Object.hasOwn(allowed,action)||pos.length!==(['index','inspect'].includes(action)?2:3)||
      Object.keys(opt).some(key=>!allowed[action].includes(key)||typeof opt[key]!=='string'||!opt[key].trim())||
      action==='review'&&!opt.out)
    throw new TypeError('See ink-studio help for stream-splats index, inspect, edit and review');
  const file=inputPath(input), directory=path.dirname(file), api=await import('../src/gaussian-chunks.mjs');
  const manifestAt=name=>api.inspectGaussianChunkManifest(Stream.read(name));
  if(action==='inspect')return inspect(api,file,manifestAt(file),opt);
  if(action==='review'){
    const spec=inputPath(settings), out=inputPath(opt.out), prior=opt.previous&&inputPath(opt.previous);
    const current={file,manifest:manifestAt(file)}, previous=prior&&{file:prior,manifest:manifestAt(prior)};
    if(previous&&(!current.manifest.edit||current.manifest.edit.asset!==previous.manifest.edit?.asset||
        previous.manifest.epoch>current.manifest.epoch))
      throw new RangeError('Previous manifest must belong to the same indexed stream and precede the current epoch');
    const {report,artifacts}=await require('./stream-splat-review.js').review(kit,api,current,previous,Stream.read(spec,3_000_000));
    const release=claim(out,'splat stream review');
    try {
      graphOutputs([file,spec,...(prior?[prior]:[])]).write(out,[...artifacts,{file:'report.json',document:report}]);
    } finally { release(); }
    console.log('Reviewed '+report.views.length+' streamed views in '+out);
    return;
  }

  const release=claim(directory,'Gaussian pack');
  try {
    const manifest=manifestAt(file);
    if(action==='index'){
      const indexed=Stream.index(manifest,packingOptions(opt));
      if(indexed!==manifest)Files.json(file,indexed);
      console.log('Indexed '+indexed.chunks.length+' chunks at epoch '+indexed.epoch);
      return;
    }
    if(!manifest.edit)throw new RangeError('Index the pack before editing it');
    const patchFile=inputPath(settings), previous=opt.previous&&inputPath(opt.previous), output=opt.out&&inputPath(opt.out);
    if(previous&&path.dirname(previous)!==directory)throw new RangeError('Keep a previous manifest beside the original payloads');
    outputPaths(directory,manifest,[file,patchFile],[previous,output].filter(Boolean));
    const {next,report,content}=Stream.edit(api,kit,manifest,directory,Stream.read(patchFile,12*1024**2));
    const published={payloads:0,rowIndices:0,payloadBytes:0};
    for(const {file,bytes,kind} of content)if(Stream.publish(directory,file,bytes)){
      if(kind==='payload'){published.payloads++;published.payloadBytes+=bytes.length;}
      else published.rowIndices++;
    }
    report.published=published;
    if(next.epoch!==manifest.epoch){
      const receipt=Stream.json(report), receiptFile='edit-'+Pack.shortHash(receipt)+'.json';
      Stream.publish(directory,receiptFile,receipt);
      next.edit.lastReceipt=receiptFile;
      if(previous)Files.json(previous,manifest);
      Files.json(file,next);
    }
    if(output)Files.json(output,report);
    console.log('Rebuilt '+report.rebuilt.length+' chunks and reused '+report.untouched.length+' at epoch '+next.epoch);
  } finally { release(); }
}

module.exports={command};
