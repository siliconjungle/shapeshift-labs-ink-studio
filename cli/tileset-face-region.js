'use strict';

const MeshUV = require('../src/mesh-uv.js');
const Selections = require('../src/pixel-selections.js');
const {placeMask} = require('../src/pixel-selection-transforms.js');
const {checkerIndex,drawingGrid} = require('../src/pixel-paint-tools.js');
const {bayerRank} = require('../src/pixel-look.js');
const {digest} = require('./pixel-edit-revisions.js');
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

function clipSelection([left,top,width,height], footprint, input, asset, raster) {
  if (input===undefined) return footprint;
  const {origin=[0,0],grid,pixels} = input;
  let mask, x=0, y=0, w=asset.width, h=asset.height;
  if (input.type!==undefined) {
    mask = Selections.mask(w,h,input,raster.read,undefined,undefined,undefined,true);
  } else {
    if (!Selections.contains(w,h,origin) || !Array.isArray(grid) || grid.length!==2 ||
        input.origin===undefined && (grid[0]!==w || grid[1]!==h) ||
        !grid.every((n,i)=>Number.isSafeInteger(n) && n>0 && origin[i]+n<=[w,h][i]) || !Array.isArray(pixels))
      throw new RangeError('A saved pixel selection needs an atlas grid or registered crop origin');
    [x,y] = origin;
    [w,h] = grid;
    mask = Selections.fromPixels(w,h,pixels,true);
  }
  return footprint.map((covered,i)=>{
    if (!covered) return 0;
    const col = left+i%width-x, row = top+Math.floor(i/width)-y;
    return col>=0 && row>=0 && col<w && row<h ? mask[row*w+col] : 0;
  });
}

function fillSelection(width,height,mask,at,read,{area,tolerance}) {
  const match = {type:'wand',at,tolerance,connected:false};
  const inside = {type:'intersect',base:match,with:{type:'bound-footprint'}};
  const query = area==='connected' ? {type:'cluster',at,source:inside} : inside;
  return Selections.mask(width,height,query,read,undefined,undefined,
    item=>item.type==='bound-footprint' ? mask : undefined,true);
}

function stamp([left,top,width,height], mask, [x,y], asset, op, K) {
  const result = new Uint8Array(mask.length);
  const grid = op.drawing && drawingGrid(asset.width,asset.height,op.drawing,true);
  const mark = i=>{
    const col = i%asset.width-left, row = Math.floor(i/asset.width)-top;
    if (col>=0 && row>=0 && col<width && row<height && mask[row*width+col]) result[row*width+col] = 1;
  };
  const dab = (u,v)=>grid ? grid.pixels(u,v,mark) : mark(v*asset.width+u);
  if (!op.spray) {
    dab(x,y);
    return result;
  }
  const {radius,density,seed} = op.spray, {hash,hash01} = K.procedural.data;
  const seedHash = hash('tileset spray/'+seed);
  for (let v=Math.max(0,y-radius);v<=Math.min(asset.height-1,y+radius);v++) {
    for (let u=Math.max(0,x-radius);u<=Math.min(asset.width-1,x+radius);u++) {
      const distance = Math.hypot(u-x,v-y);
      if (distance<=radius && hash01(u+','+v,seedHash)<density*(1-distance/(radius+1))) dab(u,v);
    }
  }
  return result;
}

function ditherIndex({pattern,mix,seed}, K) {
  if (mix===0 || mix===1) return ()=>mix;
  const phase = seed===0 ? 0 : K.procedural.data.hash('tileset dither/'+seed);
  if (pattern==='bayer') return (x,y)=>Number(bayerRank(x+(phase&3),y+((phase>>>2)&3))<mix);
  const {width,height,ranks} = K.procedural.materials.blueNoise({seed:phase});
  return (x,y)=>Number((ranks[(y%height)*width+(x%width)]+.5)/ranks.length<mix);
}

function usesRegion(op) {
  return ['fill','spray','dither','transform'].includes(op.tool) || op.drawing!==undefined || op.selection!==undefined;
}

