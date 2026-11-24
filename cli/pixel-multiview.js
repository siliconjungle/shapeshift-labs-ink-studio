'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ArtPasses = require('../src/art-passes.js');
const Bindings = require('../src/pixel-source-bindings.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const Targets = require('../src/target-selectors.js');
const { fromView } = require('../src/camera-lens.js');
const { runs } = require('../src/pixel-paint-tools.js');
const MotionReview = require('./pixel-motion-review.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { indexedValue } = require('./pixel-edit-destinations.js');

const format = 'ink-studio/pixel-multiview';
const backface=1, grazing=2, depthLimit=3, padding=4, otherChart=5;
const reasons=['','backface','grazing-angle','projection-depth','protected-chart-padding','different-chart'];
const id = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const integer = (value,min,max)=>Number.isSafeInteger(value) && value >= min && value <= max;
const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value,fields)=>record(value) && Object.keys(value).every(key=>fields.includes(key));
const at = (value,w,h)=>Array.isArray(value) && value.length === 2 &&
  integer(value[0],0,w-1) && integer(value[1],0,h-1);
const xy = (p,w)=>[p%w,Math.floor(p/w)];
const dot = (a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const unit = value=>{
  const length = Math.hypot(...value);
  return length > 1e-8 ? value.map(n=>n/length) : null;
};
const compareName = (a,b)=>a<b ? -1 : Number(a>b);
const cameraKey = ({sourceView:{camera,frame}})=>JSON.stringify([camera.matrix,camera.focal,camera.orthographic,
  camera.near,camera.far,frame.time,frame.poseTime,frame.cameraTime,frame.skyTime]);

function projectionSettings(raw,size,chart,api) {
  const {minFacing=.15,maxDepth,padding=[0,0]}=raw ?? {};
  if (raw!==undefined && !keys(raw,['minFacing','maxDepth','padding']) ||
      !Number.isFinite(minFacing)||minFacing<0||minFacing>1 ||
      maxDepth!==undefined && (!Number.isFinite(maxDepth)||maxDepth<=0||maxDepth>1e4) ||
      !Array.isArray(padding)||padding.length!==2 ||
      !Array.from(padding).every((n,k)=>integer(n,0,Math.floor((size[k]-1)/2))))
    throw new RangeError('Projection needs a facing cosine, optional positive depth, and two padding insets that leave chart cells');
  const bounds=api.editBounds(chart), depth=Math.min(chart.depth??.035,maxDepth??Infinity);
  const inset=padding.map((n,k)=>Math.max(n,Math.ceil(bounds.min[k]*size[k]-1e-10)));
  return {minFacing,maxDepth:depth,chartFacing:chart.minFacing??.5,padding,inset,
    stamp:{maxDepth:depth,frontOnly:true}};
}

function prepare(raw,design,binding,chart,api) {
  if (!keys(raw,['format','version','id','destination','frame','size','resolve','overrides','views','sourceRevision','documentRevision','projection']) ||
      raw.format !== format || raw.version !== 1 || !id(raw.id) || !Array.isArray(raw.views) ||
      !integer(raw.views.length,2,16) || !Array.isArray(raw.size) || raw.size.length !== 2 ||
      !integer(raw.size[0],1,256) || !integer(raw.size[1],1,128) ||
      !['review','facing'].includes(raw.resolve ?? 'review') ||
      [raw.sourceRevision,raw.documentRevision].some(value=>value !== undefined &&
        (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))))
    throw new TypeError('Use a version 1 pixel multiview plan with 2–16 views and a chart grid up to 256 × 128');
  const grid = binding.canvas?.size ?? [design.width,design.height];
  const samples = raw.views.map(view=>{
    if (!keys(view,['id','time','camera','cut','approved','weight','marks']) ||
        view.approved !== undefined && typeof view.approved !== 'boolean' ||
        view.weight !== undefined && (!Number.isFinite(view.weight) || view.weight <= 0 || view.weight > 16) ||
        view.marks !== undefined && !Array.isArray(view.marks))
      throw new TypeError('A multiview sample needs a camera, optional approval and a list of native marks');
    return { id:view.id,time:view.time ?? 0,camera:view.camera,cut:view.cut };
  });
  MotionReview.plan({version:1,samples},'scene',...grid);
  const views = samples.map((sample,i)=>{
    const { approved = false,weight = 1,marks = [] } = raw.views[i], seen = new Set();
    if (marks.length > 8192) throw new RangeError('A multiview camera supports up to 8192 marked pixels');
    for (const mark of marks) {
      if (!keys(mark,['at','swatch','value']) || !at(mark.at,design.width,design.height) ||
          (mark.swatch === undefined) === (mark.value === undefined) || seen.has(mark.at.join(',')))
        throw new TypeError('Multiview marks need distinct document pixels and a swatch or channel value');
      seen.add(mark.at.join(','));
    }
    return { ...sample,approved,weight,marks };
  });
  const inspecting = !views.some(view=>view.approved && view.marks.length);
  const overrides = new Map(), [w,h] = raw.size;
  if (raw.overrides !== undefined && !Array.isArray(raw.overrides)) throw new TypeError('Multiview overrides need a list');
  for (const row of raw.overrides ?? []) {
    if (!keys(row,['cell','view','pixel']) || !at(row.cell,w,h) ||
        !views.some(view=>view.approved && view.id === row.view) ||
        !at(row.pixel,design.width,design.height) || overrides.has(row.cell[1]*w+row.cell[0]))
      throw new TypeError('A conflict override needs a unique chart cell, approved view ID and document pixel');
    overrides.set(row.cell[1]*w+row.cell[0],row);
  }
  return { views,overrides,grid,size:raw.size,policy:raw.resolve ?? 'review',inspecting,
    projection:projectionSettings(raw.projection,raw.size,chart,api) };
}

function inspectFrame(frame,binding,chart,locate,{size:[width,height],projection}) {
  const { w,h,passes,sourceView } = frame, eye = fromView(sourceView.camera.matrix);
  const cell = new Int32Array(w*h).fill(-1), mapped = cell.slice(), facing = new Float32Array(w*h);
  const chartFacing = new Float32Array(w*h), distance = new Float32Array(w*h);
  const blocked = new Uint8Array(w*h), padded = new Uint8Array(w*h), owner = new Uint8Array(w*h);
  const {minFacing,maxDepth,chartFacing:restFacing,inset:[padX,padY]}=projection;
  const inScope = hit=>hit && Targets.objectScope(binding,hit);
  const splatRows = new Map(passes.splatSources?.slice(1).map(hit=>[hit.renderRow,hit]));
  for (let p=0; p<cell.length; p++) {
    if (!passes.surfaceKind[p]) continue;
    const screen = xy(p,w), surface = ArtPasses.pick(passes,...screen);
    const entry = passes.surfaceSources?.[passes.sourceSurface?.[p]];
    if (!inScope(surface) && !inScope(entry) && !inScope(splatRows.get(passes.splatId[p]-1))) continue;
    const sources = Bindings.sample(frame,screen,ArtPasses,surface);
    const geometry = inScope(sources?.geometry) && sources.geometry;
    const splat = sources?.splats.find(hit=>hit.opaqueOwner && inScope(hit));
    if (!geometry && !splat && !inScope(surface)) continue;
    owner[p] = 1;
    const source = geometry || splat;
    const normal = unit(Array.from(passes.sourceRestNormal.subarray(3*p,3*p+3)));
    const worldNormal = surface?.geometricNormal && unit(surface.geometricNormal);
    if (!source || !normal || !worldNormal) continue;
    const toEye = sourceView.camera.orthographic ? eye.back : unit(eye.eye.map((n,i)=>n-surface.position[i]));
    if (!toEye) continue;
    const direct = source.kind === 'mesh' && source.chart === chart && source.uv;
    const assigned = direct ? { chart,uv:source.uv,distance:0,facing:1 } : source.rest && locate(source.rest,normal);
    if (assigned && assigned.chart !== chart) {
      blocked[p]=otherChart;
      continue;
    }
    const hit=assigned || source.rest && locate.inspect(chart,source.rest,normal);
    if (!hit) continue;
    const [u,v] = hit.uv, x=Math.min(width-1,Math.floor(u*width)), y=Math.min(height-1,Math.floor((1-v)*height));
    const cosine=dot(worldNormal,toEye);
    mapped[p] = y*width+x;
    facing[p] = cosine;
    chartFacing[p]=hit.facing;
    distance[p]=hit.distance;
    padded[p]=Number(x<padX || x>=width-padX || y<padY || y>=height-padY);
    if (cosine<=0 || hit.facing<=0) blocked[p]=backface;
    else if (cosine<minFacing || hit.facing<restFacing) blocked[p]=grazing;
    else if (hit.distance>maxDepth+1e-8) blocked[p]=depthLimit;
    else if (padded[p]) blocked[p]=padding;
    else if (assigned) cell[p]=mapped[p];
  }
  return { w,h,cell,mapped,owner,facing,chartFacing,distance,blocked,padded,chartSize:[width,height] };
}

function markValue(mark,definition,palette,api) {
  if (definition.type === 'indexed') return indexedValue(mark.swatch ?? mark.value,palette);
  if (definition.type === 'normal' || definition.type === 'emission') return api.valueOf(definition,mark.value);
  if (definition.type === 'color') {
    const value = mark.swatch === undefined ? mark.value : palette[mark.swatch];
    const color = typeof value === 'string' ? value : value?.color;
    if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))
      throw new TypeError('A paint mark needs a document swatch or exact #rrggbb value');
    return color.toLowerCase();
  }
  if (mark.swatch !== undefined || !Number.isFinite(mark.value) || mark.value < definition.min || mark.value > definition.max)
    throw new RangeError('A scalar mark needs a value in the destination channel range');
  return mark.value;
}

