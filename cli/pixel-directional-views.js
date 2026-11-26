'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual:equal } = require('node:util');
const Directions = require('../src/pixel-directional-views.js');
const Atlas = require('../src/atlas-sprites.js');
const LayerStack = require('../src/pixel-layer-stack.js');
const { readSpriteAtlas,writeSpriteAtlas } = require('./sprite-atlas.js');
const { runs } = require('../src/pixel-paint-tools.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const dot = (a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const hex = n=>'#'+n.toString(16).padStart(6,'0');
const packed = (image,p)=>(image[p]<<16)|(image[p+1]<<8)|image[p+2];
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const isPath = value=>typeof value === 'string' && !!value.trim();

function registration(entry,metadata) {
  return { pose:entry.frame ?? 0,yaw:entry.yaw ?? 0,pitch:entry.pitch ?? metadata.pitch ?? 0,
    pivot:entry.pivot ? [entry.pivot.x,entry.pivot.y] : [entry.rect.width/2,entry.rect.height/2],
    unitsPerPixel:entry.unitsPerPixel ?? metadata.unitsPerPixel ?? 1 };
}

function open(atlas,documentFromDeck) {
  const { metadata } = atlas.snapshot();
  const entries = metadata.frames;
  if (!Array.isArray(entries) || !entries.length || entries.length > 512 || metadata.scenery !== undefined)
    throw new RangeError('Open a directional sprite atlas with up to 512 registered view tiles');
  const w = Math.max(...entries.map(row=>row.rect.width)), h = Math.max(...entries.map(row=>row.rect.height));
  if (w > 512 || h > 512 || w*h*entries.length > 4e6)
    throw new RangeError('The atlas views exceed the directional art document budget');

  const paletteIds = new Map(), views = [], anchors = metadata.partAnchors ?? [], indexes = new Map();
  for (const rgb of metadata.outputPalette ?? []) if (!paletteIds.has(rgb)) paletteIds.set(rgb,paletteIds.size);
  const frames = entries.map((entry,i)=>{
    const id = 'view-'+(i+1), view = registration(entry,metadata), index = indexes.get(view.pose) ?? 0;
    indexes.set(view.pose,index+1);
    const tile = atlas.authoredView(view.pose,index);
    if (tile.rect.width > w || tile.rect.height > h) throw new RangeError('A held atlas tile exceeds the view grid');
    const slots = Array(w*h).fill(null), alpha = Array(w*h).fill(255);
    const out = { color:[0,0,0],normal:[0,0,0],emission:[0,0,0] };
    for (let y=0;y<tile.rect.height;y++) for (let x=0;x<tile.rect.width;x++) {
      if (!atlas.sample(tile,x,y,{},out)) continue;
      const rgb = out.color.map(value=>Math.round(value*255)).reduce((sum,n)=>sum*256+n,0);
      if (!paletteIds.has(rgb)) {
        if (paletteIds.size === 255) throw new RangeError('Directional art import needs up to 255 exact visible colors');
        paletteIds.set(rgb,paletteIds.size);
      }
      slots[y*w+x] = paletteIds.get(rgb);
      alpha[y*w+x] = Math.round(out.alpha*255);
    }
    views.push({ frame:id,...view,pivot:[tile.pivot.x,tile.pivot.y],unitsPerPixel:tile.unitsPerPixel,
      ...(tile.anchors && { anchors:tile.anchors }),
      ...(tile.handoff || metadata.cels ? { handoff:tile.handoff ?? 'exact' } : {}) });
    return { id,label:'Pose '+view.pose+' · '+Math.round(view.yaw*180/Math.PI)+'° / '+Math.round(view.pitch*180/Math.PI)+'°',
      duration:entry.duration ?? 1/(metadata.fps ?? 12),
      cels:{ art:{ slots,...(alpha.some(value=>value !== 255) && { alpha }) } } };
  });
  if (!paletteIds.size) paletteIds.set(0,0);
  const palette = [...paletteIds.keys()].map(hex), swatchIds = palette.map(color=>'ink-'+color.slice(1));
  return documentFromDeck({
    format:'ink-studio/pixel-layer-deck',version:1,width:w,height:h,palette,swatchIds,layers:[{ id:'art' }],frames,
    directional:{ version:1,views,partAnchors:anchors,approvedSwatches:metadata.outputPalette ?
      [...new Set(metadata.outputPalette)].map(color=>swatchIds[paletteIds.get(color)]) : swatchIds,
      ...(metadata.viewBlend && { viewBlend:metadata.viewBlend }) }
  });
}

function anchorPositions(view,partAnchors) {
  const { right,up } = Atlas.basis(view.yaw,view.pitch), { pivot:[x,y],unitsPerPixel } = view;
  return partAnchors.map(({ id,part,point })=>{
    const projected = [x+dot(right,point)/unitsPerPixel,y-dot(up,point)/unitsPerPixel];
    const authored = Object.hasOwn(view.anchors ?? {},id), at = authored ? view.anchors[id] : projected;
    return { id,part,at,projected,authored,delta:at.map((n,i)=>n-projected[i]) };
  });
}

function sampleDocument(design,compileFrames) {
  if (design?.version !== 2 || !design.palette || !Array.isArray(design.frames))
    throw new TypeError('Directional sets need a version 2 pixel document');
  const source = Directions.prepare(design.directional,new Set(design.frames?.map(row=>row.id)),new Set(Object.keys(design.palette)));
  if (!source) throw new TypeError('Add a directional set to the pixel document before comparing or exporting views');
  if (design.width*design.height*source.views.length > 4e6)
    throw new RangeError('The directional set exceeds the native art document budget');
  const approved = (source.approvedSwatches ?? Object.keys(design.palette)).map(id=>{
    const row = design.palette[id], color = typeof row === 'string' ? row : row.color;
    return { id,color:color.toLowerCase() };
  });
  const colors = new Set(approved.map(({ color })=>parseInt(color.slice(1),16)));
  const views = new Map();
  const registrations = new Map(source.views.map(row=>[row.frame,row]));
  for (const compiled of compileFrames(design,registrations.keys())) {
    const row = registrations.get(compiled.id);
    const { rgba } = LayerStack.image(compiled,compiled.colors);
    const unapproved = new Map();
    for (let p=0;p<rgba.length;p+=4) if (rgba[p+3]) {
      const color = packed(rgba,p);
      if (!colors.has(color)) unapproved.set(color,(unapproved.get(color) ?? 0)+1);
    }
    views.set(row.frame,{ row,rgba,anchors:anchorPositions(row,source.partAnchors ?? []),
      unapproved:[...unapproved].map(([color,pixels])=>({ color:hex(color),pixels })),revision:compiled.revision });
  }
  return { source,views,approved,width:design.width,height:design.height };
}

function compare(data,anchor,includeImages) {
  const { width,height,source,views,approved } = data;
  if (anchor !== undefined && !source.partAnchors?.some(row=>row.id === anchor))
    throw new RangeError('Unknown directional part anchor '+anchor);
  const pairs = Directions.adjacent(source.views).map(pair=>{
    const a = views.get(pair.from), b = views.get(pair.to), xy = view=>anchor === undefined ? view.row.pivot :
      view.anchors.find(row=>row.id === anchor).at;
    const shift = xy(a).map((value,i)=>Math.round(value-xy(b)[i]) || 0);
    const [dx,dy] = shift;
    const counts = { leftOnly:0,rightOnly:0,color:0,alpha:0 };
    const changed = [], outside = [];
    const overlay = includeImages && new Uint8Array(a.rgba.length);
    const aligned = includeImages && new Uint8Array(a.rgba.length);
    const tints = { leftOnly:[231,139,108,255],rightOnly:[108,209,181,255],color:[246,207,115,255],alpha:[170,147,231,255] };
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const u=x-dx,v=y-dy,p=y*width+x,j=p*4;
      const k = u >= 0 && v >= 0 && u < width && v < height ? (v*width+u)*4 : -4;
      const left = a.rgba[j+3], right = b.rgba[k+3] ?? 0;
      if (aligned && k >= 0) aligned.set(b.rgba.subarray(k,k+4),j);
      if (!left && !right) continue;
      const difference = !left ? 'rightOnly' : !right ? 'leftOnly' : left !== right ? 'alpha' :
        packed(a.rgba,j) !== packed(b.rgba,k) ? 'color' : null;
      if (!difference) continue;
      counts[difference]++;
      changed.push(p);
      overlay?.set(tints[difference],j);
    }
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      if (x+dx >= 0 && y+dy >= 0 && x+dx < width && y+dy < height || !b.rgba[(y*width+x)*4+3]) continue;
      counts.rightOnly++;
      outside.push(y*width+x);
    }
    const exact = [a.row,b.row].filter(row=>row.handoff === 'exact').map(row=>row.frame);
    return { ...pair,shift,counts,difference:runs(width,changed),outsideRight:runs(width,outside),exact,
      ...(includeImages && { aligned,overlay }) };
  });
  const png = rgba=>PNG.encode(width,height,rgba,4).toString('base64');
  const report = {
    format:'ink-studio/pixel-directional-review',version:1,grid:[width,height],revision:views.values().next().value.revision,
    alignment:anchor ?? 'pivot',approved,partAnchors:source.partAnchors ?? [],
    views:[...views.values()].map(({ row,anchors,unapproved })=>({ ...row,anchors,unapproved })),
    pairs:pairs.map(({ aligned,overlay,...pair })=>pair)
  };
  const pictures = includeImages && { views:[...views.values()].map(view=>png(view.rgba)),
    pairs:pairs.map(({ aligned,overlay })=>({ aligned:png(aligned),difference:png(overlay) })) };
  return { report,pictures };
}

