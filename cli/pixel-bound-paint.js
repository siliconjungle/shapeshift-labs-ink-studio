'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual:equal } = require('node:util');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const Preview = require('./pixel-edit-preview.js');
const { digest,isRevision } = require('./pixel-edit-revisions.js');
const Destinations = require('./pixel-edit-destinations.js');
const Canvas = require('../src/pixel-canvas-transforms.js');
const { staleAt } = require('../src/pixel-source-bindings.js');
const { runs } = require('../src/pixel-paint-tools.js');

const format = 'ink-studio/bound-paint';
const reportFormat = 'ink-studio/bound-paint-preview';
const imageName = 'paint.png', bindingName = 'binding.json';
const uvTolerance = 1e-12;
const unit = value=>Math.max(0,Math.min(1,value));
const reference = value=>typeof value === 'string' && !!value.trim();
const rgb = color=>[1,3,5].map(i=>Number.parseInt(color.slice(i,i+2),16));
const hex = bytes=>'#'+bytes.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
const coordinate = (p,w)=>[p%w,Math.floor(p/w)];
const identity = ({swatch,color})=>JSON.stringify([swatch,color]);

// Chart UV uses a lower-left origin. PNG and the pixel document use top-left.
function footprint(map,x0,y0,x1,y1) {
  const u = x=>(map.offset[0]+x*map.scale[0])/map.size[0];
  const v = y=>1-(map.offset[1]+y*map.scale[1])/map.size[1];
  return { min:[u(x0),v(y1)],max:[u(x1),v(y0)] };
}

function pixels(frame,registration,sampler,channel) {
  const {width,height} = frame, grid = [width,height];
  return Array.from({length:width*height},(_,p)=>{
    const uv = Canvas.uv(grid,coordinate(p,width),registration);
    return uv ? sampler.sample(uv)[channel] : null;
  });
}

function bytesOf(value,indexed) {
  if (!value) return [0,0,0,0];
  if (indexed) return [...rgb(value.color),255];
  const alpha = Math.round(value.coverage*255);
  return alpha ? [...value.color.map(n=>Math.round(n*255)),alpha] : [0,0,0,0];
}

function rgbaPlane(values,indexed) {
  const result = new Uint8Array(values.length*4);
  values.forEach((value,p)=>result.set(bytesOf(value,indexed),p*4));
  return result;
}

