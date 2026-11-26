'use strict';

const UV = require('../src/material-uv.js');
const byte = value=>Number.isInteger(value) && value>=0 && value<=255;
const rgbaValue = value=>Array.isArray(value) && value.length===4 && Array.from(value).every(byte);
const rgbHex = rgb=>'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
const integerSlot = value=>Number.isSafeInteger(value) && value>=0 && value<256;
const channelLayouts = Object.freeze({normal:'normal',roughness:'metallicRoughness',metalness:'metallicRoughness',emission:'emission'});
const fields = (value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));

function pencil({rgba,color,alpha,slot}) {
  if (rgba!==undefined && color===undefined && alpha===undefined && slot===undefined && rgbaValue(rgba)) return {rgba};
  if (slot!==undefined && rgba===undefined && color===undefined && alpha===undefined && integerSlot(slot)) return {slot};
  if (rgba===undefined && slot===undefined && (color!==undefined || alpha!==undefined) &&
      (color===undefined || typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)) && (alpha===undefined || byte(alpha)))
    return {...(color!==undefined && {color:color.toLowerCase()}),...(alpha!==undefined && {alpha})};
}

function fillOptions(input) {
  const {area='connected',tolerance=0,pattern='solid',colors,size=1} = input ?? {};
  if (!fields(input,['area','tolerance','pattern','colors','size']) ||
      !['connected','matching-color'].includes(area) || !byte(tolerance) || !['solid','checker'].includes(pattern) ||
      (pattern==='solid' ? input.size!==undefined : !Number.isSafeInteger(size) || size<1 || size>2048) ||
      !Array.isArray(colors) || colors.length!==(pattern==='solid' ? 1 : 2))
    throw new TypeError('Fill needs a connected or matching-color area and one solid color or two checker colors');
  const paints = Array.from(colors,color=>fields(color,['rgba','color','alpha','slot']) && pencil(color));
  if (paints.some(paint=>!paint)) throw new TypeError('Each fill color needs pencil color, alpha, RGBA, or an exact palette slot');
  return {area,tolerance,pattern,colors:paints,...(pattern==='checker' && {size})};
}

function operation({tool='pencil',rgba,color,alpha,slot,sample,channel,fill}) {
  const write = rgba!==undefined || color!==undefined || alpha!==undefined || slot!==undefined;
  if (tool==='fill') {
    if (write || sample!==undefined || channel!==undefined)
      throw new TypeError('Put fill colors and selection options in the fill object');
    return {tool,fill:fillOptions(fill)};
  }
  if (fill!==undefined) throw new TypeError('Fill options belong to the fill tool');
  if (tool==='eyedropper') {
    if (write || !['color','alpha','source'].includes(sample) ||
        (sample==='source' ? typeof channel!=='string' || channel!=='pigment' && !Object.hasOwn(channelLayouts,channel) : channel!==undefined))
      throw new TypeError('Eyedropper needs color, alpha, or source with a named material channel');
    return {tool,sample,...(channel!==undefined && {channel})};
  }
  if (sample!==undefined || channel!==undefined)
    throw new TypeError('Sampling options belong to the eyedropper');
  if (tool==='eraser' && !write) return {tool};
  if (tool==='pencil') {
    const paint = pencil({rgba,color,alpha,slot});
    if (paint) return {tool,...paint};
  }
  throw new TypeError('Pencil needs RGBA, color and/or alpha, or an exact slot. Eraser takes no color or alpha.');
}

const unpack = value=>[value>>>24,(value>>>16)&255,(value>>>8)&255,value&255];
const paletteValue = (asset,slot)=>asset.palette[slot]*256+(asset.alpha?.[slot] ?? 255);

function pixels(asset) {
  const data = Buffer.from(asset.data,'base64');
  if (asset.encoding!=='indexed8') return {read:i=>data.readUInt32BE(i*4)};
  const palette = asset.palette.map((_,slot)=>paletteValue(asset,slot));
  return {read:i=>palette[data[i]],index:i=>data[i]};
}

