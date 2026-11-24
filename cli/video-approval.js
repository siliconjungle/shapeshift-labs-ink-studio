/* Check delivery pixels against an addressed source picture sequence. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const PNG = require('./png.js');
const {readTakePicture} = require('./take-picture.js');
const {nativeVideoFrames} = require('./patch-media.js');
const {stageAt} = require('./recorded-presentation.js');
const {probe} = require('./video-approval-probe.js');
const Metrics = require('./video-approval-metrics.js');

const format = 'ink-studio/video-round-trip';
const usage = 'take approve-video <plan.json> --out <new-directory> [--ffmpeg executable] [--ffprobe executable]';
const maxWork = 540000000, maxFindings=512;
const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const text = value=>typeof value==='string'&&value.trim()&&value.length<=4096;
const fields = (value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>keys.includes(key));
const check = (condition,message)=>{if (!condition) throw new RangeError(message);};
const stamp = file=>fs.statSync(file,{bigint:true});
const comparable = (a,b)=>['ino','dev','size','mtimeNs'].every(key=>a[key]===b[key]);
const evidenceColors = [[1,[244,178,76]],[2,[255,100,143]],[4,[115,220,230]]];

async function fingerprint(file) {
  const hash=createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

function sourcePixels(file,w,h,hash,expected) {
  const stat = fs.statSync(file);
  check(stat.isFile()&&stat.size<=64*1024*1024,'Source PNG is missing or exceeds its input budget: '+file);
  const bytes = fs.readFileSync(file), dimensions = PNG.layout(bytes);
  check(dimensions.w===w&&dimensions.h===h,'Source PNG dimensions do not match the declared delivery scale: '+file);
  const image = PNG.raster(bytes);
  check(image.max<=255,'Use 8-bit SDR source PNG frames');
  const rgb=new Uint8Array(w*h*3);
  for (let p=0;p<w*h;p++) {
    check(image.data[p*4+3]===image.max,'Source picture must be flattened against its delivery background');
    for (let k=0;k<3;k++) rgb[p*3+k]=Math.round(image.data[p*4+k]*255/image.max);
  }
  const digest=createHash('sha256').update(bytes).digest();
  check(expected===undefined||digest.toString('hex')===expected,'Source PNG no longer matches its clip report: '+file);
  hash.update(digest);
  return rgb;
}

function nativeArt(bytes,w,h,scale) {
  const result=new Uint8Array(w*h*3), samples=scale*scale, width=w*scale;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let red=0,green=0,blue=0;
    for (let dy=0;dy<scale;dy++) for (let dx=0;dx<scale;dx++) {
      const j=((y*scale+dy)*width+x*scale+dx)*4;
      check(bytes[j+3]===255,'Delivery picture must be opaque');
      red+=bytes[j];green+=bytes[j+1];blue+=bytes[j+2];
    }
    const at=(y*w+x)*3;
    result[at]=Math.round(red/samples);result[at+1]=Math.round(green/samples);result[at+2]=Math.round(blue/samples);
  }
  return result;
}

function artifacts(first,scale,comparison) {
  const {w,h,source,decoded,mask}=first, width=w*scale, height=h*scale;
  const rgb=new Uint8Array(width*height*3), marked=new Uint8Array(width*height*3);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const p=Math.floor(y/scale)*w+Math.floor(x/scale), at=(y*width+x)*3, j=p*3, value=mask[p];
    const gray=Math.round((decoded[at/3*4]*.21+decoded[at/3*4+1]*.72+decoded[at/3*4+2]*.07)*.43);
    const active = value?evidenceColors.filter(([bit])=>value&bit):[];
    for (let k=0;k<3;k++) {
      rgb[at+k]=source[j+k];
      marked[at+k]=active.length>1?255:active.length?active[0][1][k]:gray;
    }
  }
  const side=comparison.compose({w:width,h:height,rgb},{w:width,h:height,rgba:decoded},{mode:'side-by-side'});
  return [
    {file:'source.png',bytes:PNG.encode(width,height,rgb)},
    {file:'decoded.png',bytes:PNG.encode(width,height,decoded,4)},
    {file:'comparison.png',bytes:PNG.encode(side.w,side.h,side.rgb)},
    {file:'damage.png',bytes:PNG.encode(width,height,marked)}
  ];
}

function inspectFrame(entry,settings,lab,older,previous) {
  entry.palette=Metrics.paletteCheck(entry,settings.palette,lab);
  entry.accents=Metrics.accentCheck(entry,settings.accents,lab);
  if (older&&previous&&!entry.cut&&!previous.cut)
    previous.flicker=Metrics.flickerCheck(older,previous,entry,settings.flicker);
}

async function analyze(file,{kit,ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
  check(fs.statSync(file).size<=1024*1024,'Video approval plan exceeds its input budget');
  const recipe=path.resolve(file), spec=JSON.parse(fs.readFileSync(recipe,'utf8'));
  check(fields(spec,['format','version','delivery','picture','window','scale','cuts','palette','accents','flicker'])&&
    spec.format===format&&spec.version===1&&text(spec.delivery),'Expected a version 1 video round-trip approval plan');
  const settings=Metrics.prepare(spec), scale=spec.scale??1;
  check(integer(scale,1,16),'Delivery scale must be an integer from 1 to 16');
  const delivery=path.resolve(path.dirname(recipe),spec.delivery), input=stamp(delivery);
  check(input.isFile()&&input.size>0n&&input.size<=4n*1024n**3n,'Delivery must be a bounded regular video file');
  const refs=new Set([recipe,delivery]), T=kit.KIT.procedural.takeTime, comparison=kit.KIT.comparison;
  const {rate,firstFrame,frames,cuts:sourceCuts,hashes}=readTakePicture(spec.picture,recipe,kit);
  if (typeof spec.picture==='string') refs.add(path.resolve(path.dirname(recipe),spec.picture));
  const window=spec.window??{from:firstFrame,to:firstFrame+frames.length};
  check(fields(window,['from','to'])&&integer(window.from,firstFrame,firstFrame+frames.length-1)&&
    integer(window.to,window.from+1,firstFrame+frames.length),'Source window must select consecutive numbered frames');
  const {from,to}=window, count=to-from;
  for (const frame of frames.slice(from-firstFrame,to-firstFrame)) refs.add(frame);
  check(spec.cuts===undefined||Array.isArray(spec.cuts)&&spec.cuts.length<=frames.length&&
    spec.cuts.every(frame=>integer(frame,firstFrame,firstFrame+frames.length-1)),
  'Cuts must be numbered source frames');
  const cuts=new Set([...sourceCuts,...(spec.cuts??[])]);
  const info=probe(delivery,ffprobe,rate,count), {width,height,timestamps,...metadata}=info;
  check(width%scale===0&&height%scale===0,'Delivery raster is not divisible by its declared integer scale');
  check(count*width*height<=maxWork,'Delivery exceeds the approval pixel budget. Review a smaller matched excerpt.');
  const w=width/scale,h=height/scale, lab=Metrics.displayColor(), sourceHash=createHash('sha256');
  const covered={palettePairs:0,accentPixels:0,flickerTriples:0,heldPixels:0};
  const failures={palette:0,accents:0,flicker:0};
  const observed=new Set(), findings=[];
  let first, older, previous, countDecoded=0, omittedFindings=0;
  function finalize(row) {
    const {frame,index,palette,accents,flicker}=row;
    const bad={};
    if (palette) {
      covered.palettePairs+=palette.sampled;
      for (const id of palette.observed) observed.add(id);
      if (palette.failures.length) bad.palette=palette.failures;
    }
    if (accents) {
      covered.accentPixels+=accents.sampled;
      if (accents.damaged) bad.accents=accents;
    }
    if (flicker) {
      covered.flickerTriples++;
      covered.heldPixels+=flicker.held;
      if (flicker.flagged) bad.flicker=flicker;
    }
    const types=Object.keys(bad);
    if (!types.length) return;
    for (const type of types) failures[type]++;
    const finding={sourceFrame:frame,deliveryFrame:index,pts:timestamps[index],problems:bad};
    if (findings.length<maxFindings) findings.push(finding); else omittedFindings++;
    first??={...row,finding};
  }
  for await (const image of nativeVideoFrames(delivery,{width,height,executable:ffmpeg})) {
    const index=countDecoded++;
    check(index<count,'Decoder produced more frames than the probed delivery');
    const frame=from+index, address=frame-firstFrame;
    const source=sourcePixels(frames[address],w,h,sourceHash,hashes?.[address]);
    const entry={frame,index,cut:cuts.has(frame),w,h,source,decoded:image.data,
      art:nativeArt(image.data,w,h,scale),mask:new Uint8Array(w*h)};
    inspectFrame(entry,settings,lab,older,previous);
    if (previous) finalize(previous);
    older=previous&&{source:previous.source,art:previous.art};
    previous=entry;
  }
  check(countDecoded===count,'Decoder ended before the matched delivery was complete');
  finalize(previous);
  const sha256=await fingerprint(delivery);
  check(comparable(input,stamp(delivery)),'Delivery changed during approval');
  const unchecked=[];
  for (const row of settings.palette?.pairs??[]) if (!observed.has(row.id)) unchecked.push({kind:'palette',id:row.id});
  if (settings.accents?.colors&&!covered.accentPixels) unchecked.push({kind:'accents',reason:'no-matching-source-accent'});
  if (settings.flicker&&!covered.heldPixels) unchecked.push({kind:'flicker',
    reason:covered.flickerTriples?'no-held-source-pixels':'no-three-frame-span'});
  const status=first?'flagged':unchecked.length?'inconclusive':'approved';
  const options={
    palette:settings.palette&&{...settings.palette,pairs:settings.palette.pairs?.map(({id,colors})=>({id,colors:colors.map(Metrics.hex)}))},
    accents:settings.accents&&{...settings.accents,colors:settings.accents.colors&&[...settings.accents.colors].map(Metrics.hex)},
    flicker:settings.flicker
  };
  const report={format:format+'-report',version:1,status,
    source:{from,to,fps:T.pack(rate),width:w,height:h,frameSetSha256:sourceHash.digest('hex')},
    delivery:{file:spec.delivery,sha256,width,height,scale,firstPts:timestamps[0],lastPts:timestamps.at(-1),...metadata},
    options,coverage:covered,unchecked,flaggedFrames:failures,findings,omittedFindings,
    firstDamaged:first?{...first.finding,source:'source.png',decoded:'decoded.png',comparison:'comparison.png',damage:'damage.png'}:null};
  const images=first?artifacts(first,scale,comparison):[];
  return {report,images,inputs:[...refs]};
}

async function command(file,opt,{kit}) {
  check(text(file)&&text(opt.out)&&Object.entries(opt).every(([key,value])=>
    ['out','ffmpeg','ffprobe'].includes(key)&&text(value)),'Use '+usage);
  const target=path.resolve(opt.out);
  check(!fs.lstatSync(target,{throwIfNoEntry:false}),'Choose a new directory for video approval output');
  const {report,images,inputs}=await analyze(file,{kit,ffmpeg:opt.ffmpeg,ffprobe:opt.ffprobe});
  const {findings:_findings,...overview}=report;
  const html=fs.readFileSync(path.join(__dirname,'video-approval-review.html'),'utf8')
    .replace('/* REPORT */ {}',()=>JSON.stringify(overview).replace(/</g,'\\u003c'));
  const stage=stageAt(target);
  try {
    for (const image of images) stage.save(image.file,image.bytes);
    stage.save('index.html',html);
    stage.json('report.json',report);
    check(!fs.lstatSync(target,{throwIfNoEntry:false}),'Video approval output was created by another process');
    stage.publish(inputs);
  } finally { stage.close(); }
  process.stdout.write(JSON.stringify({status:report.status,report:'report.json',review:'index.html',
    firstDamagedFrame:report.firstDamaged?.sourceFrame??null})+'\n');
  if (report.status!=='approved') process.exitCode=2;
}

module.exports={analyze,command,usage,sourcePixels,nativeArt};
