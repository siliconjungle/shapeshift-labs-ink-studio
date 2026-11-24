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
const Timeline = require('./pixel-cel-timeline.js');
const Shot = require('../src/shot-corrections.js');

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
  return { binding,documentGrid,grid,samples,views,pixels:markPixels(design,raw.marks,documentGrid) };
}

function markPixels(design,input,documentGrid) {
  const inside = at => Array.isArray(at) && at.length === 2 &&
    [at[0],at[1]].every((value,i) => Number.isSafeInteger(value) && value >= 0 && value < documentGrid[i]);
  const marks = new Set(), anchors = new Map();
  for (const mark of input) {
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
  return [...anchors.values()];
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

function prepareMotion(design,raw) {
  if (design.version !== 2 || !fields(raw,['format','version','id','binding','frame','target','samples','marks']) ||
      raw.format !== format || raw.version !== 2 || ![raw.id,raw.binding].every(id) ||
      !Array.isArray(raw.samples) || raw.samples.length < 2 ||
      !Array.isArray(raw.marks) || !raw.marks.length || raw.marks.length > 512)
    throw new TypeError('Use a version 2 tracked correction with a target, at least two samples and 1–512 marks');
  const binding = design.sceneBindings?.find(row=>row.id === raw.binding);
  if (!binding) throw new RangeError('Unknown pixel scene binding '+raw.binding);
  const { target } = raw, frame = raw.frame ?? binding.frame ?? design.frames[0].id;
  if (!design.frames.some(row=>row.id === frame) || binding.frame !== undefined && binding.frame !== frame)
    throw new RangeError('Motion edit needs the document frame registered to its binding');
  const documentGrid = [design.width,design.height], grid = binding.canvas?.size ?? documentGrid;
  const pixels = markPixels(design,raw.marks,documentGrid);
  const shot = target?.kind === 'shot', cels = target?.kind === 'cels';
  const lookup = cels && Timeline.index(design.frames), used = new Set();
  let clock, previousKey = -1;
  if (cels) {
    if (!fields(target,['kind'])) throw new TypeError('Name the cels to write on each sample');
  } else if (shot) {
    if (!fields(target,['kind','frames','fps','startTime','depthTolerance']) ||
        !Array.isArray(target.frames) || target.frames.length !== 2 ||
        !Array.from(target.frames).every(n=>Number.isSafeInteger(n) && n >= 0 && n <= 1e9) ||
        target.frames[0] > target.frames[1])
      throw new TypeError('A shot target needs an ordered inclusive range of shot frames and an FPS');
    clock = Shot.prepare({ size:grid,fps:target.fps,startTime:target.startTime });
  } else if (!fields(target,['kind','destination','size','projection']) || target.kind !== 'rest' || !id(target.destination)) {
    throw new TypeError('Choose a rest, cels, or shot target for the motion edit');
  }
  if (!cels && raw.marks.some(mark=>mark.swatch === null || mark.anchors))
    throw new TypeError('Rest and shot edits need colored marks. Use the cels target for erasures and flanked gaps.');

  const samples = Array.from(raw.samples,(sample,index)=>{
    if (!fields(sample,['id','label','time','camera','cut',...(cels ? ['cels'] : shot ? ['shotFrame'] : [])]) ||
        !id(sample.id))
      throw new TypeError('Each motion edit sample needs a scene view ID and timing');
    const { cels:ids = [],shotFrame,...view } = sample;
    if (cels) {
      if (!Array.isArray(ids) || !Array.from(ids).every(key=>Timeline.celName(key) && lookup.locations.has(key)))
        throw new RangeError('Motion edit samples need existing cel IDs');
      const cells = ids.map(key=>{
        if (used.has(key)) throw new RangeError('Each selected cel needs just one motion sample: '+key);
        used.add(key);
        return lookup.locations.get(key);
      });
      const destinationFrame = cells[0]?.frame ?? frame;
      if (cells.some(cell=>cell.frame !== destinationFrame) || !index && destinationFrame !== frame)
        throw new RangeError('Each sample targets one document frame, and the first uses the reference frame');
      return { view,frame:destinationFrame,cells };
    }
    if (shot) {
      const [first,last] = target.frames;
      if (!Number.isSafeInteger(shotFrame) || shotFrame <= previousKey || shotFrame < first || shotFrame > last ||
          Math.abs(view.time-(clock.startTime+shotFrame/clock.fps)) > 1e-8)
        throw new RangeError('Shot keys need ascending shotFrame indices in range and times on the shot clock');
      previousKey = shotFrame;
    }
    return { view,frame,shotFrame };
  });
  if (cels && !used.size) throw new RangeError('Choose at least one cel for the motion edit');
  const views = { version:1,samples:samples.map(row=>row.view) };
  Review.plan(views,'scene',...grid);
  return { binding,frame,target,grid,documentGrid,pixels,samples,views,clock,lookup };
}

function reportMotion(raw,plan,revision,frames,evidence,artifact,patch,approval) {
  const { binding,frame,target,documentGrid,grid,views } = plan;
  const resultRevision = digest(artifact);
  const token = digest([format,raw,revision,frames,evidence,resultRevision,patch]);
  if (approval !== undefined && approval !== token)
    throw new RangeError('Tracked correction approval is stale. Review the current document and source samples again.');
  const counts = { verified:0,unchanged:0,unresolved:0 };
  for (const row of frames) for (const key of Object.keys(counts)) counts[key] += row.counts[key];
  return { format:format+'-report',version:2,id:raw.id,mode:approval === undefined ? 'preview' : 'applied',
    target:target.kind,artifact:{ rest:'scene',cels:'document',shot:'shot-corrections' }[target.kind],
    approval:token,revision,resultRevision,scene:binding.scene,binding:binding.id,frame,
    grid:documentGrid,sourceGrid:grid,reference:views.samples[0].id,counts,
    unresolvedFrames:[...new Set(frames.filter(row=>row.counts.unresolved).map(row=>row.frame))],frames };
}

function runMotion(design,raw,{ compile,edit,captureTrack,world,rest,approval,includeImages }) {
  const plan = prepareMotion(design,raw);
  const { binding,frame:referenceFrame,target,pixels,views,samples,documentGrid,lookup } = plan;
  const reference = compile(design,referenceFrame), revision = reference.revision;
  if (target.kind === 'rest') {
    const result = rest({ format:'ink-studio/pixel-multiview',version:1,id:raw.id,destination:target.destination,
      frame:referenceFrame,size:target.size,projection:target.projection,views:samples.map(({ view },index)=>({
        id:view.id,time:view.time,camera:view.camera,cut:view.cut,approved:index === 0,
        ...(index === 0 && { marks:raw.marks.map(({ at,swatch })=>({ at,swatch })) })
      })) },binding,includeImages);
    const token = digest([format,raw,revision,result.report,result.artifact,result.patch]);
    if (approval !== undefined && approval !== token)
      throw new RangeError('Tracked correction approval is stale. Review the current document and source samples again.');
    return { ...result,reviewKind:'rest',report:{ ...result.report,format:format+'-report',version:2,id:raw.id,target:'rest',artifact:'scene',
      mode:approval === undefined ? 'preview' : 'applied',approval:token,revision,
      ...(result.artifact && { resultRevision:digest(result.artifact) }) },
      artifact:approval === undefined ? undefined : result.artifact };
  }

  const isShot = target.kind === 'shot', frameRows = [], pictures = [], evidence = [], writes = [], keys = [];
  const inverse = inverseRegistration(documentGrid,binding.canvas), referenceGaps = new Map();
  Track.track({ binding,selection:{ id:raw.id,frame:referenceFrame,pixels },documentGrid,revision,views,
    render:captureTrack(binding.scene,binding,{ shot:isShot }),
    visit({ index,row,full,matches }) {
      const sample = samples[index], byPixel = new Map(matches.map(match=>[key(match.documentAt),match]));
      const captured = isShot ? reference : compile(design,sample.frame,undefined,true);
      const marks = [];
      function tracked(mark) {
        return { reference:mark.at,kind:mark.kind,swatch:mark.swatch,status:'unresolved' };
      }
      if (isShot) {
        const pixels = [];
        for (const mark of raw.marks) {
          const correspondence = byPixel.get(key(mark.at)), report = { ...tracked(mark),correspondence,at:correspondence.at };
          if (correspondence.status !== 'visible') report.reason = correspondence.reason ?? correspondence.status;
          else {
            const pin = full.shotCorrectionSurface?.pin(...correspondence.at);
            if (!pin?.target || typeof pin.splat !== 'string' || !Targets.objectScope(binding,pin.target))
              report.reason = 'no-stable-shot-pin';
            else Object.assign(report,{ status:'verified',pin });
          }
          marks.push(report);
        }
        avoidCollisions(marks);
        for (const mark of marks) if (mark.status === 'verified')
          pixels.push({ anchor:mark.pin,color:typeof design.palette[mark.swatch] === 'string' ? design.palette[mark.swatch] : design.palette[mark.swatch].color });
        keys.push({ frame:sample.shotFrame,pixels });
      } else {
        // Check the original gap even when the reference is used only for tracking.
        if (!index) for (const mark of raw.marks) if (mark.anchors) {
          const result = gapAt(mark,byPixel,full,binding);
          if (result.reason) referenceGaps.set(key(mark.at),result.reason);
        }
        for (const { cel,layer } of sample.cells) {
          const source = captured.layerSources.get(layer), definition = captured.layerStack.rows.get(layer);
          const [dx,dy] = Timeline.offset(definition,lookup.cels.get(cel));
          const celMarks = raw.marks.map(mark=>{
            const result = evaluate(mark,byPixel,full,plan,captured,source,
              { effectiveLock:definition.effectiveLock || definition.kind === 'reference' },inverse,index,referenceGaps);
            if (result.status === 'verified' && (result.at[0]-dx < 0 || result.at[0]-dx >= captured.width ||
                result.at[1]-dy < 0 || result.at[1]-dy >= captured.height))
              Object.assign(result,{ status:'unresolved',reason:'outside-cel' });
            return { ...result,cel,layer };
          });
          avoidCollisions(celMarks);
          const pixels = celMarks.filter(mark=>mark.status === 'verified').map(({ at,swatch })=>({ at,swatch }));
          if (pixels.length) writes.push({ cel,pixels });
          marks.push(...celMarks);
        }
      }
      const counts = { verified:0,unchanged:0,unresolved:0 };
      for (const mark of marks) counts[mark.status]++;
      frameRows.push({ id:row.id,frame:isShot ? sample.shotFrame : sample.frame,label:row.label ?? row.id,time:row.time,
        sourceFrame:full.sourceView.frame,camera:full.sourceView.camera,counts,marks,
        status:counts.unresolved ? (counts.verified || counts.unchanged ? 'partial' : 'needs-review') : 'resolved' });
      evidence.push(digest([full.rgb,full.alpha,full.passes.surfaceKind,full.passes.depth,full.passes.objectId,full.passes.partId]));
      if (includeImages) {
        const source = Review.fromRender({ ...full,sourceView:undefined },row);
        const before = isShot ? viewPNG(source) : viewPNG(Motion.fromRaster(captured));
        let after;
        if (isShot) {
          for (const mark of marks) if (mark.status === 'verified') {
            const [x,y] = mark.at;
            source.rgba.set(bytes(mark.swatch,design),(y*source.width+x)*4);
          }
          after = viewPNG(source);
        }
        pictures.push({ before,after,source:isShot ? before : viewPNG(source) });
      }
    }
  });
  let artifact = design, patch;
  if (isShot) {
    const prior = Shot.prepare(world(binding.scene).look?.shotCorrections), { clock } = plan;
    if (prior && (prior.fps !== clock.fps || prior.startTime !== clock.startTime || !same(prior.size,clock.size)))
      throw new RangeError('Motion edit needs the existing shot grid and clock');
    artifact = Shot.paint(prior ?? clock,{ id:raw.id,frames:target.frames,keys,
      ...(target.depthTolerance !== undefined && { depthTolerance:target.depthTolerance }) });
  } else if (writes.length) {
    patch = { id:raw.id,revision,destination:'timeline',operation:{ type:'write-cels',cels:writes } };
    artifact = edit(design,reference,patch);
  }
  if (includeImages && !isShot) for (const [index,picture] of pictures.entries())
    picture.after = viewPNG(Motion.fromRaster(compile(artifact,samples[index].frame)));
  const report = reportMotion(raw,plan,revision,frameRows,evidence,artifact,patch,approval);
  return { report,images:pictures,patch,artifact:approval === undefined ? undefined : artifact };
}

function writeReview(file, images, report) {
  const data = JSON.stringify({ images,report }).replaceAll('<','\\u003c');
  const template = fs.readFileSync(path.join(__dirname,'pixel-tracked-correction.html'),'utf8');
  files.write(file,template.replace('/*DATA*/',() => data));
}

module.exports = { run,runMotion,writeReview };
