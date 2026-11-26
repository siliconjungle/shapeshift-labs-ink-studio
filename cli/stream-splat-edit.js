'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Files = require('./asset-files.js');
const Pack = require('./gaussian-pack-files.js');
const Frames = require('../src/splat-frames.js');
const Row = require('./splat-row-attributes.js');

const editFormat = 'ink-studio/stream-splat-index', patchFormat = 'ink-studio/stream-splat-patch';
const maxFile = 48 * 1024 ** 2, maxRows = 262144, maxCells = 256, maxOperations = 32768, stride = 16;
const idName = /^[A-Za-z0-9_-]{1,96}$/;
const address = /^([A-Za-z0-9_-]{1,96})\/(0|[1-9][0-9]{0,6})$/;
const rowsName = /^rows-([a-f0-9]{20})\.json$/;
const receiptName = /^edit-([a-f0-9]{20})\.json$/;
const checksum = /-([a-f0-9]{20})\.[^.]+$/;
const hashedLevel = /^chunk-[A-Za-z0-9_-]+-lod-\d+-[a-f0-9]{20}\.(bin|irc)$/;
const hex = /^[a-f0-9]{64}$/;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const integer = (n, lo, hi) => Number.isSafeInteger(n) && range(n, lo, hi);
const name = value => typeof value === 'string' && idName.test(value);
const rowId = value => typeof value === 'string' && address.test(value);
const gridKey = (layer, cell) => JSON.stringify([layer, cell]);
const sha = data => Pack.hash(JSON.stringify(data));
const at = (chunk, row) => chunk + '/' + row;

function readBytes(file, limit, exact) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || exact !== undefined && stat.size !== exact)
      throw new RangeError('Invalid stream byte length for ' + file);
    const bytes = Buffer.alloc(stat.size);
    for (let offset = 0; offset < bytes.length;) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new RangeError('Incomplete stream payload ' + file);
      offset += count;
    }
    const base=path.basename(file);
    const expected = (hashedLevel.test(base) || rowsName.test(base) || receiptName.test(base)) && checksum.exec(base)?.[1];
    if (expected && Pack.shortHash(bytes) !== expected) throw new RangeError('Stream payload checksum differs for ' + file);
    return bytes;
  } finally { fs.closeSync(fd); }
}

const read = (file, size = maxFile) => JSON.parse(readBytes(file, size));
function config(input) {
  if (!fields(input, ['cellSize','voxelSizes','encoding','lossless']))
    throw new TypeError('Editable packs need recorded cell size and voxel tiers');
  const { cellSize, voxelSizes, encoding = 'raw', lossless = encoding === 'irc1' } = input;
  if (!range(cellSize, .00001, 1e6) || !Array.isArray(voxelSizes) || !integer(voxelSizes.length, 1, 16) ||
      voxelSizes.at(-1) !== 0 || !voxelSizes.slice(0,-1).every((n,i) => range(n,.000001,1e6) &&
        (!i || Number.isInteger(voxelSizes[i-1]/n) && voxelSizes[i-1]/n >= 2)) ||
      !['raw','irc1'].includes(encoding) || typeof lossless !== 'boolean' || lossless && encoding !== 'irc1')
    throw new RangeError('Invalid edit grid, nested voxel tiers, or encoding');
  return { cellSize, voxelSizes: voxelSizes.slice(), encoding, lossless };
}

function paths(manifest) {
  const grid = new Map(), chunks = new Map();
  for (const chunk of manifest.chunks) {
    if (!Array.isArray(chunk.cell) || chunk.cell.length !== 3 || !chunk.cell.every(Number.isSafeInteger))
      throw new RangeError('Editable chunks need native grid cell addresses');
    const key = gridKey(chunk.layer, chunk.cell), finest = chunk.levels.at(-1);
    if (grid.has(key) || chunk.locked !== undefined && (!Array.isArray(chunk.locked) || chunk.locked.length > finest.splats ||
        !chunk.locked.every((n,i) => integer(n, (chunk.locked[i-1] ?? -1) + 1, finest.splats - 1))) ||
        chunk.rowIndex !== undefined && (typeof chunk.rowIndex !== 'string' || !rowsName.test(chunk.rowIndex)))
      throw new RangeError('Invalid chunk cell or row index ' + chunk.id);
    grid.set(key, chunk.id);
    chunks.set(chunk.id, chunk);
  }
  return { grid, chunks };
}

