const { createHash } = require('node:crypto');
const RowAssets = require('./render-row-assets.js');
const RowAttributes = require('./splat-row-attributes.js');
const Topology = require('./splat-topology.js');
const Groups = require('./splat-group-deformations.js');
const ScanRotation = require('./splat-scan-rotation.js');
const Curve = require('../src/curve-splat.js');
const Optical = require('../src/optical-materials.js');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Footprints = require('../src/splat-footprints.js');
const SurfaceLook = require('../src/surface-look.js');
const source = Symbol('splat fit source');
const footprintRows = Symbol('edited footprint rows');
const rowAttributes = Symbol('edited splat attributes');
const groupTransforms = Symbol('splat group transforms');
const carriedGroups = Symbol('materialized splat groups');
const sourceTopology = Symbol('source splat topology');
const bakedFit = Symbol('baked splat fit');
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

function sourceSignature(world) {
  const hash=createHash('sha256').update(RowAssets.signature(world));
  const scan=world.gaussianHarmonics, meta=world.renderMetadata;
  hash.update(JSON.stringify([world.splatIds,meta?.objects,meta?.materials,meta?.targets,scan?.degree,scan?.up]));
  for (const column of [meta?.objectIds,meta?.materialIds,meta?.targetIds,meta?.normals,scan?.dc,scan?.sh,
    scan?.normals,scan?.linear,scan?.available]) {
    hash.update(column ? 'column:'+column.byteLength+':' : 'missing:');
    if (column) hash.update(Buffer.from(column.buffer,column.byteOffset,column.byteLength));
  }
  return hash.digest('hex');
}

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
  if (stable && asset.sourceSignature!==undefined && asset.sourceSignature!==sourceSignature(world))
    throw new RangeError('Splat attribute plan does not match the source cloud');
  const target = stable ? Targets.prepare(asset.target) : undefined;
  if (stable && (!Targets.name(target.object) || Object.keys(target).some(key => !['object','part'].includes(key))))
    throw new TypeError('Stable splat fit needs an object ID and optional part ID');
  const topology=asset.topology===undefined ? undefined : Topology.catalog(base,asset.topology,target,topologyEditable);
  world = topology?.world ?? base;
  if (!Array.isArray(asset.edits) || asset.edits.length>world.count) throw new TypeError('Splat fit needs splat edits');
  const ids = stable && Provenance.identities(world);
  const owner = stable && Targets.index(world).row;
  const scales=new Float32Array(world.count).fill(1), seen=new Set(), editedRows=new Uint8Array(world.count);
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
    if (scale!==1) editedRows[i]=1;
  }
  if (asset.attributes!==undefined) {
    if (!Array.isArray(asset.attributes) || asset.attributes.length>world.count)
      throw new TypeError('Splat fit needs a bounded attribute table');
    const authored=Footprints.validate(world);
    const footprints=new Map(), transforms=new Map();
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
      editedRows[i]=1;
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
        if (Object.keys(values).length) transforms.set(i,values);
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
    if (transforms.size) {
      scales.rowAttributes=transforms;
      scales.attributeRows=new Uint8Array(world.count);
      for (const i of transforms.keys()) scales.attributeRows[i]=1;
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
    for (const i of topology.created.keys()) editedRows[i]=1;
    if (topology.retired.size) {
      scales.retiredRows=new Uint8Array(world.count);
      for (const i of topology.retired.keys()) {
        scales[i]=0;
        scales.retiredRows[i]=1;
        editedRows[i]=1;
      }
    }
  }
  if (asset.groups!==undefined) {
    if (!stable) throw new TypeError('Splat groups need a stable splat fit');
    scales.groups=Groups.prepare(world,asset.groups,{target,attributes:scales.rowAttributes,
      retired:topology?.retired,eligible:topologyEditable});
    if (scales.groups.affected.size) {
      scales.attributeRows ??= new Uint8Array(world.count);
      for (const row of scales.groups.affected.keys()) editedRows[row]=scales.attributeRows[row]=1;
    }
  }
  if (scales.rowAttributes) scales.rowTransforms=RowAttributes.transforms(scales.rowAttributes);
  if (world.gaussianHarmonics && (scales.rowTransforms || scales.groups?.affected.size)) {
    const {M}=require('../index.js').load().KIT;
    const rotations=new Map([...(scales.rowTransforms ?? [])].filter(([,change])=>change.matrix));
    const first=ScanRotation.transport(world,rotations,M);
    const last=scales.groups && ScanRotation.transport(first.harmonics ? {...world,gaussianHarmonics:first.harmonics} : world,
      scales.groups.affected,M);
    scales.harmonics=last?.harmonics ?? first.harmonics;
    if (scales.groups) scales.groups.directionalRows=last.directionalRows ?? 0;
  }
  if (editedRows.some(Boolean)) {
    scales.editedRows=editedRows;
    scales.revision=createHash('sha256').update(JSON.stringify(asset)).digest('hex');
  }
  cache.set(base,scales);
  return scales;
}

