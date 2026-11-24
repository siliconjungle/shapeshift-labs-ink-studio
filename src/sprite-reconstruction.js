/* Camera-driven handoff between a named native object and its directional atlas. */
const SpriteReconstruction = (() => {
  const atlasAPI = typeof AtlasSprites === 'undefined' ? require('./atlas-sprites.js') : AtlasSprites;
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const assets = new WeakSet(),
    bindings = new WeakMap(),
    tiles = new Map();
  let tileBytes = 0;
  const bins = 64,
    stride = bins + 1,
    pixelLimit = 262144,
    tileCacheBytes = 16 * 1024 * 1024;
  const curveAPI=typeof CurveSplat === 'undefined' ? require('./curve-splat.js') : CurveSplat;
  const clamp = n => Math.max(0, Math.min(1, n));
  const dot = atlasAPI.dot;
  const plus = (a, b, factor = 1) => a.map((n, i) => n + b[i] * factor);
  const length = v => Math.hypot(...v);
  const local = (basis, v) => [dot(v, basis.right), dot(v, basis.up), dot(v, basis.normal)];
  const knots = (x, y) => ((x ^ y) & 1) * 2 + (y & 1);
  function rank(x, y, phase) {
    x = (Math.floor(x) + (phase & 7)) & 7;
    y = (Math.floor(y) + (phase >> 3)) & 7;
    return 16 * knots(x, y) + 4 * knots(x >> 1, y >> 1) + knots(x >> 2, y >> 2);
  }
  const glsl = `
int spriteRank(vec2 at, int phase) {
  ivec2 p=(ivec2(floor(at))+ivec2(phase&7,phase>>3))&ivec2(7);
  int x=p.x,y=p.y;
  int a=(x^y)&7;
  return 16*(2*(a&1)+(y&1))+4*(2*((a>>1)&1)+((y>>1)&1))+2*((a>>2)&1)+((y>>2)&1);
}
bool spriteGeometry(int code, vec2 at) {
  return code==0 || spriteRank(at,(code-1)/65)<((code-1)%65);
}
`;
  function asset({ atlas, range, projectedRange } = {}) {
    const source = atlasAPI.compile(atlas);
    if (source.sceneryPlanes || source.largestView > pixelLimit)
      throw new RangeError('Sprite reconstruction needs a directional atlas with at most 262144 pixels per view');
    if (range !== undefined && projectedRange !== undefined)
      throw new RangeError('Sprite reconstruction needs either a distance range or a projected texel range');
    const limits = projectedRange === undefined ? (range === undefined ? [12,18] : range) : projectedRange;
    if (!Array.isArray(limits) || limits.length !== 2 || !Array.from(limits).every(Number.isFinite) ||
        limits[0] <= 0 || limits[1] <= limits[0])
      throw new RangeError(projectedRange === undefined ? 'Sprite reconstruction needs increasing positive near and far distances' :
        'Sprite reconstruction needs an increasing positive projected texel range');
    const { splatFitRevision } = source;
    const result = Object.freeze({ atlas:source, ...(splatFitRevision && {splatFitRevision}), [projectedRange===undefined ? 'range' : 'projectedRange']:Object.freeze(limits.slice()) });
    assets.add(result);
    return result;
  }
  const partKey = (object,part) => JSON.stringify([object,part]);

  function bindingsFor(world, configuration, retainGeometry) {
    const plan = bindings.get(configuration);
    if (!plan) throw new TypeError('Use the sprite reconstruction binding API');
    if (plan.metadata === world.renderMetadata && plan.count === world.count && plan.meshes === world.meshes && plan.retainGeometry === retainGeometry) return plan;
    const { objects, objectIds, materials, materialIds, targets, targetIds } = world.renderMetadata ?? {};
    const legacy = new Map(), parts = new Map(), retained = new Set();
    for (const [i,entry] of plan.entries.entries()) {
      if (retainGeometry?.(entry)) retained.add(i);
      if (entry.part === undefined) legacy.set(entry.object,i);
      else {
        if (entry.mesh && !retained.has(i) && !world.meshes?.includes(entry.mesh))
          throw new RangeError('Part mesh must be present in world.meshes: '+entry.object+'/'+entry.part);
        parts.set(partKey(entry.object,entry.part),i);
      }
    }
    const slots = new Uint8Array(world.count), counts = new Uint32Array(plan.entries.length);
    for (let i = 0; i < world.count; i++) {
      const object=objects?.[objectIds?.[i]];
      if (!object) continue;
      const target=targets?.[targetIds?.[i]];
      const slot=legacy.get(object) ?? (target?.part===undefined ? undefined : parts.get(partKey(object,target.part)));
      if (slot===undefined) continue;
      const entry=plan.entries[slot];
      if (entry.part!==undefined && !retained.has(slot)) {
        const isCurve=Boolean(world.curveStations?.[i*curveAPI.stationStride]);
        if (entry.mesh || isCurve!==(entry.representation==='curves') || materials?.[materialIds?.[i]]!==entry.material ||
            target.entity!==undefined && target.entity!==object)
          throw new RangeError('Native geometry disagrees with the part representation or material: '+object+'/'+target.part);
      }
      slots[i]=slot+1;
      counts[slot]++;
    }
    for (const [i,entry] of plan.entries.entries())
      if (!counts[i] && !entry.mesh && !retained.has(i))
        throw new RangeError('Sprite reconstruction cannot find native splats for '+entry.object+(entry.part ? '/'+entry.part : ''));
    return Object.assign(plan,{metadata:world.renderMetadata,count:world.count,meshes:world.meshes,retainGeometry,retained,slots,counts,mask:null,key:''});
  }

  function placementFor(object,material,part,spec) {
    const {asset:source,at,yaw,scale,frame,playback,depth,lighting,emission}=spec;
    if (!assets.has(source)) throw new TypeError('Sprite reconstruction needs a registered asset');
    let hash=0;
    const label=part===undefined ? object : partKey(object,part);
    for (let i=0;i<label.length;i++) hash=(Math.imul(hash,31)+label.charCodeAt(i))|0;
    const placement=atlasAPI.place({atlas:source.atlas,mode:'impostor',at,yaw,scale,frame,playback,
      depth,lighting,emission,objectId:object,materialId:material});
    return {source,placement,phase:hash&63};
  }

  function attach(world,entries,partBinding) {
    if (!Number.isSafeInteger(world?.count) || world.count<0 || !(world.data instanceof Float32Array))
      throw new TypeError('Sprite reconstruction needs a native world');
    const previous=world.spriteReconstruction && bindings.get(world.spriteReconstruction);
    const merged=[...(previous?.entries.filter(entry=>(entry.part!==undefined)!==partBinding)??[]),...entries];
    if (merged.length>128) throw new RangeError('Sprite reconstruction supports up to 128 placements and parts');
    const legacy=new Set(merged.filter(entry=>entry.part===undefined).map(entry=>entry.object));
    if (merged.some(entry=>entry.part!==undefined&&legacy.has(entry.object)))
      throw new RangeError('Use one reconstruction binding per object or bind its parts separately');
    if (!merged.length) {
      delete world.spriteReconstruction;
      return world;
    }
    const configuration=Object.freeze({});
    bindings.set(configuration,{entries:merged});
    bindingsFor(world,configuration);
    world.spriteReconstruction=configuration;
    return world;
  }

  function bind(world,entries) {
    if (!Array.isArray(entries) || entries.length>128)
      throw new TypeError('Sprite reconstruction needs up to 128 placements');
    const names=new Set();
    return attach(world,Array.from(entries,(spec={})=>{
      const {object,material}=spec;
      if (!selectors.name(object) || names.has(object))
        throw new TypeError('Sprite reconstruction needs a registered asset and a unique native object name');
      names.add(object);
      return {object,material,...placementFor(object,material,undefined,spec)};
    }),false);
  }

  function bindParts(world,entries) {
    if (!Array.isArray(entries) || entries.length>128)
      throw new TypeError('Part representations need up to 128 parts');
    const names=new Set(), meshes=new Set();
    return attach(world,Array.from(entries,({object,part,material,representation,mesh,sprite}={})=>{
      const key=partKey(object,part);
      if (![object,part,material].every(selectors.name) || names.has(key) ||
          !['mesh','curves','splats'].includes(representation))
        throw new TypeError('Part representations need unique object and part IDs, a material, and a native representation');
      names.add(key);
      if (representation==='mesh') {
        if (meshes.has(mesh) || mesh?.objectId!==object || mesh.partId!==part ||
            mesh.materials?.length!==1 || mesh.materials[0]!==material)
          throw new RangeError('A part mesh needs matching object, part and material IDs');
        meshes.add(mesh);
      } else if (mesh!==undefined) throw new TypeError('Only mesh parts can bind a native mesh');
      return {object,part,material,representation,mesh,...(sprite && placementFor(object,material,part,sprite))};
    }),true);
  }

  function labels(world) {
    const entries=bindings.get(world.spriteReconstruction)?.entries ?? [];
    return entries.filter(row=>row.part!==undefined).map(({object,part,material})=>({object,part,material}));
  }

  function resolve(world, { eye, back, ortho, focal, time = 0, setback = 0, mode = 'auto', atlasTime, impostorBlend, retainGeometry } = {}) {
    const configuration = world.spriteReconstruction;
    if (!configuration || mode === false || mode === 'geometry') return null;
    if (!['auto', 'sprite'].includes(mode) || !Number.isFinite(time) || !Number.isFinite(setback))
      throw new RangeError('Sprite reconstruction mode must be auto, geometry or sprite');
    atlasAPI.viewBlend(impostorBlend);
    const plan = bindingsFor(world, configuration, retainGeometry),
      rows = [],
      states = [],
      steps = [];
    const observer = ortho ? plus(eye, back, -setback) : eye;
    let geometryRows = world.count;
    for (const [i, { object, part, material, representation, placement, source, phase }] of plan.entries.entries()) {
      const tags=part===undefined ? {object} : {object,part,material,representation};
      const retained=plan.retained.has(i);
      if (!placement || retained) {
        steps.push(bins);
        states.push({...tags,geometry:1,sprite:0,...(retained&&{reason:'source-edited'})});
        continue;
      }
      const clock = atlasTime?.(placement) ?? time;
      const at =
        typeof placement.at === 'function'
          ? atlasAPI.vector(placement.at(clock), 'Sprite reconstruction anchor')
          : placement.at;
      const delta = plus(observer, at, -1), distance = length(delta);
      const direction = ortho || distance < 1e-9 ? back : delta.map(n => n / distance);
      const rotation = atlasAPI.basis(placement.yaw, 0);
      const selectView = () => {
        const frame = typeof placement.frame === 'function' ? placement.frame(clock) : (placement.frame ?? placement.frameAt?.(clock));
        return source.atlas.select(frame, 'impostor', local(rotation, direction));
      };
      const project = view => {
        const depth = ortho ? 1 : dot(delta,back);
        return depth > 0 ? (view.unitsPerPixel * placement.scale * focal) / depth : Infinity;
      };
      let view, step;
      if (mode === 'sprite') step=0;
      else {
        if (source.projectedRange && !(focal > 0 && Number.isFinite(focal)))
          throw new RangeError('Projected sprite reconstruction requires a positive art-grid focal length');
        const [low,high] = source.projectedRange ?? source.range;
        const value = source.projectedRange ? project(view=selectView()) - low : high - distance;
        const x = clamp(value/(high-low));
        step = Math.round(bins*x*x*(3-2*x));
      }
      steps.push(step);
      if (!step) geometryRows -= plan.counts[i];
      const state = { ...tags, distance, geometry: step / bins, sprite: 1 - step / bins };
      states.push(state);
      if (step === bins) continue;
      view ??= selectView();
      const pixelsPerTexel = project(view);
      const cutoutLevel = source.atlas.cutoutLevel?.(view, pixelsPerTexel);
      if (cutoutLevel !== undefined) state.cutoutLevel = cutoutLevel;
      const reprojection = atlasAPI.reproject(placement, view, local(rotation,direction), {
        blend:impostorBlend, distance:ortho ? Infinity : distance, pixelsPerTexel, time:clock
      });
      const axes = reprojection ? atlasAPI.basis(reprojection.report.yaw+placement.yaw,reprojection.report.pitch) : atlasAPI.basis(
        Math.atan2(direction[0], direction[2]),
        Math.atan2(direction[1], Math.hypot(direction[0], direction[2]))
      );
      state.view = { frame: view.frame, yaw: view.yaw, pitch: view.pitch };
      if (reprojection) state.reprojection=reprojection.report;
      rows.push({
        placement,part,
        at,
        view,
        axes,
        reprojection,
        cutoutLevel,
        normalAxes:
          !reprojection && source.atlas.normalSpace === 'view' ? atlasAPI.basis(view.yaw + placement.yaw, view.pitch) : rotation,
        phase,
        step
      });
    }
    const key = steps.join('/');
    if (!plan.mask || plan.key !== key) {
      const codes = plan.entries.map(({ phase }, i) => (steps[i] === bins ? 0 : 1 + steps[i] + stride * phase));
      const mask = Uint16Array.from(plan.slots, slot => (slot ? codes[slot - 1] : 0));
      const meshCodes = new Map();
      for (const [i,{mesh}] of plan.entries.entries()) if (mesh && codes[i]) meshCodes.set(mesh.id,codes[i]);
      plan.mask = { codes: mask, meshCodes, hasFar:steps.some((step,i)=>step===0&&plan.counts[i]>0) };
      plan.key = key;
    }
    return { rows, states, geometryRows, mask: rows.length ? plan.mask : null };
  }

  const hidden = code => code > 0 && (code - 1) % stride === 0;
  const geometry = (code, x, y) => !code || rank(x, y, ((code - 1) / stride) | 0) < (code - 1) % stride;
  const sprite = (row, x, y) => rank(x, y, row.phase) >= row.step;
  const alpha = (value, row, x, y) => value * 64 > rank(x + 3, y + 5, row.phase ^ 45);
  function hits(plan, { origin, direction, maxDistance = 100, pixelAt, clip }) {
    if (!plan?.rows.length) return [];
    const magnitude = length(direction),
      ray = direction.map(n => n / magnitude),
      result = [];
    const texel = { color: [0, 0, 0], normal: [0, 0, 0], emission: [0, 0, 0] },
      effectColor = [0, 0, 0];
    for (const row of plan.rows) {
      const { placement, at, axes, reprojection } = row,
        { atlas, objectId, materialId, scale } = placement;
      const view = reprojection?.view ?? row.view;
      const facing = -dot(ray, axes.normal);
      if (!(facing > 1e-7)) continue;
      const plane = dot(plus(origin, at, -1), axes.normal) / facing;
      const base = plus(plus(origin, ray, plane), at, -1),
        units = view.unitsPerPixel * scale;
      const u = view.pivot.x + dot(base, axes.right) / units;
      const v = view.pivot.y - dot(base, axes.up) / units;
      const x = Math.floor(u), y = Math.floor(v);
      if (x < 0 || x >= view.rect.width || y < 0 || y >= view.rect.height) continue;
      const target = {
        kind: 'sprite',
        ...(row.part !== undefined && {part:row.part}),
        entity: objectId,
        object: objectId,
        ...(materialId !== undefined && { material: materialId })
      };
      function add(opacity, depth, color, solid) {
        const distance = plane + (placement.depth ? (depth * scale) / facing : 0);
        if (!(distance > 0 && distance <= maxDistance)) return;
        const point = plus(origin, ray, distance),
          pixel = pixelAt(point);
        if (!pixel || !sprite(row, ...pixel) || !alpha(opacity, row, ...pixel) || (clip && !clip(point))) return;
        result.push({
          kind: 'sprite',
          id: objectId,
          index: -1,
          distance,
          point,
          target,
          color: color.slice(),
          alpha: 1,
          solid
        });
      }
      const mip = !reprojection && atlas.cutoutImage?.(view, row.cutoutLevel);
      const body = reprojection ? atlasAPI.sampleReprojected(reprojection,u,v,placement,texel) :
        mip ? atlas.cutoutSample(view,mip,u,v,placement,texel) : atlas.sample(view,x,y,placement,texel);
      if (body) add(texel.alpha,texel.depth,texel.color,true);
      const effect = reprojection ? null : atlas.effect(view),
        coverage = effect?.sample(x, y, effectColor);
      if (coverage) add(coverage, effect.depth, effectColor, false);
    }
    return result;
  }
  function light(authored, override, time) {
    const enabled = override ?? authored;
    if (enabled === undefined || enabled === false) return null;
    const { direction = [-0.52, 0.64, 0.57], ambient = 0.32, intensity = 0.88 } = { ...authored, ...override };
    const vector = atlasAPI.vector(
      typeof direction === 'function' ? direction(time) : direction,
      'Sprite reconstruction light'
    );
    const magnitude = length(vector);
    if (
      !magnitude ||
      !Number.isFinite(magnitude) ||
      ![ambient, intensity].every(n => Number.isFinite(n) && n >= 0 && n <= 4)
    )
      throw new RangeError('Invalid sprite reconstruction light');
    return { direction: vector.map(n => n / magnitude), ambient, intensity };
  }
  function tile(row) {
    const { atlas } = row.placement,
      { view } = row;
    let image = tiles.get(view);
    if (image) {
      tiles.delete(view);
      tiles.set(view, image);
      return image;
    }
    const { width, height } = view.rect,
      pixels = width * height,
      values = new Float32Array(pixels * 16);
    const channels = { depth: true, emission: true },
      out = { color: [0, 0, 0], normal: [0, 0, 0], emission: [0, 0, 0] },
      rgb = [0, 0, 0];
    const effect = atlas.effect(view);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (atlas.sample(view, x, y, channels, out)) {
          values.set([...out.color, out.alpha], i);
          values.set(out.hasNormal ? [...out.normal, out.depth] : [0, 0, 0, out.depth], pixels * 4 + i);
          if (out.hasEmission) values.set(out.emission, pixels * 8 + i);
        }
        if (effect) {
          const a = effect.sample(x, y, rgb);
          if (a) values.set([...rgb, a], pixels * 12 + i);
        }
      }
    image = { width, height, values, effectDepth: effect?.depth };
    while (tileBytes + values.byteLength > tileCacheBytes && tiles.size) {
      const [oldest, previous] = tiles.entries().next().value;
      tileBytes -= previous.values.byteLength;
      tiles.delete(oldest);
    }
    tiles.set(view, image);
    tileBytes += values.byteLength;
    return image;
  }
  return Object.freeze({ asset, bind, bindParts, labels, resolve, hidden, geometry, sprite, alpha, tile, light, hits, glsl });
})();
if (typeof module !== 'undefined') module.exports = SpriteReconstruction;