function baseline(design,destination,frameId,sceneRef,{compile,scene,sameScene}) {
  const route = Destinations.resolve(design,destination), { binding,layer } = route;
  const channel = route.destination.channel;
  if (route.destination.kind !== 'surface-channel' || !['paint','pigment'].includes(channel))
    throw new TypeError('Bound paint exchange needs a surface-channel destination for paint or pigment');
  if (!sameScene(binding.scene,sceneRef))
    throw Preview.conflict('wrong-scene','The paint is bound to '+binding.scene,{binding:binding.id,scene:sceneRef});
  const frame = compile(design,frameId ?? binding.frame,undefined,layer && layer.kind !== 'group' ? layer.id : undefined);
  if (binding.frame !== undefined && binding.frame !== frame.id)
    throw Preview.conflict('wrong-frame','The paint is bound to frame '+binding.frame,{binding:binding.id,frame:frame.id});
  const original = scene(sceneRef), { source,solid,target,definitions,api } = Destinations.surfaceSource(route,{scene:()=>original});
  const { width,height } = frame, grid = [width,height], registration = binding.canvas ?? { size:grid,offset:[0,0],scale:[1,1] };
  const bounds = api.editBounds(target), clipping = frame.layerSources?.get(layer?.id)?.clipping;
  const indexed = channel === 'pigment';
  const palette = frame.paletteEntries.map(({id,color})=>({swatch:id,color:color.toLowerCase()}));
  const values = pixels(frame,registration,api.restSampler(target,definitions),channel);
  const rgba = rgbaPlane(values,indexed), blocked = new Map();
  const reasons = values.map((_,p)=>{
    const at = coordinate(p,width), [x,y] = at, box = footprint(registration,x,y,x+1,y+1);
    const reason = layer?.effectiveLock || layer?.kind === 'reference' || layer?.kind === 'group' ? 'locked-layer' :
      staleAt(binding,at) ? 'stale-binding-pixel' : frame.locks[p] ? 'protected-pixel' :
      clipping && !clipping[p] ? 'clipped-pixel' :
      box.min.some((v,i)=>v< -uvTolerance || box.max[i]>1+uvTolerance || v>=box.max[i]) ? 'outside-registration' :
      box.min.some((v,i)=>v<bounds.min[i]-uvTolerance || box.max[i]>bounds.max[i]+uvTolerance) ? 'protected-chart-padding' : null;
    if (reason) {
      if (!blocked.has(reason)) blocked.set(reason,[]);
      blocked.get(reason).push(p);
    }
    return reason;
  });
  const table = new Map(palette.map((row,i)=>[identity(row),{ ...row,slot:i }]));
  if (indexed) for (const row of values) if (row && !table.has(identity(row)))
    table.set(identity(row),{ ...row,slot:table.size });
  const indices = indexed && table.size <= 255 ? [...table.values()].map(({swatch,color})=>({swatch,color})) : null;
  const manifest = { format,version:1,image:imageName,encoding:indices ? 'indexed' : 'rgba',grid,pixelAspect:frame.pixelAspect,
    frame:frame.id,destination,documentRevision:frame.revision,sourceRevision:source.sourceRevision,
    binding:{ id:binding.id,scene:binding.scene,object:solid.id,...(solid.part !== undefined && {part:solid.part}),
      ...(layer && { layer:layer.id }),chart:route.destination.chart,channel,registration,bounds },
    palette,...(indices && {indices}),baseline:digest(values),
    blocked:Object.fromEntries([...blocked].map(([code,points])=>[code,runs(width,points)])) };
  const png = ()=>indices ? PNG.encodeIndexed(width,height,values.map(row=>row ? table.get(identity(row)).slot : null),
    indices.map(row=>rgb(row.color))) : PNG.encode(width,height,rgba,4);
  return { frame,manifest,values,rgba,reasons,png,original,indexed,definitions,api,chart:target };
}

function readEdited(file,[width,height]) {
  if (fs.statSync(file).size > 16*1024*1024) throw new RangeError('Edited paint PNG exceeds 16 MiB');
  const bytes = fs.readFileSync(file);
  const layout = PNG.layout(bytes);
  if (layout.w !== width || layout.h !== height)
    throw Preview.conflict('image-grid','Edited PNG dimensions must match the bound art grid',
      { expected:[width,height],actual:[layout.w,layout.h] });
  const sheet = PNG.sheetRaster(bytes);
  if (sheet.value) {
    const { palette,value:{data:slots},alpha:{data:alpha} } = sheet, rgba = new Uint8Array(width*height*4);
    const channels = palette.map(color=>[color>>>16,color>>>8&255,color&255]);
    for (let p=0;p<slots.length;p++) if (alpha[p]) rgba.set([...channels[slots[p]],alpha[p]],p*4);
    return { rgba,palette,slots };
  }
  const rgba = Uint8Array.from(sheet.data,n=>Math.round(n*255/sheet.max));
  for (let p=0;p<rgba.length;p+=4) if (!rgba[p+3]) rgba.fill(0,p,p+3);
  return { rgba };
}

function difference(base,image) {
  const { manifest:{indices,palette,grid:[width]},rgba,values,reasons,indexed } = base;
  const retainedIndices = indexed && indices && image.palette &&
    image.palette.length >= indices.length && indices.every((row,i)=>image.palette[i] === Number.parseInt(row.color.slice(1),16));
  const byColor = new Map(), byIdentity = new Set(palette.map(identity));
  for (const row of palette) {
    if (!byColor.has(row.color)) byColor.set(row.color,[]);
    byColor.get(row.color).push(row);
  }
  const changes = [], conflicts = [];
  function reject(code,p,message,details) { conflicts.push({code,at:coordinate(p,width),message,...details}); }
  for (let p=0;p<values.length;p++) {
    const start = p*4, after = [...image.rgba.subarray(start,start+4)], before = [...rgba.subarray(start,start+4)];
    const prior = values[p], selected = retainedIndices && after[3] && indices[image.slots[p]];
    if (equal(before,after) && (!selected || prior && identity(prior) === identity(selected))) continue;
    if (reasons[p]) {
      reject(reasons[p],p,'The changed pixel is outside this bound paint edit scope');
      continue;
    }
    const color = hex(after);
    let value = null;
    if (indexed && after[3]) {
      if (after[3] !== 255) {
        reject('pigment-alpha',p,'Indexed pigment needs opaque or transparent pixels',{alpha:after[3]});
        continue;
      }
      const matches = selected ? [selected] : byColor.get(color) ?? [];
      if (matches.length !== 1 || !byIdentity.has(identity(matches[0]))) {
        reject(matches.length > 1 ? 'ambiguous-swatch' : 'unknown-swatch',p,
          matches.length > 1 ? 'Keep the exported palette order to choose between matching swatches' :
            'Edited pigment color must be an exact document swatch',{ color,swatches:matches.map(row=>row.swatch) });
        continue;
      }
      value = matches[0];
    } else if (after[3]) value = { color,alpha:after[3] };
    changes.push({ p,at:coordinate(p,width),before,after,value });
  }
  return { changes,conflicts };
}