function addMarks(view,grid,before,binding,design,definition,api,protect,candidates) {
  const rejected = [];
  let accepted = 0;
  if (!view.approved) return { accepted,ignored:view.marks.length,rejected };
  for (const mark of view.marks) {
    const sourceAt = Canvas.sourcePoint(grid,mark.at,binding.canvas)?.map(Math.floor);
    const value = markValue(mark,definition,design.palette,api);
    const index = sourceAt ? sourceAt[1]*before.w+sourceAt[0] : -1, cell = before.cell[index];
    const hidden = Bindings.staleAt(binding,mark.at) ? 'stale-binding-pixel' :
      protect(mark.at) ?? (!sourceAt ? 'outside-registration' :
        cell < 0 ? reasons[before.blocked[index]] || (before.owner[index] ? 'unverified-chart-hit' : 'outside-visible-target') : null);
    if (hidden) {
      rejected.push({ at:mark.at,sourceAt:sourceAt ?? null,reason:hidden,
        ...(before.mapped[index]>=0&&{cell:xy(before.mapped[index],before.chartSize[0]),
          facing:before.facing[index],chartFacing:before.chartFacing[index],distance:before.distance[index]}) });
      continue;
    }
    if (!candidates.has(cell)) candidates.set(cell,[]);
    candidates.get(cell).push({ view:view.id,pixel:mark.at,sourceAt,value,score:before.facing[index]*view.weight });
    accepted++;
  }
  return { accepted,ignored:0,rejected };
}