const nextEpoch = manifest => {
  const maximum=manifest.chunks.reduce((epoch,chunk)=>Math.max(epoch,...chunk.levels.map(level=>level.revision)),manifest.epoch ?? 0);
  if (maximum>=Number.MAX_SAFE_INTEGER) throw new RangeError('Stream epoch limit reached');
  return maximum+1;
};

function ensureIndexed(manifest) {
  const state = manifest.edit, { chunks, grid } = paths(manifest), packing = config(manifest.packing);
  if (!fields(state, ['format','version','asset','redirects','retired','lastReceipt']) || state.format !== editFormat ||
      state.version !== 1 || typeof state.asset !== 'string' || !hex.test(state.asset) ||
      !Array.isArray(state.redirects) || state.redirects.length > 262144 ||
      !Array.isArray(state.retired) || state.retired.length > 262144 ||
      state.lastReceipt !== undefined && (typeof state.lastReceipt !== 'string' || !receiptName.test(state.lastReceipt)))
    throw new RangeError('Index the pack before editing it');
  const retired = new Set(state.retired), redirects = new Map();
  if (retired.size !== state.retired.length || !state.retired.every(rowId)) throw new RangeError('Invalid stream tombstones');
  for (const pair of state.redirects) {
    if (!Array.isArray(pair) || pair.length !== 2 || !rowId(pair[0]) || redirects.has(pair[0]) ||
        retired.has(pair[0]) || !chunks.has(pair[1]) || pair[0].split('/')[0] === pair[1])
      throw new RangeError('Invalid stream row redirect');
    redirects.set(...pair);
  }
  return { packing, chunks, grid, retired, redirects };
}

function index(manifest, override) {
  if (manifest.edit) {
    ensureIndexed(manifest);
    if (override) throw new RangeError('An indexed pack already has a fixed grid');
    return manifest;
  }
  paths(manifest);
  const packing = config(manifest.packing ?? override);
  if (override && manifest.packing && sha(packing) !== sha(config(override)))
    throw new RangeError('Requested grid differs from retained packing settings');
  return { ...manifest, packing, epoch: nextEpoch(manifest), edit: { format:editFormat, version:1,
    asset:sha({ manifest, packing }), redirects:[], retired:[] } };
}

function loadLevel(directory, api, level) {
  const bytes = readBytes(path.join(directory, level.file), 4_000_000 * 128, level.payloadBytes ?? level.splats * 64);
  return { data:api.decodeGaussianChunkPayload(bytes, level.splats, level.encoding ?? 'raw'), bytes:bytes.length };
}

function readChunk(directory, api, manifest, chunk) {
  const level = chunk.levels.at(-1);
  if (level.splats > maxRows) throw new RangeError('Editable chunk exceeds the decoded row budget');
  const { data, bytes } = loadLevel(directory, api, level);
  let ids, locked;
  if (chunk.rowIndex) {
    const saved = read(path.join(directory, chunk.rowIndex), 16 * 1024 ** 2);
    if (!fields(saved,['ids','locked']) || !Array.isArray(saved.ids) || saved.ids.length!==level.splats ||
        !saved.ids.every(rowId) || new Set(saved.ids).size!==saved.ids.length || !Array.isArray(saved.locked) ||
        !saved.locked.every((n,i)=>integer(n,(saved.locked[i-1]??-1)+1,level.splats-1)))
      throw new RangeError('Chunk row ledger does not match ' + chunk.id);
    ({ids,locked}=saved);
  } else {
    ids = Array.from({length:level.splats},(_,i)=>at(chunk.id,i));
    locked = chunk.locked ?? [];
  }
  const pinned = new Set(locked), rows = new Map();
  for (const [i,id] of ids.entries()) {
    const dataRow = data.subarray(i*stride,(i+1)*stride);
    const slot = dataRow[11];
    if (!dataRow.every(Number.isFinite) || dataRow[3]<0 ||
        !integer(slot,0,64) || slot && (!chunk.footprints || !manifest.footprints?.[slot-1] || dataRow[12]<=0))
      throw new RangeError('Invalid static Gaussian row in ' + chunk.id);
    rows.set(id,{data:dataRow,locked:pinned.has(i)});
  }
  return { rows, bytes, count:level.splats };
}

