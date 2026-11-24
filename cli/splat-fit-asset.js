const RowAssets = require('./render-row-assets.js');
const Curve = require('../src/curve-splat.js');
const Optical = require('../src/optical-materials.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Footprints = require('../src/splat-footprints.js');

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
  function index(source) {
    const i = stable ? ids.rowOf(source) : source;
    if (!Number.isSafeInteger(i) || i<0 || i>=world.count || seen.has(i) || !eligible(world,i) ||
        (stable && !Targets.objectScope(target,owner(i))))
      throw new RangeError('Invalid, duplicate, or unavailable splat fit target ' + source);
    seen.add(i);
    return i;
  }
  for (const [source, scale] of asset.edits) {
    if (!Number.isFinite(scale) || scale!==0 && (scale<.4 || scale>2))
      throw new RangeError('Invalid splat fit footprint scale');
    const i=index(source);
    scales[i]=scale;
  }
  if (asset.attributes!==undefined) {
    if (!Array.isArray(asset.attributes) || asset.attributes.length>world.count)
      throw new TypeError('Splat fit needs a bounded attribute table');
    const authored=Footprints.validate(world), styles=authored?.styles.slice()??[];
    const styleKeys=new Map(styles.map((style,i)=>[JSON.stringify(style),i+1]));
    let slots, pigment, albedo, coverage;
    seen.clear();
    for (const [source, change] of asset.attributes) {
      const i=index(source);
      if (!change || Object.getPrototypeOf(change)!==Object.prototype || !Object.keys(change).length ||
          Object.keys(change).some(key=>!['footprint','pigment','coverage'].includes(key)))
        throw new TypeError('Splat fit attributes need a footprint, pigment or coverage');
      if (change.footprint!==undefined) {
        const base=authored?.styles[(authored.indices[i]??0)-1];
        if (change.footprint===false && base?.depth==='plane')
          throw new RangeError('Cannot replace a retained plane with a Gaussian footprint');
        const proposed=Footprints.prepare(change.footprint);
        const footprint=proposed && Footprints.prepare({...proposed,depth:base?.depth??'center'});
        const key=footprint && JSON.stringify(footprint);
        if (footprint && !styleKeys.has(key)) styleKeys.set(key,styles.push(footprint));
        if (styles.length>Footprints.maxStyles) throw new RangeError('Splat fit exceeds the footprint style budget');
        if (!slots) {
          slots=new Uint16Array(world.count);
          if (authored) slots.set(authored.indices);
        }
        slots[i]=footprint ? styleKeys.get(key) : 0;
      }
      if (change.pigment!==undefined) {
        if (!rgb24(change.pigment)) throw new RangeError('Splat fit pigment needs a packed RGB color');
        if (!pigment) {
          pigment=new Uint32Array(world.count);
          albedo=new Uint32Array(world.count);
          if (world.materialAlbedo) albedo.set(world.materialAlbedo.subarray(0,world.count));
        }
        pigment[i]=albedo[i]=change.pigment+1;
      }
      if (change.coverage!==undefined) {
        if (!unit(change.coverage)) throw new RangeError('Splat fit coverage needs a value from 0 to 1');
        if (change.coverage!==1) {
          coverage ??= new Float32Array(world.count).fill(1);
          coverage[i]=change.coverage;
        }
      }
    }
    if (slots) {
      const frames=authored?.frames && new Float32Array(world.count*6);
      if (frames) frames.set(authored.frames);
      scales.footprints=slots.some(Boolean) ? Footprints.layout(world.count,styles,slots,frames) : undefined;
    }
    if (pigment) Object.assign(scales,{pigment,albedo});
    if (coverage) scales.coverage=coverage;
  }
  cache.set(world,scales);
  return scales;
}

const sceneId = world => world.spec?.id ?? world.id;
const rgb24 = value => Number.isSafeInteger(value) && value>=0 && value<=0xffffff;
const unit = value => Number.isFinite(value) && value>=0 && value<=1;
function pigmentAt(world, i, fit) {
  const value=fit?.albedo?.[i] || world.materialAlbedo?.[i];
  if (value) return value-1;
  const rgb=Math.round((world.rest??world.data)[i*16+7]);
  return (rgb&255)<<16 | rgb&0xff00 | rgb>>>16&255;
}
module.exports={format,prepare,eligible,sceneId,rgb24,unit,pigmentAt};
