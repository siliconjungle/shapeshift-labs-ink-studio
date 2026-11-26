const path = require('node:path');
const fs = require('node:fs');
const AreaLights = require('../src/area-lights.js');
const CameraLens = require('../src/camera-lens.js');
const PbrMaterials = require('../src/pbr-materials.js');
const toDisplay = require('../src/color-space.js').prepare('srgb-linear', 'srgb');
const ShotLighting = require('../src/shot-lighting.js');
const Targets = require('../src/target-selectors.js');
const FrameComposite = require('../src/frame-composite.js');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const passNames = ['pigment', 'position', 'shadingNormal', 'surfaceCoverage'];
const registrationPasses = ['objectPosition', 'surfaceUV', 'surfaceUVValid', 'surfaceKind'];
const ambient = .36;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

function lightFrames(camera, bounds, steps) {
  const {min,max} = bounds;
  const aim = min.map((n,i) => n + (max[i] - n) * .5);
  const distance = Math.min(200, Math.max(.25, Math.hypot(...max.map((n,i) => n - min[i]))));
  const view = Array.from(camera.view);
  const right = [view[0],view[4],view[8]], up = [view[1],view[5],view[9]], front = [view[2],view[6],view[10]];
  return Array.from({length:steps}, (_,i) => {
    const azimuth = -65 + 130 * i / (steps - 1), angle = azimuth * Math.PI / 180;
    const at = aim.map((n,k) => n + distance * (Math.sin(angle) * right[k] + Math.cos(angle) * front[k] + .32 * up[k]));
    const emitter = {id:'paint-review-key', at, normal:aim.map((n,k) => n - at[k]),
      shape:'disk', size:[distance*.07,distance*.07], radius:distance*4, bias:.001,
      intensity:2, color:'#ffffff', sampleGrid:1, shadows:false, visible:false};
    return {azimuth, emitter};
  });
}

function reviewPaintLighting(world, {view = {}, subject, steps = 5, ranges} = {}) {
  const {w = 160, h = 96, px = 1} = view;
  const time = view.t ?? view.time ?? world.lookSnapshot?.time ?? 0;
  if (!integer(w,1,1024) || !integer(h,1,1024) || px !== 1 ||
      !integer(steps,3,13) || w*h*(steps+2)>8_000_000 || !Number.isFinite(time) || time < 0)
    throw new RangeError('Paint lighting needs a bounded native grid with px 1, a finite scene time, and 3 to 13 light positions');
  if (subject !== undefined && (!subject || Object.getPrototypeOf(subject)!==Object.prototype ||
      !Targets.name(subject.object) || subject.part!==undefined && !Targets.name(subject.part) ||
      Object.keys(subject).some(key=>!['object','part'].includes(key))))
    throw new TypeError('Choose a subject by object ID and optional part ID');
  if (ranges !== undefined) {
    if (!Array.isArray(ranges) || !integer(ranges.length, 1, 7) ||
        !Array.from(ranges).every(n => Number.isFinite(n) && n >= .35 && n <= 5) ||
        new Set(ranges).size !== ranges.length || w*h*ranges.length*(3*steps+3) > 24_000_000)
      throw new RangeError('Paint review needs 1 to 7 distinct camera range multipliers from .35 to 5 within its pixel budget');
    return reviewRanges(world, { view, subject, steps, ranges, time });
  }
  const { camera, cameraRow, authored, neutral, coverage, samples, bounds, passes } =
    capturePaint(world, { view, subject, time });
  const { position, shadingNormal } = passes;
  const sweep = samples.length ? lightFrames(camera,bounds,steps).map(({azimuth,emitter},i)=>{
    const lights=AreaLights.prepare([emitter]), gains=[0,0,0];
    const rgb=neutral.rgb.slice();
    let changedPixels=0;
    for (const p of samples) {
      const at=p*3;
      AreaLights.evaluate(lights,position.subarray(at,at+3),shadingNormal.subarray(at,at+3),gains);
      for (let k=0;k<3;k++) gains[k]+=ambient;
      const lit=ShotLighting.shade(Array.from(neutral.rgb.subarray(at,at+3),n=>n/255),gains);
      for (let k=0;k<3;k++) rgb[at+k]=Math.round(lit[k]*255);
      changedPixels+=Number(lit.some((_n,k)=>rgb[at+k]!==neutral.rgb[at+k]));
    }
    return {id:'light-'+String(i+1).padStart(2,'0'),azimuth,emitter,changedPixels,image:{...neutral,rgb}};
  }) : [];
  const report = {format:'ink-studio/paint-lighting-review',version:1,scene:world.id??world.spec?.id??null,
    width:neutral.w,height:neutral.h,time,poseTime:cameraRow.poseTime,camera:cameraRow.camera,subject:subject??null,coverage,
    sweep:{ambient,mode:'diffuse',frames:sweep.map(({image,...row})=>row)}};
  return {report,authored,neutral,sweep:sweep.map(({image})=>image)};
}

