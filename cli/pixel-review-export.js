'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');
const Recipes = require('./pixel-command-recipes.js');

const format = 'ink-studio/pixel-review-bundle';
const resultFormat = 'ink-studio/pixel-review-export';
const maxZoom = 8;
const name = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const plain = value=>value && Object.getPrototypeOf(value) === Object.prototype;
const json = value=>JSON.stringify(value,null,2)+'\n';
const checksum = bytes=>createHash('sha256').update(bytes).digest('hex');

function options({ zoom = 4,views,out }) {
  if (!Number.isSafeInteger(zoom) || zoom < 1 || zoom > maxZoom)
    throw new RangeError('Choose a review zoom between 1 and '+maxZoom);
  if (out !== undefined && (typeof out !== 'string' || !out.trim())) throw new TypeError('Review output needs a directory');
  if (views !== undefined && (!Array.isArray(views) || !views.length || new Set(views.map(row=>row?.id)).size !== views.length))
    throw new TypeError('Review views need unique IDs');
  return { zoom,out,views:views?.map(view=>{
    if (!plain(view)) throw new TypeError('A review view needs an ID and a pixel or scene scope');
    const { scene,camera,...scope } = view;
    const comparison = scene ? {...scope,time:undefined} : scope;
    Recipes.comparison(comparison);
    if (scene && scope.time !== undefined && (!Number.isFinite(scope.time) || scope.time < 0))
      throw new TypeError('A scene review time must be finite and nonnegative');
    if (scene !== undefined && (scene !== true || scope.binding !== undefined || scope.layer !== undefined || scope.cel !== undefined))
      throw new TypeError('A whole-scene view needs scene: true and no binding, layer, or cel');
    if (camera !== undefined && (!(scope.binding || scene) || !plain(camera) ||
        Object.keys(camera).some(key=>!['yaw','pitch','dist','fov','target','ortho'].includes(key)) ||
        ['yaw','pitch','dist','fov'].some(key=>camera[key] !== undefined && !Number.isFinite(camera[key])) ||
        (camera.ortho !== undefined && typeof camera.ortho !== 'boolean') ||
        (camera.target !== undefined && (!Array.isArray(camera.target) || camera.target.length !== 3 ||
          !Array.from(camera.target).every(Number.isFinite)))))
      throw new TypeError('A review camera needs finite lens and pose values');
    return structuredClone(view);
  }) };
}

function zoomImage(bytes,scale) {
  const { w,h,data } = PNG.raster(bytes), width = w*scale,height = h*scale;
  const pixels = new Uint8Array(width*height*4), row = new Uint8Array(width*4);
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const sample = data.subarray((y*w+x)*4,(y*w+x+1)*4);
      for (let i=0; i<scale; i++) row.set(sample,(x*scale+i)*4);
    }
    for (let i=0; i<scale; i++) pixels.set(row,(y*scale+i)*width*4);
  }
  return PNG.encode(width,height,pixels,4);
}

const escape = value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function html(manifest,summary) {
  const sections = manifest.views.map(view=>{
    const figures = scope=>['before','after','difference'].map(side=>{
      const title = side[0].toUpperCase()+side.slice(1), src = view[scope][side];
      return '<figure><img src="'+src+'" alt="'+title+'"><figcaption>'+title+'</figcaption></figure>';
    }).join('');
    return '<section><h2>'+escape(view.id)+'</h2><p>'+view.changedPixels+' changed pixels</p>'+
      '<div class="panels" role="group" aria-label="Native 1× views">'+figures('native')+'</div>'+
      '<details open><summary>'+manifest.zoom+'× views</summary><div class="panels">'+figures('zoomed')+'</div></details></section>';
  }).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>'+escape(manifest.label)+'</title><style>'+
    'body{margin:2rem auto;padding:0 1.25rem;max-width:90rem;background:#14161c;color:#e9eaf0;font:16px system-ui}'+
    'h1{margin-bottom:.5rem}a{color:#a7d5ff}nav,summary{line-height:2}section{border-top:1px solid #414652;margin-top:1.5rem}'+
    '.panels{display:flex;flex-wrap:wrap;gap:1rem;margin:.6rem 0 1rem}figure{margin:0;max-width:100%;overflow:auto}'+
    'img{display:block;image-rendering:pixelated;background:#282d37;outline:1px solid #4c5362}figcaption{padding:.45rem 0}</style>'+
    '<body><h1>'+escape(manifest.label)+'</h1><p>'+summary.pixelCount+' changed document pixels · '+summary.receiptCount+' edit receipts</p>'+
    '<nav><a href="manifest.json">Manifest</a> · <a href="diff.json">Exact diff</a> · '+
    '<a href="render-settings.json">Render settings</a> · <a href="receipts.json">Edit receipts</a>'+
    (manifest.topology ? ' · <a href="topology.json">Mesh topology</a>' : '')+'</nav>'+sections+'</body></html>\n';
}

