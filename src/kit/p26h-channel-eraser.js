/* Retained attenuation masks for local authoring edits. */
(function (K) {
  const P = K.procedural, { V, clamp } = K;
  const record = value => K.world.data.record(value);
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const name = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const style = ['direction', 'grid', 'looseness', 'relief'];
  const surfaceChannels = ['paint', 'tint', 'hueShift', 'roughness', 'coating', 'emission', 'spill', 'style', ...style];
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(n => range(n, -10000, 10000));

  function rows(raw, compile) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 32) throw new TypeError('Use up to 32 named channel erasers per layer');
    const ids = new Set();
    return Array.from(raw, row => {
      if (!record(row) || !name(row.id) || ids.has(row.id) || row.enabled !== undefined && typeof row.enabled !== 'boolean')
        throw new TypeError('Channel erasers need unique IDs and an optional enabled switch');
      ids.add(row.id);
      return compile(row);
    });
  }

  function revise(source, id, patch) {
    if (!name(id) || patch !== null && (!record(patch) || Object.hasOwn(patch, 'id') || !Object.keys(patch).length))
      throw new TypeError('Edit an eraser by ID and patch its settings, or pass null to remove it');
    const next = (source ?? []).slice(), index = next.findIndex(row => row.id === id);
    if (patch === null) {
      if (index < 0) throw new RangeError('Unknown channel eraser ' + id);
      next.splice(index, 1);
    } else if (index < 0) next.push({ id, ...patch });
    else next[index] = { ...next[index], ...patch };
    return next;
  }

  function surface(raw) {
    const { boxOf, expand, pointIndex } = P.spatial;
    const specs = rows(raw, row => {
      const { points, radius, feather = .35, strength = 1, channels, enabled = true } = row;
      if (!fields(row, ['id', 'points', 'radius', 'feather', 'strength', 'channels', 'enabled']) ||
          !Array.isArray(points) || points.length < 1 || points.length > 256 || !Array.from(points).every(xyz) ||
          !range(radius, .0001, 100) || !range(feather, 0, 1) || !range(strength, 0, 1) ||
          !Array.isArray(channels) || !channels.length || new Set(channels).size !== channels.length ||
          !Array.from(channels).every(key => surfaceChannels.includes(key)))
        throw new TypeError('A surface eraser needs XYZ points, radius, distinct channels and strength and feather in 0–1');
      const scope = new Set(channels.flatMap(ch => ch === 'style' ? style : [ch]));
      const segments = (points.length === 1 ? points : points.slice(1)).map((end, i) => {
        const start = points[i], delta = V.sub(end, start);
        return { start, delta, length2: V.dot(delta, delta), bounds: expand(boxOf([start, end]), radius) };
      });
      const index = pointIndex(segments);
      function reduce(point) {
        let distance = Infinity;
        index(point, ({ start, delta, length2 }) => {
          const bias = length2 ? clamp(V.dot(V.sub(point, start), delta) / length2, 0, 1) : 0;
          distance = Math.min(distance, V.dist(point, V.mad(start, delta, bias)));
        });
        if (distance >= radius) return 1;
        const t = feather ? clamp((radius - distance) / (radius * feather), 0, 1) : 1;
        return 1 - strength * t * t * (3 - 2 * t);
      }
      return { scope, enabled, strength, reduce };
    });
    if (!specs.length) return;
    const active = specs.filter(row => row.enabled && row.strength);
    return { has: channel => active.some(row => row.scope.has(channel)),
      remaining(channel, point) {
        let weight = 1;
        for (const row of active) if (row.scope.has(channel)) weight *= row.reduce(point);
        return weight;
      } };
  }

  function temporal(raw, span, controls, makeTrack) {
    return rows(raw, row => {
      const { id, start, end, strength = 1, enabled = true } = row;
      if (!fields(row, ['id', 'start', 'end', 'strength', 'controls', 'enabled']) ||
          !range(start, 0, span + 1e-9) || !range(end, start, span + 1e-9) || end === start)
        throw new TypeError('An animation eraser needs a time window inside its layer');
      const scope = controls(row.controls);
      const track = Array.isArray(strength) ? makeTrack(strength) : undefined;
      if (track ? track.keys.some(key => !range(key.time, start, end)) : !range(strength, 0, 1))
        throw new TypeError('Animation eraser strength needs 0–1 or keys inside its window');
      return { id, start, end, enabled, strength, scope, track };
    });
  }

  P.channelEraser = Object.freeze({ revise, surface, temporal });
})(KIT);