function resolveCells(candidates,plan) {
  const chosen = new Map(), conflicts = [], widest = plan.size[0];
  for (const [cell,rows] of [...candidates].sort((a,b)=>a[0]-b[0])) {
    rows.sort((a,b)=>b.score-a.score || compareName(a.view,b.view) || a.pixel[1]-b.pixel[1] || a.pixel[0]-b.pixel[0]);
    const mixed = rows.some(row=>JSON.stringify(row.value) !== JSON.stringify(rows[0].value)), override = plan.overrides.get(cell);
    const winner = override ? rows.find(row=>row.view === override.view && row.pixel.every((n,i)=>n === override.pixel[i])) :
      !mixed || plan.policy === 'facing' ? rows[0] : null;
    if (override && !winner) throw new RangeError('Conflict override references an unavailable sample at '+override.cell.join(','));
    if (winner) chosen.set(cell,winner);
    if (mixed || override) conflicts.push({ cell:xy(cell,widest),samples:rows,...(winner && { winner }) });
  }
  for (const [cell,row] of plan.overrides)
    if (!candidates.has(cell)) throw new RangeError('Conflict override references an empty cell at '+row.cell.join(','));
  return { chosen,conflicts };
}

function stamps(chosen,[w,h],projection) {
  const swatches = new Map();
  for (const [cell,{ value }] of chosen) {
    const key = JSON.stringify(value);
    if (!swatches.has(key)) swatches.set(key,{value,cells:new Set()});
    swatches.get(key).cells.add(cell);
  }
  return [...swatches.values()].map(({value,cells})=>({ value,projection,
    brush:{ kind:'bitmap',min:[0,0],max:[1,1],
    rows:Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>cells.has(y*w+x) ? '#' : '.').join('')) } }));
}

