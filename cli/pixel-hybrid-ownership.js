'use strict';

const { conflict } = require('./pixel-edit-preview.js');

const destinations = {
  sdf: ['sdf-shape', 'sdf-material', 'surface-channel'],
  mesh: ['mesh-topology', 'scan-material'],
  atlas: ['surface-channel', 'decal-layer', 'scan-material'],
  splats: ['splat-attributes'],
  curves: []
};
const pigment = ['pigment', 'paint', 'material'];
const coverage = ['coverage', 'opacity', 'footprint', 'footprintScale', 'visible', 'scale', 'orientation'];
const detail = ['roughness', 'normal', 'emission'];

function channelsFor(destination, operation, dedicatedDetail) {
  switch (destination.kind) {
    case 'mesh-topology':
    case 'sdf-shape': return ['shape'];
    case 'surface-channel':
      return [pigment.includes(destination.channel) ? 'pigment' : coverage.includes(destination.channel) ? 'coverage' : 'detail'];
    case 'decal-layer': return operation?.type === 'mask' ? ['coverage'] : ['pigment', 'coverage'];
    case 'sdf-material': {
      const paint = operation?.paint;
      return paint ? [...(paint.material !== undefined ? ['pigment'] : []), ...(paint.masks !== undefined ? ['detail'] : [])] : ['pigment'];
    }
    case 'scan-material':
    case 'splat-attributes': {
      if (destination.kind === 'splat-attributes' && dedicatedDetail) return ['detail'];
      if (operation?.topology !== undefined) return ['shape', 'pigment', 'coverage', 'detail'];
      if (operation?.groups !== undefined) return ['shape', 'coverage'];
      const inputs = [operation, operation?.paint, operation?.attributes,
        ...(Array.isArray(operation?.splats) ? operation.splats : []), ...(Array.isArray(operation?.texels) ? operation.texels : [])];
      const active = keys => inputs.some(row => keys.some(key => row?.[key] !== undefined));
      return [...(active(['position']) ? ['shape'] : []), ...(active(pigment) ? ['pigment'] : []),
        ...(active(coverage) ? ['coverage'] : []), ...(active(detail) ? ['detail'] : [])];
    }
    default: return [];
  }
}

function declaration(source, context, binding) {
  return source.editor?.snapshot().hybridOwnership ?? source.world?.hybridOwnership ??
    source.world?.spec?.hybridOwnership ?? context.hybridOwnership?.(binding);
}

function verify({ destination, binding }, patch, source, context) {
  const ownership = declaration(source, context, binding), requested = patch.ownership;
  if (requested === undefined && (ownership === undefined || destination.kind === 'shot-correction')) return;
  const api = require('../index.js').load().KIT.authoring.hybridOwnership;
  if (requested === undefined) {
    if (api.manages(ownership, binding)) throw conflict('hybrid-owner-required',
      'Choose the authored hybrid channel before editing this part', { object:binding.object, part:binding.part ?? null });
    return;
  }
  if (ownership === undefined) throw conflict('missing-hybrid-ownership',
    'The scene has no ownership declaration for this edit', { ownership:requested });
  const manifest = api.prepare(ownership), route = api.route(manifest, requested);
  function matches(owner) {
    return owner.source === route.source && owner.destination === destination.id && owner.target.object === binding.object &&
      owner.target.part === binding.part && destinations[owner.kind].includes(destination.kind);
  }
  if (!matches(route)) throw conflict('wrong-hybrid-owner',
    'The edit destination does not address the authored ' + route.channel + ' owner',
    { ownership:route, destination:destination.id, binding:binding.id });
  const dedicatedDetail = route.channel === 'detail' && route.kind === 'splats' &&
    !manifest.parts.some(part => ['shape', 'pigment', 'coverage'].some(channel => {
      const { target } = manifest.sources[part.owners[channel].source];
      return target.object === binding.object &&
        (target.part === undefined || binding.part === undefined || target.part === binding.part);
    }));
  const channels = channelsFor(destination, patch.operation, dedicatedDetail);
  const routes = channels.map(channel => api.route(manifest, { ...requested, channel }));
  if (!channels.includes(route.channel) || routes.some(owner => !matches(owner)))
    throw conflict('hybrid-channel-mismatch','The edit would change a channel outside its authored destination',
      { ownership:route, channels, destination:destination.id });
  const derived = [...new Map(routes.flatMap(owner => owner.derived).map(item => [item.id, item])).values()];
  return { ...route, channels, derived };
}

module.exports = { verify };