function request(input, manifest) {
  if (!fields(input,['format','version','asset','epoch','edits']) || input.format!==patchFormat || input.version!==1 ||
      input.asset!==manifest.edit.asset || input.epoch!==manifest.epoch || !Array.isArray(input.edits) ||
      !integer(input.edits.length,1,maxOperations))
    throw new RangeError('Patch must match the indexed stream asset and current epoch');
  const seen = new Set();
  return input.edits.map(edit => {
    if (!fields(edit,['id','pigment','opacity','position','translate','scale','orientation','layer','remove']) || !rowId(edit.id) ||
        seen.has(edit.id) || Object.keys(edit).length<2 || edit.remove!==undefined && (edit.remove!==true || Object.keys(edit).length!==2) ||
        edit.translate!==undefined && edit.position!==undefined ||
        edit.layer!==undefined && !name(edit.layer) || edit.pigment!==undefined && !integer(edit.pigment,0,0xffffff))
      throw new RangeError('Invalid or duplicate stream splat edit ' + edit?.id);
    seen.add(edit.id);
    const output={...edit};
    for (const key of ['opacity','position','translate','scale','orientation'])
      if (edit[key]!==undefined) output[key]=Row.prepare(key==='translate'?'position':key,edit[key]);
    return output;
  });
}

function apply(row, edit, {M,Q}) {
  const result=row.slice();
  if (edit.opacity!==undefined) result[3]=edit.opacity;
  if (edit.position) result.set(edit.position);
  if (edit.translate) for(let i=0;i<3;i++) result[i]+=edit.translate[i];
  if (edit.pigment!==undefined) {
    const n=edit.pigment;
    result[7]=(n&255)<<16 | n&0xff00 | n>>>16&255;
  }
  if (edit.scale || edit.orientation) {
    const matrix=Q.toMatrix(edit.orientation ?? [0,0,0,1]).map((n,i)=>n*(edit.scale?.[i%3]??1));
    const covariance=Frames.covariance(row,0,matrix,M);
    [4,5,6,8,9,10].forEach((field,i)=>{result[field]=covariance[[0,1,2,4,5,8][i]];});
  }
  if (!result.every(Number.isFinite) || !Array.from(result.subarray(0,3)).every(n=>range(n,-1e6,1e6)))
    throw new RangeError('Edited Gaussian exceeds scene coordinate or float limits');
  return result;
}

const sorted = (a,b) => a<b ? -1 : a>b ? 1 : 0;
const json = value => Buffer.from(JSON.stringify(value)+'\n');

function publish(directory, name, bytes) {
  const file=path.join(directory,name), previous=fs.statSync(file,{throwIfNoEntry:false});
  if (previous) {
    if (!readBytes(file,bytes.length,bytes.length).equals(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)))
      throw new Error('Conflicting content at ' + name);
    return false;
  }
  Files.write(file,bytes);
  return true;
}