function stamps(changes,base) {
  const { manifest:{binding:{registration}},indexed,values } = base, tiles = new Map();
  for (const row of changes) {
    const [x,y] = row.at, key = Math.floor(x/256)+':'+Math.floor(y/128);
    if (!tiles.has(key)) tiles.set(key,[]);
    tiles.get(key).push(row);
  }
  return [...tiles.values()].flatMap(tile=>{
    const x0 = Math.min(...tile.map(row=>row.at[0])), y0 = Math.min(...tile.map(row=>row.at[1]));
    const w = Math.max(...tile.map(row=>row.at[0]))-x0+1, h = Math.max(...tile.map(row=>row.at[1]))-y0+1;
    const {min,max} = footprint(registration,x0,y0,x0+w,y0+h);
    const window = { min:min.map(unit),max:max.map(unit) }, clear = [], groups = new Map();
    for (const row of tile) {
      const {p,at:[x,y],value} = row, local = (y-y0)*w+x-x0;
      if (!value || !indexed && value.alpha<255 && values[p]) clear.push(local);
      if (!value) continue;
      const key = JSON.stringify(value);
      if (!groups.has(key)) groups.set(key,{value,locations:[]});
      groups.get(key).locations.push(local);
    }
    function brush(locations) {
      const bits = new Uint8Array(w*h);
      for (const p of locations) bits[p] = 1;
      return { kind:'bitmap',min:[0,0],max:[1,1],rows:Array.from({length:h},(_,y)=>
        Array.from(bits.subarray(y*w,(y+1)*w),n=>n ? '#' : '.').join('')) };
    }
    return [...(clear.length ? [{ mode:'clear',window,brush:brush(clear) }] : []),
      ...[...groups.values()].map(({value,locations})=>({ window,brush:brush(locations),
        ...(indexed ? { value } : { value:value.color,strength:value.alpha/255 }) }))];
  });
}

