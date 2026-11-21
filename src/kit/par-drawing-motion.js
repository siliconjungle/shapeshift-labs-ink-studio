/* Seekable screen-space drawings bound to measured raster regions and features. */
(function (P) {
  const D = P.drawing2d;
  const record = P.graphTypes.validator('record');
  const number = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  const pair = (value, low, high) => Array.isArray(value) && value.length === 2 &&
    Array.from(value).every(n => number(n, low, high));
  const point = value => pair(value, -1e9, 1e9);
  const id = value => typeof value === 'string' ? value.length > 0 && value.length <= 128 :
    Number.isSafeInteger(value) && value > 0;

  function prepareBindings(input) {
    if (!Array.isArray(input) || input.length > 128) throw new RangeError('Expected up to 128 drawing anchors');
    const seen = new Set();
    let total = 0;
    return P.data.freeze(P.data.clone(input)).map(binding => {
      const { id: name, track, offset = [0, 0], boundsAnchor, smoothing = 0, lag = 0, hold = 0, minConfidence = 0,
        commands = [], masks = [] } = binding ?? {};
      if (!id(name) || !id(track) || seen.has(name) || !point(offset) ||
          boundsAnchor !== undefined && !pair(boundsAnchor, 0, 1) ||
          ![smoothing, lag, hold].every(n => number(n, 0, 60)) || !number(minConfidence, 0, 1))
        throw new RangeError('Invalid drawing anchor ID, offset, or timing settings');
      for (const list of [commands, masks]) {
        if (!Array.isArray(list) || !list.every(draw => record(draw) &&
            (draw.translate === undefined || point(draw.translate))))
          throw new TypeError('Anchor drawings and masks need screen drawing commands');
        total += list.length;
      }
      if (total > 8192) throw new RangeError('Tracked anchors exceed the drawing command budget');
      seen.add(name);
      return { name, track, offset, boundsAnchor, smoothing, lag, hold, minConfidence, commands, masks };
    });
  }

  function prepareObservations(observations) {
    let previous = -Infinity, count = 0;
    return Array.from(observations, entry => {
      const { time, regions } = entry ?? {};
      if (!number(time, -1e9, 1e9) || time - previous < 1e-6 || !Array.isArray(regions) || regions.length > 128)
        throw new RangeError('Anchor observations need increasing times and bounded feature records');
      const features = new Map();
      for (const region of regions) {
        const { id: key, center, confidence = 1, bounds } = region ?? {};
        if (!id(key) || features.has(key) || !point(center) || !number(confidence, 0, 1) ||
            bounds !== undefined && (!point([bounds?.x, bounds?.y]) ||
              !number(bounds.width, 0, 1e9) || !number(bounds.height, 0, 1e9)))
          throw new RangeError('Invalid or duplicate anchor feature');
        features.set(key, { center, bounds, confidence });
      }
      count += regions.length;
      if (count > 262144) throw new RangeError('Anchor observations exceed the feature record budget');
      previous = time;
      return { features, time };
    });
  }

  function measured(feature, anchor) {
    if (!feature || feature.confidence < anchor.minConfidence) return null;
    if (!anchor.boundsAnchor) return feature.center;
    if (!feature.bounds) return null;
    const { x, y, width, height } = feature.bounds;
    return [x + width * anchor.boundsAnchor[0], y + height * anchor.boundsAnchor[1]];
  }

  function trace(observations, anchor) {
    let latest = null;
    return observations.map(({ time, features }) => {
      const feature = features.get(anchor.track), position = measured(feature, anchor);
      if (!position) {
        if (latest && latest.lostAt === null) latest = { ...latest, lostAt: time };
        return latest;
      }
      const mayBlend = latest && (latest.lostAt === null || time + 1e-9 < latest.lostAt + anchor.hold);
      const blend = mayBlend && anchor.smoothing ? 1 - Math.pow(.5, (time - latest.observedAt) / anchor.smoothing) : 1;
      latest = { point: position.map((n, i) => blend === 1 ? n : latest.point[i] + (n - latest.point[i]) * blend),
        observedAt: time, confidence: feature.confidence, lostAt: null };
      return latest;
    });
  }

  function trackedAnchors(observations, bindings) {
    if (!Array.isArray(observations) || observations.length > 8192)
      throw new RangeError('Expected up to 8192 anchor observations');
    const anchors = prepareBindings(bindings);
    if (anchors.length * observations.length > 262144) throw new RangeError('Anchor clip exceeds its sample budget');
    const clip = prepareObservations(observations), tracks = anchors.map(anchor => trace(clip, anchor));
    function index(time) {
      let lo = 0, hi = clip.length;
      while (lo < hi) {
        const middle = (lo + hi) >>> 1;
        if (clip[middle].time <= time + 1e-9) lo = middle + 1;
        else hi = middle;
      }
      return lo - 1;
    }
    function sample(time) {
      if (!number(time, -1e9, 1e9)) throw new RangeError('Anchor sample needs a finite time');
      const value = [], masks = [];
      const states = anchors.map((anchor, i) => {
        const at = time - anchor.lag, slot = index(at), current = tracks[i][slot];
        const base = { id: anchor.name, track: anchor.track, observedAt: current?.observedAt ?? null,
          confidence: current?.confidence ?? null };
        if (!current || current.lostAt !== null && at + 1e-9 >= current.lostAt + anchor.hold)
          return { ...base, status: 'hidden', position: null };
        const next = tracks[i][slot + 1], held = current.lostAt !== null;
        const weight = !held && next?.lostAt === null ?
          Math.max(0, (at - clip[slot].time) / (clip[slot + 1].time - clip[slot].time)) : 0;
        const position = current.point.map((n, axis) => n + anchor.offset[axis] + (weight ? (next.point[axis] - n) * weight : 0));
        const attach = ({ translate: offset = [0, 0], ...draw }) =>
          ({ ...draw, translate: [position[0] + offset[0], position[1] + offset[1]] });
        value.push(...anchor.commands.map(attach));
        masks.push(...anchor.masks.map(attach));
        return { ...base, status: held ? 'held' : 'tracked', position };
      });
      return { value, masks, anchors: states };
    }
    return Object.freeze({ sample });
  }

  D.trackedAnchors = trackedAnchors;
})(KIT.procedural);
