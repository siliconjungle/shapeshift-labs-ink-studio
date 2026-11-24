'use strict';

const fs = require('node:fs');
const { inflateSync } = require('node:zlib');

const fileLimit = 64 * 1024 * 1024;
const decodedLimit = 32 * 1024 * 1024;
const paletteLimit = 4096;

class Reader {
  constructor(bytes,context) {
    this.bytes = bytes;
    this.context = context;
    this.position = 0;
  }
  get remaining() { return this.bytes.length-this.position; }
  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining)
      throw new RangeError('Truncated or invalid Aseprite '+this.context);
    const start = this.position;
    this.position += length;
    return this.bytes.subarray(start,this.position);
  }
  skip(n) { this.take(n); }
  u8() { return this.take(1)[0]; }
  u16() { return this.take(2).readUInt16LE(0); }
  i16() { return this.take(2).readInt16LE(0); }
  u32() { return this.take(4).readUInt32LE(0); }
  i32() { return this.take(4).readInt32LE(0); }
  string() { return this.take(this.u16()).toString('utf8'); }
  rect() { return { x:this.i32(),y:this.i32(),w:this.u32(),h:this.u32() }; }
  body() { return this.take(this.remaining); }
}

function readLayer(body,flags) {
  const attributes = body.u16(), type = body.u16(), level = body.u16();
  body.skip(4);
  const blend = body.u16(), opacity = body.u8();
  body.skip(3);
  const label = body.string(), tileset = type === 2 ? body.u32() : undefined;
  const uuid = flags & 4 ? body.take(16).toString('hex') : undefined;
  return { attributes,type,level,blend,opacity,label,tileset,uuid };
}

function readCel(body,channels,pixels) {
  const layer = body.u16(), offset = [body.i16(),body.i16()], opacity = body.u8(), type = body.u16(), zIndex = body.i16();
  body.skip(5);
  const cel = { layer,offset,opacity,type,zIndex };
  if (type === 1) return { ...cel,link:body.u16() };
  if (type !== 0 && type !== 2 && type !== 3) return cel;
  const width = body.u16(), height = body.u16();
  if (type === 3) {
    const bits = body.u16(), masks = [body.u32(),body.u32(),body.u32(),body.u32()];
    body.skip(10);
    return { ...cel,width,height,bits,masks,...(bits === 32 && { data:pixels(body.body(),width*height*4,true) }) };
  }
  return { ...cel,width,height,data:pixels(body.body(),width*height*channels,type !== 0) };
}

function readTileset(body,channels,pixels) {
  const id = body.u32(), flags = body.u32(), count = body.u32(), width = body.u16(), height = body.u16(), base = body.i16();
  body.skip(14);
  const label = body.string();
  if (!width || !height) throw new RangeError('Invalid Aseprite tile dimensions');
  const external = flags & 1 ? [body.u32(),body.u32()] : undefined;
  const data = flags & 2 && count ? pixels(body.take(body.u32()),width*height*count*channels,true) : undefined;
  return { id,flags,count,width,height,base,label,external,data };
}

function applyPalette(body,type,palette) {
  if (type === 0x2019) {
    const count = body.u32(), first = body.u32(), last = body.u32();
    body.skip(8);
    const size = count || palette.length;
    if (size > paletteLimit || first > last || last >= size) throw new RangeError('Invalid Aseprite palette bounds');
    const result = Array.from({length:size},(_,i)=>palette[i] ?? { rgba:[0,0,0,255] });
    for (let i=first;i<=last;i++) {
      const flags = body.u16(), rgba = [...body.take(4)];
      result[i] = { rgba,...(flags & 1 && { label:body.string() }) };
    }
    return result;
  }
  const packets = body.u16(), result = palette.slice();
  let start = 0;
  for (let i=0;i<packets;i++) {
    start += body.u8();
    const count = body.u8() || 256, end = start+count;
    if (end > 256) throw new RangeError('Invalid Aseprite legacy palette bounds');
    for (let index=start;index<end;index++) {
      const rgb = [...body.take(3)].map(n=>type === 0x0011 ? (n&63)*4+((n&63)>>4) : n);
      result[index] = { rgba:[...rgb,255] };
    }
  }
  return result;
}