function channelEvidence(frame,channel) {
  switch(channel) {
    case 'opacity': return { bytes:frame.passes.surfaceCoverage,stride:1,depth:frame.passes.depth };
    case 'emission': return { bytes:frame.passes.emission,stride:3 };
    case 'normal': return { bytes:frame.passes.shadingNormal,stride:3 };
    case 'roughness': return { bytes:frame.rgb,stride:3 };
    case 'shadow-band': return { bytes:frame.passes.shadowBandBias,stride:1 };
    case 'hatch': return { bytes:frame.passes.hatchWeight,stride:1 };
    case 'outline': return { bytes:frame.passes.outlineWeight,stride:1 };
    case 'light-spill': return { bytes:frame.passes.lightSpillWeight,stride:1 };
    default: return { bytes:frame.passes.pigment,stride:1 };
  }
}

function diagnostics(before,after,chosen,contested,rejected,channel) {
  const { w,h,chartSize:[width,height],mapped,blocked,padded } = before;
  const masks = { changed:[],seams:[],chartEdges:[],padding:[],grazing:[],backfaces:[],depthLimit:[],bleed:[],conflict:[],rejected:[] };
  const skipped = new Set(rejected.flatMap(row=>row.sourceAt ? [row.sourceAt[1]*w+row.sourceAt[0]] : []));
  for (let p=0; p<w*h; p++) {
    const sample = chosen.get(before.cell[p]), {bytes,stride,depth} = before.evidence;
    const depthChanged = depth && Math.abs(depth[p]-after.evidence.depth[p]) > 1e-5;
    let changed = depthChanged || channel.startsWith('mask:') && !!sample;
    for (let c=0;c<stride && !changed;c++)
      changed = Math.abs(bytes[p*stride+c]-after.evidence.bytes[p*stride+c]) > 1e-5;
    if (changed) {
      masks.changed.push(p);
      if (!sample || channel !== 'opacity' && before.cell[p] !== after.cell[p]) masks.bleed.push(p);
    }
    if (contested.has(before.cell[p])) masks.conflict.push(p);
    if (skipped.has(p)) masks.rejected.push(p);
    if (!sample && mapped[p]<0) continue;
    const x = p%w, neighbors = [x>0 ? p-1 : -1,x+1<w ? p+1 : -1,p-w,p+w];
    if (mapped[p]>=0) {
      const [u,v]=xy(mapped[p],width), rim=u===0||v===0||u===width-1||v===height-1;
      if (neighbors.some(q=>q>=0 && q<w*h && (blocked[q]===otherChart || rim&&mapped[q]<0))) masks.chartEdges.push(p);
      if (padded[p]) masks.padding.push(p);
      if (blocked[p]===grazing) masks.grazing.push(p);
      if (blocked[p]===backface) masks.backfaces.push(p);
      if (blocked[p]===depthLimit) masks.depthLimit.push(p);
    }
    if (!sample) continue;
    if (neighbors.some(q=>{
      const other = chosen.get(before.cell[q]);
      return other && other.view !== sample.view && JSON.stringify(other.value) !== JSON.stringify(sample.value);
    })) masks.seams.push(p);
  }
  return { counts:Object.fromEntries(Object.entries(masks).map(([key,indices])=>[key,indices.length])),
    runs:Object.fromEntries(Object.entries(masks).map(([key,indices])=>[key,runs(w,indices)])) };
}