function capturePaint(world, { view, subject, time, extended = false }) {
  const { w = 160, h = 96 } = view;
  const channels = extended ? [...passNames, ...registrationPasses] : passNames;
  let camera, shot;
  const capture = R.cameraCapture(view, (projection, sample) => {
    if (projection.width===w && projection.height===h) {
      camera=projection;
      shot=sample;
    }
  });
  const frame = R.render(world, {...view,...capture,w,h,px:1,t:time,time,
    captureBasePaint:true,capturePaintFinish:extended,passes:channels,pixelSelection:subject??false,
    ...(extended && {depthOfField:false,motionalCoverage:false,surfaceHistory:false}),
    samples:false,captureCoverage:false,composite:false,renderGraph:false,inspection:false,
    renderGrid:false,shutter:false,afterimages:false,cameraGuides:false});
  const {passes,basePaint} = frame;
  if (!camera || frame.w!==w || frame.h!==h || basePaint?.alpha.length!==w*h ||
      channels.some(name=>!passes?.[name]) || extended && frame.paintFinish?.length!==w*h*2 ||
      subject && frame.pixelSelection?.coverage.length!==w*h)
    throw new Error('Paint lighting needs aligned pigment, geometry and authored color on one native grid');

  const {pigment,position,shadingNormal,surfaceCoverage} = passes;
  const matte = frame.pixelSelection?.coverage;
  const neutral = {w,h,rgb:new Uint8Array(w*h*3),alpha:new Uint8Array(w*h)};
  const authored = {w,h,rgb:frame.rgb, ...(frame.alpha && {alpha:frame.alpha})};
  const bounds = {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const coverage = {visible:0,retainedPaint:0,packedColor:0,missingPaint:0,relightable:0};
  const samples = [];
  for (let p=0; p<w*h; p++) {
    if (!surfaceCoverage[p] || matte && matte[p]<=.5 || frame.alpha?.[p]===0) continue;
    coverage.visible++;
    const at=p*3;
    if (basePaint.alpha[p]) {
      neutral.rgb.set(basePaint.rgb.subarray(at,at+3),at);
      coverage.retainedPaint++;
    } else if (pigment[p]) {
      const color=pigment[p]-1;
      neutral.rgb.set([color>>16,color>>8&255,color&255],at);
      coverage.packedColor++;
    } else {
      coverage.missingPaint++;
      continue;
    }
    neutral.alpha[p]=255;
    const point=position.subarray(at,at+3), normal=shadingNormal.subarray(at,at+3);
    if (!point.every(Number.isFinite) || !normal.every(Number.isFinite) || Math.hypot(...normal)<.5) continue;
    for (let k=0;k<3;k++) {
      bounds.min[k]=Math.min(bounds.min[k],point[k]);
      bounds.max[k]=Math.max(bounds.max[k],point[k]);
    }
    samples.push(p);
  }
  if (!extended && !coverage.visible) throw new RangeError(subject ? 'The selected subject has no visible surface pixels' : 'The shot has no visible surface pixels');
  coverage.relightable=samples.length;
  const cameraRow = { poseTime:shot.frame.poseTime, camera:{ eye:Array.from(camera.eye), matrix:Array.from(camera.view),
    ortho:camera.ortho, focal:shot.focal, time:shot.frame.cameraTime } };
  return { camera, shot, cameraRow, passes, authored, neutral, coverage, samples, bounds, finish:frame.paintFinish };
}

function worldKeys(camera, steps) {
  const { back, right, up } = CameraLens.fromView(camera.view), elevation = 18 * Math.PI / 180;
  return Array.from({ length:steps }, (_,i) => {
    const azimuth = -65 + i * 130 / (steps - 1), angle = azimuth * Math.PI / 180;
    const direction = back.map((n,k) => Math.cos(elevation) * (n * Math.cos(angle) + right[k] * Math.sin(angle)) +
      up[k] * Math.sin(elevation));
    return { id:'light-' + String(i+1).padStart(2,'0'), azimuth, elevation:18, direction };
  });
}

function reviewRange(capture, keys) {
  const { camera, neutral, passes, samples, finish } = capture;
  const { position, shadingNormal, surfaceUVValid, surfaceUV, objectPosition, surfaceKind } = passes;
  const { w, h, alpha } = neutral;
  const empty = () => ({ w, h, rgb:new Uint8Array(w*h*3), alpha:new Uint8Array(w*h) });
  const roughness = empty(), sampleRows = [], registration = { uv:0, rest:0, roughness:0, kinds:{} };
  for (let p=0; p<alpha.length; p++) {
    if (!alpha[p]) continue;
    if (surfaceUVValid[p]) registration.uv++;
    const kind = ['none','mesh','sdf','splat','sprite','emitter'][surfaceKind[p]];
    registration.kinds[kind] = (registration.kinds[kind] ?? 0) + 1;
    if (['mesh','sdf','splat'].includes(kind) && objectPosition.subarray(p*3,p*3+3).every(Number.isFinite)) registration.rest++;
    const rough = finish[p*2];
    if (!Number.isFinite(rough)) continue;
    registration.roughness++;
    roughness.rgb.fill(Math.round(Math.min(1,Math.max(0,rough))*255),p*3,p*3+3);
    roughness.alpha[p] = alpha[p];
  }
  const forward = CameraLens.fromView(camera.view).back;
  for (const p of samples) {
    const at = p*3, point = position.subarray(at, at+3), normal = shadingNormal.subarray(at, at+3);
    const rough = finish[p*2], metal = finish[p*2+1], known = Number.isFinite(rough);
    sampleRows.push({ p, at, known, normal, position:point,
      ...(Number.isFinite(metal) && { metalness:metal }), ...(known && { roughness:rough }),
      view:camera.ortho ? forward : camera.eye.map((n,k)=>n-point[k]),
      color:Array.from(neutral.rgb.subarray(at,at+3),n=>n/255) });
  }
  const white = '#ffffff', directSpecular = [0,0,0];
  const keyFrames = keys.map(({ direction }) => {
    const plan = PbrMaterials.prepare({ materials:{ finish:{} },
      environment:{ sky:white, horizon:white, ground:white, intensity:ambient },
      lights:[{ direction, color:white, intensity:2.65 }] });
    const lit = { ...neutral, rgb:neutral.rgb.slice() }, relief = empty(), highlights = empty();
    for (const entry of sampleRows) {
      const { p, at, known, normal } = entry;
      const facing = Math.max(0, direction.reduce((total,n,k)=>total+n*normal[k],0));
      relief.rgb.fill(Math.round(38 + facing*205),at,at+3);
      relief.alpha[p] = alpha[p];
      if (known) {
        const rgb = PbrMaterials.shade(plan, 1, { ...entry, directSpecular });
        lit.rgb.set(rgb.map(n=>Math.round(n*255)),at);
        const toned = toDisplay(directSpecular.map(n=>1-Math.exp(-2*n)));
        highlights.rgb.set(toned.map(n=>Math.round(n*255)),at);
        highlights.alpha[p] = alpha[p];
      } else {
        const rgb = ShotLighting.shade(entry.color,[ambient+facing,ambient+facing,ambient+facing]);
        lit.rgb.set(rgb.map(n=>Math.round(n*255)),at);
      }
    }
    return { lit, relief, highlights };
  });
  return { roughness, keyFrames, registration, coordinates:{ surfaceUV, surfaceUVValid, objectPosition, surfaceKind } };
}

function reviewRanges(world, { view, subject, steps, ranges, time }) {
  const reference = capturePaint(world,{ view, subject, time, extended:true }), pose = CameraLens.fromView(reference.camera.view);
  const initialDistance = reference.shot.camera.distance;
  const keys = worldKeys(reference.camera, steps);
  const views = ranges.map((range,i) => {
    const distance = initialDistance * range;
    const camera = { ...view.camera, pose:{ ...pose, eye:pose.eye.map((n,k)=>n+(distance-initialDistance)*pose.back[k]) } };
    const capture = range === 1 ? reference : capturePaint(world, {
      view:{ ...view,camera,dist:distance,ortho:reference.camera.ortho,lockCamera:true,
        cameraOrbitOffset:undefined,cameraStaging:false },
      subject,time,extended:true });
    const { registration, ...data } = reviewRange(capture, keys);
    return { id:'view-' + String(i+1).padStart(2,'0'), range, distance, ...capture.cameraRow,
      coverage:capture.coverage, registration, authored:capture.authored, neutral:capture.neutral, ...data };
  });
  if (!views.some(row=>row.coverage.visible))
    throw new RangeError(subject ? 'The selected subject has no visible surface pixels' : 'The shot has no visible surface pixels');
  const report = { format:'ink-studio/paint-lighting-review', version:2, scene:world.id??world.spec?.id??null,
    width:reference.neutral.w, height:reference.neutral.h, time, subject:subject??null,
    rig:{ space:'world', ambient, keys }, views:views.map(({ authored,neutral,roughness,keyFrames,coordinates,...row })=>row) };
  return { report, views };
}

function comparisonSheet(tiles, columns) {
  const kit=require('../index.js').load().KIT, {w,h}=tiles[0].image;
  const cols=Math.min(tiles.length,columns ?? (tiles.length<7 ? 3 : 4));
  const cellWidth=Math.max(96,w)+8, cellHeight=h+23;
  const width=cols*cellWidth+8, height=Math.ceil(tiles.length/cols)*cellHeight+8;
  const draw=[], layers=[];
  for (const [i,{image,label}] of tiles.entries()) {
    const x=8+(i%cols)*cellWidth+Math.floor((cellWidth-8-w)/2);
    const y=8+Math.floor(i/cols)*cellHeight;
    draw.push({type:'text',text:label,at:[x+w/2,y+6],size:10,color:'#e3ebf7'});
    layers.push({source:image,rect:[x,y+16,w,h]});
  }
  const plan=kit.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(18,24,36)},
    kit.frameComposite.layers(plan,{},0),width,height,'nearest');
}

