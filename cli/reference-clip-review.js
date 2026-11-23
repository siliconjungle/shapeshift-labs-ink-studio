/* Read native frame sequences, align their clocks and package a portable workbench. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const PNG = require('./png.js');
const Assets = require('./asset-files.js');
const MAX_DECODED = 96 * 1024 * 1024;
const MAX_FILE = 128 * 1024 * 1024;
const MAX_STAGE_PIXELS = 1024 * 1024;
const format = 'ink-studio/reference-clip-review';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = row => row && [Object.prototype,null].includes(Object.getPrototypeOf(row));
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const check = (condition, message) => { if (!condition) throw new RangeError('Reference clip: ' + message); };
const sortNames = new Intl.Collator('en', { numeric:true, sensitivity:'base' });

function frameDimensions(bytes) {
  check(bytes.length >= 33 && bytes.readUInt32BE(12) === 0x49484452, 'expected a PNG frame');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function createReferenceClipReview(file, options = {}) {
  const ink = options.ink ?? require('..');
  const kit = options.kit ?? ink.load();
  const { referenceClips: C, comparison } = kit.KIT;
  const owner = path.resolve(file), dependencies = new Set();
  const source = (base, name) => {
    check(typeof name === 'string' && name.length > 0, 'source paths must be filenames');
    return path.resolve(path.dirname(base),name);
  };
  function read(name) {
    const resolved = fs.realpathSync(name);
    const stat = fs.statSync(resolved);
    check(stat.isFile() && stat.size <= MAX_FILE, 'source files must be bounded regular files');
    dependencies.add(resolved);
    return fs.readFileSync(resolved);
  }
  const plan = JSON.parse(read(owner));
  check(record(plan) && plan.format === format && plan.version === 1, 'expected a version 1 review plan');
  const title = plan.title ?? 'Reference clip review';
  check(typeof title === 'string' && title.trim() && title.length <= 180, 'title must contain 1–180 characters');

  let decodedBytes = 0;
  let encodedBytes = 0, browserBytes = 0;
  const media = new Map();
  function decode(bytes, { crop, pixelSize = 1 } = {}) {
    const [w,h] = frameDimensions(bytes);
    const [x,y,cw,ch] = crop ?? [0,0,w,h];
    check(integer(x,0,w-1) && integer(y,0,h-1) && integer(cw,1,w-x) && integer(ch,1,h-y) &&
      integer(pixelSize,1,64) && cw % pixelSize === 0 && ch % pixelSize === 0,
    'crop must fit the PNG and divide evenly by its integer pixel size');
    const width = cw/pixelSize, height = ch/pixelSize;
    check(width*height <= MAX_STAGE_PIXELS, 'cropped art frame exceeds the native pixel budget');
    decodedBytes += width*height*4;
    check(decodedBytes <= MAX_DECODED, 'decoded sequences exceed the combined art frame budget');
    const { data,max } = PNG.raster(bytes);
    const rgba = new Uint8Array(width*height*4), center = Math.floor(pixelSize/2);
    for(let row=0,i=0;row<height;row++)for(let col=0;col<width;col++,i+=4) {
      const from = ((y+row*pixelSize+center)*w+x+col*pixelSize+center)*4;
      for(let c=0;c<4;c++)rgba[i+c] = Math.round(data[from+c]*255/max);
    }
    const normalized = PNG.encode(width,height,rgba,4);
    const id = hash(normalized);
    const image = 'frames/'+id+'.png';
    if (!media.has(image)) {
      const packed = deflateSync(rgba);
      encodedBytes += normalized.length;
      browserBytes += packed.length;
      check(Math.max(encodedBytes,browserBytes) <= 64 * 1024 * 1024, 'encoded sequences exceed the portable workbench budget');
      media.set(image,{ png:normalized,packed });
    }
    return { width,height,rgba,image };
  }

  function clipReport(report, getFrame, spec) {
    check(report?.format === 'ink-studio/graph-clip' && report.version === 1 && Array.isArray(report.frames) &&
      integer(report.frames.length,1,C.maxFrames), 'expected an Ink graph clip with numbered PNG frames');
    const { fps, from:startFrame } = report;
    const timing = C.timeline({ fps,startFrame,frameCount:report.frames.length });
    const frames = Array.from(report.frames, (frame,i) => {
      check(frame?.frame === timing.startFrame+i && typeof frame.file === 'string' && /^[a-f0-9]{64}$/.test(frame.sha256),
        'clip report needs consecutive addressed PNG frames and their hashes');
      const bytes = getFrame(frame.file);
      check(hash(bytes) === frame.sha256,'graph clip frame has changed: '+frame.file);
      return decode(bytes,spec);
    });
    return { timing,frames };
  }
  function loadSide(spec, side) {
    check(record(spec), 'expected a '+side+' source');
    const kinds = ['directory','clip','graph'].filter(key => spec[key] !== undefined);
    check(kinds.length === 1, side+' needs one PNG directory, Ink clip report, or graph');
    const { label=side === 'reference' ? 'Reference' : 'Ink render', offset=[0,0], crop }=spec;
    check(typeof label === 'string' && label.trim() && label.length <= 100 &&
      Array.isArray(offset) && offset.length === 2 && offset.every(n=>integer(n,0,4096)) &&
      (crop === undefined || Array.isArray(crop) && crop.length === 4), 'invalid '+side+' label, offset, or crop');
    let sequence;
    if (kinds[0] === 'directory') {
      const folder = source(owner,spec.directory);
      const names = fs.readdirSync(folder).filter(name=>/\.png$/i.test(name))
        .sort((a,b)=>sortNames.compare(a,b)||(a<b?-1:a>b?1:0));
      const timing = C.timeline({ fps:spec.fps,startFrame:spec.startFrame,frameCount:names.length });
      sequence = { timing,frames:names.map(name=>decode(read(path.join(folder,name)),spec)) };
    } else if (kinds[0] === 'clip') {
      const reportFile = source(owner,spec.clip);
      const report = JSON.parse(read(reportFile));
      const root = fs.realpathSync(path.dirname(reportFile));
      sequence = clipReport(report, name => {
        check(/^frames\/[^/\\]+\.png$/i.test(name), 'expected a numbered frame from the clip folder');
        const frame = fs.realpathSync(path.resolve(root,name));
        const relative = path.relative(root,frame);
        check(!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative), 'frame escapes the clip folder');
        return read(frame);
      }, spec);
    } else {
      const { graph, from=0,to,output,fps=24,warmup=0,cuts=[],inputs,seed,renderOptions } = spec;
      C.timeline({ fps,startFrame:from,frameCount:to-from });
      const graphPath = source(owner,graph), project=ink.readGraphProject(graphPath,{ kit, ...options.graph });
      try {
        for (const entry of project.sourceFiles()) dependencies.add(fs.realpathSync(entry));
        const { report,artifacts } = project.clip({
          output, from,to,warmup,format:'frames',clock:{fps,cuts},inputs,seed,renderOptions
        });
        check(report.passed,'Ink graph clip assertions failed');
        const frames = new Map(artifacts.map(artifact=>[artifact.file,artifact.bytes]));
        sequence = clipReport(report, name=>frames.get(name),spec);
      } finally { project.clear(); }
    }
    const { width,height } = sequence.frames[0];
    check(sequence.frames.every(frame=>frame.width===width && frame.height===height), side+' frames need one native grid');
    return { ...sequence,label,offset,width,height };
  }

  const reference = loadSide(plan.reference,'reference'), candidate = loadSide(plan.candidate,'candidate');
  const width = Math.max(reference.offset[0]+reference.width,candidate.offset[0]+candidate.width);
  const height = Math.max(reference.offset[1]+reference.height,candidate.offset[1]+candidate.height);
  check(width*height<=MAX_STAGE_PIXELS,'registered comparison exceeds the native pixel budget');
  const sideManifest = ({ timing,frames,label,offset,width,height }) => ({
    fps:timing.fps,startFrame:timing.startFrame,frameCount:timing.frameCount,
    label,offset,width,height,images:frames.map(frame=>frame.image)
  });
  const sides = { reference:sideManifest(reference),candidate:sideManifest(candidate) };
  const sessionId = hash(JSON.stringify(sides));
  function openRows(key, format) {
    const value=plan[key];
    if(typeof value!=='string')return value;
    const asset=JSON.parse(read(source(owner,value)));
    check(asset?.format===format && asset.version===1 && asset.sessionId===sessionId && Array.isArray(asset[key]),
      key+' file belongs to different source clips or has an invalid format');
    return asset[key];
  }
  const alignment = C.create({ ...sides,beats:openRows('beats',C.alignmentFormat) });
  const notes = alignment.notes(openRows('notes',C.noteFormat));
  const manifest = { format,version:1,title,sessionId,width,height,...sides,beats:alignment.beats,notes };

  function pixels(side,address) {
    return C.register(side.frames[address.index],manifest,side.offset);
  }
  function frame(time,view) {
    const address = alignment.sample(time);
    return { address,image:comparison.compose(pixels(reference,address.reference),pixels(candidate,address.candidate),view) };
  }
  function sheet(beatIds) {
    const ids = beatIds ?? alignment.beats.map(beat=>beat.id);
    const times = ids.length ? ids.map(id=>alignment.range(id)[0]) : [0];
    const width = manifest.width*2*3, height = manifest.height*times.length;
    check(width*height<=8*MAX_STAGE_PIXELS,'contact sheet exceeds its pixel budget. Export fewer beats.');
    const rgb = new Uint8Array(width*height*3);
    const step = 1/alignment.reference.rate;
    for(const [i,time] of times.entries())for(const [j,shift] of [-step,0,step].entries()) {
      const { image } = frame(time+shift);
      for(let row=0;row<image.h;row++) {
        const from = row*image.w*3, to=((i*image.h+row)*width+j*image.w)*3;
        rgb.set(image.rgb.subarray(from,from+image.w*3),to);
      }
    }
    return { w:width,h:height,rgb };
  }
  function write(directory, { time=0, view, includeSheet=false, beat } = {}) {
    directory = path.resolve(directory);
    const preview = frame(time,view);
    const sheetImage = includeSheet ? sheet(beat === undefined ? undefined : [beat]) : null;
    const html = fs.readFileSync(path.join(__dirname,'reference-clip-review.html'),'utf8')
      .replace('/*WORKBENCH*/',()=>JSON.stringify({...manifest,initialTime:preview.address.time,view:comparison.settings(view)})
        .replaceAll('<','\\u003c'));
    const files = new Map([...Array.from(media,([name,{png}])=>[name,png]),
      ['index.html',html],
      ['review-ui.js',fs.readFileSync(path.join(__dirname,'reference-clip-review-ui.js'))],
      ['frame-images.js','const referenceClipImages = '+JSON.stringify(Object.fromEntries(
        Array.from(media,([name,{packed}])=>[name,packed.toString('base64')])
      ))+';\n'],
      ['ink.js',ink.bundle()],
      ['workbench.json',JSON.stringify(manifest,null,2)+'\n'],
      ['comparison.png',PNG.encode(preview.image.w,preview.image.h,preview.image.rgb,3)],
      ['frame.json',JSON.stringify(preview.address,null,2)+'\n']
    ]);
    if(sheetImage)files.set('sheet.png',PNG.encode(sheetImage.w,sheetImage.h,sheetImage.rgb,3));
    for (const name of files.keys()) {
      const target = path.join(directory,name);
      const folder = path.dirname(target);
      const existing = fs.existsSync(target) ? fs.realpathSync(target) : null;
      const parent = fs.existsSync(folder) ? fs.realpathSync(folder) : directory;
      check(!dependencies.has(existing) && !dependencies.has(path.join(parent,path.basename(name))),
        'workbench output overlaps a source file');
    }
    for (const [name,contents] of files) Assets.write(path.join(directory,name),contents);
    return { directory, manifest, preview:preview.address, files:[...files.keys()].filter(name=>!media.has(name)) };
  }

  return Object.freeze({ alignment,manifest,frame,sheet,write });
}

function command(args,options,kit) {
  const [file] = args;
  check(args.length===1 && typeof options.out==='string',
    'use reference-clip <plan.json> --out directory [--beat ID | --at seconds]');
  for (const key of ['beat','at','mode','divider'])
    check(options[key]!==true,'--'+key+' needs a value');
  check(options.beat===undefined || options.at===undefined,'choose --beat or --at');
  const review = createReferenceClipReview(file,{ kit });
  const time = options.beat === undefined ? Number(options.at ?? 0) : review.alignment.range(options.beat)[0];
  const view = { mode:options.mode,divider:options.divider===undefined ? undefined : Number(options.divider) };
  const result=review.write(options.out,{ time,view,includeSheet:!!options.sheet,beat:options.beat });
  console.log(JSON.stringify({ directory:result.directory,files:result.files,frame:result.preview }));
}

module.exports = { createReferenceClipReview,command };
