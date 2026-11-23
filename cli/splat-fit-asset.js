const RowAssets = require('./render-row-assets.js');
const Curve = require('../src/curve-splat.js');
const Optical = require('../src/optical-materials.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');

const format='ink-studio/splat-fit';
const compiled=new WeakMap();

function eligible(world, i) {
  const rest=world.rest ?? world.data, q=i*16, flags=Math.round(rest[q+11]), kind=flags&15;
  return rest[q+3]>=1 && (kind===0 || kind===12) && !(flags&(16|32|64|128|256|512|1024|2048|32768)) &&
    !Curve.isRow(rest,q) && !world.opticalSplats?.[i*Optical.STRIDE+3] && !world.anim?.geometryOwned?.[i] && !world.anim?.physicsOwned?.[i] && !world.anim?.rig?.bid?.[i];
}

function prepare(world, asset) {
  if (asset===undefined || asset===false) return null;
  const stable = asset?.version === 2 && asset.format === format;
  if (!stable) RowAssets.validate(world,asset,format);
  if (stable && asset.scene !== undefined && asset.scene !== sceneId(world))
    throw new RangeError('Splat fit belongs to a different scene');
  let cache = compiled.get(asset);
  if (!cache) compiled.set(asset,cache = new WeakMap());
  if (cache.has(world)) return cache.get(world);
  if (!Array.isArray(asset.edits) || asset.edits.length>world.count) throw new TypeError('Splat fit needs splat edits');
  const target = stable ? Targets.prepare(asset.target) : undefined;
  if (stable && (!Targets.name(target.object) || Object.keys(target).some(key => !['object','part'].includes(key))))
    throw new TypeError('Stable splat fit needs an object ID and optional part ID');
  const ids = stable && Provenance.identities(world);
  const owner = stable && Targets.index(world).row;
  const scales=new Float32Array(world.count).fill(1), seen=new Set();
  for (const [source, scale] of asset.edits) {
    const i = stable ? ids.rowOf(source) : source;
    if (!Number.isSafeInteger(i) || i<0 || i>=world.count || seen.has(i) ||
        !Number.isFinite(scale) || scale!==0 && (scale<.4 || scale>2) || !eligible(world,i) ||
        (stable && !Targets.objectScope(target,owner(i))))
      throw new RangeError('Invalid, duplicate, or unavailable splat fit target ' + source);
    seen.add(i);
    scales[i]=scale;
  }
  cache.set(world,scales);
  return scales;
}

const sceneId = world => world.spec?.id ?? world.id;
module.exports={format,prepare,eligible,sceneId};
