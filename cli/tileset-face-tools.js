'use strict';

const UV = require('../src/material-uv.js');
const {over} = require('../src/art-passes.js');
const byte = value=>Number.isInteger(value) && value>=0 && value<=255;
const rgbaValue = value=>Array.isArray(value) && value.length===4 && Array.from(value).every(byte);
const rgbHex = rgb=>'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
const slotId = value=>typeof value==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const integerSlot = value=>Number.isSafeInteger(value) && value>=0 && value<256;
const channelLayouts = Object.freeze({normal:'normal',roughness:'metallicRoughness',metalness:'metallicRoughness',emission:'emission'});
const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));

function pencil({rgba,color,alpha,slot}) {
  if (rgba!==undefined && color===undefined && alpha===undefined && slot===undefined && rgbaValue(rgba)) return {rgba};
  if (slot!==undefined && rgba===undefined && color===undefined && alpha===undefined && (integerSlot(slot) || slotId(slot))) return {slot};
  if (rgba===undefined && slot===undefined && (color!==undefined || alpha!==undefined) &&
      (color===undefined || typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)) && (alpha===undefined || byte(alpha)))
    return {...(color!==undefined && {color:color.toLowerCase()}),...(alpha!==undefined && {alpha})};
}

function paintColors(colors) {
  const paints = Array.from(colors,color=>fields(color,['rgba','color','alpha','slot']) && pencil(color));
  if (paints.some(paint=>!paint)) throw new TypeError('Each pattern color needs pencil color, alpha, RGBA, or an exact palette slot');
  return paints;
}

function fillOptions(input) {
  const {area='connected',tolerance=0,pattern='solid',colors,size=1} = input ?? {};
  if (!fields(input,['area','tolerance','pattern','colors','size']) ||
      !['connected','matching-color'].includes(area) || !byte(tolerance) || !['solid','checker'].includes(pattern) ||
      (pattern==='solid' ? input.size!==undefined : !Number.isSafeInteger(size) || size<1 || size>2048) ||
      !Array.isArray(colors) || colors.length!==(pattern==='solid' ? 1 : 2))
    throw new TypeError('Fill needs a connected or matching-color area and one solid color or two checker colors');
  return {area,tolerance,pattern,colors:paintColors(colors),...(pattern==='checker' && {size})};
}

const fraction = value=>Number.isFinite(value) && value>=0 && value<=1;
function sprayOptions(input={}) {
  const {radius=4,density=.65,seed=0} = input ?? {};
  if (!fields(input,['radius','density','seed']) || !Number.isSafeInteger(radius) || radius<0 || radius>512 ||
      !fraction(density) || !Number.isSafeInteger(seed))
    throw new TypeError('Spray needs a radius of 0–512 texels, unit density, and an integer seed');
  return {radius,density,seed};
}

function ditherOptions(input) {
  const {pattern='bayer',mix=.5,seed=0,colors} = input ?? {};
  if (!fields(input,['pattern','mix','seed','colors']) || !['bayer','blue-noise'].includes(pattern) ||
      !fraction(mix) || !Number.isSafeInteger(seed) || !Array.isArray(colors) || colors.length!==2)
    throw new TypeError('Dither needs Bayer or blue-noise, two colors, a unit mix, and an integer seed');
  return {pattern,mix,seed,colors:paintColors(colors)};
}