function bindPaint(asset, edit) {
  const {tool,slot,color,alpha,rgba} = edit;
  const indexed = asset.encoding==='indexed8';
  if (slot!==undefined && (!indexed || slot>=asset.palette.length)) return;
  if (slot!==undefined || rgba || tool==='eraser') {
    const value = slot!==undefined ? paletteValue(asset,slot) :
      rgba ? rgba.reduce((packed,byte)=>packed*256+byte,0) : 0;
    const pixel = {value,slot:slot!==undefined ? 'slot-'+slot : value===0 ? null : undefined};
    return {pixel:()=>pixel};
  }
  const rgb = color===undefined ? undefined : Number.parseInt(color.slice(1),16);
  return {needsSource:rgb===undefined || alpha===undefined,pixel:before=>({
    value:(rgb ?? (before>>>8))*256+(alpha ?? (before&255))
  })};
}

function pencilOrEraser(asset, at, edit) {
  const paint = bindPaint(asset,edit);
  if (!paint) return;
  const index = at[1]*asset.width+at[0], pixel = paint.pixel(paint.needsSource ? pixels(asset).read(index) : 0);
  return {rgba:unpack(pixel.value),pixel};
}

function sampleMap(K, row, source, hit, channel, asset) {
  const definition = row.tilesetMaterialSources.get(source.material);
  const data = definition?.[channel];
  if (data===undefined) return;
  const bake = row.bakes.find(entry=>entry.material===source.material && !entry.invalidated && entry.maps[channel]!==undefined);
  const provenance = bake ? {kind:'material-bake',bake:bake.id} : {kind:'material-slot'};
  if (typeof data==='number') return {provenance,units:'unit',value:data};

  const mesh = row.mesh, triangle = K.sceneMeshes.sourceTriangle(mesh,hit.drawTriangle);
  if (hit.mesh!==mesh.id || K.meshTopology.triangleSource(mesh,triangle)?.face!==source.face || !hit.barycentric) return;
  const {uvSet,uv} = K.sceneMeshes.channelUV(mesh,triangle,hit.barycentric,channelLayouts[channel]);
  const [x,y] = UV.texel(uv,asset.width,asset.height).map((value,i)=>
    Math.max(0,Math.min(Math.round(value),[asset.width,asset.height][i]-1)));
  const index = y*asset.width+x, stride = data.length/(asset.width*asset.height);
  if (!(channel==='roughness' || channel==='metalness' ? stride===1 :
        channel==='normal' ? stride===4 : [3,4].includes(stride))) return;
  if (channel==='roughness' || channel==='metalness')
    return {provenance,uvSet,uv,at:[x,y],units:'unit',value:data[index]/255,byte:data[index]};
  const value = Array.from(data.slice(index*stride,(index+1)*stride));
  return {provenance,uvSet,uv,at:[x,y],units:stride===4 ? 'rgba8' : 'rgb8',value};
}

function eyedrop(K, row, source, hit, asset, {sample:mode,channel}) {
  if (mode==='source' && channel!=='pigment') {
    const result = sampleMap(K,row,source,hit,channel,asset);
    return result && {mode,channel,...result};
  }
  const raster = pixels(asset), i = source.at[1]*asset.width+source.at[0];
  const rgba = unpack(raster.read(i)), paletteSlot = raster.index?.(i);
  const color = rgbHex(rgba.slice(0,3)), alpha = rgba[3];
  const [units,value] = mode==='color' ? ['rgb-hex',color] : mode==='alpha' ? ['byte',alpha] : ['rgba8',rgba];
  return {mode,...(channel && {channel}),at:source.at,uv:source.uv,units,value,rgba,
    ...(paletteSlot!==undefined && {paletteSlot}),provenance:{kind:'tileset',id:source.tileset}};
}

module.exports = {operation,pencilOrEraser,eyedrop,bindPaint,pixels};
