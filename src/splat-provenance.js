/* Keep stable labels alongside native splats when copying or assembling buffers. */
const SplatProvenance = (() => {
  const tables = [['objectIds', 'objects'], ['materialIds', 'materials'], ['targetIds', 'targets']];
  const channels = [['normals', 3, Float32Array], ['shadingNormals',3,Float32Array], ['paintedEmission',3,Float32Array],
    ['inkControls',4,Float32Array], ['muteEmission', 1, Uint8Array], ['paintFinish', 13, Float32Array]];
  function remapSpills(sources, to) {
    return sources.flatMap(source => {
      const rows = [];
      for (let k = 0; k < source.rows.length; k += 2) {
        const index = to(source.rows[k]);
        if (index !== undefined) rows.push(index, source.rows[k + 1]);
      }
      return rows.length ? [{ ...source, rows }] : [];
    });
  }
  const identityCache = new WeakMap();
  const curveLod = (records, indexAt) => records?.length ?
    (typeof CurveLod === 'undefined' ? require('./curve-lod.js') : CurveLod).remap(records, indexAt) : [];
  const perSplat = [['data', 16, Float32Array], ['attr', 4, Float32Array], ['fine', 12, Float32Array],
    ['pix', 8, Float32Array], ['surfaceData', 8, Float32Array], ['materialAlbedo', 1, Uint32Array],
    ['opticalSplats', 12, Float32Array], ['curveClips', 12, Float32Array], ['curveMaterials', 4, Float32Array],
    ['curveLighting', 7, Float32Array], ['curveTiming', 8, Float64Array], ['curvePattern', 16, Float64Array], ['curveShadows', 1, Uint8Array],
    ['curveStations', 7, Float64Array], ['curveRest',16,Float32Array], ['curveShadowOptics', 1, Float32Array], ['materialPixelStyles', 4, Float32Array],
    ['shadowLod', 6, Float32Array], ['splatLodProtected', 1, Uint8Array]];
  function targetKey(target) {
    const labels = [target.entity, target.surface, target.prefabs, target.tags, target.medium, target.mediumKind];
    if (target.mark !== undefined || target.markLayer !== undefined || target.part !== undefined) labels.push(target.mark, target.markLayer);
    if (target.part !== undefined) labels.push(target.part);
    if (target.castsShadow !== undefined) labels.push(target.castsShadow);
    return JSON.stringify(labels);
  }

  const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
  function restData(world) {
    const base = world.anim?.base;
    return world.rest ?? (base instanceof Float32Array && base.length>=world.count*16 ? base : world.data);
  }

  function identities(world, { fresh = false } = {}) {
    const rest = restData(world);
    const authored = world.splatIds, metadata = world.renderMetadata, count = world.count;
    const prior = identityCache.get(rest);
    if (!fresh && prior && prior.authored === authored && prior.metadata === metadata && prior.count === count) return prior.index;
    const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
    const { row } = selectors.index(world);
    const ids = new Array(count), rows = new Map();
    for (let i = 0; i < count; i++) {
      const target = row(i), owner = target.entity ?? target.object;
      const offset = i*16;
      const x = rest[offset], y = rest[offset+1], z = rest[offset+2];
      const id = validId(authored?.[i]) ? authored[i] :
        owner != null && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
          ? 'rest:' + JSON.stringify([owner,target.part ?? null,x,y,z]) : undefined;
      if (!validId(id)) continue;
      ids[i] = id;
      rows.set(id,rows.has(id) ? -1 : i);
    }
    const index = Object.freeze({
      idAt: i => rows.get(ids[i]) === i ? ids[i] : undefined,
      ambiguous: i => rows.get(ids[i]) === -1,
      rowOf: id => rows.get(id) ?? -1
    });
    identityCache.set(rest,{ authored, metadata, count, index });
    return index;
  }

  function dictionary(key = value => value) {
    const names = [null], ids = new Map();
    function add(value, anonymous = false) {
      if (value == null) return anonymous ? names.push(null) - 1 : 0;
      const id = key(value);
      if (!ids.has(id)) ids.set(id, names.push(value) - 1);
      return ids.get(id);
    }
    return { names, add };
  }

  function fromRecords(records) {
    const result = { normals: new Float32Array(records.length * 3) };
    const objects = dictionary(), materials = dictionary(), targets = dictionary(targetKey);
    const objectIds = new Uint32Array(records.length), materialIds = new Uint32Array(records.length);
    const targetIds = new Uint32Array(records.length);
    for (let i = 0; i < records.length; i++) {
      const { owner, material, surface, target, normal } = records[i];
      objectIds[i] = objects.add(owner === '' ? null : owner);
      materialIds[i] = materials.add(material === '' ? null : material);
      if (surface || target) targetIds[i] = targets.add({ ...(surface && { surface }), ...target });
      if (normal) result.normals.set(normal, i * 3);
    }
    if (objects.names.length > 1) Object.assign(result, { objectIds, objects: objects.names });
    if (materials.names.length > 1) Object.assign(result, { materialIds, materials: materials.names });
    if (targets.names.length > 1) Object.assign(result, { targetIds, targets: targets.names });
    return result;
  }

  function combineMetadata(parts, count) {
    if (!parts.some(part => part.renderMetadata)) return undefined;
    const result = {};
    for (const [rows, names] of tables) {
      if (!parts.some(part => part.renderMetadata?.[rows])) continue;
      const out = new Uint32Array(count), table = dictionary(names === 'targets' ? targetKey : undefined);
      let offset = 0;
      for (const part of parts) {
        const source = part.renderMetadata?.[rows];
        if (source) {
          const index = (part.renderMetadata[names] ?? []).map((name, i) => i ? table.add(name, true) : 0);
          for (let i = 0; i < part.count; i++) out[offset + i] = index[source[i]] ?? 0;
        }
        offset += part.count;
      }
      result[rows] = out;
      result[names] = table.names;
    }
    for (const [key, stride, Type] of channels) {
      if (!parts.some(part => part.renderMetadata?.[key])) continue;
      const out = new Type(count * stride);
      let offset = 0;
      for (const part of parts) {
        const input = part.renderMetadata?.[key];
        if (input) out.set(input.subarray(0, part.count * stride), offset * stride);
        offset += part.count;
      }
      result[key] = out;
    }
    const spills = [];
    let offset = 0;
    for (const part of parts) {
      if (part.renderMetadata?.paintSpills)
        spills.push(...remapSpills(part.renderMetadata.paintSpills, index => index + offset));
      offset += part.count;
    }
    if (spills.length) result.paintSpills = spills;
    return result;
  }

  function join(parts, options = {}) {
    if (!Array.isArray(parts) || parts.some(part => !Number.isSafeInteger(part?.count) || part.count < 0 ||
        !(part.data instanceof Float32Array) || part.data.length < part.count * 16 || part.anim || part.rest ||
        part.pixAnchors || part.effectParticles?.length || part.sortRanges?.length))
      throw new TypeError('Expected native splat chunks without external per-splat animation or draw ranges');
    const { pal = parts.find(part => part.pal)?.pal, ...meta } = options;
    if (pal && parts.some(part => part.pal && (part.pal.length !== pal.length || part.pal.some((color, i) => color !== pal[i]))))
      throw new RangeError('Joined splat chunks must share a palette');
    const count = parts.reduce((n, part) => n + part.count, 0);
    const result = { ...meta, ...(pal && { pal }), count };
    if (parts.some(part => part.curveSplats)) result.curveSplats = true;
    const footprintAPI = typeof SplatFootprints === 'undefined' ? require('./splat-footprints.js') : SplatFootprints;
    const footprints = footprintAPI.join(parts);
    if (footprints) result.splatFootprints = footprints;
    const engravingAPI=typeof Engraving==='undefined'?require('./engraving.js'):Engraving;
    const engraving=engravingAPI.join(parts);if(engraving)result.engraving=engraving;
    for (const [key, stride, Type] of perSplat) {
      if (key !== 'data' && !parts.some(part => part[key])) continue;
      const out = result[key] = new Type(count * stride);
      let offset = 0;
      for (const part of parts) {
        if (part[key]) out.set(part[key].subarray(0, part.count * stride), offset * stride);
        offset += part.count;
      }
    }

    const moving = [], back = [], splatIds = [], surfaces = [], ramps = [], rampOff = [], pats = [], paintRows = [], paintDecals = [];
    const withIds = parts.some(part => part.splatIds ?? part.ids);
    const rampIds = new Map(), patternIds = new Map();
    let offset = 0, curveGroups = 0;
    const curvePrograms = [
      ['curveTiming', 'curveTimePrograms', 8, []],
      ['curvePattern', 'curvePatternPrograms', 16, []],
      ['curveStations', 'curveStrands', 7, []]
    ];
    const curveDetail = [];
    const curveAPI = result.curveSplats && (typeof CurveSplat === 'undefined' ? require('./curve-splat.js') : CurveSplat);
    for (const part of parts) {
      if (part.curveLod) curveDetail.push(...curveLod(part.curveLod, i => offset + i));
      if (curveAPI && part.curveSplats) curveAPI.joinGroups(result.data, offset, part.count, () => ++curveGroups);
      for (const [rows, name, stride, programs] of curvePrograms) {
        if (!part[rows]?.length || !part[name]?.length) continue;
        const first = programs.length;
        for (const program of part[name]) programs.push(program);
        for (let i = 0; i < part.count; i++) {
          const row = (offset + i) * stride;
          if (result[rows][row]) result[rows][row] += first;
        }
      }
      const base = surfaces.length;
      for (const surface of part.surfaces ?? []) surfaces.push(surface);
      const remapRamps = part.ramps?.map((ramp, i) => {
        const off = part.rampOff?.[i] ?? false, key = JSON.stringify([off, ramp]);
        if (!rampIds.has(key)) {
          rampOff.push(off);
          rampIds.set(key, ramps.push(ramp));
        }
        return rampIds.get(key);
      });
      const remapPatterns = part.pats?.map(pattern => {
        if (!patternIds.has(pattern)) patternIds.set(pattern, pats.push(pattern));
        return patternIds.get(pattern);
      });
      for (let i = 0; i < part.count; i++) {
        const at = (offset + i) * 8;
        const alternateRamp = (offset + i) * 6 + 3;
        if (result.shadowLod?.[alternateRamp])
          result.shadowLod[alternateRamp] = remapRamps?.[result.shadowLod[alternateRamp] - 1] ?? 0;
        if (result.surfaceData?.[at]) result.surfaceData[at] += base;
        if (result.pix?.[at]) {
          result.pix[at] = remapRamps?.[result.pix[at] - 1] ?? 0;
          result.pix[at + 2] = remapPatterns?.[result.pix[at + 2] - 1] ?? 0;
        }
        if (withIds) splatIds.push((part.splatIds ?? part.ids)?.[i] ?? null);
      }
      for (const i of part.moving ?? []) moving.push(offset + i);
      for (const i of part.back ?? []) back.push(offset + i);
      for (const row of part.paintDecals ?? []) paintDecals.push({ ...row, index: offset + row.index });
      for (const row of part.paintCorrections?.rows ?? []) paintRows.push({ ...row, index: offset + row.index });
      offset += part.count;
    }
    for (const [, name, , programs] of curvePrograms) if (programs.length) result[name] = programs;
    if (curveDetail.length) result.curveLod = curveDetail;
    if (result.surfaceData) result.surfaces = surfaces;
    if (result.pix) Object.assign(result, { ramps, rampOff, pats });
    if (withIds) result.splatIds = Object.freeze(splatIds);
    if (paintDecals.length) result.paintDecals = paintDecals;
    if (paintRows.length) result.paintCorrections = bindPaint(paintRows);
    return Object.assign(result, { renderMetadata: combineMetadata(parts, count),
      moving: Int32Array.from(moving), back: Int32Array.from(back) });
  }

  function harmonicRows(input,count,transfer) {
    const {degree,dc,sh,linear,normals,available}=input, terms=(degree+1)**2-1;
    return {...input,count,dc:transfer(dc,3,Float32Array),sh:transfer(sh,terms*3,Float32Array),
      ...(available&&{available:transfer(available,1,Uint8Array)}),
      ...(linear&&{linear:transfer(linear,1,Uint8Array)}),...(normals&&{normals:transfer(normals,3,Int8Array)})};
  }

  function subset(world, selection) {
    const indices = Array.from(selection);
    if (indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= world.count) || new Set(indices).size !== indices.length)
      throw new RangeError('A splat subset needs distinct indices from the world');
    const result = { ...world, count: indices.length };
    if (world.splatFootprints) {
      const api = typeof SplatFootprints === 'undefined' ? require('./splat-footprints.js') : SplatFootprints;
      result.splatFootprints = api.subset(world,indices);
    }
    if(world.engraving){const api=typeof Engraving==='undefined'?require('./engraving.js'):Engraving;result.engraving=api.subset(world,indices);}
    if ((result.renderSdfs || result.referenceSdfs) && (indices.length !== world.count || indices.some((index,i)=>index !== i))) {
      delete result.renderSdfs;
      delete result.referenceSdfs;
    }
    const remap = new Map(indices.map((source, i) => [source, i]));
    if (world.curveLod) result.curveLod = curveLod(world.curveLod, i => remap.get(i));
    if (world.splatBakedEmission) {
      result.splatBakedEmission = new Map();
      for (const [source, linear] of world.splatBakedEmission)
        if (remap.has(source)) result.splatBakedEmission.set(remap.get(source), linear);
    }
    function take(source, stride, Type) {
      const out = new Type(indices.length * stride);
      for (let i = 0; i < indices.length; i++) out.set(source.subarray(indices[i] * stride, (indices[i] + 1) * stride), i * stride);
      return out;
    }
    for (const [key, stride, Type] of perSplat) if (world[key]) result[key] = take(world[key], stride, Type);
    if (world.rest instanceof Float32Array) result.rest = take(world.rest,16,Float32Array);
    if (world.gaussianHarmonics) result.gaussianHarmonics=harmonicRows(world.gaussianHarmonics,indices.length,take);
    if (world.renderMetadata) {
      const source = world.renderMetadata, meta = result.renderMetadata = { ...source };
      for (const [key, stride, Type] of channels) if (source[key]) meta[key] = take(source[key], stride, Type);
      if (source.paintSpills) meta.paintSpills = remapSpills(source.paintSpills, index => remap.get(index));
      for (const [key] of tables) if (source[key]) meta[key] = take(source[key], 1, Uint32Array);
    }
    for (const key of ['moving', 'back']) result[key] = Int32Array.from(Array.from(world[key] ?? []).filter(i => remap.has(i)), i => remap.get(i));
    if (world.splatIds) result.splatIds = Object.freeze(indices.map(i => world.splatIds[i]));
    if (world.paintDecals) result.paintDecals = world.paintDecals.filter(row => remap.has(row.index))
      .map(row => ({ ...row, index: remap.get(row.index) }));
    if (world.paintCorrections) {
      const paintRows = world.paintCorrections.rows.filter(row => remap.has(row.index))
        .map(row => ({ ...row, index: remap.get(row.index) }));
      result.paintCorrections = bindPaint(paintRows);
    }
    return result;
  }

  // Append static rows without changing existing row addresses or slot numbers.
  // Each clone refers to an earlier row, including rows added in the same batch.
  function appendStatic(world, additions) {
    if (!(world?.data instanceof Float32Array) || !Number.isSafeInteger(world.count) || world.count<0 ||
        world.data.length<world.count*16 || !Array.isArray(additions) || world.count+additions.length>0xffffff)
      throw new RangeError('Appending splats needs a packed world and an array of additions');
    const count=world.count+additions.length;
    for (const [i,row] of additions.entries()) {
      if (!validId(row?.id) || !Array.isArray(row.position) || row.position.length!==3 ||
          !Array.from(row.position).every(Number.isFinite) ||
          (row.from===undefined ? !(row.data instanceof Float32Array) || row.data.length!==16 :
            !Number.isSafeInteger(row.from) || row.from<0 || row.from>=world.count+i))
        throw new RangeError('A splat addition needs an ID, position, and packed row or earlier source index');
    }
    function extend(source,stride,Type) {
      const out=new Type(count*stride);
      if (source) out.set(source.subarray(0,world.count*stride));
      for (const [i,{from}] of additions.entries()) if (from!==undefined)
        out.copyWithin((world.count+i)*stride,from*stride,(from+1)*stride);
      return out;
    }
    const patch={count};
    for (const [key,stride,Type] of perSplat) if (world[key]) patch[key]=extend(world[key],stride,Type);
    patch.rest=extend(restData(world),16,Float32Array);
    patch.splatIds=Object.freeze([...Array.from({length:world.count},(_,i)=>world.splatIds?.[i]??null),
      ...additions.map(row=>row.id)]);
    const renderMetadata=patch.renderMetadata={...world.renderMetadata};
    for (const [key,stride,Type] of channels) if (renderMetadata[key])
      renderMetadata[key]=extend(renderMetadata[key],stride,Type);
    for (const [key,table] of tables) {
      const label = table==='objects' ? 'object' : table==='materials' ? 'material' : 'target';
      if (!renderMetadata[key] && !additions.some(row=>row[label]!==undefined)) continue;
      const names=[...(renderMetadata[table]??[null])];
      const keyOf=label==='target' ? targetKey : value=>value;
      const slots=new Map(names.flatMap((name,i)=>i && name!=null ? [[keyOf(name),i]] : []));
      const indices=extend(renderMetadata[key],1,Uint32Array);
      for (const [i,row] of additions.entries()) {
        if (row.from!==undefined) indices[world.count+i]=indices[row.from];
        else if (row[label]!==undefined) {
          const key=keyOf(row[label]);
          if (!slots.has(key)) slots.set(key,names.push(row[label])-1);
          indices[world.count+i]=slots.get(key);
        }
      }
      renderMetadata[key]=indices;
      renderMetadata[table]=names;
    }
    for (const [i,row] of additions.entries()) for (const data of [patch.data,patch.rest]) {
      const offset=(world.count+i)*16;
      if (row.data) data.set(row.data,offset);
      else data.copyWithin(offset,row.from*16,(row.from+1)*16);
      data.set(row.position,offset);
    }
    if (patch.materialAlbedo) for (const [i,{pigment}] of additions.entries())
      if (pigment!==undefined) patch.materialAlbedo[world.count+i]=pigment+1;
    if (world.gaussianHarmonics) {
      const input=world.gaussianHarmonics;
      const harm=patch.gaussianHarmonics=harmonicRows({...input,available:input.available??new Uint8Array(world.count).fill(1)},
        count,extend);
      for (const [i,{from,scan}] of additions.entries()) {
        const row=world.count+i;
        if (scan) {
          harm.dc.set(scan.dc,row*3);
          harm.sh.set(scan.sh,row*scan.sh.length);
          if (harm.linear) harm.linear[row]=Number(scan.linear);
          if (scan.normal) harm.normals.set(scan.normal,row*3);
        } else if (from===undefined) {
          const color=patch.data[row*16+7];
          for (let k=0;k<3;k++) harm.dc[row*3+k]=((color>>(k*8)&255)/255-.5)/.28209479177387814;
        }
      }
    }
    const F=typeof SplatFootprints==='undefined' ? require('./splat-footprints.js') : SplatFootprints;
    const footprint=F.validate(world);
    if (footprint) patch.splatFootprints=F.layout(count,footprint.styles,extend(footprint.indices,1,Uint16Array),
      footprint.frames && extend(footprint.frames,6,Float32Array));
    const E=typeof Engraving==='undefined' ? require('./engraving.js') : Engraving;
    const engraving=E.validate(world);
    if (engraving) patch.engraving=E.layout(count,engraving.styles,extend(engraving.indices,1,Uint16Array),
      extend(engraving.anchors,3,Float32Array),extend(engraving.restFrames,6,Float32Array));
    return patch;
  }

  function bindPaint(rows) {
    const api = typeof PaintCorrections === 'undefined' ? require('./paint-corrections.js') : PaintCorrections;
    return api.bind(rows);
  }

  return Object.freeze({ join, subset, appendStatic, fromRecords, targetKey, validId, identities, restData });
})();
if (typeof module !== 'undefined') module.exports = SplatProvenance;