function atlasSource(design,data,base) {
  const { width:w,height:h,source,views,approved } = data;
  const viewBlend = source.viewBlend ?? base?.metadata.viewBlend ?? 'nearest';
  if ([...views.values()].some(view=>view.unapproved.length))
    throw new RangeError('Directional views contain unapproved colors. Review the set before export.');
  const columns = Math.min(Math.floor(8192/w),Math.max(1,Math.ceil(Math.sqrt(views.size*h/w))));
  const width = w*columns, height = h*Math.ceil(views.size/columns);
  if (height > 8192 || width*height > 16e6) throw new RangeError('Directional tile sheet exceeds the sprite atlas budget');
  if (base?.metadata.cels || base?.metadata.scenery || base?.metadata.bump)
    throw new RangeError('A registered base needs baked view tiles without runtime cel, scenery or bump edits');
  if (viewBlend === 'depth-reprojected' && !base?.images.depth)
    throw new RangeError('Depth-reprojected directional output needs a registered base with depth');
  const images = Object.fromEntries(Object.keys(base?.images ?? { color:true }).map(channel=>[channel,new Uint8Array(width*height*4)]));
  const frames = [], poses = new Map();
  for (const [i,{ row,rgba }] of [...views.values()].entries()) {
    const original = base?.metadata.frames.find(entry=>{
      const view = registration(entry,base.metadata);
      return equal(view,{ pose:row.pose,yaw:row.yaw,pitch:row.pitch,pivot:row.pivot,unitsPerPixel:row.unitsPerPixel });
    });
    if (base && !original)
      throw new RangeError('Directional frame '+row.frame+' has no matching angle, pivot and scale in the registered base');
    const rect = { x:i%columns*w,y:Math.floor(i/columns)*h,width:w,height:h };
    const durationMs = design.frames.find(frame=>frame.id === row.frame).durationMs;
    const bakedDuration = original && (original.duration ?? 1/(base.metadata.fps ?? 12));
    const duration = bakedDuration && Math.max(1,Math.round(bakedDuration*1000)) === durationMs ?
      bakedDuration : durationMs/1000;
    if (poses.has(row.pose) && poses.get(row.pose) !== duration)
      throw new RangeError('All directional views of pose '+row.pose+' need the same frame duration');
    poses.set(row.pose,duration);
    let handoff = row.handoff ?? original?.handoff;
    let pixels = 0, left = w, top = h, right = -1, bottom = -1;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const read = (y*w+x)*4, alpha = rgba[read+3], write = ((y+rect.y)*width+x+rect.x)*4;
      if (original && x < original.rect.width && y < original.rect.height) {
        const at = ((original.rect.y+y)*base.metadata.width+original.rect.x+x)*4;
        if (base.images.color[at+3]) for (const name of ['depth','normal','emission'])
          images[name]?.set(base.images[name].subarray(at,at+4),write);
      }
      if (alpha && images.depth && !images.depth[write+3]) handoff = 'exact';
      images.color.set(rgba.subarray(read,read+4),write);
      if (images.silhouette && alpha >= 128) {
        images.silhouette.fill(255,write,write+4);
        pixels++;
        left = Math.min(left,x);
        top = Math.min(top,y);
        right = Math.max(right,x);
        bottom = Math.max(bottom,y);
      }
    }
    const { silhouette,anchors,...registrationFields } = original ?? {};
    frames.push({ ...registrationFields,frame:row.pose,duration,yaw:row.yaw,pitch:row.pitch,rect,
      pivot:{ x:row.pivot[0],y:row.pivot[1] },unitsPerPixel:row.unitsPerPixel,
      ...(handoff !== undefined && { handoff }),...(row.anchors && { anchors:row.anchors }),
      ...(images.silhouette && { silhouette:{ pixels,bounds:pixels ? [left,top,right,bottom] : null,
        touchesBorder:left === 0 || top === 0 || right === w-1 || bottom === h-1 } }) });
  }
  const { outputPalette,clips, ...metadata } = base?.metadata ?? {};
  const survivingClips = clips?.map(clip=>({ ...clip,frames:clip.frames.filter(pose=>poses.has(pose)) })).filter(clip=>clip.frames.length);
  return { metadata:{ ...metadata,width,height,tileWidth:w,tileHeight:h,frames,partAnchors:source.partAnchors ?? [],
    ...(survivingClips?.length && { clips:survivingClips }),
    viewBlend,
    ...(approved.length <= 64 && { outputPalette:approved.map(({ color })=>parseInt(color.slice(1),16)) })
  },images };
}

