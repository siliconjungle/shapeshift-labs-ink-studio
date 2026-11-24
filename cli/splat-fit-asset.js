const RowAssets = require('./render-row-assets.js');
const RowAttributes = require('./splat-row-attributes.js');
const Topology = require('./splat-topology.js');
const Curve = require('../src/curve-splat.js');
const Optical = require('../src/optical-materials.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Footprints = require('../src/splat-footprints.js');
const SurfaceLook = require('../src/surface-look.js');
const source = Symbol('splat fit source');
const footprintRows = Symbol('edited footprint rows');
const rowAttributes = Symbol('edited splat attributes');
const sourceTopology = Symbol('source splat topology');
const baseWorld = world => world[source] ?? world;

const format='ink-studio/splat-fit';
const compiled=new WeakMap(), footprintStyles=new WeakMap();

function eligible(world,i) {
  return Provenance.restData(world)[i*16+3]>=1 && paintable(world,i);
}

function paintable(world, i) {
  const rest=Provenance.restData(world), q=i*16, flags=Math.round(rest[q+11]), kind=flags&15;
  return rest[q+3]>0 && (kind===0 || kind===12) && !(flags&(16|32|64|128|256|512|1024|2048|32768)) &&
    !Curve.isRow(rest,q) && !world.opticalSplats?.[i*Optical.STRIDE+3] && !world.anim?.geometryOwned?.[i] && !world.anim?.physicsOwned?.[i] && !world.anim?.rig?.bid?.[i];
}


function footprintAt(layout,row) {
  const slot=layout?.indices[row];
  if (!slot) return false;
  if (!footprintStyles.has(layout)) footprintStyles.set(layout,layout.styles.map(style=>Footprints.prepare(style)));
  return footprintStyles.get(layout)[slot-1];
}

function footprintFor(base,change) {
  if (change===false && base?.depth==='plane')
    throw new RangeError('Cannot replace a retained plane with a Gaussian footprint');
  const proposed=Footprints.prepare(change);
  if (!proposed) return false;
  const depth=base?.depth??'center';
  return (proposed.depth??'center')===depth ? proposed : Footprints.prepare({...proposed,depth});
}

function fittedFootprints(count,authored,replacements) {
  const styles=[], indices=new Uint16Array(count), slots=new Map(), keys=new WeakMap();
  for (let i=0; i<count; i++) {
    const style=replacements.has(i) ? replacements.get(i) : footprintAt(authored,i);
    if (!style) continue;
    let key=keys.get(style);
    if (!key) keys.set(style,key=JSON.stringify(style));
    if (!slots.has(key)) {
      if (styles.length===Footprints.maxStyles)
        throw new RangeError('Splat fit exceeds the footprint style budget');
      slots.set(key,styles.push(style));
    }
    indices[i]=slots.get(key);
  }
  if (!styles.length) return;
  const frames=authored?.frames && new Float32Array(count*6);
  if (frames) frames.set(authored.frames);
  return Footprints.layout(count,styles,indices,frames);
}

const topologyEditable = (world,i) => paintable(world,i) && RowAttributes.transformable(world,i);
const sourceWorld = (world,fit) => fit?.topology?.world ?? world[sourceTopology]?.world ?? baseWorld(world);

function prepare(world, asset) {
  const base = world = baseWorld(world);
  if (asset===undefined || asset===false) return null;
  const stable = asset?.version === 2 && asset.format === format;
  if (!stable) RowAssets.validate(world,asset,format);
  if (stable && asset.scene !== undefined && asset.scene !== sceneId(world))
    throw new RangeError('Splat fit belongs to a different scene');
  let cache = compiled.get(asset);
  if (!cache) compiled.set(asset,cache = new WeakMap());
  if (cache.has(world)) return cache.get(world);
  const target = stable ? Targets.prepare(asset.target) : undefined;
  if (stable && (!Targets.name(target.object) || Object.keys(target).some(key => !['object','part'].includes(key))))
    throw new TypeError('Stable splat fit needs an object ID and optional part ID');
  const topology=asset.topology===undefined ? undefined : Topology.catalog(base,asset.topology,target,topologyEditable);
  world = topology?.world ?? base;
  if (!Array.isArray(asset.edits) || asset.edits.length>world.count) throw new TypeError('Splat fit needs splat edits');
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
    const authored=Footprints.validate(world);
    const footprints=new Map(), editedRows=new Map();
    let pigment, albedo, coverage, materialIds, roughness, emission;
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
      const i=index(source,paintable);
      if (!change || Object.getPrototypeOf(change)!==Object.prototype || !Object.keys(change).length ||
          Object.keys(change).some(key=>!['footprint','pigment','coverage','material','roughness','emission',...RowAttributes.keys].includes(key)))
        throw new TypeError('Invalid splat fit attributes');
      const changed=RowAttributes.keys.filter(name=>change[name]!==undefined);
      if (changed.length) {
        if (changed.some(name=>name!=='opacity') && !RowAttributes.transformable(world,i))
          throw new RangeError('Splat transforms need a static source row');
        const authored=RowAttributes.valuesAt(world,i), values={};
        for (const name of changed) {
          const value=RowAttributes.prepare(name,change[name]);
          if (!RowAttributes.same(value,authored[name])) values[name]=value;
        }
        if (Object.keys(values).length) editedRows.set(i,values);
      }
      if (change.footprint!==undefined) {
        const authoredStyle=footprintAt(authored,i);
        const style=footprintFor(authoredStyle,change.footprint);
        if (JSON.stringify(style)!==JSON.stringify(authoredStyle)) footprints.set(i,style);
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
    if (footprints.size) {
      scales.footprints=fittedFootprints(world.count,authored,footprints);
      scales.footprintRows=new Uint8Array(world.count);
      for (const i of footprints.keys()) scales.footprintRows[i]=1;
    }
    if (editedRows.size) {
      scales.rowAttributes=editedRows;
      scales.attributeRows=new Uint8Array(world.count);
      for (const i of editedRows.keys()) scales.attributeRows[i]=1;
    }
    if (pigment) Object.assign(scales,{pigment,albedo});
    if (coverage) scales.coverage=coverage;
    if (materialIds) scales.renderMetadata={...world.renderMetadata,materialIds};
    if (surfaceData) scales.surfaceData=surfaceData;
    if (surfaces) scales.surfaces=surfaces;
    if (roughness) scales.roughness=roughness;
    if (emission) scales.emission=emission;
  }
  if (topology) {
    scales.topology=topology;
    if (topology.retired.size) {
      scales.retiredRows=new Uint8Array(world.count);
      for (const i of topology.retired.keys()) {
        scales[i]=0;
        scales.retiredRows[i]=1;
      }
    }
  }
  cache.set(base,scales);
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

function renderWorld(world,fit,{footprints=true,applyAttributes=true} = {}) {
  if (!fit) return world;
  const { albedo,renderMetadata,surfaceData,surfaces,roughness } = fit;
  const hasFootprints=footprints && Object.hasOwn(fit,'footprints');
  if (!albedo && !renderMetadata && !surfaceData && !roughness && !hasFootprints && !fit.rowAttributes && !fit.topology) return world;
  const base=baseWorld(world);
  const rendered={ ...world,...fit.topology?.patch,[source]:base,
    ...(fit.topology && {[sourceTopology]:fit.topology}),
    ...(hasFootprints && {splatFootprints:fit.footprints,[footprintRows]:fit.footprintRows}),
    ...(albedo && {materialAlbedo:albedo}),
    ...(renderMetadata && {renderMetadata}),
    ...(surfaceData && {surfaceData}),
    ...(surfaces && {surfaces}),
    ...(roughness && {splatRoughness:roughness}),
    ...(fit.rowAttributes && {[rowAttributes]:fit.rowAttributes}) };
  if (!fit.rowAttributes || !applyAttributes) return rendered;
  const attributesSource={...sourceWorld(world,fit),...(surfaceData&&{surfaceData}),
    ...(hasFootprints&&{splatFootprints:fit.footprints})};
  return RowAttributes.apply(rendered,attributesSource,fit.rowAttributes);
}

function editedFootprint(world,row) {
  return world[footprintRows]?.[row] ? footprintAt(world.splatFootprints,row) : undefined;
}

function lifecycle(world,row) {
  const topology=world[sourceTopology];
  return {created:topology?.created.get(row),retired:topology?.retired.get(row)};
}

const editedAttributes = (world,row) => world[rowAttributes]?.get(row);
module.exports={format,prepare,topologyEditable,sourceWorld,lifecycle,editedAttributes,footprintAt,footprintFor,editedFootprint,eligible,paintable,sceneId,rgb24,unit,pigmentAt,validEmission,roughnessAt,materialProfiles,renderWorld,baseWorld};