function plan(base,manifest,imageFile,{evaluate,limit}) {
  const { documentRevision,sourceRevision,grid:[width,height],frame,destination,binding } = base.manifest;
  if (!equal(manifest,base.manifest))
    throw Preview.conflict('binding-manifest','Binding data does not match this export. Export a fresh binding and paint image.');
  const edited = readEdited(imageFile,[width,height]), diff = difference(base,edited);
  const { changes,conflicts } = diff;
  const report = { format:reportFormat,version:1,status:conflicts.length ? 'conflicted' : 'unchanged',
    documentRevision,sourceRevision,grid:[width,height],frame,destination,binding,
    changed:changes.length+conflicts.length,eligible:changes.length,rejected:conflicts.length,
    pixels:changes.slice(0,limit).map(({p,value,...row})=>({ ...row,uv:Canvas.uv([width,height],row.at,binding.registration),
      ...(base.indexed && { beforeSwatch:base.values[p]?.swatch ?? null,afterSwatch:value?.swatch ?? null }) })),
    runs:{ eligible:runs(width,changes.map(row=>row.p)),
      rejected:runs(width,conflicts.map(({at:[x,y]})=>y*width+x)) },conflicts,sources:[] };
  const images = { before:base.rgba,edited:edited.rgba };
  if (conflicts.length || !changes.length) return { report,images };
  const batch = stamps(changes,base);
  if (batch.length+(base.chart.stamps?.length ?? 0)>256) {
    report.status = 'conflicted';
    conflicts.push({code:'chart-stamp-budget',message:'Proposed paint exceeds the chart’s 256 retained stamps',
      existing:base.chart.stamps?.length ?? 0,added:batch.length});
    return { report,images };
  }
  const patch = { id:'bound-paint-'+digest([base.manifest,changes]).slice(0,32),revision:documentRevision,sourceRevision,
    frame,destination,operation:{ stamps:batch } };
  const { result,receipt } = evaluate(patch,base.original);
  const chart = result.solids.find(row=>row.id === binding.object)?.surfaceState?.charts?.[binding.chart];
  if (!chart) throw new Error('The bound chart disappeared during preview');
  const proposed = pixels(base.frame,binding.registration,base.api.restSampler(chart,base.definitions),binding.channel);
  images.proposed = rgbaPlane(proposed,base.indexed);
  const intended = new Map(changes.map(row=>[row.p,row]));
  for (let p=0;p<proposed.length;p++) {
    const row = intended.get(p), observed = proposed[p];
    const expected = row ? base.indexed ? row.value : row.after : base.values[p];
    const actual = row && !base.indexed ? bytesOf(observed,false) : observed;
    if (!equal(expected,actual)) conflicts.push({ code:row ? 'unresolved-paint' : 'chart-bleed',
      at:coordinate(p,width),message:row ? 'The retained source did not reproduce the requested pixel' :
        'The retained source changed a pixel outside the approved diff' });
  }
  report.sources = Preview.sourceChanges(binding.scene,base.original.editor.snapshot(),result);
  if (conflicts.length) {
    report.status = 'conflicted';
    report.rejected = conflicts.length;
    report.runs.rejected = runs(width,conflicts.map(({at:[x,y]})=>y*width+x));
    return { report,images };
  }
  report.status = 'ready';
  report.approval = digest([base.manifest,changes,receipt.outputs.artifactRevision]);
  return { report,images,result,receipt };
}

function writeReview(file,report,images) {
  const [w,h] = report.grid;
  const escape = text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  const panels = Object.entries(images).map(([name,rgba])=>`<figure><figcaption>${escape(name)}</figcaption>
    <img alt="${escape(name)} native chart pixels" src="data:image/png;base64,${PNG.encode(w,h,rgba,4).toString('base64')}"></figure>`);
  const mask = new Uint8Array(w*h*4);
  for (const [status,spans] of Object.entries(report.runs)) for (const [y,x,length] of spans)
    for (let i=x;i<x+length;i++) mask.set(status==='eligible' ? [71,196,161,255] : [245,106,94,255],(y*w+i)*4);
  panels.push(`<figure><figcaption>Changed pixels · green eligible · red blocked</figcaption>
    <img alt="Affected native pixels" src="data:image/png;base64,${PNG.encode(w,h,mask,4).toString('base64')}"></figure>`);
  files.write(file,`<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>Bound paint review · Ink Studio</title>
  <style>
  :root{color-scheme:dark;background:#13191b;color:#edf2ec;font:15px system-ui,sans-serif}
  main{max-width:76rem;margin:auto;padding:1.5rem}h1{font-size:1.65rem}
  section{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem}
  figure{margin:0}figcaption{margin-bottom:.6rem;text-transform:capitalize}
  img{display:block;width:100%;height:auto;image-rendering:pixelated;background:repeating-conic-gradient(#30393b 0% 25%,#222a2c 0% 50%) 0/16px 16px}
  pre{overflow:auto;background:#1c2528;padding:1rem;max-height:30rem}
  </style></head><body><main><h1>Bound paint review</h1>
  <p>${escape([report.binding.object,report.binding.part,report.binding.chart,report.binding.channel].filter(Boolean).join(' / '))}
  · ${escape(report.status)} · ${report.changed} changed pixels</p>
  <section>${panels.join('')}</section><details><summary>Source changes and approval</summary>
  <pre>${escape(JSON.stringify(report,null,2))}</pre></details></main></body></html>`);
}

