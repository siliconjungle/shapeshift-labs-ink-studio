/* Shared art-pixel buffer names and splat ownership rules for CPU and shader hosts. */
const ArtPasses = (() => {
  const surface = Object.freeze(['coverage', 'depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId', 'position', 'objectPosition', 'protected', 'emissionDepth', 'motion', 'emissionMotion', 'target', 'mask']);
  const environment = Object.freeze(['sky', 'fogTransmittance', 'precipitation', 'reflections', 'foregroundCoverage']);
  const partMotion = Object.freeze(['partId', 'partMotion', 'previousDepth', 'partMotionValid']);
  const strands = Object.freeze(['strandId', 'strandDepth', 'strandCoverage', 'strandTangent', 'strandU', 'strandMotion', 'strandMotionValid']);
  const opaque = Object.freeze(['depth','surfaceCoverage','objectId','materialId','geometricNormal','shadingNormal',
    'position','objectPosition','surfaceUV','surfaceUVValid','surfaceKind','surfaceMotion','surfaceMotionValid']);
  const geometrySource = ['sourceSurface','sourceTriangle','sourceCoordinates'];
  const splatSource = ['sourceSplat','sourceSplatAlpha','sourceSplatDepth','sourceSplatWeight','sourceSplatOmitted',
    'sourceSplatFrontRank','sourceSplatFront','sourceSplatFrontMetrics'];
  const sourceBindings = Object.freeze([...geometrySource,...splatSource]);
  const proxies=Object.freeze(['proxyDepth','proxyRejected','proxyRemovedCoverage']);
  const inkControls=Object.freeze(['shadowBandBias','hatchWeight','outlineWeight','lightSpillWeight']);
  const surfaceKinds=Object.freeze([null,'mesh','sdf','splat','sprite','emitter']);
  const needsSurfaceMotion = selected => selected.includes('surfaceMotion') || selected.includes('surfaceMotionValid');
  const needsPartMotion = selected => selected.some(channel => channel !== 'partId' && partMotion.includes(channel));
  const needsStrandMotion = selected => selected.includes('strandMotion') || selected.includes('strandMotionValid');
  const channels = Object.freeze([...new Set([...surface, ...environment, ...partMotion, ...strands, ...opaque, ...proxies, ...sourceBindings, ...inkControls,
    'paletteOwner', 'inkMask', 'inkShadow', 'pigment', 'sourceRestNormal'])]);
  const cutoff = 0.5;
  const ownsSurface = (alpha, writesDepth, depth, nearest) => writesDepth && alpha > cutoff && depth <= nearest;
  const over = (value, below, alpha) => value * alpha + below * (1 - alpha);

  function select(request) {
    if (!request) return [];
    if (request === true) return surface;
    if (!Array.isArray(request) || request.some(channel => !['environment', 'part-motion', 'strands', 'opaque-surface', 'depth-proxy'].includes(channel) && !channels.includes(channel)))
      throw new RangeError('Unknown art pass. Available passes: ' + channels.join(', '));
    return [...new Set(request.flatMap(channel => channel === 'environment' ? environment :
      channel === 'part-motion' ? partMotion : channel === 'strands' ? strands : channel === 'opaque-surface' ? opaque :
      channel === 'depth-proxy' ? proxies : geometrySource.includes(channel) ? geometrySource :
        splatSource.includes(channel) ? splatSource : [channel]))];
  }

  function subset(passes, selected) {
    const output = { w: passes.w, h: passes.h };
    for (const channel of selected) output[channel] = passes[channel];
    for (const channel of ['motion', 'emissionMotion', 'partMotion', 'previousDepth', 'strandMotion', 'surfaceUV', 'surfaceMotion'])
      if (output[channel] && passes[channel + 'Valid']) output[channel + 'Valid'] = passes[channel + 'Valid'];
    if (output.objectId) output.objects = passes.objects;
    if (output.materialId) output.materials = passes.materials;
    if (output.partId) output.parts = passes.parts;
    if (selected.some(channel => strands.includes(channel))) output.strands = passes.strands;
    if (output.surfaceKind) output.surfaceKinds = surfaceKinds;
    if (output.target) output.targets = passes.targets;
    if (output.paletteOwner) output.paletteOwners = passes.paletteOwners;
    if (output.sourceSurface) output.surfaceSources = passes.surfaceSources;
    if (output.sourceSplat) output.splatSources = passes.splatSources;
    return output;
  }

  function pick(passes,x,y) {
    if (!passes?.depth || !passes.surfaceKind || !passes.position)
      throw new TypeError('Surface picking needs the opaque-surface art passes');
    const {w,h,depth}=passes;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x<0 || y<0 || x>=w || y>=h) return null;
    const p=y*w+x;
    if (!Number.isFinite(depth[p])) return null;
    const tuple = (array,n) => array && Array.from(array.subarray(p*n,(p+1)*n));
    return { kind:surfaceKinds[passes.surfaceKind[p]], depth:depth[p],
      object:passes.objects?.[passes.objectId?.[p]] ?? null, material:passes.materials?.[passes.materialId?.[p]] ?? null,
      ...(passes.partId && {part:passes.parts?.[passes.partId[p]]?.part ?? null}),
      coverage:passes.surfaceCoverage?.[p], position:tuple(passes.position,3), restPosition:tuple(passes.objectPosition,3),
      geometricNormal:tuple(passes.geometricNormal,3), shadingNormal:tuple(passes.shadingNormal,3),
      uv:passes.surfaceUVValid?.[p] ? tuple(passes.surfaceUV,2) : null };
  }

  const glsl = `
bool inkOwnsSurface(float alpha, bool writesDepth, float depth, float nearestDepth) {
  return writesDepth && alpha > 0.5 && depth <= nearestDepth;
}
float inkCoverageOver(float alpha, float below) { return alpha + below * (1.0 - alpha); }
vec3 inkEmissionOver(vec3 emission, vec3 below, float alpha) {
  return emission * alpha + below * (1.0 - alpha);
}
`;

  return Object.freeze({ channels, environment, partMotion, strands, opaque, surfaceKinds, proxies, inkControls, sourceBindings, needsPartMotion, needsStrandMotion, needsSurfaceMotion, select, subset, pick, cutoff, ownsSurface, over, glsl });
})();
if (typeof module !== 'undefined') module.exports = ArtPasses;