function edit(api, kit, manifest, directory, patch) {
  const {packing,chunks,grid,retired,redirects}=ensureIndexed(manifest), edits=request(patch,manifest);
  const loaded=new Map(), dirty=new Set(), touched=[], newContent=[];
  let readRows=0, readPayloadBytes=0;
  function cell(id, proposed) {
    if (!loaded.has(id)) {
      const descriptor=chunks.get(id) ?? proposed;
      if (!descriptor || loaded.size>=maxCells) throw new RangeError('Unavailable chunk or edit cell budget exceeded');
      const count=descriptor.levels?.at(-1).splats ?? 0;
      if ((readRows+=count)>maxRows) throw new RangeError('Patch decoded row budget exceeded');
      const resident=count ? readChunk(directory,api,manifest,descriptor) : {rows:new Map(),bytes:0};
      readPayloadBytes+=resident.bytes;
      loaded.set(id,{...resident,descriptor});
    }
    return loaded.get(id);
  }
  for (const operation of edits) {
    const {id}=operation, origin=address.exec(id)[1];
    if (retired.has(id)) throw new RangeError('Stable row is retired: ' + id);
    const source=redirects.get(id)??origin, before=cell(source), row=before.rows.get(id);
    if (!row) throw new RangeError('Unknown stable stream row ' + id);
    let destination=null;
    if (operation.remove || operation.opacity===0) {
      before.rows.delete(id);
      retired.add(id);
      redirects.delete(id);
      dirty.add(source);
    } else {
      const data=apply(row.data,operation,kit), layer=operation.layer??before.descriptor.layer;
      const position=operation.position||operation.translate ? Array.from(data.subarray(0,3), v=>Math.floor(v/packing.cellSize)) : before.descriptor.cell;
      const key=gridKey(layer,position);
      destination=grid.get(key)??Pack.chunkId(layer,position);
      if (destination===source && data.every((n,i)=>n===row.data[i])) {
        touched.push({id,from:source,to:source,status:'unchanged'});
        continue;
      }
      if (destination!==source) {
        const known=loaded.get(destination)?.descriptor??chunks.get(destination);
        if (known && gridKey(known.layer,known.cell)!==key) throw new Error('Conflicting Gaussian chunk identity');
        before.rows.delete(id);
      }
      cell(destination,{id:destination,layer,cell:position}).rows.set(id,{data,locked:true});
      grid.set(key,destination);
      if (destination===origin) redirects.delete(id);
      else redirects.set(id,destination);
      dirty.add(source);
      dirty.add(destination);
    }
    touched.push({id,from:source,to:destination,status:destination===null?'retired':destination===source?'edited':'moved'});
  }
  if (retired.size>262144 || redirects.size>262144) throw new RangeError('Stream edit address limit reached');
  const epoch=dirty.size?nextEpoch(manifest):manifest.epoch, rebuilt=[], reusedLevels=[];
  const output=new Map(chunks);
  for (const id of [...dirty].sort(sorted)) {
    const {descriptor,rows}=loaded.get(id);
    if (!rows.size) {
      output.delete(id);
      rebuilt.push({id,rows:0,levels:[],status:'emptied'});
      continue;
    }
    const data=new Float32Array(rows.size*stride), protect=new Uint8Array(rows.size), locked=[], ids=[];
    let slots=false, i=0;
    for (const [id,{data:row,locked:pinned}] of rows) {
      data.set(row,i*stride);
      ids.push(id);
      if (pinned) locked.push(i);
      slots ||= row[11]>0;
      protect[i++]=+(pinned||row[11]>0);
    }
    const rowBytes=json({ids,locked}), rowIndex='rows-'+Pack.shortHash(rowBytes)+'.json';
    newContent.push({file:rowIndex,bytes:rowBytes,kind:'rowIndex'});
    const cell={id,layer:descriptor.layer,cell:descriptor.cell};
    const {bounds,levels}=api.buildGaussianCellLevels(data,protect,{...packing,lossless:packing.encoding==='irc1',name:id,footprints:slots});
    const old=new Map(descriptor.levels?.map(level=>[level.id,level]));
    const native=levels.map(({data,payload,...level})=>{
      const bytes=payload??Pack.rawPayload(data), file=Pack.levelName(id,level.id,bytes,level.file);
      const same=old.get(level.id);
      const revision=same?.file===file && same.error===level.error && Boolean(descriptor.footprints)===slots ? same.revision : epoch;
      if (revision!==epoch) reusedLevels.push({chunk:id,level:level.id,file});
      else newContent.push({file,bytes,kind:'payload'});
      return {...level,file,revision};
    });
    const styles=new Set();
    if (slots) for (let at=11;at<data.length;at+=stride) if(data[at]) styles.add(data[at]);
    const footprintRevision=slots?Pack.shortHash(JSON.stringify([...styles].sort((a,b)=>a-b).map(n=>[n,manifest.footprints[n-1]]))):null;
    output.set(id,{...cell,bounds,rowIndex,levels:native,...(slots&&{footprints:true,footprintRevision})});
    rebuilt.push({id,rows:rows.size,levels:native.map(level=>level.id),status:chunks.has(id)?'rebuilt':'created'});
  }
  const next={...manifest,epoch,chunks:[...output.values()],
    edit:{...manifest.edit,redirects:[...redirects].sort(([a],[b])=>sorted(a,b)),retired:[...retired].sort(sorted)}};
  api.inspectGaussianChunkManifest(next);
  ensureIndexed(next);
  const untouched=manifest.chunks.filter(chunk=>!dirty.has(chunk.id)).map(chunk=>chunk.id);
  const report={format:'ink-studio/stream-splat-edit-report',version:1,asset:manifest.edit.asset,
    previousEpoch:manifest.epoch,epoch,edits:touched,rebuilt,reusedLevels,untouched,
    read:{chunks:[...loaded.keys()].filter(id=>chunks.has(id)),rows:readRows,payloadBytes:readPayloadBytes}};
  return { next, report, content:newContent };
}

module.exports={read,readBytes,loadLevel,index,ensureIndexed,edit,readChunk,publish,json};
