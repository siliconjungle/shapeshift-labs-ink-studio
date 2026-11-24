'use strict';

const { isDeepStrictEqual:equal } = require('node:util');

function conflict(code, message, details, ErrorType = RangeError) {
  return Object.assign(new ErrorType(message),{ conflicts:[{ code,message,...details }] });
}

function conflicts(error) {
  if (error?.conflicts?.length) return error.conflicts;
  const problems = Array.isArray(error?.problems) && error.problems.filter(row => row.level === 'error');
  if (problems?.length) return problems.map(({ path,problem,hint }) =>
    ({ code:'invalid-scene', path, message:problem, ...(hint && { hint }) }));
  return [{ code:'invalid-edit', message:error?.message ?? String(error) }];
}

function fieldsChanged(before, after) {
  return [...new Set([...Object.keys(before ?? {}),...Object.keys(after ?? {})])]
    .filter(key => !equal(before?.[key],after?.[key]));
}

function sourceChanges(scene, before, after) {
  if (!before || !after || equal(before,after)) return [];
  const result = [];
  const solids = rows => Object.fromEntries((rows ?? []).map((row,i) => [row.id === undefined ? 'slot:'+i : 'solid:'+row.id,row]));
  function compare(kind, left = {}, right = {}) {
    for (const key of fieldsChanged(left,right)) {
      const old = left && Object.hasOwn(left,key) ? left[key] : undefined;
      const next = right && Object.hasOwn(right,key) ? right[key] : undefined;
      const object = kind === 'solid' ? next?.id ?? old?.id ?? key : key;
      const part = kind === 'solid' ? next?.part ?? old?.part : undefined;
      result.push({ scene, kind, object, ...(part !== undefined && { part }),
        change:old === undefined ? 'added' : next === undefined ? 'removed' : 'modified',
        fields:fieldsChanged(old,next) });
    }
  }
  compare('solid',solids(before.solids),solids(after.solids));
  compare('part',before.parts,after.parts);
  compare('prefab',before.instances,after.instances);
  const fields = fieldsChanged(before,after).filter(key => !['solids','parts','instances'].includes(key));
  if (fields.length) result.push({ scene, kind:'scene', change:'modified', fields });
  return result;
}

function sourceTarget({ destination,binding,layer }, patch) {
  if (!binding) return;
  const splats = destination.kind === 'splat-attributes' && Array.isArray(patch.operation?.splats) ? patch.operation.splats : null;
  const channels = splats?.filter(row=>row && (row.pigment!==undefined || row.coverage!==undefined))
    .map(({splat,pigment,coverage})=>({splat,...(pigment!==undefined&&{pigment}),...(coverage!==undefined&&{coverage})}));
  return {
    id:patch.id, destination:destination.id, kind:destination.kind,
    scene:binding.scene, binding:binding.id, object:binding.object,
    ...(layer?.kind === 'surface' && { layer:layer.id, ...(patch.operation?.pixel !== undefined && { at:patch.operation.pixel }) }),
    ...(binding.part !== undefined && { part:binding.part }),
    ...(destination.chart !== undefined && { chart:destination.chart, channel:destination.channel }),
    ...(destination.kind === 'shot-correction' && Array.isArray(patch.edits) && {
      frame:patch.frame, pixels:patch.edits.map(edit => ({ at:edit?.at, from:edit?.from, to:edit?.to }))
    }),
    ...(splats && {splats:splats.map(change=>change?.splat)}),
    ...(channels?.length && {channels})
  };
}

function previewLimit(limit = 256) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Pixel preview limit must be a nonnegative integer');
  return limit;
}

function guideChanges(before = [], after = []) {
  if (before === after) return [];
  const left = new Map(before.map(guide => [guide.id,guide])), right = new Map(after.map(guide => [guide.id,guide]));
  const changed = [];
  for (const id of new Set([...left.keys(),...right.keys()])) {
    const old = left.get(id), next = right.get(id);
    if (!equal(old,next)) changed.push({ id, change:old === undefined ? 'added' : next === undefined ? 'removed' : 'modified',
      before:structuredClone(old ?? null), after:structuredClone(next ?? null) });
  }
  return changed;
}

function report({ baseline, candidate = baseline, sources = [], targets = [], issues = [],
  warnings = [], sourceRevision, compile, cell, limit }) {
  const maximum = previewLimit(limit);
  const pixels = [];
  let pixelCount = 0;
  if (!equal(baseline,candidate)) {
    const canSkipUnchanged = candidate.version === 2 && baseline.version === 2 &&
      baseline.width === candidate.width && baseline.height === candidate.height &&
      equal(baseline.palette,candidate.palette) && equal(baseline.protectedDetails,candidate.protectedDetails) &&
      baseline.layers.every((layer,i) => equal(layer,candidate.layers[i]));
    const oldFrames = canSkipUnchanged && new Map(baseline.frames.map(frame => [frame.id,frame]));
    const frames = candidate.version === 2 ? candidate.frames : [undefined];
    for (const frame of frames) {
      const id = frame?.id;
      if (oldFrames && equal(oldFrames.get(id),frame)) continue;
      const before = compile(baseline,id), after = compile(candidate,id);
      const width = Math.max(before.width,after.width), height = Math.max(before.height,after.height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = x < before.width && y < before.height ? y*before.width+x : -1;
        const b = x < after.width && y < after.height ? y*after.width+x : -1;
        const oldSlot = before.slots[a] ?? -1, newSlot = after.slots[b] ?? -1;
        const oldColor = oldSlot < 0 ? undefined : before.mixedColors?.[a] ?? before.colors[oldSlot];
        const newColor = newSlot < 0 ? undefined : after.mixedColors?.[b] ?? after.colors[newSlot];
        const oldAlpha = before.opacity?.[a] ?? (oldSlot < 0 ? 0 : 255);
        const newAlpha = after.opacity?.[b] ?? (newSlot < 0 ? 0 : 255);
        const oldLayer = before.layerIds[before.owners[a]] ?? null, newLayer = after.layerIds[after.owners[b]] ?? null;
        if (oldLayer === newLayer && before.cels?.get(oldLayer) === after.cels?.get(newLayer) &&
            before.swatches[oldSlot] === after.swatches[newSlot] && oldColor === newColor && oldAlpha === newAlpha &&
            (before.locks[a] ?? 0) === (after.locks[b] ?? 0)) continue;
        pixelCount++;
        if (pixels.length >= maximum) continue;
        const { at, ...left } = a < 0 ? {} : cell(before,a), { at:_, ...right } = b < 0 ? {} : cell(after,b);
        const showAlpha = (before.opacity || after.opacity) && oldAlpha !== newAlpha;
        pixels.push({ frame:id ?? null,at:at ?? [x,y],
          before:a < 0 ? null : { ...left,color:color(oldColor),...(showAlpha && { alpha:oldAlpha }) },
          after:b < 0 ? null : { ...right,color:color(newColor),...(showAlpha && { alpha:newAlpha }) } });
      }
    }
  }
  const guides = guideChanges(baseline.version === 2 ? baseline.guides : undefined,
    candidate.version === 2 ? candidate.guides : undefined);
  return { format:'ink-studio/pixel-edit-preview', version:1, valid:issues.length === 0,
    ...(sourceRevision !== undefined && { sourceRevision }),
    ...(warnings.length && { warnings }),
    ...(guides.length && { guides }),
    pixelCount, pixels, sources, targets, conflicts:issues };
}

const color = packed => packed === undefined ? null : '#'+packed.toString(16).padStart(6,'0');

module.exports = { conflict, conflicts, sourceChanges, sourceTarget, guideChanges, previewLimit, report };
