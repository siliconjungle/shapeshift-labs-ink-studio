'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const files = require('./asset-files.js');
const {readTilesetImage} = require('./tileset-image.js');

function revision(asset) {
  const shape = [asset.width,asset.height,asset.encoding,asset.palette,asset.alpha,...(asset.paletteMetadata ? [asset.paletteMetadata] : [])];
  return createHash('sha256').update(JSON.stringify(shape)).update(Buffer.from(asset.data,'base64')).digest('hex');
}

function difference(before, incoming, same, toolkit) {
  const paletteChanged = JSON.stringify(before.palette) !== JSON.stringify(incoming.palette);
  const alphaChanged = JSON.stringify(before.alpha) !== JSON.stringify(incoming.alpha);
  const result = {changed:0,added:0,removed:0,slotChanges:0,paletteChanged,alphaChanged,bounds:null,samples:[]};
  if (same) return result;
  const tilesets = toolkit.KIT.authoring.tilesets.prepare({before,incoming});
  const oldPixels = tilesets.resolve({tileset:'before'}).pixels, newPixels = tilesets.resolve({tileset:'incoming'}).pixels;
  const indexed = before.encoding === 'indexed8' && incoming.encoding === 'indexed8';
  const oldSlots = indexed && Buffer.from(before.data,'base64'), newSlots = indexed && Buffer.from(incoming.data,'base64');
  const width = Math.max(before.width,incoming.width), height = Math.max(before.height,incoming.height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const a = x<before.width && y<before.height ? y*before.width+x : -1;
    const b = x<incoming.width && y<incoming.height ? y*incoming.width+x : -1;
    if (a<0 && b<0) continue;
    const i = a*4, j = b*4;
    const rgba = a>=0 && b>=0 && (oldPixels[i] !== newPixels[j] || oldPixels[i+1] !== newPixels[j+1] ||
      oldPixels[i+2] !== newPixels[j+2] || oldPixels[i+3] !== newPixels[j+3]);
    const slot = indexed && a>=0 && b>=0 && oldSlots[a] !== newSlots[b];
    if (a>=0 && b>=0 && !rgba && !slot) continue;
    if (a<0) result.added++;
    else if (b<0) result.removed++;
    else result.changed++;
    if (slot) result.slotChanges++;
    left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y);
    if (result.samples.length<16) result.samples.push({x,y,
      before:a<0 ? null : Array.from(oldPixels.subarray(a*4,a*4+4)),
      incoming:b<0 ? null : Array.from(newPixels.subarray(b*4,b*4+4)),
      ...(indexed && {beforeSlot:a<0 ? null : oldSlots[a],incomingSlot:b<0 ? null : newSlots[b]})});
  }
  if (right>=0) result.bounds = {x:left,y:top,width:right-left+1,height:bottom-top+1};
  return result;
}

function applyRevision(editor, id, asset, link, report, apply) {
  try {
    const revision = apply ? editor.updateTilesetSource(id,asset,link) : editor.planTilesetSource(id,asset,link);
    return {...report,revision,status:revision.canCommit ? apply ? 'accepted' : 'ready' : 'blocked',
      canCommit:revision.canCommit,applied:apply && revision.canCommit};
  } catch (error) {
    if (!error.report) throw error;
    return {...report,revision:error.report,status:'blocked',canCommit:false};
  }
}