function command([action,input,...rest],opt,{ compileFrames,documentFromDeck }) {
  if (action === 'uv-clips') {
    if (!isPath(input) || rest.length || !['settings','out'].every(key=>isPath(opt[key])) ||
        Object.keys(opt).some(key=>!['settings','out'].includes(key)) ||
        path.extname(opt.out).toLowerCase()!=='.json')
      throw new TypeError('Use pixel-art directions uv-clips <atlas> --settings bindings.json --out clips.json');
    const resolved = path.resolve(input), out = path.resolve(opt.out);
    const manifest = fs.statSync(resolved).isDirectory() ? path.join(resolved,'atlas.json') : resolved;
    if ([manifest,path.resolve(opt.settings)].includes(out))
      throw new RangeError('Write the directional clip rules to a separate path');
    const api = require('../index.js').load().KIT.authoring.directionalUV;
    files.json(out,api.fromAtlas(readSpriteAtlas(manifest),read(opt.settings)));
    return;
  }
  const options = { open:['out'],review:['anchor','out','review'],export:['out','base'] };
  if (!Object.hasOwn(options,action) || !isPath(input) || rest.length ||
      Object.entries(opt).some(([key,value])=>!options[action].includes(key) || !isPath(value)) ||
      (action !== 'review' && !opt.out) || opt.review && path.extname(opt.review).toLowerCase() !== '.html')
    throw new TypeError('Use pixel-art directions open <atlas> --out document.json, review <document>, or export <document> --out atlas.json');
  const inputs = [input,opt.base].filter(Boolean).map(file=>{
    const resolved = path.resolve(file);
    return fs.statSync(resolved).isDirectory() ? path.join(resolved,'atlas.json') : resolved;
  });
  const outputs = [opt.out,opt.review].filter(Boolean).map(file=>path.resolve(file));
  if (outputs.some(file=>inputs.includes(file)) || new Set(outputs).size !== outputs.length)
    throw new RangeError('Write directional outputs to separate paths from their inputs');
  if (action === 'open') {
    files.json(outputs[0],open(readSpriteAtlas(input),documentFromDeck));
    return;
  }
  const design = read(input), data = sampleDocument(design,compileFrames);
  if (action === 'export') {
    const base = opt.base && readSpriteAtlas(opt.base).snapshot();
    const result = writeSpriteAtlas(atlasSource(design,data,base),{ out:opt.out });
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return;
  }
  const { report,pictures } = compare(data,opt.anchor,!!opt.review);
  if (opt.review) {
    const template = fs.readFileSync(path.join(__dirname,'pixel-directional-views.html'),'utf8');
    const data = JSON.stringify({ report,pictures }).replaceAll('<','\\u003c');
    files.write(path.resolve(opt.review),template.replace('/*DIRECTIONAL_DATA*/',()=>data));
  }
  if (opt.out) files.json(path.resolve(opt.out),report);
  else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = { command, registration };
