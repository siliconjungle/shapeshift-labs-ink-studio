const path = require('node:path');
const AreaLights = require('../src/area-lights.js');
const ShotLighting = require('../src/shot-lighting.js');
const Targets = require('../src/target-selectors.js');
const FrameComposite = require('../src/frame-composite.js');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const passNames = ['pigment', 'position', 'shadingNormal', 'surfaceCoverage'];
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

function reviewPaintLighting(world, {view = {}, subject, steps = 5} = {}) {
  const {w = 160, h = 96, px = 1} = view;
  const time = view.t ?? view.time ?? world.lookSnapshot?.time ?? 0;
  if (!integer(w,1,1024) || !integer(h,1,1024) || px !== 1 ||
      !integer(steps,3,13) || w*h*(steps+2)>8_000_000 || !Number.isFinite(time) || time < 0)
    throw new RangeError('Paint lighting needs a bounded native grid with px 1, a finite scene time, and 3 to 13 light positions');
  if (subject !== undefined && (!subject || Object.getPrototypeOf(subject)!==Object.prototype ||
      !Targets.name(subject.object) || subject.part!==undefined && !Targets.name(subject.part) ||
      Object.keys(subject).some(key=>!['object','part'].includes(key))))
    throw new TypeError('Choose a subject by object ID and optional part ID');
  let camera, shot;
  const capture = R.cameraCapture(view, (projection, sample) => {
    if (projection.width===w && projection.height===h) {
      camera=projection;
      shot=sample;
    }
  });
  const frame = R.render(world, {...view,...capture,w,h,px:1,t:time,time,
    captureBasePaint:true,passes:passNames,pixelSelection:subject??false,
    samples:false,captureCoverage:false,composite:false,renderGraph:false,inspection:false,
    renderGrid:false,shutter:false,afterimages:false,cameraGuides:false});
  const {passes,basePaint} = frame;
  if (!camera || frame.w!==w || frame.h!==h || basePaint?.alpha.length!==w*h ||
      passNames.some(name=>!passes?.[name]) || subject && frame.pixelSelection?.coverage.length!==w*h)
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
  if (!coverage.visible) throw new RangeError(subject ? 'The selected subject has no visible surface pixels' : 'The shot has no visible surface pixels');
  coverage.relightable=samples.length;
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
    width:w,height:h,time,poseTime:shot.frame.poseTime,camera:{eye:Array.from(camera.eye),matrix:Array.from(camera.view),
      ortho:camera.ortho,focal:shot.focal,time:shot.frame.cameraTime},subject:subject??null,coverage,
    sweep:{ambient,mode:'diffuse',frames:sweep.map(({image,...row})=>row)}};
  return {report,authored,neutral,sweep:sweep.map(({image})=>image)};
}

function comparisonSheet(tiles) {
  const kit=require('../index.js').load().KIT, {w,h}=tiles[0].image;
  const cols=Math.min(tiles.length,tiles.length<7 ? 3 : 4);
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

function writeReview(directory, {report,authored,neutral,sweep}) {
  const labelled = [{name:'neutral', label:'Neutral paint', image:neutral},
    {name:'authored', label:'Authored shot', image:authored},
    ...report.sweep.frames.map(({id,azimuth},i)=>({name:id,label:'Light '+Math.round(azimuth)+' deg',image:sweep[i]}))];
  const manifest = {};
  function write(name, {w,h,rgb,alpha}) {
    const file=name+'.png';
    const frame=PNG.encodeFrame(PNG.packFrame({w,h,rgb,alpha}));
    files.write(path.join(directory,file),frame);
    manifest[name]=file;
  }
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
