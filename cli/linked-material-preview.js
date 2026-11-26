const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');
const assets = require('./asset-files.js');
const usages = require('./material-output-usages.js');
const geometry = require('./material-preview-geometry.js');
const { mapSamples, screenSamples, displaySamples } = require('./material-preview-aov.js');
const render = require('./render.js').render;

const format = 'ink-studio/linked-material-preview';
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,63}$/i.test(value);
const text = (value, limit = 100) => typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\x00-\x1f]/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && min <= value && value <= max;
const pair = (value, min, max) => Array.isArray(value) && value.length === 2 && Array.from(value).every(n => integer(n, min, max));
const clamp = n => Math.max(0, Math.min(1, n));
const previewKinds = ['sphere', 'plane', 'cube', 'mesh', 'ink'];
const toRGBA = ({ width, height, channels, data }, alpha = 255) => {
  if (channels === 4) return Uint8Array.from(data);
  const output = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++)
    output.set([data[p * channels], data[p * channels + 1], data[p * channels + 2], alpha], p * 4);
  return output;
};

function address(value) {
  if (pair(value, -1000, 1000)) return value.slice();
  if (!integer(value, 1001, 2000)) throw new TypeError('UV tiles need a UDIM number from 1001 to 2000 or a signed UV pair');
  const n = value - 1001;
  return [n % 10, Math.floor(n / 10)];
}

function settings(source, baseDir) {
  if (!fields(source, ['format', 'version', 'label', 'targets', 'slots', 'view', 'variants']) || source.format !== format ||
      source.version !== 1 || !text(source.label, 140) ||
      !Array.isArray(source.targets) || !integer(source.targets.length, 1, 10) ||
      !record(source.slots) || !integer(Object.keys(source.slots).length, 1, 64))
    throw new TypeError('Expected a version 1 linked material preview plan with targets and slot bindings');
  const variants = source.variants ?? [];
  if (!Array.isArray(variants) || variants.length > 3 || !Array.from(variants).every(row =>
      fields(row,['id','label','inputs','time','seed']) && id(row.id) && text(row.label) &&
      (row.inputs === undefined || record(row.inputs)) && (row.time === undefined || Number.isFinite(row.time)) &&
      (row.seed === undefined || Number.isSafeInteger(row.seed))))
    throw new TypeError('Preview variants need an ID, label and optional inputs, time or seed');
  if (new Set(['current',...variants.map(row=>row.id.toLowerCase())]).size !== variants.length+1)
    throw new RangeError('Duplicate material preview variant ID');
  const view = source.view ?? {};
  const { width = 360, height = 280, steps = 12, textureSize = 256 } = view;
  if (!fields(view, ['width', 'height', 'steps', 'textureSize']) || !integer(width, 64, 640) || !integer(height, 64, 640) ||
      !integer(steps, 1, 32) || !integer(textureSize, 16, 512) || width * height * steps * source.targets.length * (variants.length + 1) > 14e6)
    throw new RangeError('Preview dimensions, orbit steps or total render budget are out of range');
  const targets = Array.from(source.targets, target => {
    if (!fields(target, ['id', 'kind', 'label', 'file', 'slot', 'uvSet', 'uvGrid']) || !id(target.id) ||
        !previewKinds.includes(target.kind) || target.label !== undefined && !text(target.label))
      throw new TypeError('Invalid linked material preview target');
    const imported = target.kind === 'mesh' || target.kind === 'ink';
    if (imported ? !text(target.file, 4096) || target.slot !== undefined || target.uvGrid !== undefined ||
        target.uvSet !== undefined && !integer(target.uvSet, 0, 31) :
        target.file !== undefined || target.uvSet !== undefined || !text(target.slot) ||
        target.uvGrid !== undefined && !pair(target.uvGrid, 1, 8))
      throw new TypeError('Primitive previews need a slot. Imported targets need a file and optional UV set.');
    return { ...target, label: target.label ?? target.id,
      ...(imported ? { file: path.resolve(baseDir, target.file) } : { uvGrid: target.uvGrid ?? [1, 1] }) };
  });
  if (new Set(targets.map(row => row.id.toLowerCase())).size !== targets.length) throw new RangeError('Duplicate preview target ID');
  const slots = new Map();
  for (const [slot, binding] of Object.entries(source.slots)) {
    if (!text(slot) || !fields(binding, ['output', 'maps', 'tiles', 'tileInput']) ||
        (binding.output === undefined) === (binding.maps === undefined) ||
        binding.output !== undefined && !id(binding.output) ||
        binding.tileInput !== undefined && !id(binding.tileInput))
      throw new TypeError('Bind preview slot ' + slot + ' to one graph output or one map collection');
    const tiles = binding.tiles ?? [1001];
    if (!Array.isArray(tiles) || !integer(tiles.length, 1, 64)) throw new RangeError('Each preview slot supports 1–64 UV tiles');
    const tileList = Array.from(tiles, address), keys = tileList.map(geometry.tileKey);
    if (new Set(keys).size !== keys.length) throw new RangeError('Duplicate UV tile on ' + slot);
    if (binding.maps !== undefined && (!record(binding.maps) || !integer(Object.keys(binding.maps).length, 1, 24) ||
        Object.entries(binding.maps).some(([name, watch]) => !id(name) ||
          !fields(watch, ['output', 'map']) || Object.keys(watch).length !== 1 || !id(watch.output ?? watch.map))))
      throw new TypeError('Preview maps need names and graph output or output-usage references');
    slots.set(slot, { ...binding, tileList });
  }
  return { label: source.label, targets, slots, variants, view: { width, height, steps, textureSize } };
}

