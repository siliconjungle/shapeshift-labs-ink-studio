'use strict';

const MeshUV = require('../src/mesh-uv.js');
const Selections = require('../src/pixel-selections.js');
const {checkerIndex} = require('../src/pixel-paint-tools.js');
const Tools = require('./tileset-face-tools.js');
const uvSlip = Symbol.for('ink-studio.spriteSurface.uvSlip');

function localUV(layer, corner, region) {
  const offset = corner*5;
  return [3,8,13].map(i=>[layer.vertices[offset+i]-region.x,layer.vertices[offset+i+1]-region.y]);
}

function footprint(row, source, hit, asset, K) {
  const layer = K.sceneMeshes.layer(row.mesh);
  const chart = layer.surfaceCharts.find(row=>row.materialId===source.material);
  if (!chart || layer.sceneMeshId!==hit.mesh) return;
  const {region,first,end} = chart, triangles = [];
  const low = [asset.width,asset.height], high = [0,0];
  const motion = layer[uvSlip]?.ranges ?? [];
  for (let corner=first;corner<end;corner+=3) {
    if (layer.featureFaces[corner/3]!==source.face) continue;
    if (motion.some(range=>corner>=range.first && corner<range.end)) return;
    const tri = localUV(layer,corner,region);
    for (const [x,y] of tri) {
      low[0] = Math.min(low[0],Math.floor(x));
      low[1] = Math.min(low[1],Math.floor(y));
      high[0] = Math.max(high[0],Math.floor(x));
      high[1] = Math.max(high[1],Math.floor(y));
    }
    triangles.push(tri);
  }
  if (!triangles.length) return;
  const left = Math.max(0,low[0]), top = Math.max(0,low[1]);
  const width = Math.min(asset.width-1,high[0])-left+1, height = Math.min(asset.height-1,high[1])-top+1;
  const at = [source.at[0]-left,source.at[1]-top];
  if (!Selections.contains(width,height,at)) return;
  const local = triangles.map(tri=>tri.map(([x,y])=>[x-left,y-top]));
  const {mask} = MeshUV.texelMask(local,width,height,{sampled:true});
  if (!mask[at[1]*width+at[0]]) return;
  return {rect:[left,top,width,height],mask,at};
}

function plan(row, source, hit, asset, op, K) {
  const {area,tolerance,pattern,colors,size} = op.fill;
  const paints = colors.map(color=>Tools.bindPaint(asset,color));
  if (paints.some(paint=>!paint)) return {conflict:'palette-slot-unavailable'};
  const bounded = footprint(row,source,hit,asset,K);
  if (!bounded) return {conflict:'unresolved-fill-footprint'};
  const {rect,mask,at} = bounded, [left,top,width,height] = rect;
  const raster = Tools.pixels(asset);
  const read = i=>raster.read((top+Math.floor(i/width))*asset.width+left+i%width);
  const match = {type:'wand',at,tolerance,connected:false};
  const inside = {type:'intersect',base:match,with:{type:'bound-footprint'}};
  const query = area==='connected' ? {type:'cluster',at,source:inside} : inside;
  const selection = Selections.mask(width,height,query,read,undefined,undefined,
    item=>item.type==='bound-footprint' ? mask : undefined,true);
  const selectedTexels = selection.reduce((count,value)=>count+value,0);
  const pixels = i=>{
    if (!selection[i]) return;
    const paint = paints[pattern==='checker' ? checkerIndex(left+i%width,top+Math.floor(i/width),size) : 0];
    return paint.pixel(paint.needsSource ? read(i) : 0);
  };
  return {rect,pixels,selection,changedMask:new Uint8Array(selection.length),report:{...op.fill,rect,selectedTexels}};
}

function contact([x,y,width,height], mask) {
  const stride = width+1, counts = new Uint32Array(stride*height);
  for (let row=0;row<height;row++) for (let col=0;col<width;col++) {
    const i = row*stride+col;
    counts[i+1] = counts[i]+mask[row*width+col];
  }
  const crop = {x,y,width,height}, work = {rows:0,limit:4000000};
  return (layer,corner,{region})=>{
    let hit = false;
    const tri = localUV(layer,corner,region);
    const complete = MeshUV.scanSampled(tri,crop,work,(row,left,right)=>{
      const start = (row-y)*stride;
      hit = counts[start+right+1]>counts[start+left];
      if (hit) return false;
    });
    if (!complete) throw new RangeError('Face fill impact review exceeds its scanline budget');
    return hit;
  };
}

function preview([,,w,h], selection, changed) {
  const rgb = new Uint8Array(w*h*3);
  for (let i=0;i<selection.length;i++) if (selection[i])
    rgb.set(changed[i] ? [250,195,89] : [111,160,161],i*3);
  return {w,h,rgb};
}

module.exports = {plan,contact,preview};