function protectOutputs(inputs,outputs) {
  const real = file=>{
    const absolute = path.resolve(file);
    try { return fs.realpathSync(absolute); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(real(path.dirname(absolute)),path.basename(absolute));
    }
  };
  const source = new Set(inputs.map(real)), targets = outputs.map(real);
  if (new Set(targets).size !== targets.length || targets.some(file=>source.has(file)))
    throw new RangeError('Write bound paint outputs separately from each other and their inputs');
}

function command(pos,opt,services) {
  const [action,document,sidecar,image] = pos, { out,scene:sceneRef,approval,review } = opt;
  const exportMode = action === 'export', apply = action === 'apply';
  const has = key=>opt[key] !== undefined;
  if (!['export','preview','apply'].includes(action) || pos.length !== (exportMode ? 2 : 4) ||
      !reference(sceneRef) || (exportMode || apply) && !reference(out) || has('out') && !reference(out) ||
      exportMode && !reference(opt.destination) || has('frame') && !reference(opt.frame) ||
      apply !== has('approval') || has('approval') && !isRevision(approval) ||
      has('review') && (action !== 'preview' || !reference(review) || !/\.html$/i.test(review)) ||
      Object.keys(opt).some(key=>!(exportMode ? ['scene','destination','frame','out'] :
        apply ? ['scene','approval','out'] : ['scene','out','review','limit']).includes(key)))
    throw new TypeError('Use pixel-art paint export, preview, or apply with a scene, binding, and edited PNG. See ink-studio help.');
  const design = services.read(document);
  if (design.version !== 2) throw new TypeError('Bound paint exchange needs a version 2 pixel document');
  if (exportMode) {
    const inputs = [document,sceneRef], png = path.resolve(out,imageName), binding = path.resolve(out,bindingName);
    protectOutputs(inputs,[png,binding]);
    const current = baseline(design,opt.destination,opt.frame,sceneRef,services);
    files.write(png,current.png());
    files.json(binding,current.manifest);
    console.log(JSON.stringify({ image:png,binding,source:current.manifest.binding },null,2));
    return;
  }
  protectOutputs([document,sceneRef,sidecar,image],[out,review].filter(Boolean));
  const manifest = services.read(sidecar), limit = Preview.previewLimit(opt.limit === undefined ? undefined :
    reference(opt.limit) ? Number(opt.limit) : NaN);
  let proposal;
  try {
    if (manifest?.format !== format || manifest.version !== 1 || !reference(manifest.destination) || !reference(manifest.frame) ||
        !isRevision(manifest.documentRevision) || !isRevision(manifest.sourceRevision))
      throw new TypeError('Expected a version 1 Ink bound paint binding');
    const revision = services.fingerprint(design);
    if (revision !== manifest.documentRevision)
      throw Preview.conflict('stale-document','The pixel document changed after paint export',{expected:manifest.documentRevision,actual:revision});
    const base = baseline(design,manifest.destination,manifest.frame,sceneRef,services);
    if (base.manifest.sourceRevision !== manifest.sourceRevision)
      throw Preview.conflict('stale-source','The bound scene or its dependencies changed after paint export',
        {expected:manifest.sourceRevision,actual:base.manifest.sourceRevision});
    proposal = plan(base,manifest,image,{limit,evaluate:(patch,original)=>services.editWithReceipt(design,patch,{
      scene:()=>({ editor:original.editor.fork(),revision:original.revision }),sceneRef
    },{runner:'cli',options:{scene:sceneRef},frameId:patch.frame})});
  } catch (error) {
    proposal = { report:{ format:reportFormat,version:1,status:'conflicted',conflicts:Preview.conflicts(error) } };
  }
  const { report,images,result,receipt } = proposal;
  if (apply) {
    if (!result || report.approval !== approval) {
      if (result) {
        report.status = 'conflicted';
        delete report.approval;
        report.conflicts.push({code:'approval-mismatch',message:'Preview the current edit and use its approval digest'});
      }
      console.log(JSON.stringify(report,null,2));
      process.exitCode = 2;
      return;
    }
    files.json(path.resolve(out),result);
    console.log(JSON.stringify(receipt,null,2));
    return;
  }
  if (review && images) writeReview(path.resolve(review),report,images);
  if (out) files.json(path.resolve(out),report);
  else console.log(JSON.stringify(report,null,2));
  if (report.status === 'conflicted') process.exitCode = 2;
}

module.exports = { command };