function planSplatGroups(world, {groups, target, base=world.look?.splatFit} = {}) {
  const prior=base===false ? undefined : base;
  if (prior && (prior.version!==2 || prior.format!==format))
    throw new TypeError('Splat groups can extend a version 2 splat fit');
  const scope=Targets.prepare(target ?? prior?.target);
  if (prior && (scope.object!==prior.target.object || scope.part!==prior.target.part))
    throw new RangeError('Splat groups must keep the base fit target');
  if (!Array.isArray(groups)) throw new TypeError('Provide the ordered splat group list');
  const asset={ ...prior,format,version:2,scene:sceneId(world),target:scope,edits:prior?.edits??[],
    groups:structuredClone(groups) };
  // Check scene identity before copying a base fit into the new asset.
  if (prior?.scene!==undefined && prior.scene!==asset.scene)
    throw new RangeError('Splat fit belongs to a different scene');
  const fit=prepare(world,asset);
  return { asset, report:{format:'ink-studio/splat-group-report',version:1,scene:asset.scene,target:scope,
    changedRows:fit.groups.affected.size,directionalRows:fit.groups.directionalRows??0,groups:fit.groups.report,
    revision:fit.revision??null} };
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
  const carried=world[carriedGroups];
  if (carried?.fit===fit && carried.footprints===footprints && applyAttributes) return world;
  world=carried?.input??world;
  const { albedo,renderMetadata,surfaceData,surfaces,roughness } = fit;
  const hasFootprints=footprints && Object.hasOwn(fit,'footprints');
  if (!albedo && !renderMetadata && !surfaceData && !roughness && !hasFootprints && !fit.rowAttributes && !fit.topology && !fit.groups?.affected.size) return world;
  const base=baseWorld(world);
  const rendered={ ...world,...fit.topology?.patch,[source]:base,
    ...(fit.topology && {[sourceTopology]:fit.topology}),
    ...(hasFootprints && {splatFootprints:fit.footprints,[footprintRows]:fit.footprintRows}),
    ...(albedo && {materialAlbedo:albedo}),
    ...(renderMetadata && {renderMetadata}),
    ...(surfaceData && {surfaceData}),
    ...(surfaces && {surfaces}),
    ...(roughness && {splatRoughness:roughness}),
    ...(fit.rowAttributes && {[rowAttributes]:fit.rowAttributes}),
    ...(fit.groups?.affected.size && {[groupTransforms]:fit.groups.affected}) };
  if (!applyAttributes) return rendered;
  let result=rendered;
  if (fit.rowAttributes) {
    const attributesSource={...sourceWorld(world,fit),...(surfaceData&&{surfaceData}),
      ...(hasFootprints&&{splatFootprints:fit.footprints})};
    result=RowAttributes.transport(rendered,attributesSource,fit.rowTransforms);
  }
  if (fit.groups?.affected.size) {
    result=RowAttributes.transport(result,result,fit.groups.affected);
    result[carriedGroups]={fit,footprints,input:world};
  }
  if (fit.harmonics) result.gaussianHarmonics=fit.harmonics;
  return result;
}