const sampleMaximum = image => ({ unorm8: 255, unorm16: 65535 })[image.descriptor.precision] ?? 1;
const byte = value => Math.round(clamp(value) * 255);
function texture(P, channels, id, limit) {
  const color = channels.baseColor, first = color ?? Object.values(channels)[0];
  const scale = limit / Math.max(limit, first.raster.width, first.raster.height);
  const width = Math.max(1, Math.round(first.raster.width * scale)), height = Math.max(1, Math.round(first.raster.height * scale));
  const pixels = color ? toRGBA(P.graphImages.toDisplay(P.graphImages.resize(color, width, height))) :
    Uint8Array.from({ length: width * height * 4 }, (_, i) => [150, 157, 158, 255][i % 4]);
  const row = { id, texture: { width, height, pixels }, mipmaps: { ambient: .46, specular: .39, light: [-.48, .6, .72] } };
  for (const name of ['roughness', 'metalness', 'opacity']) {
    if (!channels[name]) continue;
    const source = P.graphImages.resize(channels[name], width, height), divisor = sampleMaximum(source);
    const samples = Uint8Array.from(source.raster.data, n => byte(n / divisor));
    if (name === 'opacity') {
      for (let i = 0; i < samples.length; i++) pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * samples[i] / 255);
    } else row[name] = samples;
  }
  if (channels.emission) row.emission = toRGBA(P.graphImages.toDisplay(P.graphImages.resize(channels.emission, width, height)));
  const n = channels.normal ?? (channels.height && P.graphImages.normals.heightToNormal(channels.height));
  if (n) {
    if (n.descriptor.normalSpace === 'world') throw new TypeError('Linked material previews need tangent-space normal maps');
    const normal = P.graphImages.resize(n, width, height), { channels, data } = normal.raster;
    const divisor = sampleMaximum(normal), pixels = new Uint8Array(width * height * 4);
    const flipY = normal.descriptor.normalOrientation === 'directx';
    for (let p = 0; p < width * height; p++) {
      const i = p * channels;
      const alpha = normal.descriptor.alpha === 'none' ? 1 : data[i + 3] / divisor;
      const gain = normal.descriptor.alpha === 'premultiplied' ? alpha : 1;
      for (let c = 0; c < 3; c++) {
        let n = gain ? data[i + c] / (gain * divisor) : Number(c === 2);
        if (gain && normal.descriptor.domain === 'unit') n = n * 2 - 1;
        pixels[p * 4 + c] = byte(((c === 1 && flipY ? -n : n) + 1) * .5);
      }
      pixels[p * 4 + 3] = 255;
    }
    row.normal = pixels;
  }
  return row;
}

