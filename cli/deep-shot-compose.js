const Color = require('../src/color-space.js');
const PNG = require('./png.js');
const { plateLayout, allocatePlanes } = require('./deep-openexr.js');
const { layout: { maxLayers } } = require('./deep-composite.js');

const rgb = ['R','G','B'], objectId = 'ink.objectId', materialId = 'ink.materialId';
const statistics = plate => plate.statistics ?? {
  width: plate.w, height: plate.h, retainedSamples: plate.offsets.at(-1), droppedSamples: 0, truncatedPixels: 0
};
const nearest = (a,b) => Math.abs(a-b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));

function ensureRegistration(reference, entry, alignment) {
  const { input, plate } = entry;
  if (plate === reference || input.kind === 'card' || alignment === 'registered') return;
  const a = reference.registration, b = plate.registration;
  if (reference.w !== plate.w || reference.h !== plate.h || reference.view !== plate.view || !a || !b ||
      !nearest(a.setback,b.setback) || !a.worldToCamera.every((n,i) => nearest(n,b.worldToCamera[i])) ||
      !a.worldToNDC.every((n,i) => nearest(n,b.worldToNDC[i])))
    throw new RangeError('Deep input ' + input.id + ' does not match the reference camera. Supply an authored registration.');
}

function registerLabels(entries, reference, field, ids) {
  const names = reference[field].slice(), used = new Set(reference.planes[ids]), lookup = new Map();
  for (const [i, label] of names.entries()) if (label !== null && !lookup.has(label)) lookup.set(label,i);
  for (const entry of entries) {
    const remap = new Map([[0,0]]);
    entry[ids] = remap;
    if (entry.plate === reference) continue;
    for (const id of entry.plate.planes[ids]) {
      if (remap.has(id)) continue;
      const label = entry.plate[field][id] ?? entry.input.id + '/' + field + '/' + id;
      if (!lookup.has(label)) {
        if (!names.length) names.push(null);
        while (used.has(names.length)) names.push(null);
        if (names.length >= 65536) throw new RangeError('Deep shot exceeds its named ID budget');
        lookup.set(label,names.length);
        names.push(label);
      }
      remap.set(id,lookup.get(label));
    }
  }
  return names;
}

