const path = require('node:path');
const curves = require('../src/curve-splat.js');
const ribbons = require('../src/curve-ribbons.js');
const provenance = require('../src/splat-provenance.js');
const camera = require('../src/camera-lens.js');
const sprites = require('../src/atlas-sprites.js');
const { spriteAtlas,exportViews,writeAtlas } = require('./sprite-atlas.js');
const { encodeGray } = require('./png.js');
const { write } = require('./asset-files.js');

const name = value => typeof value === 'string' && Boolean(value.trim());
const axis = [0,1,2];

function selection(world, object, part) {
  const rows = [], objects = new Set(), parts = new Set(), materials = new Set();
  const meta = world.renderMetadata;
  for (let i=0; i<world.count; i++) {
    if (!curves.isRow(world.data,i*16)) continue;
    if (world.curveStrands?.[world.curveStations?.[i*curves.stationStride]-1]?.aggregate) continue;
    const source = meta?.objects?.[meta.objectIds?.[i]], target = meta?.targets?.[meta.targetIds?.[i]];
    if (object !== undefined && source !== object || part !== undefined && target?.part !== part) continue;
    rows.push(i);
    objects.add(source);
    parts.add(target?.part);
    materials.add(meta?.materials?.[meta.materialIds?.[i]]);
  }
  if (!rows.length) throw new RangeError('No finite curve spans match the requested source');
  const one = set => set.size === 1 ? set.values().next().value : undefined;
  return { rows,object:object ?? one(objects) ?? world.id ?? 'curve-bake',
    part:part ?? one(parts),material:one(materials) ?? 'baked-curves' };
}

function shapeBounds(data,count) {
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (let i=0; i<count; i++) {
    const at = i*16, shape = curves.spanShape(data,at,1);
    if (!shape) continue;
    for (const k of axis) {
      const reach = Math.abs(shape.axis[k])*shape.half+shape.radius*shape.support;
      min[k] = Math.min(min[k],data[at+k]-reach);
      max[k] = Math.max(max[k],data[at+k]+reach);
    }
  }
  if (!min.every(Number.isFinite)) throw new RangeError('Cannot frame the selected curve spans');
  return { min,max };
}

function fit(bounds,pivot,views,width,height,padding) {
  const corners = [0,1,2,3,4,5,6,7].map(i=>axis.map(k=>(i>>k&1 ? bounds.max[k] : bounds.min[k])-pivot[k]));
  let units = 0;
  for (const view of views) {
    const {right,up} = sprites.basis(view.yaw,view.pitch);
    for (const point of corners)
      units=Math.max(units,Math.abs(sprites.dot(point,right))/(width*.5-padding),
        Math.abs(sprites.dot(point,up))/(height*.5-padding));
  }
  return { units,radius:Math.max(1,...corners.map(p=>Math.hypot(...p))) };
}

function bakeCurves(world, {
  object, part, width = 96, height = 96, directions = 8, yaw = world?.cam?.yaw ?? 0,
  pitches = [world?.cam?.pitch ?? 0], pivot, padding = 3, time = 0, normals = false, ribbon = true, cutoutMipmaps
} = {}) {
  if (!Number.isSafeInteger(world?.count) || !world.curveSplats || !(world.data instanceof Float32Array))
    throw new TypeError('Curve baking needs a native world containing finite curves');
  if (object !== undefined && !name(object) || part !== undefined && !name(part) ||
      ![width,height].every(n=>Number.isSafeInteger(n) && n>0 && n<=512) ||
      !Number.isFinite(padding) || padding<0 || 2*padding>=Math.min(width,height) ||
      !Number.isFinite(time) || time<0 || typeof normals !== 'boolean' ||
      ribbon !== false && ribbon !== true && (!ribbon || Object.getPrototypeOf(ribbon)!==Object.prototype))
    throw new RangeError('Curve baking needs valid labels, dimensions up to 512, padding, time and map options');
  const source = selection(world,object,part), subset = provenance.subset(world,source.rows);
  const bounds = shapeBounds(subset.data,subset.count);
  const at = pivot === undefined ? axis.map(k=>(bounds.min[k]+bounds.max[k])*.5) : sprites.vector(pivot,'Curve bake pivot');
  const views = exportViews({cam:{yaw,pitch:0}},{directions,yaw,pitches});
  const { units,radius } = fit(bounds,at,views,width,height,padding);
  const lens = camera.view(), dist = units*height*.5/Math.tan(lens.fov*.5);
  const isolated = {
    count:subset.count,data:subset.data,pal:subset.pal,renderMetadata:subset.renderMetadata,
    curveSplats:true,curveClips:subset.curveClips,curveMaterials:subset.curveMaterials,
    curveLighting:subset.curveLighting,curveTiming:subset.curveTiming,curveTimePrograms:subset.curveTimePrograms,
    curvePattern:subset.curvePattern,curvePatternPrograms:subset.curvePatternPrograms,
    curveStations:subset.curveStations,curveStrands:subset.curveStrands,
    radius,cam:{ ...lens,target:at,dist,yaw,pitch:pitches[0] },fog:{ c:0,start:1,max:0 },dither:0
  };
  const columns = Math.min(directions,Math.floor(8192/width));
  if (Math.ceil(views.length/columns)*height > 8192)
    throw new RangeError('Curve bake views exceed the sprite atlas sheet dimensions');
  const atlas = spriteAtlas(isolated,{ width,height,directions,columns,yaw,pitches,pivot:at,
    times:[time],maps:['depth',...(normals ? ['normal'] : [])],normalSpace:'view',cutoutMipmaps,
    curveSurface:true,view:{raw:true,edges:false,curveSubdivision:false,curveLod:false} });
  atlas.metadata.curveBake = {
    format:ribbons.format,version:1,object:source.object,...(source.part && {part:source.part}),
    material:source.material,sourceSpans:source.rows.length,time,
    ...(ribbon && { ribbon:ribbon === true ? {} : { ...ribbon } })
  };
  const coverage = Uint8Array.from({ length:atlas.metadata.width*atlas.metadata.height },(_,i)=>atlas.images.color[i*4+3]);
  if (!coverage.some(Boolean)) throw new RangeError('The selected curves are outside the bake view or have no visible coverage at that time');
  return { atlas,coverage,ribbon:ribbon && ribbons.ribbon(atlas) };
}

function writeCurveBake(directory, { atlas,coverage }) {
  // The standard atlas reader uses color alpha directly. Keep a separate mask
  // for paint, graph and interchange tools.
  const { metadata } = atlas, coverageFile = 'coverage.png';
  write(path.join(directory,coverageFile),encodeGray(metadata.width,metadata.height,coverage));
  writeAtlas(directory,{ ...atlas,metadata:{ ...metadata,curveBake:{ ...metadata.curveBake,coverageFile } } });
}
module.exports = { bakeCurves,writeCurveBake };
