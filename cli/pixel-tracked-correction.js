'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ArtPasses = require('../src/art-passes.js');
const Targets = require('../src/target-selectors.js');
const Bindings = require('../src/pixel-source-bindings.js');
const Motion = require('../src/pixel-motion-checks.js');
const Track = require('./pixel-selection-track.js');
const Review = require('./pixel-motion-review.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { digest } = require('./pixel-edit-revisions.js');

const format = 'ink-studio/pixel-tracked-correction';
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const fields = (row, keys) => row && Object.getPrototypeOf(row) === Object.prototype &&
  Object.keys(row).every(key => keys.includes(key));
const key = at => at.join(',');
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function bridge(a, b) {
  const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
  return (dx === 2 && !dy || dy === 2 && !dx) ? a.map((v, i) => (v + b[i]) / 2) : null;
}

function prepare(design, raw) {
  if (design.version !== 2 || !fields(raw, ['format','version','id','binding','layer','samples','marks']) ||
      raw.format !== format || raw.version !== 1 || ![raw.id,raw.binding,raw.layer].every(id) ||
      !Array.isArray(raw.samples) || raw.samples.length < 2 || !Array.isArray(raw.marks) ||
      !raw.marks.length || raw.marks.length > 512)
    throw new TypeError('Use a version 1 tracked correction plan with 2 or more samples and 1–512 marks');
  const binding = design.sceneBindings?.find(row => row.id === raw.binding);
  const layer = design.layers.find(row => row.id === raw.layer);
  if (!binding || !layer || (layer.kind ?? 'paint') !== 'paint')
    throw new RangeError('Tracked corrections need a scene binding and an editable paint layer');
  if (binding.frame !== undefined && binding.frame !== raw.samples[0]?.frame)
    throw new RangeError('The first sample must use the frame registered to the binding');
  const frames = new Map(design.frames.map(row => [row.id,row]));
  const usedFrames = new Set(), documentGrid = [design.width,design.height], grid = binding.canvas?.size ?? documentGrid;
  const samples = Array.from(raw.samples, row => {
    if (!fields(row, ['id','frame','label','time','camera','cut']) || !id(row.id) ||
        !frames.has(row.frame) || usedFrames.has(row.frame))
      throw new TypeError('Each correction sample needs a unique existing document frame and a scene view ID');
    usedFrames.add(row.frame);
    const { frame,...view } = row;
    return { view,frame };
  });
  const views = { version:1,samples:samples.map(row => row.view) };
  Review.plan(views,'scene',...grid);
  const inside = at => Array.isArray(at) && at.length === 2 &&
    [at[0],at[1]].every((value,i) => Number.isSafeInteger(value) && value >= 0 && value < documentGrid[i]);
  const marks = new Set(), anchors = new Map();
  for (const mark of raw.marks) {
    if (!fields(mark,['at','kind','swatch','anchors']) || !inside(mark.at) || marks.has(key(mark.at)) ||
        !['highlight','contour','gap'].includes(mark.kind) ||
        !(mark.swatch === null || id(mark.swatch) && Object.hasOwn(design.palette,mark.swatch)))
      throw new TypeError('Each correction mark needs a unique native pixel, a kind and a palette swatch or null');
    marks.add(key(mark.at));
    if (mark.anchors !== undefined) {
      if (mark.kind !== 'gap' || !Array.isArray(mark.anchors) || mark.anchors.length !== 2 ||
          ![mark.anchors[0],mark.anchors[1]].every(inside))
        throw new TypeError('Only a gap can supply two in-bounds anchors');
      const middle = bridge(...mark.anchors);
      if (!middle || !same(middle,mark.at)) throw new RangeError('Gap anchors must straddle their pixel on one axis');
    }
    for (const at of mark.anchors ?? [mark.at]) anchors.set(key(at),at);
  }
  return { binding,documentGrid,grid,samples,views,pixels:[...anchors.values()] };
}

function inverseRegistration(grid, canvas) {
  const size = canvas?.size ?? grid;
  const offset = canvas?.offset ?? [0,0], scale = canvas?.scale ?? [1,1];
  const axes = size.map((n,i) => {
    const axis = new Int32Array(n).fill(-1);
    for (let p = 0; p < grid[i]; p++) {
      const at = Math.floor(offset[i] + (p+.5)*scale[i]);
      if (at >= 0 && at < n) axis[at] = axis[at] === -1 ? p : -2;
    }
    return axis;
  });
  return at => {
    const point = at.map((n,i) => axes[i][n]);
    if (point.includes(-2)) return { reason:'ambiguous-registration' };
    return point.some(n => n === undefined || n < 0) ? { reason:'outside-registration' } : { target:point };
  };
}

function gapAt(mark, matches, full, binding) {
  const anchors = mark.anchors.map(at => matches.get(key(at)));
  const at = anchors.every(row => row.at) ? bridge(...anchors.map(row => row.at)) : null;
  if (anchors.some(row => row.status !== 'visible'))
    return { reason:'gap-anchor-unresolved',anchors,...(at && { at }),
      blocker:anchors.find(row => row.blocker)?.blocker };
  if (!at) return { reason:'gap-span-changed',anchors };
  const hit = ArtPasses.pick(full.passes,...at);
  if (hit) {
    const sample = Bindings.sample(full,at,ArtPasses,hit);
    const front = sample?.frontSplat;
    const owner = sample?.geometry ?? sample?.splats.find(splat => splat.opaqueOwner) ?? hit;
    const blocker = front && front.depth < owner.depth-1e-5 && !Targets.objectScope(binding,front) ? front :
      !Targets.objectScope(binding,owner) ? owner : null;
    if (blocker)
      return { reason:'gap-blocked',at,anchors,blocker:{ kind:blocker.kind,object:blocker.object ?? null,part:blocker.part ?? null } };
    if (sample?.truncated) return { reason:'gap-owner-unknown',at,anchors };
  }
  if (!hit && (full.alpha?.[at[1]*full.w+at[0]] ?? 0) > 0)
    return { reason:'gap-owner-unknown',at,anchors };
  return { at,anchors };
}

function evaluate(mark, matches, full, plan, frame, source, layer, inverse, index, referenceGaps) {
  const entry = { reference:mark.at,kind:mark.kind,swatch:mark.swatch,status:'unresolved' };
  let location;
  if (mark.anchors) {
    const referenceReason = referenceGaps.get(key(mark.at));
    if (referenceReason) return { ...entry,reason:'reference-gap-unverified',referenceReason };
    if (Bindings.staleAt(plan.binding,mark.at)) return { ...entry,reason:'stale-source-binding' };
    location = gapAt(mark,matches,full,plan.binding);
  } else {
    const correspondence = matches.get(key(mark.at));
    if (correspondence.status !== 'visible')
      return { ...entry,reason:correspondence.reason ?? correspondence.status,correspondence };
    location = { at:correspondence.at,correspondence };
  }
  const { at:sourceAt,reason,...evidence } = location;
  const result = { ...entry,...evidence,...(sourceAt && { sourceAt }) };
  if (reason) return { ...result,reason };
  const destination = inverse(sourceAt);
  if (!destination.target) return { ...result,...destination };
  const at = destination.target;
  if (!index && !same(at,mark.at)) return { ...result,reason:'reference-registration-mismatch',at };
  const p = at[1]*frame.width+at[0], slot = source.slots[p];
  const before = frame.swatches[slot] ?? null;
  const beforeAlpha = slot >= 0 ? (source.alpha?.[p] ?? 255) : 0;
  Object.assign(result,{ at,before,beforeAlpha,beforeKnockout:slot === -2 });
  if (mark.swatch === null ? slot === -1 : mark.swatch === before && beforeAlpha === 255)
    return { ...result,status:'unchanged' };
  if (layer.effectiveLock) return { ...result,reason:'locked-layer' };
  if (frame.locks[p]) return { ...result,reason:'protected-pixel' };
  if (source.clipping && !source.clipping[p]) return { ...result,reason:'clipped-pixel' };
  return { ...result,status:'verified' };
}

function avoidCollisions(marks) {
  const counts = new Map();
  for (const mark of marks) if (mark.at)
    counts.set(key(mark.at),(counts.get(key(mark.at)) ?? 0) + 1);
  for (const mark of marks) if (mark.at && mark.status !== 'unresolved' && counts.get(key(mark.at)) > 1)
    Object.assign(mark,{ status:'unresolved',reason:'destination-collision' });
}

function bytes(swatch, design) {
  if (swatch === null) return null;
  const raw = design.palette[swatch], color = typeof raw === 'string' ? raw : raw.color;
  return [1,3,5].map(i => parseInt(color.slice(i,i+2),16)).concat(255);
}

const viewPNG = ({width,height,rgba}) => PNG.encode(width,height,rgba,4).toString('base64');

function run(design, raw, { compile,edit,captureTrack,approval,includeImages = false }) {
  const plan = prepare(design,raw);
  const { binding,documentGrid,views,pixels,samples } = plan;
  const sourceAt = inverseRegistration(documentGrid,binding.canvas);
  const selection = { id:raw.id,frame:samples[0].frame,pixels };
  const revision = compile(design,selection.frame).revision;
  const frames = [], images = [], evidence = [], referenceGaps = new Map();
  let candidate = design;
  Track.track({ binding,selection,documentGrid,revision,views,render:captureTrack(binding.scene,binding),
    visit({ index,row,full,matches }) {
      const { frame:frameId } = samples[index];
      const frame = compile(candidate,frameId,undefined,raw.layer);
      const source = frame.layerSources.get(raw.layer), layer = frame.layerStack.rows.get(raw.layer);
      const correspondences = new Map(matches.map(match => [key(match.documentAt),match]));
      const marks = Array.from(raw.marks,mark => {
        const result = evaluate(mark,correspondences,full,plan,frame,source,layer,sourceAt,index,referenceGaps);
        if (!index && mark.anchors && result.reason && result.beforeAlpha === undefined)
          referenceGaps.set(key(mark.at),result.reason);
        return result;
      });
      avoidCollisions(marks);
      const verified = marks.filter(mark => mark.status === 'verified');
      const unresolved = marks.filter(mark => mark.status === 'unresolved').length;
      const unchanged = marks.length - verified.length - unresolved;
      if (verified.length) {
        const pixels = verified.map(({ at,swatch }) => ({ at,rgba:bytes(swatch,design),...(swatch !== null && { swatch }) }));
        candidate = edit(candidate,frame,{ id:raw.id,frame:frameId,revision:frame.revision,destination:'raster',
          operation:{ tool:'rgba',layer:raw.layer,pixels } });
      }
      frames.push({ id:row.id,frame:frameId,label:row.label ?? row.id,time:row.time,sourceFrame:full.sourceView.frame,
        camera:full.sourceView.camera,status:unresolved ? (verified.length || unchanged ? 'partial' : 'needs-review') : 'resolved',
        counts:{ verified:verified.length,unchanged,unresolved },marks });
      evidence.push(digest([full.rgb,full.alpha,full.passes.surfaceKind,full.passes.depth,full.passes.objectId]));
      if (includeImages) images.push({ before:viewPNG(Motion.fromRaster(frame)),
        after:viewPNG(Motion.fromRaster(compile(candidate,frameId))),
        source:viewPNG(Review.fromRender({ ...full,sourceView:undefined },row)) });
    }
  });
  const token = digest([format,raw,revision,frames,evidence]);
  if (approval !== undefined && approval !== token)
    throw new RangeError('Tracked correction approval is stale. Review the current document and source samples again.');
  const counts = frames.reduce((totals,row) => {
    for (const key of Object.keys(totals)) totals[key] += row.counts[key];
    return totals;
  },{ verified:0,unchanged:0,unresolved:0 });
  const report = { format:format+'-report',version:1,id:raw.id,mode:approval === undefined ? 'preview' : 'applied',
    approval:token,revision,resultRevision:compile(candidate,selection.frame).revision,scene:binding.scene,binding:binding.id,
    layer:raw.layer,grid:documentGrid,sourceGrid:plan.grid,reference:views.samples[0].id,counts,
    unresolvedFrames:frames.filter(row => row.counts.unresolved).map(row => row.frame),frames };
  return { report,images,document:approval === undefined ? undefined : candidate };
}

function writeReview(file, images, report) {
  const data = JSON.stringify({ images,report }).replaceAll('<','\\u003c');
  const template = fs.readFileSync(path.join(__dirname,'pixel-tracked-correction.html'),'utf8');
  files.write(file,template.replace('/*DATA*/',() => data));
}

module.exports = { run,writeReview };