function transform(rect, mask, active, raster, asset, op, K) {
  const [left,top,width,height] = rect, selection = active.slice();
  const sources = new Int32Array(mask.length).fill(-1);
  let placedTexels = 0, clippedPixels = 0;
  const mapped = placeMask(width,height,active,[left,top],op.transform,(x,y,from)=>{
    const col = x-left, row = y-top, i = row*width+col;
    if (col<0 || row<0 || col>=width || row>=height || !mask[i]) {
      clippedPixels++;
      return;
    }
    sources[i] = from;
    selection[i] = 1;
    placedTexels++;
  },K.authoring.tilesets.maxEdge);
  const selectedTexels = active.reduce((count,value)=>count+value,0);
  const report = {mode:op.mode,settings:op.transform,rect,...mapped,selectedTexels,placedTexels,clippedPixels,
    selectionRevision:digest([rect,active])};
  if (!mapped || !placedTexels) return {conflict:!mapped ? 'empty-transform-selection' : 'empty-transform-placement',report};
  const pixels = i=>{
    const from = sources[i];
    if (from>=0) {
      const at = (top+Math.floor(from/width))*asset.width+left+from%width;
      const slot = raster.index?.(at);
      return {value:raster.read(at),...(slot!==undefined && {index:slot})};
    }
    if (op.mode==='move' && active[i]) return {value:0,slot:null};
  };
  return {rect,pixels,selection,changedMask:new Uint8Array(mask.length),report};
}

function plan(row, source, hit, asset, op, K) {
  const colors = op.fill?.colors ?? op.dither?.colors ?? [op];
  const paints = op.tool==='transform' ? undefined : colors.map(color=>Tools.bindPaint(asset,{...color,alphaMode:op.alphaMode}));
  if (paints?.some(paint=>!paint)) return {conflict:'palette-slot-unavailable'};
  const bounded = footprint(row,source,hit,asset,K);
  if (!bounded) return {conflict:op.fill ? 'unresolved-fill-footprint' : 'unresolved-paint-footprint'};
  const {rect,mask,at} = bounded, [left,top,width,height] = rect;
  const raster = Tools.pixels(asset);
  const active = clipSelection(rect,mask,op.selection,asset,raster);
  if (op.tool==='transform') return transform(rect,mask,active,raster,asset,op,K);
  const read = i=>raster.read((top+Math.floor(i/width))*asset.width+left+i%width);
  const selection = op.fill ? fillSelection(width,height,active,at,read,op.fill) : active;
  const candidates = op.fill || op.dither ? selection : stamp(rect,selection,source.at,asset,op,K);
  const choose = op.dither ? ditherIndex(op.dither,K) : op.fill?.pattern==='checker' ?
    (x,y)=>checkerIndex(x,y,op.fill.size) : ()=>0;
  const selectedTexels = selection.reduce((count,value)=>count+value,0);
  const pixels = i=>{
    if (!candidates[i]) return;
    const paint = paints[choose(left+i%width,top+Math.floor(i/width))];
    return paint.pixel(paint.needsSource ? read(i) : 0);
  };
  const {tool,selection:input,...settings} = op;
  const report = {...(op.fill ?? settings),rect,selectedTexels,
    ...(!op.fill && {candidateTexels:candidates.reduce((count,value)=>count+value,0)}),
    ...(input && {selectionRevision:digest([rect,active])})};
  return {rect,pixels,selection,changedMask:new Uint8Array(selection.length),report};
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
    if (!complete) throw new RangeError('Face paint impact review exceeds its scanline budget');
    return hit;
  };
}

function preview([,,w,h], selection, changed) {
  const rgb = new Uint8Array(w*h*3);
  for (let i=0;i<selection.length;i++) if (selection[i])
    rgb.set(changed[i] ? [250,195,89] : [111,160,161],i*3);
  return {w,h,rgb};
}

module.exports = {usesRegion,plan,contact,preview};
