const RowAssets = require('./render-row-assets.js');
const Curve = require('../src/curve-splat.js');
const Optical = require('../src/optical-materials.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Footprints = require('../src/splat-footprints.js');
const SurfaceLook = require('../src/surface-look.js');
const source = Symbol('splat fit source');
const baseWorld = world => world[source] ?? world;

const format='ink-studio/splat-fit';
const compiled=new WeakMap();

function eligible(world,i) {
  return Provenance.restData(world)[i*16+3]>=1 && paintable(world,i);
}

function paintable(world, i) {
  const rest=Provenance.restData(world), q=i*16, flags=Math.round(rest[q+11]), kind=flags&15;
  return rest[q+3]>0 && (kind===0 || kind===12) && !(flags&(16|32|64|128|256|512|1024|2048|32768)) &&
    !Curve.isRow(rest,q) && !world.opticalSplats?.[i*Optical.STRIDE+3] && !world.anim?.geometryOwned?.[i] && !world.anim?.physicsOwned?.[i] && !world.anim?.rig?.bid?.[i];
}

function prepare(world, asset) {
  world = baseWorld(world);
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
  function index(source, supports=eligible) {
    const i = stable ? ids.rowOf(source) : source;
    if (!Number.isSafeInteger(i) || i<0 || i>=world.count || seen.has(i) || !supports(world,i) ||
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
    let slots, pigment, albedo, coverage, materialIds, roughness, emission;
    let surfaceData, surfaces, profiles;
    const stride = SurfaceLook.STRIDE;
    const transferredFinishes = new Map(), defaultFinishes = new Map();
    function applyFinish(i, slot) {
      if (!surfaceData) {
        surfaceData = new Float32Array(world.count*stride);
        if (world.surfaceData) surfaceData.set(world.surfaceData.subarray(0,surfaceData.length));
      }
      const offset = i*stride;
      if (slot && !world.surfaceData?.[offset] && !surfaceData[offset]) {
        const normal = world.renderMetadata?.normals?.subarray(i*3,i*3+3);
        surfaceData.set(normal?.some(Boolean) ? normal : [0,1,0], offset+1);
        surfaceData[offset+4] = 1;
      }
      surfaceData[offset] = slot;
    }
    function setPigment(i, color) {
      if (!pigment) {
        pigment = new Uint32Array(world.count);
        albedo = new Uint32Array(world.count);
        if (world.materialAlbedo) albedo.set(world.materialAlbedo.subarray(0,world.count));
      }
      pigment[i] = albedo[i] = color+1;
    }
    seen.clear();
    for (const [source, change] of asset.attributes) {
      const i=index(source,change?.footprint!==undefined ? eligible : paintable);
      if (!change || Object.getPrototypeOf(change)!==Object.prototype || !Object.keys(change).length ||
          Object.keys(change).some(key=>!['footprint','pigment','coverage','material','roughness','emission'].includes(key)))
        throw new TypeError('Invalid splat fit attributes');
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
      let surfaceSlot = world.surfaceData?.[i*stride] ?? 0;
      if (change.material!==undefined) {
        const profile = (profiles ??= materialProfiles(world))(change.material);
        materialIds ??= new Uint32Array(world.renderMetadata.materialIds);
        materialIds[i] = profile.id;
        if (profile.id !== world.renderMetadata.materialIds[i]) {
          if (profile.finish !== undefined && profile.finish !== surfaceSlot) {
            const finish = world.surfaces?.[profile.finish-1];
            const bevelDistance = world.surfaces?.[surfaceSlot-1]?.bevelDistance;
            if (finish?.bevelDistance && finish.bevelDistance!==bevelDistance) {
              // A transferred material must sample the recipient's geometry.
              const key=profile.finish+'/'+surfaceSlot;
              if (!transferredFinishes.has(key)) {
                surfaces ??= world.surfaces.slice();
                transferredFinishes.set(key,surfaces.push({...finish,bevelDistance}));
              }
              surfaceSlot=transferredFinishes.get(key);
            } else surfaceSlot=profile.finish;
            applyFinish(i,surfaceSlot);
          }
          setPigment(i,profile.pigment);
        }
      }
      if (change.roughness!==undefined) {
        if (!unit(change.roughness)) throw new RangeError('Splat roughness must be from 0 to 1');
        roughness ??= new Float32Array(world.count).fill(NaN);
        roughness[i] = change.roughness;
        const finish = (surfaces ?? world.surfaces)?.[surfaceSlot-1];
        if (specular(finish) === undefined) {
          if (!defaultFinishes.has(surfaceSlot)) {
            surfaces ??= world.surfaces?.slice() ?? [];
            const layers = { ...finish?.settings.layers };
            let id='splat-specular';
            while (Object.hasOwn(layers,id)) id+='-';
            layers[id]={type:'specular',strength:.3,roughness:.5};
            defaultFinishes.set(surfaceSlot,surfaces.push({...finish,settings:{...finish?.settings,layers}}));
          }
          applyFinish(i,defaultFinishes.get(surfaceSlot));
        }
      }
      if (change.emission!==undefined) {
        if (!validEmission(change.emission)) throw new RangeError('Splat emission needs three linear RGB values from 0 to 64');
        if (change.emission.some(Boolean)) (emission ??= new Map()).set(i,change.emission.slice());
      }
      if (change.pigment!==undefined) {
        if (!rgb24(change.pigment)) throw new RangeError('Splat fit pigment needs a packed RGB color');
        setPigment(i,change.pigment);
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
    if (materialIds) scales.renderMetadata={...world.renderMetadata,materialIds};
    if (surfaceData) scales.surfaceData=surfaceData;
    if (surfaces) scales.surfaces=surfaces;
    if (roughness) scales.roughness=roughness;
    if (emission) scales.emission=emission;
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
  const rgb=Math.round(Provenance.restData(world)[i*16+7]);
  return (rgb&255)<<16 | rgb&0xff00 | rgb>>>16&255;
}
const validEmission = value => Array.isArray(value) && value.length===3 &&
  Array.from(value).every(n=>Number.isFinite(n) && n>=0 && n<=64);

function specular(finish) {
  return Object.values(finish?.settings.layers ?? {}).find(layer=>layer.type==='specular');
}

function roughnessAt(world,i,fit,finish=world.surfaceData?.[i*SurfaceLook.STRIDE]) {
  const value = fit?.roughness?.[i];
  if (Number.isFinite(value)) return value;
  const layer = specular(world.surfaces?.[finish-1]);
  if (!layer) return .5;
  const { roughness }=layer;
  const widths=Array.isArray(roughness) ? roughness : [roughness,roughness];
  return widths.reduce((sum,width)=>sum+Math.min(1,width>0 ? width : .22),0)/2;
}

function materialProfiles(world) {
  const { materials,materialIds } = world.renderMetadata ?? {};
  const profiles = new Map();
  const byId = new Map();
  for (let i=0; i<world.count; i++) {
    const id=materialIds?.[i], name=materials?.[id];
    if (!Targets.name(name) && !Number.isSafeInteger(name)) continue;
    const finish=world.surfaceData?.[i*SurfaceLook.STRIDE] ?? 0;
    if (!byId.has(id)) byId.set(id,{id,finish,colors:new Map()});
    const profile=byId.get(id), pigment=pigmentAt(world,i);
    if (profile.finish!==finish) profile.finish=undefined;
    profile.colors.set(pigment,(profile.colors.get(pigment)??0)+1);
  }
  for (const [id,{finish,colors}] of byId) {
    let pigment=0, peak=0;
    for (const [color,count] of colors) if (count>peak || count===peak && color<pigment) {
      pigment=color;
      peak=count;
    }
    profiles.set(materials[id],{id,finish,pigment});
  }
  return name => {
    if (!profiles.has(name)) throw new RangeError('Unknown splat material slot '+name);
    return profiles.get(name);
  };
}

function renderWorld(world,fit) {
  if (!fit) return world;
  const { albedo,renderMetadata,surfaceData,surfaces,roughness } = fit;
  const hasFootprints=Object.hasOwn(fit,'footprints');
  if (!albedo && !renderMetadata && !surfaceData && !roughness && !hasFootprints) return world;
  return { ...world,[source]:baseWorld(world),
    ...(hasFootprints && {splatFootprints:fit.footprints}),
    ...(albedo && {materialAlbedo:albedo}),
    ...(renderMetadata && {renderMetadata}),
    ...(surfaceData && {surfaceData}),
    ...(surfaces && {surfaces}),
    ...(roughness && {splatRoughness:roughness}) };
}

module.exports={format,prepare,eligible,paintable,sceneId,rgb24,unit,pigmentAt,validEmission,roughnessAt,materialProfiles,renderWorld,baseWorld};