function readTags(body) {
  const count = body.u16();
  body.skip(8);
  if (count > 128) throw new RangeError('Ink supports up to 128 Aseprite tags');
  return Array.from({length:count},()=>{
    const from = body.u16(), to = body.u16(), direction = body.u8(), repeat = body.u16();
    body.skip(6);
    const color = [...body.take(3)];
    body.skip(1);
    return { from,to,direction,repeat,color,name:body.string() };
  });
}

function readSlice(body,frames) {
  const count = body.u32(), flags = body.u32();
  body.skip(4);
  const name = body.string();
  if (count > frames) throw new RangeError('Aseprite slice has too many frame keys');
  return { name,keys:Array.from({length:count},()=>{
    const frame = body.u32(), bounds = body.rect();
    const center = flags & 1 ? body.rect() : undefined;
    const pivot = flags & 2 ? { x:body.i32(),y:body.i32() } : undefined;
    return { frame,bounds,...(center?.w && center.h && { center }),
      ...(pivot && pivot.x !== 2147483647 && pivot.y !== 2147483647 && { pivot }) };
  }) };
}

function readBinary(source) {
  if (!(source instanceof Uint8Array) && fs.statSync(source).size > fileLimit)
    throw new RangeError('Aseprite file exceeds the 64 MiB import limit');
  const bytes = source instanceof Uint8Array ? Buffer.from(source.buffer,source.byteOffset,source.byteLength) : fs.readFileSync(source);
  if (bytes.length > fileLimit) throw new RangeError('Aseprite file exceeds the 64 MiB import limit');
  const input = new Reader(bytes,'file'), header = new Reader(input.take(128),'header');
  if (header.u32() !== bytes.length || header.u16() !== 0xa5e0) throw new TypeError('Expected a complete binary .ase or .aseprite file');
  const count = header.u16(), width = header.u16(), height = header.u16(), depth = header.u16(), flags = header.u32();
  const speed = header.u16() || 100;
  header.skip(8);
  const transparentIndex = header.u8();
  header.skip(3);
  const colors = header.u16() || 256, aspect = [header.u8(),header.u8()];
  const grid = [header.i16(),header.i16(),header.u16(),header.u16()];
  if (!count || count > 2048 || !width || !height || width > 512 || height > 512 || colors > paletteLimit ||
      width*height*count > 4_000_000 || ![8,16,32].includes(depth))
    throw new RangeError('Aseprite file exceeds native timeline, palette or canvas limits or uses an unknown color depth');
  let budget = decodedLimit;
  const pixels = (data,size,compressed)=>{
    if (!Number.isSafeInteger(size) || size < 0 || (budget -= size) < 0)
      throw new RangeError('Aseprite image data exceeds the decoded import limit');
    if (size === 0 && data.length === 0) return data;
    const decoded = compressed ? inflateSync(data,{ maxOutputLength:Math.max(1,size) }) : data;
    if (decoded.length !== size) throw new RangeError('Aseprite image byte count does not match its dimensions');
    return decoded;
  };

  const channels = depth/8, frames = [], layers = [], tags = [], slices = [], tilesets = new Map(), issues = [];
  let issueOverflow = 0, paletteBudget = 262144;
  const report = (code,message,details)=>{
    if (issues.length < 4096) issues.push({ code,message,...details });
    else issueOverflow++;
  };
  let palette = Array.from({length:colors},()=>({ rgba:[0,0,0,255] })), modern = false, hasPalette = false;
  for (let index=0;index<count;index++) {
    const length = input.u32();
    const frame = new Reader(input.take(length-4),'frame '+(index+1));
    if (frame.u16() !== 0xf1fa) throw new TypeError('Invalid Aseprite frame signature');
    const oldChunks = frame.u16(), durationMs = frame.u16() || speed;
    frame.skip(2);
    const newChunks = frame.u32(), chunks = newChunks || oldChunks, cels = new Map(), palettes = [];
    const frameId = 'frame-'+(index+1), location = { frame:frameId };
    if (chunks > frame.remaining/6 || chunks > 65536) throw new RangeError('Invalid Aseprite chunk count');
    let lastCel;
    for (let i=0;i<chunks;i++) {
      const length = frame.u32(), type = frame.u16();
      const body = new Reader(frame.take(length-6),'frame '+(index+1)+' chunk 0x'+type.toString(16));
      if ([0x0004,0x0011,0x2019].includes(type)) palettes.push([type,body]);
      else if (type === 0x2004) {
        if (layers.length >= 64) throw new RangeError('Ink supports up to 64 imported layers');
        layers.push(readLayer(body,flags));
      } else if (type === 0x2005) {
        const cel = readCel(body,channels,pixels);
        if (cels.has(cel.layer)) throw new RangeError('Aseprite frame repeats a cel on layer index '+cel.layer);
        cels.set(cel.layer,cel);
        lastCel = cel;
      } else if (type === 0x2006) {
        const flags = body.u32(), bounds = Array.from({length:4},()=>body.i32()/65536);
        if (flags & 1 && lastCel) lastCel.preciseBounds = bounds;
      } else if (type === 0x2007) {
        const profile = body.u16(), flags = body.u16();
        if (profile > 1 || flags & 1)
          report('color-profile','Custom ICC or gamma is unavailable. Pixel values are interpreted as sRGB.',{...location,profile});
      } else if (type === 0x2018) tags.push(...readTags(body));
      else if (type === 0x2022) {
        if (slices.length >= 256) throw new RangeError('Ink supports up to 256 imported slices');
        slices.push(readSlice(body,count));
      } else if (type === 0x2023) {
        const tile = readTileset(body,channels,pixels);
        if (tilesets.has(tile.id)) throw new RangeError('Duplicate Aseprite tileset ID '+tile.id);
        tilesets.set(tile.id,tile);
      } else if (type === 0x2020) {
        const flags = body.u32();
        if (flags) report('user-data','Aseprite user text, colors and custom properties are not imported.',{...location,flags});
      } else {
        const names = { 0x2008:'external files',0x2016:'saved mask',0x2017:'path' };
        report('unsupported-chunk','Skipped Aseprite '+(names[type] ?? 'chunk 0x'+type.toString(16))+'.',{...location,chunk:type});
      }
    }
    if (frame.remaining) throw new RangeError('Aseprite frame size does not match its chunks');
    modern ||= palettes.some(([type])=>type === 0x2019);
    let changed = false;
    for (const [type,body] of palettes) if (!modern || type === 0x2019) {
      palette = applyPalette(body,type,palette);
      changed = hasPalette = true;
    }
    if (changed && (paletteBudget -= palette.length) < 0)
      throw new RangeError('Aseprite palette history exceeds the import budget');
    frames.push({ id:frameId,durationMs,cels,palette,paletteChanged:changed });
  }
  if (input.remaining) throw new RangeError('Unexpected data after the Aseprite timeline');
  if (tags.length > 128 || !layers.length || width*height*layers.length > 4_000_000 ||
      width*height*layers.length*count > 16_000_000)
    throw new RangeError('Aseprite file exceeds the native layer or timeline evaluation budget');
  return { width,height,depth,channels,flags,transparentIndex,aspect:aspect.every(Boolean) ? aspect : [1,1],grid,
    frames,layers,tags,slices,tilesets,hasPalette,issues,report,get issueOverflow() { return issueOverflow; } };
}

module.exports = { readBinary };
