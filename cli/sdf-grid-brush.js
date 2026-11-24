'use strict';

const ArtPasses = require('../src/art-passes.js');
const ViewSource = require('../src/pixel-view-source.js');
const Bindings = require('../src/pixel-source-bindings.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const Targets = require('../src/target-selectors.js');
const Camera = require('../src/camera-lens.js');
const { conflict } = require('./pixel-edit-preview.js');

const fields = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
  Object.keys(raw).every(key=>keys.includes(key));
const finite = (value, a, b) => Number.isFinite(value) && value>=a && value<=b;
const vector = (value,length,check) => Array.isArray(value) && value.length===length && Array.from(value).every(check);
const depthSamples = 16;

function prepare(raw,frame,binding,maxCells) {
  if (!fields(raw,['mode','depth','pixels','selection','camera','minFacing']) || !['add','cut'].includes(raw.mode) ||
      !finite(raw.depth,.005,20) || (raw.pixels===undefined)===(raw.selection===undefined))
    throw new TypeError('A native SDF brush needs add or cut, depth from .005 to 20, and pixels or a named selection');
  const { mode,depth,minFacing=.2,camera={} } = raw;
  if (!finite(minFacing,.05,1) || !fields(camera,['yaw','pitch','dist','target','ortho','fov']) ||
      ['yaw','pitch','dist','fov'].some(key=>camera[key]!==undefined && !Number.isFinite(camera[key])) ||
      camera.dist!==undefined && !finite(camera.dist,.01,1000) ||
      camera.target!==undefined && !vector(camera.target,3,n=>finite(n,-1e5,1e5)) ||
      camera.ortho!==undefined && typeof camera.ortho!=='boolean')
    throw new TypeError('An SDF brush needs a valid camera and a facing cosine from .05 to 1');
  const { width,height } = frame, grid = binding.canvas?.size ?? [width,height];
  ViewSource.grid(...grid);
  const pixels = raw.pixels ?? frame.selections?.find(row=>row.id===raw.selection)?.pixels;
  if (!Array.isArray(pixels) || !pixels.length || pixels.length>maxCells ||
      !Array.from(pixels).every(at=>vector(at,2,Number.isSafeInteger) &&
        at[0]>=0 && at[0]<width && at[1]>=0 && at[1]<height) ||
      new Set(pixels.map(at=>at.join(','))).size!==pixels.length)
    throw new RangeError('The brush footprint needs 1–'+maxCells+' distinct document pixels or a named selection on this frame');
  return { mode,depth,minFacing,camera,grid,pixels };
}

function project(editor,solid,frame,binding,raw,layer) {
  const { KIT } = require('../index.js').load(), { V } = KIT, api = KIT.procedural.gridSculptBrush;
  const { mode,depth,minFacing,camera,grid,pixels } = prepare(raw,frame,binding,api.maxCells);
  if (solid.part || solid.kind==='ground' || solid.ghost || solid.carve || solid.hold)
    throw conflict('unsupported-sdf-brush-target','Grid brushes need a finite, static solid with an editable exterior',
      { binding:binding.id,object:solid.id });
  const world = editor.build(undefined,{ retainRenderSdf:true });
  const [w,h] = grid, selected = { object:solid.id };
  const { render,cameraCapture } = require('./render.js');
  let projection;
  const image = render(world,{ ...camera,w,h,px:1,t:0,raw:true,transparent:true,
    passes:['opaque-surface','partId','sourceSurface'],
    sdfAssist:{ epsilon:.0005,steps:256 },splatOrder:'surface',pixelSelection:selected,
    renderGraph:false,renderGrid:false,cameraGuides:false,inspection:false,shutter:false,composite:false,
    ...cameraCapture(null,(raster,sample)=>{
      if (raster.width!==w || raster.height!==h) return;
      const { eye,right,up,back } = Camera.fromView(raster.view);
      projection = { origin:eye,right:V.mul(right,1/sample.focal),down:V.mul(up,-1/sample.focal),
        forward:V.mul(back,-1),perspective:sample.camera.orthographic===false };
    })
  });
  if (!projection || image.w!==w || image.h!==h || !image.pixelSelection || !image.passes?.surfaceSources)
    throw new Error('Grid sculpt brush could not capture the native surface and camera');
  const { passes } = image, sourceTables = new Map(), hits = [], skipped = [], cells = [], used = new Set();
  let retainedProjection, volume = 0;
  const clipping = frame.layerSources?.get(layer?.id)?.clipping;
  function skip(at,code,details) { skipped.push({ at,code,...details }); }

  for (const at of pixels) {
    const index = at[1]*frame.width+at[0];
    if (frame.locks[index] || clipping && !clipping[index]) {
      skip(at,frame.locks[index] ? 'protected-pixel' : 'clipped-pixel');
      continue;
    }
    if (Bindings.staleAt(binding,at)) { skip(at,'stale-binding-pixel'); continue; }
    const mapped = Canvas.sourcePoint([frame.width,frame.height],at,binding.canvas);
    if (!mapped) { skip(at,'outside-bound-canvas'); continue; }
    const sourceAt = mapped.map(Math.floor), [x,y] = sourceAt, pixel = y*w+x;
    if (used.has(pixel)) { skip(at,'duplicate-bound-pixel',{ sourceAt }); continue; }
    const surface = ArtPasses.pick(passes,x,y);
    if (!surface) { skip(at,'no-surface',{ sourceAt }); continue; }
    const hit = Bindings.sample(image,sourceAt,ArtPasses,surface)?.geometry;
    if (!Targets.objectScope(selected,hit ?? surface) || image.pixelSelection.coverage[pixel]<.9) {
      skip(at,'occluded-or-outside-target',{ sourceAt,object:surface.object });
      continue;
    }
    if (surface.kind!=='sdf' || !vector(hit?.field,2,Number.isSafeInteger)) {
      skip(at,'sdf-address-unavailable',{ sourceAt });
      continue;
    }
    const [sourceIndex,ownerIndex] = hit.field;
    if (!sourceTables.has(sourceIndex)) sourceTables.set(sourceIndex,Array.from(world.renderSdfs?.[sourceIndex]?.rows.keys() ?? []));
    const owner = sourceTables.get(sourceIndex)[ownerIndex];
    if (!owner?.sd || owner.renderTarget?.entity!==solid.id) {
      skip(at,'sdf-address-unavailable',{ sourceAt });
      continue;
    }
    const direction = projection.perspective ? V.norm(V.sub(surface.position,projection.origin)) : projection.forward;
    const facing = -V.dot(surface.geometricNormal,direction);
    if (!Number.isFinite(facing) || facing<minFacing) { skip(at,'grazing-or-back-facing',{ sourceAt,facing }); continue; }

    const pixelSize = V.len(projection.right)*(projection.perspective ? surface.depth : 1);
    const overlap = Math.min(depth*.5,Math.max(.002,pixelSize*.15));
    const near = surface.depth-(mode==='cut' ? overlap : depth), far = surface.depth+(mode==='cut' ? depth : overlap);
    if (near<1e-4 || far>2000) { skip(at,'outside-brush-depth',{ sourceAt }); continue; }
    const space = owner.modifierSpace;
    const toLocal = p=>space ? space.inverse(p) : p.slice();
    retainedProjection ??= {
      origin:toLocal(projection.origin), perspective:projection.perspective,
      ...Object.fromEntries(['right','down','forward'].map(key=>[key,space ?
        V.mul(space.inverseDirection(projection[key]),1/space.scale) : projection[key].slice()]))
    };
    const { intervals,estimate } = affectedDepth(owner.sd,api,projection,grid,x,y,near,far,mode);
    const geometricPoint = toLocal(surface.position);
    used.add(pixel);
    cells.push([x,y,near,far]);
    hits.push({ at,sourceAt,rest:geometricPoint,surfaceDepth:surface.depth,depth:[near,far],changedDepths:intervals });
    volume += estimate;
  }
  if (!hits.length) {
    const conflicts = skipped.map(hit=>({ ...hit,binding:binding.id,message:'Brush pixel cannot address the bound SDF surface' }));
    throw Object.assign(new RangeError('No brush pixels hit a visible, editable SDF surface'),{ conflicts });
  }
  const brush = { version:1,grid,projection:retainedProjection,cells };
  const { bounds } = api.prepare(brush);
  return { modifier:{ kind:'grid-brush',mode,brush },report:{ mode,grid,projectedPixels:hits.length,hits,
    skippedHits:skipped,volume:{ space:'solid-rest',bounds,estimatedWorldVolume:volume,depthSamplesPerPixel:depthSamples } } };
}

function affectedDepth(sd,api,projection,grid,x,y,near,far,mode) {
  const dz = (far-near)/depthSamples;
  const area = Math.hypot(...projection.right)*Math.hypot(...projection.down);
  const intervals = [];
  let estimate = 0, start = null;
  for (let i=0;i<depthSamples;i++) {
    const z = near+(i+.5)*dz;
    const inside = sd(...api.point(projection,grid,x+.5,y+.5,z))<0;
    if (inside===(mode==='cut')) {
      start ??= near+i*dz;
      estimate += area*dz*(projection.perspective ? z*z : 1);
    } else if (start!==null) {
      intervals.push([start,near+i*dz]);
      start = null;
    }
  }
  if (start!==null) intervals.push([start,far]);
  return { intervals,estimate };
}

module.exports = { project };