function operation({tool='pencil',rgba,color,alpha,slot,sample,channel,fill,spray,dither,drawing,selection,alphaMode,strength,mode,transform}) {
  const write = rgba!==undefined || color!==undefined || alpha!==undefined || slot!==undefined;
  if (alphaMode!==undefined && (!['pencil','spray','fill','dither'].includes(tool) ||
      !['replace','accumulate'].includes(alphaMode)))
    throw new TypeError('Choose replace or accumulate alpha for pencil, spray, fill, or dither');
  if (strength!==undefined && (tool!=='eraser' || !fraction(strength)))
    throw new TypeError('Eraser strength must be between 0 and 1');
  if (selection!==undefined && !record(selection))
    throw new TypeError('Choose a native selection query or saved atlas pixel selection');
  if (drawing!==undefined && (!['pencil','eraser','spray'].includes(tool) ||
      !fields(drawing,['mirrorX','mirrorY']) || ![drawing.mirrorX,drawing.mirrorY].some(n=>n!==undefined) ||
      !Object.values(drawing).every(n=>n===undefined || typeof n==='number' && Number.isSafeInteger(n*2))))
    throw new TypeError('Use mirrorX or mirrorY in atlas texel coordinates with pencil, eraser, or spray');
  const scope = {...(selection!==undefined && {selection}),...(drawing!==undefined && {drawing}),
    ...(alphaMode!==undefined && {alphaMode}),...(strength!==undefined && {strength})};
  if (fill!==undefined && tool!=='fill' || spray!==undefined && tool!=='spray' || dither!==undefined && tool!=='dither')
    throw new TypeError('Pattern settings must match the selected tool');
  if (tool==='transform') {
    const selectedMode = mode===undefined ? 'move' : mode;
    if (write || sample!==undefined || channel!==undefined || selection===undefined ||
        !['move','copy'].includes(selectedMode) || !record(transform))
      throw new TypeError('A bound transform needs an atlas selection, transform settings, and optional move or copy mode');
    return {tool,mode:selectedMode,transform,selection};
  }
  if (mode!==undefined || transform!==undefined)
    throw new TypeError('Use mode and transform with the transform tool');
  if (tool==='fill' || tool==='dither') {
    if (write || sample!==undefined || channel!==undefined)
      throw new TypeError('Put pattern colors in the fill or dither object');
    return {tool,...(tool==='fill' ? {fill:fillOptions(fill)} : {dither:ditherOptions(dither)}),...scope};
  }
  if (tool==='eyedropper') {
    if (write || selection!==undefined || !['color','alpha','source'].includes(sample) ||
        (sample==='source' ? typeof channel!=='string' || channel!=='pigment' && !Object.hasOwn(channelLayouts,channel) : channel!==undefined))
      throw new TypeError('Eyedropper needs color, alpha, or source with a named material channel');
    return {tool,sample,...(channel!==undefined && {channel})};
  }
  if (sample!==undefined || channel!==undefined)
    throw new TypeError('Sampling options belong to the eyedropper');
  if (tool==='eraser' && !write) return {tool,...scope};
  if (tool==='pencil' || tool==='spray') {
    const paint = pencil({rgba,color,alpha,slot});
    if (paint) return {tool,...paint,...(tool==='spray' && {spray:sprayOptions(spray)}),...scope};
  }
  throw new TypeError('Pencil and spray need RGBA, color and/or alpha, or an exact slot. Eraser takes no color or alpha.');
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
  const {tool,slot:requested,color,alpha,rgba,alphaMode,strength=1} = edit;
  const indexed = asset.encoding==='indexed8';
  const slot = typeof requested==='string' ? asset.paletteMetadata?.swatchIds.indexOf(requested) ??
    (indexed ? asset.palette.findIndex((_,i)=>requested==='slot-'+i) : -1) : requested;
  if (slot!==undefined && (!indexed || slot<0 || slot>=asset.palette.length)) return;
  if (tool==='eraser') {
    if (strength===1) return {pixel:()=>({value:0,slot:null})};
    return {needsSource:true,pixel:before=>({value:(before>>>8)*256+Math.round(over(0,before&255,strength))})};
  }
  const fixed = slot!==undefined ? paletteValue(asset,slot) : rgba?.reduce((packed,byte)=>packed*256+byte,0);
  const rgb = fixed!==undefined ? fixed>>>8 : color===undefined ? undefined : Number.parseInt(color.slice(1),16);
  const input = fixed!==undefined ? fixed&255 : alpha;
  if (alphaMode==='accumulate' && input!==undefined) return {needsSource:true,pixel:before=>({
    value:(rgb ?? (before>>>8))*256+Math.round(over(255,before&255,input/255)),
    ...(slot!==undefined && {index:slot})
  })};
  if (fixed!==undefined) {
    const pixel = {value:fixed,...(slot!==undefined ? {index:slot} : fixed===0 && {slot:null})};
    return {pixel:()=>pixel};
  }
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
    ...(paletteSlot!==undefined && {paletteSlot}),
    ...(asset.paletteMetadata && {swatchId:asset.paletteMetadata.swatchIds[paletteSlot]}),provenance:{kind:'tileset',id:source.tileset}};
}

const previewsCoverage = op=>op.alphaMode!==undefined || op.strength!==undefined;
module.exports = {operation,pencilOrEraser,eyedrop,bindPaint,pixels,previewsCoverage};
