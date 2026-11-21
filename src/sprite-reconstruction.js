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
  function asset({ atlas, range = [12, 18] } = {}) {
    const source = atlasAPI.compile(atlas);
    if (source.sceneryPlanes || source.largestView > pixelLimit)
      throw new RangeError('Sprite reconstruction needs a directional atlas with at most 262144 pixels per view');
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Array.from(range).every(Number.isFinite) ||
      range[0] <= 0 ||
      range[1] <= range[0]
    )
      throw new RangeError('Sprite reconstruction needs increasing positive near and far distances');
    const result = Object.freeze({ atlas: source, range: Object.freeze(range.slice()) });
    assets.add(result);
    return result;
  }
  function bindingsFor(world, configuration) {
    const plan = bindings.get(configuration);
    if (!plan) throw new TypeError('Use K.sprite.reconstruction.bind to attach a sprite reconstruction');
    if (plan.metadata === world.renderMetadata && plan.count === world.count) return plan;
    const { objects, objectIds } = world.renderMetadata ?? {};
    const index = new Map(plan.entries.map((entry, i) => [entry.placement.objectId, i]));
    const slots = new Uint8Array(world.count),
      counts = new Uint32Array(plan.entries.length);
    for (let i = 0; i < world.count; i++) {
      const slot = index.get(objects?.[objectIds?.[i]]);
      if (slot === undefined) continue;
      slots[i] = slot + 1;
      counts[slot]++;
    }
    for (const [i, n] of counts.entries())
      if (!n)
        throw new RangeError(
          'Sprite reconstruction cannot find native splats for ' + plan.entries[i].placement.objectId
        );
    return Object.assign(plan, {
      metadata: world.renderMetadata,
      count: world.count,
      slots,
      counts,
      mask: null,
      key: ''
    });
  }

  function bind(world, entries) {
    if (
      !Number.isSafeInteger(world?.count) ||
      world.count < 0 ||
      !(world.data instanceof Float32Array) ||
      !Array.isArray(entries) ||
      entries.length > 128
    )
      throw new TypeError('Sprite reconstruction needs a native world and up to 128 placements');
    if (!entries.length) {
      delete world.spriteReconstruction;
      return world;
    }
    const names = new Set();
    const items = Array.from(
      entries,
      ({ asset: source, object, material, at, yaw, scale, frame, playback, depth, lighting, emission } = {}) => {
        if (!assets.has(source) || !selectors.name(object) || names.has(object))
          throw new TypeError('Sprite reconstruction needs a registered asset and a unique native object name');
        names.add(object);
        let hash = 0;
        for (let i = 0; i < object.length; i++) hash = (Math.imul(hash, 31) + object.charCodeAt(i)) | 0;
        const placement = atlasAPI.place({
          atlas: source.atlas,
          mode: 'impostor',
          at,
          yaw,
          scale,
          frame,
          playback,
          depth,
          lighting,
          emission,
          objectId: object,
          materialId: material
        });
        return { source, placement, phase: hash & 63 };
      }
    );
    const configuration = Object.freeze({});
    bindings.set(configuration, { entries: items });
    bindingsFor(world, configuration);
    world.spriteReconstruction = configuration;
    return world;
  }

  function resolve(world, { eye, back, ortho, time = 0, setback = 0, mode = 'auto', atlasTime } = {}) {
    const configuration = world.spriteReconstruction;
    if (!configuration || mode === false || mode === 'geometry') return null;
    if (!['auto', 'sprite'].includes(mode) || !Number.isFinite(time) || !Number.isFinite(setback))
      throw new RangeError('Sprite reconstruction mode must be auto, geometry or sprite');
    const plan = bindingsFor(world, configuration),
      rows = [],
      states = [],
      steps = [];
    const observer = ortho ? plus(eye, back, -setback) : eye;
    let geometryRows = world.count;
    for (const [i, { placement, source, phase }] of plan.entries.entries()) {
      const clock = atlasTime?.(placement) ?? time;
      const at =
        typeof placement.at === 'function'
          ? atlasAPI.vector(placement.at(clock), 'Sprite reconstruction anchor')
          : placement.at;
      const delta = plus(observer, at, -1),
        distance = length(delta),
        [near, far] = source.range;
      const x = clamp((far - distance) / (far - near)),
        step = mode === 'sprite' ? 0 : Math.round(bins * x * x * (3 - 2 * x));
      steps.push(step);
      if (!step) geometryRows -= plan.counts[i];
      const state = { object: placement.objectId, distance, geometry: step / bins, sprite: 1 - step / bins };
      states.push(state);
      if (step === bins) continue;
      const direction = ortho || distance < 1e-9 ? back : delta.map(n => n / distance);
      const rotation = atlasAPI.basis(placement.yaw, 0);
      const frame =
        typeof placement.frame === 'function'
          ? placement.frame(clock)
          : (placement.frame ?? placement.frameAt?.(clock));
      const view = source.atlas.select(frame, 'impostor', local(rotation, direction));
      const axes = atlasAPI.basis(
        Math.atan2(direction[0], direction[2]),
        Math.atan2(direction[1], Math.hypot(direction[0], direction[2]))
      );
      state.view = { frame: view.frame, yaw: view.yaw, pitch: view.pitch };
      rows.push({
        placement,
        at,
        view,
        axes,
        normalAxes:
          source.atlas.normalSpace === 'view' ? atlasAPI.basis(view.yaw + placement.yaw, view.pitch) : rotation,
        phase,
        step
      });
    }
    const key = steps.join('/');
    if (!plan.mask || plan.key !== key) {
      const codes = plan.entries.map(({ phase }, i) => (steps[i] === bins ? 0 : 1 + steps[i] + stride * phase));
      const mask = Uint16Array.from(plan.slots, slot => (slot ? codes[slot - 1] : 0));
      plan.mask = { codes: mask, hasFar: steps.includes(0) };
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
      const { placement, at, axes, view } = row,
        { atlas, objectId, materialId, scale } = placement;
      const facing = -dot(ray, axes.normal);
      if (!(facing > 1e-7)) continue;
      const plane = dot(plus(origin, at, -1), axes.normal) / facing;
      const base = plus(plus(origin, ray, plane), at, -1),
        units = view.unitsPerPixel * scale;
      const x = Math.floor(view.pivot.x + dot(base, axes.right) / units);
      const y = Math.floor(view.pivot.y - dot(base, axes.up) / units);
      if (x < 0 || x >= view.rect.width || y < 0 || y >= view.rect.height) continue;
      const target = {
        kind: 'sprite',
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
      if (atlas.sample(view, x, y, placement, texel)) add(texel.alpha, texel.depth, texel.color, true);
      const effect = atlas.effect(view),
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
  return Object.freeze({ asset, bind, resolve, hidden, geometry, sprite, alpha, tile, light, hits, glsl });
})();
if (typeof module !== 'undefined') module.exports = SpriteReconstruction;