async function loadMaps(project, config, run, P, files, budget) {
  const table = new Map();
  let requests = 0;
  for (const [slot, binding] of config.slots) for (const uv of binding.tileList) {
    if (++requests > 96) throw new RangeError('Linked preview has more than 96 tile bindings');
    const watches = binding.output ? { material: { output: binding.output } } : binding.maps;
    const inputs = binding.tileInput ? { ...run.inputs, [binding.tileInput]: uv } : run.inputs;
    const evaluated = await project.previewFrame(watches, { ...run, ...(inputs && { inputs }) }, { encodeArtifacts: false });
    if (!evaluated.report.passed) throw new RangeError('Graph assertions failed for slot ' + slot + ' tile ' + geometry.tileLabel(uv));
    const packet = evaluated.values.material;
    const channels = binding.maps ? evaluated.values : P.materialChannels.valid(packet) ?
      Object.fromEntries(Object.entries(packet.channels).map(([name, row]) => [name, row.raster])) :
      { baseColor: packet };
    if (Object.keys(channels).length > 24) throw new RangeError('Linked preview supports up to 24 maps per tile');
    const maps = Object.entries(channels).map(([name, image]) => {
      if (!P.graphImages.valid(image) || (!name.startsWith('custom.') && !P.materialChannels.validMap(name, image)))
        throw new TypeError('Preview channel ' + name + ' on ' + slot + ' needs a typed map with a matching intent');
      const { width, height } = image.raster;
      budget.texels += width * height;
      if (budget.texels > 12e6) throw new RangeError('Material maps exceed the 12-million-texel preview budget');
      const { bytes, ...details } = usages.preview(P, image, evaluated.report.previews[name]?.outputUsage ?? {});
      const imageFile = 'images/' + createHash('sha256').update(bytes).digest('hex') + '.png';
      files.set(imageFile,bytes);
      return { name, width, height, ...details, image: imageFile, ...mapSamples(image,files), display:displaySamples(bytes,files) };
    });
    table.set(slot + '\0' + geometry.tileKey(uv), { channels, maps });
  }
  return table;
}

function capture(frame, regions, files) {
  const { w, h, rgb } = frame;
  const pixels = new Uint8Array(w*h*4), hits = new Uint8Array(w*h*6);
  const native = screenSamples(frame,regions,files,(p,region,u,v)=>{
    pixels.set(rgb.subarray(p*3,p*3+3),p*4);
    pixels[p*4+3]=255;
    const a=Math.round(clamp(u)*65535), b=Math.round(clamp(v)*65535);
    hits.set([region+1,a>>8,a&255,b>>8,b&255,0],p*6);
  });
  return { ...native, image:PNG.encode(w,h,pixels,4), hit:PNG.encode(w*2,h,hits) };
}