function inspect(editor, sceneFile, id, link, {acceptExternal=false,expect,apply=false,automatic=false,onFile} = {}, toolkit) {
  const scene = editor.snapshot(), A = toolkit.KIT.authoring;
  const prior = A.tilesetSources.prepare(scene)[id];
  const before = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(id);
  const current = revision(before), baseline = prior?.sha256 ?? null, sameSource = prior?.file === link.file;
  const localPaint = baseline !== null && current !== baseline;
  const filename = path.resolve(path.dirname(sceneFile),link.file);
  const result = {format:'ink-studio/tileset-source-review',version:1,tileset:id,file:link.file,refresh:link.refresh,
    baseline,working:{width:before.width,height:before.height,encoding:before.encoding,sha256:current},
    localPaint,applied:false,blockers:[]};
  if (sameSource && prior.refresh !== link.refresh && expect === undefined && !acceptExternal)
    return applyRevision(editor,id,before,{...prior,refresh:link.refresh},{...result,policyOnly:true},apply);

  let incoming;
  try {
    const bytes = fs.readFileSync(filename);
    onFile?.(filename);
    incoming = readTilesetImage(bytes,toolkit);
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'missing-source' : 'unreadable-source';
    return {...result,status:reason,blockers:[{reason,message:error.message}],canCommit:false};
  }
  const sha256 = revision(incoming), same = current === sha256;
  const next = {file:link.file,refresh:link.refresh,sha256};
  const blockers = result.blockers;
  if (expect !== undefined && expect !== sha256) blockers.push({reason:'source-revision-changed',expected:expect});
  if (!same && (localPaint || !sameSource) && !acceptExternal)
    blockers.push({reason:localPaint ? 'local-paint' : 'different-embedded-image'});
  if (automatic && (before.width !== incoming.width || before.height !== incoming.height || before.encoding !== incoming.encoding))
    blockers.push({reason:'image-layout-changed'});
  const report = {...result,incoming:{width:incoming.width,height:incoming.height,encoding:incoming.encoding,sha256},
    sourceChanged:!sameSource || baseline !== sha256,...(!automatic && {diff:difference(before,incoming,same,toolkit)})};
  if (blockers.length) return {...report,status:'blocked',canCommit:false};
  if (same && prior?.file === next.file && prior.refresh === next.refresh && prior.sha256 === next.sha256)
    return {...report,status:'current',canCommit:true};

  return applyRevision(editor,id,incoming,next,report,apply);
}

function refresh(editor, sceneFile, toolkit, onFile) {
  const links = toolkit.KIT.authoring.tilesetSources.prepare(editor.snapshot());
  return Object.keys(links).sort().filter(id=>links[id].refresh === 'on-load').map(id=>
    inspect(editor,sceneFile,id,links[id],{apply:true,automatic:true,onFile},toolkit));
}

function command(type, args, options, toolkit, openEditor) {
  const {scene,id,out,refresh:mode,expect,'accept-external':acceptExternal} = options;
  const name = value=>typeof value === 'string' && value.trim();
  const link = type === 'link', allowed = ['scene','id','out','expect','accept-external',...(link ? ['refresh'] : [])];
  if (args.length !== (link ? 1 : 0) || link && (!name(args[0]) || !/\.png$/i.test(args[0])) ||
      ![scene,id].every(name) || Object.keys(options).some(key=>!allowed.includes(key)) ||
      out !== undefined && (!name(out) || !/\.json$/i.test(out)) ||
      mode !== undefined && !['manual','on-load'].includes(mode) ||
      expect !== undefined && (typeof expect !== 'string' || !/^[a-f0-9]{64}$/.test(expect)))
    throw new TypeError('Use tileset '+type+' --scene <scene.json> --id <tileset-id>'+
      (link ? ' with a PNG path and optional --refresh manual|on-load' : ' for a linked sheet'));
  const input = path.resolve(scene), output = out && path.resolve(out), editor = openEditor(input);
  const prior = toolkit.KIT.authoring.tilesetSources.prepare(editor.snapshot())[id];
  if (!link && !prior) throw new RangeError('Tileset '+id+' has no external source link');
  const target = link ? {file:path.relative(path.dirname(input),path.resolve(args[0])).split(path.sep).join('/'),
    refresh:mode ?? prior?.refresh ?? 'manual'} : prior;
  if (output && (output === input || path.dirname(input) !== path.dirname(output) ||
      output === path.resolve(path.dirname(input),target.file)))
    throw new RangeError('Write a new scene JSON beside its source and separate from the linked PNG');
  const report = inspect(editor,input,id,target,{acceptExternal,expect,apply:Boolean(output)},toolkit);
  if (output && report.canCommit) files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  if (output && !report.canCommit) process.exitCode = 1;
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = {command,refresh};