function shotFrame(plan, frame) {
  let available = plateLayout.maxSamples, inputPixels = 0;
  const entries = plan.inputs.map((input, i) => {
    const match = frame.matches[i], plate = plan.plate(input, match, available);
    inputPixels += plate.w * plate.h;
    if (inputPixels > 4 * plateLayout.maxPixels) throw new RangeError('Deep shot exceeds its shared input pixel budget');
    available -= plate.offsets.at(-1);
    return { input, match, plate };
  });
  const anchor = entries.find(entry => entry.input.id === plan.reference).plate;
  for (const entry of entries) ensureRegistration(anchor, entry, plan.alignment);
  const { w, h, view, registration } = anchor, capacity = plateLayout.maxSamples - available;
  const objects = registerLabels(entries, anchor, 'objects', objectId), materials = registerLabels(entries, anchor, 'materials', materialId);
  const offsets = new Uint32Array(w * h + 1), planes = allocatePlanes(capacity), pixels = new Uint8Array(w * h * 4);
  const intoWorking = Color.prepare('srgb-linear', plan.working), intoDeep = Color.prepare(plan.working, 'srgb-linear');
  const intoDisplay = Color.prepare(plan.working, plan.display), display = [0,0,0], native = [0,0,0], mixed = [0,0,0];
  const effects = plan.operations.map(op => ({ ...op, matched: 0 }));
  const ray = [], pool = [];
  let used = 0, trimmed = 0, maxSamples = 0;

  function apply(sample, input, plate, index, x, y) {
    const a = plate.planes.A[index], object = plate.planes[objectId][index], material = plate.planes[materialId][index];
    Object.assign(sample, { alpha: a, z: plate.planes.Z[index] + input.depthOffset, source: input.id,
      objectId: object, materialId: material, object: plate.objects[object], material: plate.materials[material],
      kind: plate.planes['ink.kind'][index], x, y, drop: false });
    for (let c = 0; c < 3; c++) sample.rgb[c] = a ? plate.planes[rgb[c]][index] / a : 0;
    intoWorking(sample.rgb,sample.rgb);
    for (const effect of effects) if (effect.matches(sample)) {
      effect.matched++;
      effect.apply(sample);
      if (sample.drop) return false;
    }
    sample.z = Math.fround(sample.z);
    if (!Number.isFinite(sample.z) || sample.z < 0 || !Number.isFinite(sample.alpha) ||
        sample.alpha < 0 || sample.alpha > 1 || !Array.isArray(sample.rgb) ||
        sample.rgb.length !== 3 || !Array.from(sample.rgb).every(Number.isFinite))
      throw new RangeError('Deep effect produced invalid color, coverage or depth at ' + x + ',' + y);
    return true;
  }

  function copy(sample, visibility) {
    const { entry, index, alpha, z } = sample, source = entry.plate.planes;
    for (const name of plateLayout.channels) planes[name][used] = source[name][index];
    const nativeAlpha = Math.fround(alpha);
    planes.A[used] = nativeAlpha;
    planes.Z[used] = planes.ZBack[used] = z;
    planes['ink.visibleCoverage'][used] = nativeAlpha * visibility;
    for (const tag of [objectId,materialId]) {
      const id = source[tag][index];
      planes[tag][used] = entry.plate === anchor ? id : entry[tag].get(id);
    }
    intoDeep(sample.rgb,native);
    for (let c=0;c<3;c++) {
      const encoded = Math.fround(native[c] * nativeAlpha);
      if (!Number.isFinite(encoded)) throw new RangeError('Deep effect exceeds float sample storage');
      planes[rgb[c]][used] = encoded;
    }
    used++;
  }

  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    ray.length = 0;
    for (const entry of entries) {
      const { input, plate } = entry, sx = x - input.offset[0], sy = y - input.offset[1];
      if (sx < 0 || sx >= plate.w || sy < 0 || sy >= plate.h) continue;
      const at = sy * plate.w + sx;
      for (let index = plate.offsets[at]; index < plate.offsets[at + 1]; index++) {
        const sample = pool[ray.length] ??= { rgb: [0,0,0] };
        if (!apply(sample,input,plate,index,x,y)) { trimmed++; continue; }
        sample.entry = entry;
        sample.index = index;
        ray.push(sample);
      }
    }
    if (ray.length > maxLayers) throw new RangeError('Deep edit exceeds ' + maxLayers + ' retained samples at ' + x + ',' + y);
    maxSamples = Math.max(maxSamples, ray.length);
    // Sort stably so supplied plate order resolves equal-depth ties.
    ray.sort((a,b) => a.z - b.z);
    let visibility = 1;
    mixed.fill(0);
    for (const sample of ray) {
      const a = Math.fround(sample.alpha);
      copy(sample,visibility);
      for (let c = 0; c < 3; c++) mixed[c] += sample.rgb[c] * a * visibility;
      visibility *= 1 - a;
    }
    offsets[p+1] = used;
    const alpha = 1 - visibility;
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) mixed[c] /= alpha;
    intoDisplay(mixed,display);
    for (let c = 0; c < 3; c++) pixels[p*4+c] = Math.round(display[c] * 255);
    pixels[p*4+3] = Math.round(alpha * 255);
  }
  for (const name of plateLayout.channels) planes[name] = planes[name].subarray(0,used);
  const clipped = capacity - used - trimmed;
  const sources = entries.map(({ input, match, plate }) => ({
    id: input.id, file: plan.relative(match.path), kind: input.kind, time: match.time ?? plate.time ?? null,
    ...(match.static ? { static: true } : { delta: match.delta }), offset: input.offset, depthOffset: input.depthOffset,
    ...(input.kind === 'card' && { color: input.card.color }), ...statistics(plate)
  }));
  const droppedSamples = sources.reduce((n,row) => n + row.droppedSamples,0), truncatedPixels =
    Math.min(w*h,sources.reduce((n,row) => n + row.truncatedPixels,0));
  return {
    plate: { w,h,offsets,planes,objects,materials,view,registration,time:frame.time,
      statistics: { droppedSamples,truncatedPixels } },
    preview: PNG.encode(w,h,pixels,4),
    receipt: { time:frame.time, width:w, height:h, sources, effects: effects.map(({ matches, apply, ...row }) => row),
      maxSamples, retainedSamples:used, trimmedSamples:trimmed, clippedSamples:clipped, droppedSamples, truncatedPixels }
  };
}

function inspect(plate, at) {
  const { w,h,offsets,planes,objects,materials } = plate;
  const value = { format:'ink-studio/deep-plate-info', version:1, view:plate.view, time:plate.time ?? null,
    registration:plate.registration ?? null, ...statistics(plate), objects, materials,
    color:{ space:'srgb-linear', alpha:'premultiplied' }, channels:plateLayout.channels };
  if (!at) return value;
  if (!Array.isArray(at) || at.length !== 2) throw new TypeError('Choose one deep pixel as [x,y]');
  const [x,y] = at;
  if (![x,y].every(Number.isSafeInteger) || x<0 || y<0 || x>=w || y>=h)
    throw new RangeError('Deep probe is outside the native art grid');
  const p=y*w+x, first=offsets[p], count=offsets[p+1]-first;
  const kind = Object.fromEntries(Object.entries(plateLayout.kinds).map(([name,id])=>[id,name]));
  value.pixel = { at, samples: Array.from({length:count},(_,k)=>{
    const i=first+k, object=planes[objectId][i], material=planes[materialId][i];
    return { z:planes.Z[i], alpha:planes.A[i], visibleCoverage:planes['ink.visibleCoverage'][i],
      rgb:rgb.map(channel=>planes[channel][i]), kind:kind[planes['ink.kind'][i]] ?? planes['ink.kind'][i],
      objectId:object, object:objects[object] ?? null, materialId:material, material:materials[material] ?? null,
      splatId:planes['ink.splatId'][i] };
  }) };
  return value;
}

module.exports = { shotFrame, inspect };