// Materialize a static derivative once before reducing or packing its rows.
function bake(world,asset=world.look?.splatFit) {
  const fit=prepare(world,asset);
  if (!fit) return world;
  if (world.anim || world.rest || world.pixAnchors || world.effectParticles?.length || world.sortRanges?.length)
    throw new TypeError('Splat LOD baking needs static source rows without external animation or draw ranges');
  const rendered=renderWorld(world,fit), data=rendered.data.slice(0,rendered.count*16), keep=[];
  const frames=rendered.splatFootprints?.frames?.slice();
  for (let i=0;i<rendered.count;i++) {
    const scale=fit[i], coverage=fit.coverage?.[i]??1, at=i*16;
    if (!scale || !coverage || !data[at+3]) continue;
    keep.push(i);
    if (coverage<1) data[at+3]=Math.min(1,data[at+3])*coverage;
    if (scale!==1) {
      for (const c of [4,5,6,8,9,10]) data[at+c]*=scale*scale;
      if (frames) for (let k=0;k<6;k++) frames[i*6+k]*=scale;
    }
    const pigment=fit.pigment?.[i];
    if (pigment) {
      const rgb=pigment-1;
      data[at+7]=(rgb&255)<<16 | rgb&0xff00 | rgb>>>16;
    }
  }
  const {rest, [source]:_, [sourceTopology]:_topology, [rowAttributes]:_attrs,
    [footprintRows]:_shapes, [groupTransforms]:_groups, [carriedGroups]:_carried, ...result}=rendered;
  result.data=data;
  const {splatFit,...look}=rendered.look??{};
  result.look=look;
  const identity=Provenance.identities(sourceWorld(rendered,fit));
  result.splatIds=Object.freeze(Array.from({length:rendered.count},(_,i)=>identity.idAt(i)??null));
  if (fit.topology) {
    result.splatLineage=new Map(world.splatLineage);
    for (const [kind,rows] of [['created',fit.topology.created],['retired',fit.topology.retired]])
      for (const [row,record] of rows) {
        const id=result.splatIds[row];
        result.splatLineage.set(id,{...result.splatLineage.get(id),[kind]:record});
      }
  }
  if (frames) {
    const {styles,indices}=rendered.splatFootprints;
    result.splatFootprints=Footprints.layout(rendered.count,styles,indices,frames);
  }
  if (fit.editedRows) {
    result.splatLodProtected = Uint8Array.from(fit.editedRows, (edited, i) => edited || rendered.splatLodProtected?.[i] || 0);
    result[bakedFit] = { revision: fit.revision, retainGeometry: editedSubjects(rendered,fit) };
  }
  if (fit.emission) result.splatBakedEmission = new Map([...(world.splatBakedEmission ?? []), ...fit.emission]);
  delete result.renderSdfs;
  delete result.referenceSdfs;
  return keep.length===rendered.count ? result : Provenance.subset(result,keep);
}

const subjectLookups = new WeakMap();
function editedSubjects(world,fit) {
  if (!fit?.editedRows) return world[bakedFit]?.retainGeometry;
  if (subjectLookups.has(fit)) return subjectLookups.get(fit);
  const before=Targets.index(sourceWorld(world,fit)).row, after=Targets.index(world).row;
  const objects=new Set(), parts=new Set();
  const key=(owner,part)=>JSON.stringify([owner,part]);
  function add({object,entity,part}) {
    for (const owner of [object,entity]) if (owner!==undefined) {
      objects.add(owner);
      parts.add(key(owner,part));
    }
  }
  for (let i=0;i<fit.editedRows.length;i++) if (fit.editedRows[i]) {
    add(before(i));
    add(after(i));
  }
  const includes = ({object,part,source: sprite}) => sprite?.splatFitRevision !== fit.revision &&
    (part===undefined ? objects.has(object) : parts.has(key(object,part)));
  subjectLookups.set(fit,includes);
  return includes;
}

function sourceRevision(world, asset) {
  return prepare(world,asset)?.revision ?? world[bakedFit]?.revision;
}

function editedFootprint(world,row) {
  return world[footprintRows]?.[row] ? footprintAt(world.splatFootprints,row) : undefined;
}

function lifecycle(world,row) {
  const topology=world[sourceTopology];
  const prior=world.splatLineage?.get(world.splatIds?.[row]);
  return {created:topology?.created.get(row)??prior?.created,retired:topology?.retired.get(row)??prior?.retired};
}

const editedAttributes = (world,row) => world[rowAttributes]?.get(row);
const deformationAt = (world,row) => world[groupTransforms]?.get(row);
module.exports={format,sourceSignature,prepare,bake,planSplatGroups,editedSubjects,sourceRevision,topologyEditable,sourceWorld,lifecycle,editedAttributes,deformationAt,footprintAt,footprintFor,editedFootprint,eligible,paintable,sceneId,rgb24,unit,pigmentAt,validEmission,roughnessAt,materialProfiles,renderWorld,baseWorld};