function png(frame,view) {
  const { width,height,rgba } = MotionReview.fromRender({ ...frame,sourceView:undefined },view);
  return PNG.encode(width,height,rgba,4).toString('base64');
}

function review(raw,design,{ binding,destination,source,solid,target,definition,api },{ render,preview,revision,frame,protect,includeImages }) {
  const plan = prepare(raw,design,binding,target,api);
  if (raw.documentRevision !== undefined && raw.documentRevision !== revision)
    throw new RangeError('Multiview approvals were recorded against a different pixel document revision');
  if (raw.sourceRevision !== undefined && raw.sourceRevision !== source.sourceRevision)
    throw new RangeError('Multiview approvals were recorded against a different scene revision');
  const { KIT,makeBuilder } = require('../index.js').load();
  const locate = KIT.diorama.surfaceChart(solid,makeBuilder(0,[0]).frame), candidates = new Map();
  const capture = render();
  const baseline = plan.views.map((view,i)=>{
    const rendered = capture(view,i,plan.grid), before = inspectFrame(rendered,binding,destination.chart,locate,plan);
    before.evidence = channelEvidence(rendered,destination.channel);
    const marks = addMarks(view,[design.width,design.height],before,binding,design,definition,api,protect,candidates);
    return { view,before,marks,key:cameraKey(rendered),...(includeImages && { png:png(rendered,view) }) };
  });
  const { chosen,conflicts } = resolveCells(candidates,plan), projected = stamps(chosen,plan.size,plan.projection.stamp);
  const proposed = projected.length && { id:raw.id,frame,destination:raw.destination,revision,
    sourceRevision:source.sourceRevision,operation:{ stamps:projected } };
  const candidate = proposed && preview(proposed), amended = candidate ? render(candidate) : capture;
  const contested = new Set(conflicts.map(({cell:[x,y]})=>y*plan.size[0]+x));
  const images = [];
  const views = baseline.map(({ view,before,marks,key,png:original },i)=>{
    const rendered = candidate && amended(view,i,plan.grid);
    if (rendered && cameraKey(rendered) !== key)
      throw new RangeError('Multiview preview changed the camera or clock for '+view.id);
    const after = rendered ? inspectFrame(rendered,binding,destination.chart,locate,plan) : before;
    if (rendered) after.evidence = channelEvidence(rendered,destination.channel);
    const finding = diagnostics(before,after,chosen,contested,marks.rejected,destination.channel);
    if (includeImages) images.push({ before:original,after:rendered ? png(rendered,view) : original });
    return { id:view.id,approved:view.approved,time:view.time,...marks,...finding };
  });
  const unresolved = conflicts.filter(row=>!row.winner).length;
  const rejected = views.reduce((total,row)=>total+row.rejected.length,0);
  const ready = !!candidate && !unresolved && !rejected;
  const {stamp,...projection}=plan.projection;
  return { patch:ready ? proposed : null,images,report:{
    format:'ink-studio/pixel-multiview-report',version:1,scene:binding.scene,binding:binding.id,frame,
    destination:destination.id,chart:destination.chart,channel:destination.channel,grid:plan.grid,size:plan.size,
    documentRevision:revision,sourceRevision:source.sourceRevision,status:plan.inspecting ? 'inspection' : ready ? 'ready' : 'needs-review',
    projection,resolution:plan.policy,cells:chosen.size,conflicts,unresolved,rejected,views
  } };
}

function writeReview(file,report,images) {
  const template = fs.readFileSync(path.join(__dirname,'pixel-multiview.html'),'utf8');
  const read = name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
  const data = JSON.stringify({ report,images }).replaceAll('<','\\u003c');
  files.write(file,template.replace('/*CSS*/',()=>read('pixel-grid-canvas.css'))
    .replace('/*SCRIPTS*/',()=>read('pixel-grid-canvas.mjs')).replace('/*DATA*/',()=>data));
}

module.exports = { review,writeReview };
