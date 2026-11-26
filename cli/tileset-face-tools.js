'use strict';

const UV = require('../src/material-uv.js');
const byte = value=>Number.isInteger(value) && value>=0 && value<=255;
const rgbaValue = value=>Array.isArray(value) && value.length===4 && Array.from(value).every(byte);
const rgbHex = rgb=>'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
const integerSlot = value=>Number.isSafeInteger(value) && value>=0 && value<256;
const channelLayouts = Object.freeze({normal:'normal',roughness:'metallicRoughness',metalness:'metallicRoughness',emission:'emission'});

function operation({tool='pencil',rgba,color,alpha,slot,sample,channel}) {
  const write = rgba!==undefined || color!==undefined || alpha!==undefined || slot!==undefined;
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
    if (rgba!==undefined && color===undefined && alpha===undefined && slot===undefined && rgbaValue(rgba)) return {tool,rgba};
    if (slot!==undefined && rgba===undefined && color===undefined && alpha===undefined && integerSlot(slot)) return {tool,slot};
    if (rgba===undefined && slot===undefined && (color!==undefined || alpha!==undefined) &&
        (color===undefined || typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)) && (alpha===undefined || byte(alpha)))
      return {tool,...(color!==undefined && {color:color.toLowerCase()}),...(alpha!==undefined && {alpha})};
  }
  throw new TypeError('Pencil needs RGBA, color and/or alpha, or an exact slot. Eraser takes no color or alpha.');
}

function texel(asset, at, exactSlot) {
  const indexed = asset.encoding==='indexed8';
  if (exactSlot!==undefined && (!indexed || exactSlot>=asset.palette.length)) return;
  const i = at[1]*asset.width+at[0];
  if (!indexed) {
    const data = Buffer.from(asset.data,'base64');
    return {rgba:Array.from(data.subarray(i*4,(i+1)*4))};
  }
  const slot = exactSlot ?? Buffer.from(asset.data,'base64')[i], color = asset.palette[slot];
  return {rgba:[color>>>16,(color>>>8)&255,color&255,asset.alpha?.[slot] ?? 255],paletteSlot:slot};
}

function pencilOrEraser(asset, at, edit) {
  const {tool,slot,color,alpha} = edit;
  let rgba = tool==='eraser' ? [0,0,0,0] : edit.rgba;
  if (!rgba) {
    const before = texel(asset,at,slot);
    if (!before) return;
    const pigment = color?.slice(1).match(/../g).map(pair=>Number.parseInt(pair,16)) ?? before.rgba.slice(0,3);
    rgba = [...pigment,alpha ?? before.rgba[3]];
  }
  const value = rgba.reduce((packed,byte)=>packed*256+byte,0);
  const clear = tool==='eraser' || edit.rgba!==undefined && value===0;
  return {rgba,pixel:{value,slot:slot!==undefined ? 'slot-'+slot : clear ? null : undefined}};
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
  const {rgba,paletteSlot} = texel(asset,source.at);
  const color = rgbHex(rgba.slice(0,3)), alpha = rgba[3];
  const [units,value] = mode==='color' ? ['rgb-hex',color] : mode==='alpha' ? ['byte',alpha] : ['rgba8',rgba];
  return {mode,...(channel && {channel}),at:source.at,uv:source.uv,units,value,rgba,
    ...(paletteSlot!==undefined && {paletteSlot}),provenance:{kind:'tileset',id:source.tileset}};
}

module.exports = {operation,pencilOrEraser,eyedrop};