function assemble({ label,anchors,preview,receipts,batch,views,zoom }) {
  const files = new Map(), write = (file,value)=>files.set(file,value);
  const images = [], settings = [];
  for (const { scope,before,after } of views) {
    if (!name(scope.id)) throw new TypeError('Invalid review view ID');
    const compared = Recipes.compare(scope,before.bytes,after.bytes);
    const native = {}, zoomed = {};
    for (const [side,bytes] of [['before',before.bytes],['after',after.bytes],
      ['difference',Buffer.from(compared.difference.data,'base64')]]) {
      native[side] = 'views/'+scope.id+'/'+side+'.png';
      zoomed[side] = 'views/'+scope.id+'/'+side+'-'+zoom+'x.png';
      write(native[side],bytes);
      write(zoomed[side],zoom === 1 ? bytes : zoomImage(bytes,zoom));
    }
    images.push({ id:scope.id,scope,changedPixels:compared.changedPixels,comparisonRevision:compared.revision,
      grids:{before:compared.before.grid,after:compared.after.grid,difference:compared.difference.grid},native,zoomed });
    settings.push({ id:scope.id,before:before.settings,after:after.settings });
  }
  const manifest = { format,version:1,label,zoom,anchors,views:images,
    review:'index.html',diff:'diff.json',settings:'render-settings.json',receipts:'receipts.json' };
  write(manifest.diff,json(preview));
  write(manifest.settings,json({ version:1,views:settings,zoom,upsampling:'nearest-neighbor' }));
  write(manifest.receipts,json({ version:1,receipts,...(batch && {batch}) }));
  if (preview.diff?.topology?.length) {
    manifest.topology = 'topology.json';
    write(manifest.topology,json({ version:1,meshes:preview.diff.topology }));
  }
  write(manifest.review,html(manifest,{pixelCount:preview.pixelCount,receiptCount:receipts.length}));
  manifest.files = [...files].map(([path,bytes])=>({ path,bytes:Buffer.byteLength(bytes),sha256:checksum(bytes) }));
  write('manifest.json',json(manifest));
  return { manifest,files };
}

function publish({ manifest,files },out,context) {
  if (out === undefined) return { manifest,files:Object.fromEntries([...files].map(([name,contents])=>[name,
    typeof contents === 'string' ? {encoding:'utf8',data:contents} : {encoding:'base64',data:contents.toString('base64')}])) };
  const destination = path.resolve(context.directory ?? process.cwd(),out);
  if (context.inputs?.some(file=>{
    const relative = path.relative(destination,path.resolve(file));
    return !relative || (relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative));
  })) throw new RangeError('Write the review bundle separately from its inputs and report output');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.mkdirSync(destination);
  const created = [], directories = new Set();
  try {
    for (const [file,bytes] of files) {
      const target = path.join(destination,file), directory = path.dirname(target);
      if (directory !== destination && !directories.has(directory)) {
        fs.mkdirSync(directory,{recursive:true});
        directories.add(directory);
      }
      const descriptor = fs.openSync(target,'wx');
      created.push(target);
      try { fs.writeFileSync(descriptor,bytes); }
      finally { fs.closeSync(descriptor); }
    }
  } catch (error) {
    for (const file of created.reverse()) fs.rmSync(file,{force:true});
    for (const directory of [...directories].reverse()) {
      try { fs.rmdirSync(directory); } catch {}
    }
    for (const directory of [path.join(destination,'views'),destination]) {
      try { fs.rmdirSync(directory); } catch {}
    }
    throw error;
  }
  return { manifest,directory:destination };
}

module.exports = { format,resultFormat,maxZoom,options,assemble,publish };