async function createLinkedMaterialPreview(project, source, { toolkit = require('../index.js').load(),
  baseDir = process.cwd(), run = {}, onFile = () => {} } = {}) {
  const { KIT: K, makeBuilder } = toolkit, config = settings(source, baseDir), files = new Map();
  const carriers = config.targets.map(target => ({ target, ...geometry.split(geometry.load(target, toolkit, onFile), K) }));
  const names = new Set(carriers.flatMap(row => row.regions.map(region => region.slot)));
  for (const slot of config.slots.keys()) if (!names.has(slot)) throw new RangeError('No preview carrier has material slot ' + slot);
  const { width, height, steps, textureSize } = config.view, budget = { texels:0 };
  const variants = [];
  for (const { id, label, inputs, ...options } of [{ id:'current',label:'Current' },...config.variants]) {
    const evaluation = { ...run, ...options, ...(inputs && { inputs:{ ...run.inputs,...inputs } }) };
    const maps = await loadMaps(project,config,evaluation,K.procedural,files,budget);
    const targets = carriers.map(({ target, geometry, regions }) => {
      const byId = new Map(), maxTile = Math.min(textureSize, Math.floor(Math.sqrt(2 ** 20 / regions.length)));
      const bound = [];
      const materials = regions.map(region => {
        const id = 'preview-region-' + region.index, entry = maps.get(region.slot + '\0' + region.uv.join(','));
        byId.set(id, region.index);
        bound.push({ ...region, maps:entry?.maps ?? [] });
        if (!entry) return { id, color: 0x5b6769 };
        return texture(K.procedural, entry.channels, id, maxTile);
      });
      const mesh = K.sceneMeshes.create({ id: target.id, ...geometry, materials });
      const world = makeBuilder(57, [0x14252a]).finish({ meshes: [mesh], dither: 0, radius: 5 });
      const bounds = K.procedural.spatial.boxOf(Array.from({ length: geometry.positions.length / 3 },
        (_, i) => geometry.positions.slice(i * 3, i * 3 + 3)));
      const fit = Math.hypot(...K.V.sub(bounds.max, bounds.min)) * .5;
      const distance = Math.max(2.2, fit * 2.24) * Math.max(1, height / width);
      const views = [];
      for (let i = 0; i < steps; i++) {
        const yaw = (target.kind === 'plane' ? .12 : -.53) + i * (Math.PI * 2 / steps);
        const pitch = target.kind === 'plane' ? .13 : .30;
        const frame = render(world, { w: width, h: height, px: 1, raw: true, edges: false, target: [0, 0, 0],
          dist: distance, yaw, pitch, ortho: true, passes: ['depth', 'materialId', 'surfaceUV', 'surfaceCoverage'],
          renderGrid: false, cameraGuides: false, shutter: false });
        const drawn = capture(frame, byId, files);
        const image = (id==='current'?'views/':'views/variants/'+id+'/') + target.id + '-' + i + '.png';
        files.set(image, drawn.image);
        views.push({ image, pick: 'data:image/png;base64,' + drawn.hit.toString('base64'), pixels:drawn.tallies, screen:drawn.screen, depthRange:drawn.depthRange });
      }
      if (id==='current' && !views.some(view => view.pixels.some(Boolean))) throw new RangeError('Preview carrier produced no pickable surface: ' + target.id);
      const preferred = [...config.slots.keys()].map(slot => bound.find(row => row.slot === slot && row.maps.length)).find(Boolean);
      return { id: target.id, label: target.label, kind: target.kind, initialRegion: preferred?.index ?? 0, regions:bound, views };
    });
    variants.push({id,label,targets});
  }
  const [{targets},...alternates]=variants;
  return { data: { format,version:1,label:config.label,width,height,targets,...(alternates.length&&{variants:alternates}) }, files };
}

async function writeLinkedMaterialPreview(project, planFile, { directory, toolkit, run, sources = [] } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('Material preview needs --out directory');
  const plan = path.resolve(planFile), destination = path.resolve(directory);
  const input = JSON.parse(fs.readFileSync(plan, 'utf8')), touched = new Set([...sources, ...project.sourceFiles(), plan].map(file => path.resolve(file)));
  const result = await createLinkedMaterialPreview(project, input, {
    toolkit, baseDir: path.dirname(plan), run, onFile: file => touched.add(file)
  });
  const { data, files } = result;
  for (const [filename, extension] of [['index.html', '.html'], ['live.js', '.browser.js']])
    files.set(filename, fs.readFileSync(path.join(__dirname, 'linked-material-preview' + extension)));
  files.set('aov.js',fs.readFileSync(path.join(__dirname,'../src/material-preview-aov.js')));
  const summarize = targets=>targets.map(target=>({ ...target,views:target.views.map(({ pick,...view })=>view) }));
  const report = { ...data, targets:summarize(data.targets),
    ...(data.variants && { variants:data.variants.map(variant=>({ ...variant,targets:summarize(variant.targets) })) }) };
  files.set('data.js', 'const linkedMaterial = ' + JSON.stringify(data) + ';\n');
  files.set('preview.json', JSON.stringify(report, null, 2) + '\n');
  if ([...files.keys()].some(file => touched.has(path.join(destination, file))))
    throw new RangeError('Choose an output directory that keeps the preview separate from its source files');
  for (const [file, bytes] of files) assets.write(path.join(destination, file), bytes);
  return { file: path.join(destination, 'index.html'), ...report };
}

module.exports = { createLinkedMaterialPreview, writeLinkedMaterialPreview };