function writeImage(directory, name, image) {
  const file = name + '.png';
  files.write(path.join(directory, file), PNG.encodeFrame(PNG.packFrame(image)));
  return file;
}

function writeRanges(directory, { report, views }) {
  const labelled = [];
  const records = views.map((view, index) => {
    const out = {};
    for (const [mode,label] of [['neutral','Pigment'],['roughness','Roughness'],['authored','Authored']])
      out[mode] = writeImage(directory, view.id + '/' + mode, view[mode]);
    const middle = Math.floor(report.rig.keys.length / 2);
    out.keys = view.keyFrames.map((frame, i) => {
      const paths = {};
      for (const [name, image] of Object.entries(frame))
        paths[name] = writeImage(directory, view.id + '/' + report.rig.keys[i].id + '-' + name, image);
      return paths;
    });
    for (const [label,image] of [['Pigment',view.neutral],['Directional',view.keyFrames[middle].lit],
      ['Relief',view.keyFrames[middle].relief],['Roughness',view.roughness],['Highlights',view.keyFrames[middle].highlights]])
      labelled.push({ label:view.range + 'x ' + label, image });
    return { ...report.views[index], files:out };
  });
  const summary = { ...report, views:records, files:{ comparison:'comparison.png', viewer:'review.html' } };
  writeImage(directory,'comparison',comparisonSheet(labelled,5));
  const file=path.join(directory,'review.json');
  files.json(file, summary);
  for (const ext of ['html','js'])
    files.write(path.join(directory,'review.' + ext),fs.readFileSync(path.join(__dirname,'paint-review-viewer.' + ext)));
  files.write(path.join(directory,'review-data.js'),'const paintReview = ' + JSON.stringify(summary) + ';\n');
  return file;
}

function writeReview(directory, review) {
  if (review.report.version === 2) return writeRanges(directory, review);
  const {report,authored,neutral,sweep} = review;
  const labelled = [{name:'neutral', label:'Neutral paint', image:neutral},
    {name:'authored', label:'Authored shot', image:authored},
    ...report.sweep.frames.map(({id,azimuth},i)=>({name:id,label:'Light '+Math.round(azimuth)+' deg',image:sweep[i]}))];
  const manifest = {};
  const write = (name,image) => { manifest[name] = writeImage(directory,name,image); };
  for (const row of labelled) write(row.name,row.image);
  write('comparison',comparisonSheet(labelled));
  if (sweep.length) {
    const loop=sweep.concat(sweep.slice(1,-1).reverse());
    files.write(path.join(directory,'sweep.png'),PNG.encodeAnimation(loop.map(PNG.packFrame),6));
    manifest.sweep='sweep.png';
  }
  const file=path.join(directory,'review.json');
  files.json(file,{...report,files:manifest});
  return file;
}

module.exports = {reviewPaintLighting,writeReview};
