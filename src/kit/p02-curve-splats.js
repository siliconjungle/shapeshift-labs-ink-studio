/* Adapt editable paths and sampled strand sources to finite Gaussian segments. */
(function (K) {
  const format = 'ink-studio/curve-splat-scene';
  const coordinateLimit = 1e5, segmentLimit = 60000;
  const array = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const point = value => array(value) && value.length === 3 && Array.from(value).every(n => finite(n, -coordinateLimit, coordinateLimit));
  const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
  function check(condition, message) {
    if (!condition) throw new RangeError('Curve splats: ' + message);
  }
  function rgb(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    check(array(value) && value.length === 3 && Array.from(value).every(n => Number.isInteger(n) && n >= 0 && n <= 255),
      'expected an RGB colour');
    return Array.from(value);
  }
  function points(input) {
    check(Array.isArray(input) && input.length <= segmentLimit + 1, 'expected a bounded point array');
    return Array.from(input, value => {
      check(point(value), 'points need three finite world coordinates');
      return Array.from(value);
    });
  }
  function pathSpec(path) {
    return { ...(path.id !== undefined && { id: path.id }), points: path.points, closed: path.closed, up: path.up,
      frame: typeof path.frame === 'function' ? distance => path.frame(distance).N : undefined };
  }

  function bundle(spec) {
    check(spec && typeof spec === 'object' && !Array.isArray(spec), 'expected bundle settings');
    const input = spec.guide;
    check(Array.isArray(input) || input && ['path', 'spline', 'family', 'surface'].includes(input.kind ?? 'path'),
      'a strand bundle needs one guide path, spline, family or surface stroke');
    const guide = input.kind === 'family' ? K.curve.create(input.definition) : input;
    const compiled = typeof guide.frame === 'function' && typeof guide.at === 'function';
    const up = spec.up ?? (spec.style === 'frayed-hem' && !compiled && !guide.up ? [0, -1, 0] : undefined);
    if (compiled) return CurveBundles.build(spec, K.curve.path(guide, up === undefined ? {} : { up }), segmentLimit);
    const [source] = paths(guide);
    return CurveBundles.build(spec, K.curve.path(points(source.points), {
      ...(source.closed !== undefined && { closed: source.closed }),
      ...((up ?? source.up) !== undefined && { up: up ?? source.up })
    }), segmentLimit);
  }

  function bundlePaths(plan) {
    check(Array.isArray(plan?.strands) && plan.strands.length > 0 && plan.strands.length <= 128 &&
      plan.strands.every(strand => label(strand?.id) && strand.path) &&
      new Set(plan.strands.map(strand => strand.id)).size === plan.strands.length,
      'expected a bundle plan with distinct strand IDs');
    return plan.strands.map(({ id, radius, family, index, clump, path }) => ({
      ...pathSpec(path ?? {}), id, radius, family, index, clump
    }));
  }

  function paths(source) {
    if (Array.isArray(source)) return [{ points: source }];
    check(source && typeof source === 'object', 'expected a path or source document');
    switch (source.kind ?? 'path') {
      case 'path':
        check(source.closed === undefined || typeof source.closed === 'boolean', 'invalid closure');
        return [pathSpec(source)];
      case 'spline': {
        const controls = points(source.points), per = source.samples ?? 6;
        check(controls.length >= 2 && Number.isSafeInteger(per) && per >= 1 && per <= 128 &&
          per * (controls.length - 1) <= segmentLimit, 'invalid spline controls or sample count');
        return [{ id: source.id, points: K.curve.spline(controls, per), up: source.up }];
      }
      case 'family': return [pathSpec(K.curve.create(source.definition))];
      case 'surface': return [surfacePath(source)];
      case 'bundle': return bundlePaths(bundle(source));
      case 'bundle-plan':
        check(source.version === 1, 'expected a version 1 bundle plan');
        return bundlePaths(source);
      case 'textile': {
        const plan = source.plan;
        check(Array.isArray(plan?.threads ?? plan?.strands) && (plan.threads ?? plan.strands).length <= segmentLimit,
          'expected a textile or interlace plan');
        return (plan.threads ?? plan.strands).map(strand => ({
          id: strand.id, radius: strand.radius, family: strand.family, index: strand.index,
          ...(strand.path && pathSpec(strand.path)),
          ...(strand.stations && { points: strand.stations.map(station => station.p),
            uvs: strand.stations.map(station => station.uv), normals: strand.stations.map(station => station.n) })
        }));
      }
      case 'routed': {
        const { link } = source;
        check(Array.isArray(link?.paths) && link.paths.length <= segmentLimit, 'expected a routed link sample');
        return link.paths.map((points, i) => ({ id: String(i), points, radius: link.radius }));
      }
      case 'trail': {
        check(Array.isArray(source.samples) && source.samples.length <= segmentLimit + 1, 'expected a bounded trail sample list');
        const spans = [{ points: [], times: [] }];
        for (const sample of source.samples) {
          if (sample === null) {
            if (spans.at(-1).points.length) spans.push({ points: [], times: [] });
          } else {
            spans.at(-1).points.push(sample?.point ?? sample);
            spans.at(-1).times.push(sample?.time);
          }
        }
        return spans.map((span, i) => ({ ...span, id: String(i) }));
      }
      default: throw new TypeError('Unknown curve splat source ' + source.kind);
    }
  }

  const packed = color => rgb(color).reduce((sum, value) => sum * 256 + value, 0);
  const mix = (x, y, t) => x + (y - x) * t;
  const mixRgb = (x, y, t) => x.map((v, i) => mix(v, y[i], t));
  const sameValue = (a, b) => Array.isArray(a) ? a.every((value, i) => value === b[i]) : a === b;

  function track(value, name, read, isConstant, interpolate, mode = 'linear') {
    if (isConstant(value)) {
      const constant = read(value);
      return { sample: () => constant };
    }
    if (typeof value === 'function') return { sample: at => read(value(at)), varying: true };
    const step = (value?.interpolation ?? mode) === 'step';
    check(step || (value?.interpolation ?? mode) === 'linear', 'invalid ' + name + ' interpolation');
    let rows = Array.isArray(value) ? value : value?.keys;
    if (value?.samples !== undefined) {
      const samples = value.samples;
      check(rows === undefined && Array.isArray(samples) && samples.length >= 2 && samples.length <= 512,
        'expected two to 512 painted ' + name + ' samples');
      rows = Array.from(samples, (v, i) => [i / (samples.length - 1), v]);
    }
    check(Array.isArray(rows) && rows.length > 0 && rows.length <= 512, 'expected up to 512 ' + name + ' keys');
    const keys = Array.from(rows, (row, i) => {
      check(Array.isArray(row) && row.length === 2 && finite(row[0], 0, 1) &&
        (i === 0 || row[0] > rows[i - 1][0]), name + ' keys need increasing positions from zero to one');
      return [row[0], read(row[1])];
    });
    function sample({ u }) {
      if (u <= keys[0][0]) return keys[0][1];
      if (u >= keys.at(-1)[0]) return keys.at(-1)[1];
      let first = 0, last = keys.length - 1;
      while (last - first > 1) {
        const middle = (first + last) >> 1;
        if (keys[middle][0] > u) last = middle;
        else first = middle;
      }
      const [a, x] = keys[first], [b, y] = keys[last];
      return step ? x : interpolate(x, y, (u - a) / (b - a));
    }
    return { sample, keys, step, varying: keys.some(([, v]) => !sameValue(v, keys[0][1])) };
  }

  function channel(value, name, min, max) {
    return track(value, name, n => {
      check(finite(n, min, max), 'invalid ' + name + ' value');
      return n;
    }, n => typeof n === 'number', mix);
  }

  function timeTrack(value, name, fallback, max) {
    if (value === undefined) return () => fallback;
    if (finite(value, 0, max)) return () => value;
    const keys = Array.isArray(value) ? value : value?.keys, ease = value?.ease ?? 'linear';
    check(Array.isArray(keys) && keys.length >= 1 && keys.length <= 512 &&
      K.anim.keyframeTrack.eases.includes(ease), 'invalid ' + name + ' time track');
    const rows = Array.from(keys, key => {
      check(Array.isArray(key) && (key.length === 2 || key.length === 3) &&
        finite(key[0], 0, 1e9) && finite(key[1], 0, max), 'invalid ' + name + ' timed key');
      return { time: key[0], value: { value: key[1] }, ease: key[2] ?? ease };
    });
    const track = K.anim.keyframeTrack.create({ value: 'number' }, rows);
    return time => track.sample(time).value;
  }

  function timingProgram(source, options) {
    const reveal = options.reveal === false ? undefined : options.reveal;
    const trail = options.trail === true ? {} : options.trail === false ? undefined : options.trail;
    if (reveal === undefined && trail === undefined) return;
    check(reveal === undefined || reveal && Object.getPrototypeOf(reveal) === Object.prototype &&
      Object.keys(reveal).every(key => ['start', 'end', 'width', 'opacity'].includes(key)), 'invalid reveal settings');
    check(trail === undefined || source?.kind === 'trail' && trail && Object.getPrototypeOf(trail) === Object.prototype &&
      Object.keys(trail).every(key => ['lifetime', 'width', 'fade', 'ageSamples'].includes(key)),
      'trail timing needs a trail source and age settings');
    const start = timeTrack(reveal?.start, 'reveal start', 0, 1), end = timeTrack(reveal?.end, 'reveal end', 1, 1);
    const width = timeTrack(reveal?.width, 'reveal width', 1, 8), opacity = timeTrack(reveal?.opacity, 'reveal opacity', 1, 1);
    const result = { sample: time => ({ start: start(time), end: end(time), width: width(time), opacity: opacity(time) }) };
    if (trail) {
      const { lifetime = 1, ageSamples = 24, width = 1, fade = [[0,1],[1,0]] } = trail;
      check(finite(lifetime, 1e-4, 1e9) && Number.isSafeInteger(ageSamples) && ageSamples >= 4 && ageSamples <= 128,
        'invalid trail lifetime or age resolution');
      result.trail = Object.freeze({ lifetime, ageSamples, width: channel(width, 'trail width', 0, 8),
        fade: channel(fade, 'trail fade', 0, 1) });
    }
    return Object.freeze(result);
  }

  const colorTrack = (value, name) => track(value, name, rgb, value => typeof value === 'string' ||
    array(value) && value.length === 3 && Array.from(value).every(n => typeof n === 'number'), mixRgb);

  function materialTracks(along, palette, roles) {
    if (along === undefined) return {};
    check(along && Object.getPrototypeOf(along) === Object.prototype &&
      Object.keys(along).every(key => ['paletteRole', 'pigment', 'opacity', 'roughness', 'emission', 'emissionColor'].includes(key)),
      'invalid along-strand material');
    const result = {};
    if (along.paletteRole !== undefined) {
      const resolve = name => {
        check(label(name) && !name.startsWith('#'), 'expected a named palette role or ramp stop');
        const swatch = PixelLook.roleColor(name, palette, roles);
        return [swatch >> 16, (swatch >> 8) & 255, swatch & 255];
      };
      result.paletteRole = track(along.paletteRole, 'paletteRole', resolve, value => typeof value === 'string', mixRgb, 'step');
    }
    for (const key of ['pigment', 'emissionColor']) if (along[key] !== undefined)
      result[key] = colorTrack(along[key], key);
    for (const [key, max] of [['opacity', 1], ['roughness', 1], ['emission', 8]]) if (along[key] !== undefined)
      result[key] = channel(along[key], key, 0, max);
    return result;
  }

  const lightingPresets = Object.freeze({
    'matte-thread': Object.freeze({ roughness: .87, diffuse: .62, anisotropy: .48, sheen: .18, specular: .04, transmission: .03 }),
    'glossy-hair': Object.freeze({ roughness: .24, diffuse: .54, anisotropy: .94, sheen: .14, specular: .73, transmission: .13 }),
    'metal-wire': Object.freeze({ roughness: .12, diffuse: .8, anisotropy: .62, sheen: .06, specular: 1.1, transmission: 0 }),
    'backlit-fibre': Object.freeze({ roughness: .68, diffuse: .66, anisotropy: .8, sheen: .12, specular: .08, transmission: 1.12 })
  });
  const lightingChannels = { roughness: 1, diffuse: 1, anisotropy: 1, sheen: 4, specular: 4, transmission: 4 };
  const lightingColors = ['highlightColor', 'transmissionColor'];

  function lightingTracks(input) {
    if (input === undefined || input === false) return;
    const settings = typeof input === 'string' ? { preset: input } : input;
    check(settings && Object.getPrototypeOf(settings) === Object.prototype && Object.keys(settings).every(key =>
      key === 'preset' || Object.hasOwn(lightingChannels, key) || lightingColors.includes(key)),
    'invalid strand lighting settings');
    const name = settings.preset ?? 'matte-thread';
    check(label(name) && Object.hasOwn(lightingPresets, name), 'unknown strand lighting preset');
    const preset = lightingPresets[name], result = {};
    for (const [key, limit] of Object.entries(lightingChannels)) {
      const value = settings[key] === undefined ? preset[key] : settings[key];
      result[key] = channel(value, 'lighting.' + key, 0, limit);
    }
    for (const key of lightingColors) if (settings[key] !== undefined)
      result[key] = colorTrack(settings[key], 'lighting.' + key);
    return result;
  }

  function profileStops(channels, resolution) {
    if (!channels.some(p => p?.varying)) return [];
    const stops = new Set(channels.some(profile => profile?.varying && !profile.step) ?
      Array.from({ length: resolution - 1 }, (_, i) => (i + 1) / resolution) : []);
    for (const [i, profile] of channels.entries()) {
      if (!profile?.varying || !profile.keys) continue;
      for (const [j, [u, v]] of profile.keys.entries()) {
        if (u > 0 && u < 1) stops.add(u);
        if (!j || profile.step) continue;
        const [from, previous] = profile.keys[j - 1];
        if (sameValue(v, previous)) continue;
        const steps = i === 2 ? Math.ceil(Math.abs(v - previous) / (Math.PI / 12)) : 8;
        for (let k = 1; k < steps; k++) stops.add(from + (u - from) * k / steps);
        check(stops.size <= segmentLimit, 'profile exceeds the segment budget');
      }
    }
    return [...stops].sort((a, b) => a - b);
  }

  function surfaceChart(input, id = 'surface') {
    if (typeof input?.samplePointNormal === 'function' || typeof input?.sample === 'function') return input;
    const { kind, ...settings } = input ?? {};
    check(['plane', 'cylinder', 'mobius', 'kleinBottle', 'helicoid', 'catenoid'].includes(kind),
      'expected a surface chart sampler or native chart definition');
    return K.procedural.surface[kind]({ id, ...settings });
  }

  function surfacePath({ chart: input, points: controls, id, coordinates = 'canonical', closed = false,
    lift = 0, inset = 0, tolerance = .001, profileSamples = 64 } = {}) {
    const chart = surfaceChart(input);
    const stroke = id ?? chart.id ?? 'surface';
    check(label(stroke) && ['canonical', 'lifted'].includes(coordinates) && typeof closed === 'boolean' &&
      finite(tolerance, 1e-6, 100) && Number.isSafeInteger(profileSamples) && profileSamples >= 8 && profileSamples <= 1024 &&
      Array.isArray(controls) && controls.length >= 2 && controls.length <= segmentLimit + 1,
      'invalid surface stroke ID, coordinate mode or sampling settings');
    const topology = chart.topology ?? K.procedural.surface.topology({
      u: chart.periodicU ? 'periodic' : 'open', v: chart.periodicV ? 'periodic' : 'open'
    });
    const canonical = coordinates === 'canonical', route = [];
    for (const uv of controls) {
      check(topology.contains(uv) && (!canonical || uv.every(n => finite(n, 0, 1))),
        'surface stroke points must be finite UVs within the open chart axes');
      const previous = route.at(-1);
      const at = canonical && previous ? topology.liftNear(uv, previous) : uv.slice();
      if (!previous || at.some((value, i) => value !== previous[i])) route.push(at);
    }
    if (closed && route.length > 1) {
      const end = topology.liftNear(topology.canonical(route[0]).uv, route.at(-1));
      if (end.some((value, i) => value !== route.at(-1)[i])) route.push(end);
    }
    check(route.length >= 2, 'surface stroke must travel along the chart');

    const read = chart.samplePointNormal ?? chart.sample;
    let queries = 0;
    function station(uv) {
      check(++queries <= segmentLimit * 4, 'surface stroke exceeds the sampling budget');
      const { p, n } = read.call(chart, uv) ?? {};
      check(point(p) && point(n) && K.V.len(n) > 1e-8, 'surface chart must return a finite point and nonzero normal');
      return { uv, p: Array.from(p), n: K.V.norm(n) };
    }
    const stations = [station(route[0])];
    const between = (a, b, fraction) => station(a.uv.map((value, i) => mix(value, b.uv[i], fraction)));
    function follow(a, b, depth) {
      const m = between(a, b, .5);
      // The UV bound also prevents several laps from aliasing to a short XYZ chord.
      if (a.uv.some((value, i) => Math.abs(value - b.uv[i]) > 1 / 16) ||
        K.V.dist(m.p, K.V.lerp(a.p, b.p, .5)) > tolerance || K.V.dot(a.n, b.n) < .9848) {
        check(depth < 24, 'surface chart cannot resolve the stroke continuously');
        follow(a, m, depth + 1);
        follow(m, b, depth + 1);
        return;
      }
      check(stations.length <= segmentLimit, 'surface stroke exceeds the station budget');
      stations.push(b);
    }
    for (const uv of route.slice(1)) follow(stations.at(-1), station(uv), 0);

    const metric = [0];
    for (let i = 1; i < stations.length; i++) metric.push(metric.at(-1) + K.V.dist(stations[i - 1].p, stations[i].p));
    const total = metric.at(-1);
    check(total > 1e-7, 'surface stroke must have nonzero arc length');
    const rise = channel(lift, 'surface lift', 0, 100), recess = channel(inset, 'surface inset', 0, 100);
    const cuts = profileStops([rise, recess], profileSamples);
    const result = { id: stroke, points: [], uvs: [], normals: [], offsets: [], closed };
    function append({ uv, p, n }, distance) {
      check(result.points.length <= segmentLimit, 'surface stroke exceeds the station budget');
      const sample = { id: stroke, point: p.slice(), normal: n.slice(), uv: uv.slice(), distance, u: distance / total };
      const offset = rise.sample(sample) - recess.sample(sample);
      const shifted = K.V.mad(p, n, offset);
      check(point(shifted), 'surface stroke exceeds the world coordinate budget');
      result.points.push(shifted);
      result.uvs.push(uv);
      result.normals.push(n);
      result.offsets.push(offset);
    }
    append(stations[0], 0);
    for (let i = 1, k = 0; i < stations.length; i++) {
      const from = metric[i - 1] / total, to = metric[i] / total;
      while (cuts[k] <= from + 1e-12) k++;
      while (cuts[k] < to - 1e-12) {
        const u = cuts[k++];
        append(between(stations[i - 1], stations[i], (u - from) / (to - from)), u * total);
      }
      append(stations[i], metric[i]);
    }
    if (closed) {
      check(K.V.dist(result.points[0], result.points.at(-1)) <= 1e-6,
        'closed surface stroke must meet at the same offset and side of its chart');
      result.points[result.points.length - 1] = result.points[0].slice();
    }
    return result;
  }

  function carve(sculpt, host, grooves, options = {}) {
    check(typeof sculpt?.tube === 'function' && typeof sculpt?.join === 'function' && typeof host?.sd === 'function' &&
      Array.isArray(grooves) && grooves.length && grooves.length <= 1024,
      'grooves need a sculpt, a held host solid and a bounded list of strokes');
    let segments = 0;
    const plans = grooves.map(({ source, radius = .05 }) => {
      check(finite(radius, 1e-5, 100), 'invalid groove radius');
      const { points } = surfacePath(source);
      segments += points.length - 1;
      check(segments <= segmentLimit, 'grooves exceed the segment budget');
      return { points, radius };
    });
    const cutters = plans.map(({ points, radius }) => sculpt.tube(points, radius, radius, host.mat, { hold: true }));
    return sculpt.join('cut', host, cutters, {
      res: host.res, tag: host.tag, objectId: host.renderOwner, target: host.renderTarget, mask: true, r: 0, ...options
    });
  }

  function majorAxis(direction, axis, angle) {
    const projected = K.V.mad(direction, axis, -K.V.dot(direction, axis));
    const reference = Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    const n = K.V.norm(K.V.len(projected) > 1e-7 ? projected : K.V.mad(reference, axis, -K.V.dot(reference, axis)));
    return K.V.mad(K.V.mul(n, Math.cos(angle)), K.V.cross(axis, n), Math.sin(angle));
  }

  const capTypes = ['rounded', 'blunt', 'tapered', 'fading'];
  const smooth = x => {
    const u = Math.max(0, Math.min(1, x));
    return u * u * (3 - 2 * u);
  };
  function endStyle(value = 'rounded') {
    const type = typeof value === 'string' ? value : value?.type;
    const length = typeof value === 'string' ? .16 : value?.length ?? .16;
    check(capTypes.includes(type) && finite(length, 1e-5, 1), 'invalid cap style or length');
    return { type, length };
  }
  function capStyles(value) {
    if (value === undefined || typeof value === 'string') {
      const cap = endStyle(value);
      return { start: cap, end: cap };
    }
    check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => key === 'start' || key === 'end'), 'caps need start and end styles');
    return { start: endStyle(value.start), end: endStyle(value.end) };
  }

  function joinStyles(value) {
    check(Array.isArray(value) && value.length <= 128, 'expected up to 128 join edits');
    return Array.from(value, row => {
      const { type, at, length = type === 'break' ? .04 : .12, strength = 1, spread = .25, color } = row ?? {};
      check((type === 'break' || type === 'pool') && finite(at, 0, 1) && finite(length, 1e-5, 1),
        'invalid join type, position or length');
      if (type === 'break') return { type, at, length };
      check(finite(strength, 0, 8) && finite(spread, 0, 4), 'invalid pool strength or spread');
      return { type, at, length, strength, spread, color: color === undefined ? null : rgb(color) };
    });
  }

  function joinRanges(join, closed) {
    const half = join.length / 2;
    return (closed ? [-1, 0, 1] : [0]).map(shift =>
      [Math.max(0, join.at + shift - half), Math.min(1, join.at + shift + half)]).filter(([a, b]) => a < b);
  }

  function strandEnds(knots, lengths, total, caps, joins, closed, profileCuts) {
    const cuts = new Set(profileCuts);
    const add = (from, to) => {
      for (let i = 0; i <= 24; i++) cuts.add(from + (to - from) * i / 24);
    };
    const gaps = [];
    for (const join of joins) for (const [from, to] of joinRanges(join, closed)) {
      if (join.type === 'break') {
        gaps.push({ from, to });
        cuts.add(from);
        cuts.add(to);
      } else add(from, to);
    }
    gaps.sort((a, b) => a.from - b.from);
    const merged = [];
    for (const gap of gaps) {
      const last = merged.at(-1);
      if (last && last.to >= gap.from) last.to = Math.max(last.to, gap.to);
      else merged.push(gap);
    }
    const runs = [];
    let from = 0;
    for (const gap of merged) {
      if (gap.from > from) runs.push({ from, to: gap.from, bluntStart: from > 0, bluntEnd: true });
      from = gap.to;
    }
    if (from < 1) runs.push({ from, to: 1, bluntStart: from > 0, bluntEnd: false });
    if (!closed && runs[0]?.from === 0) {
      runs[0].bluntStart = caps.start.type === 'blunt';
      if (caps.start.type === 'fading' || caps.start.type === 'tapered') add(0, caps.start.length);
    }
    if (!closed && runs.at(-1)?.to === 1) {
      runs.at(-1).bluntEnd = caps.end.type === 'blunt';
      if (caps.end.type === 'fading' || caps.end.type === 'tapered') add(1 - caps.end.length, 1);
    }
    // The plane uses the tangent on the visible side of the authored boundary.
    function plane(u, sign) {
      const at = u * total, tolerance = total * 1e-12;
      let distance = 0;
      for (let i = 0; i < lengths.length; i++) {
        const length = lengths[i];
        if (length < 1e-7) continue;
        const end = distance + length;
        if (sign > 0 ? at < end - tolerance || end === total : at <= end + tolerance) {
          const blend = Math.max(0, Math.min(1, (at - distance) / length));
          return { point: K.V.lerp(knots[i], knots[i + 1], blend),
            normal: K.V.mul(K.V.sub(knots[i + 1], knots[i]), sign / length), segment: i, blend, sign };
        }
        distance = end;
      }
      return null;
    }
    for (const run of runs) {
      if (run.bluntStart) run.start = plane(run.from, 1);
      if (run.bluntEnd) run.end = plane(run.to, -1);
    }
    return { runs, stops: [...cuts].filter(u => u > 0 && u < 1).sort((a, b) => a - b) };
  }

  function endWeights(sample, run, caps, closed) {
    if (closed) return [1, 1];
    let width = 1, fade = 1;
    for (const [name, active, distance] of [['start', run.from === 0, sample.u], ['end', run.to === 1, 1 - sample.u]]) {
      const cap = caps[name];
      if (!active || distance >= cap.length) continue;
      if (cap.type === 'tapered') width *= smooth(distance / cap.length);
      if (cap.type === 'fading') fade *= smooth(distance / cap.length);
    }
    return [width, fade];
  }

  function poolAt(sample, pools, closed) {
    let spread = 1, density = 1, tint;
    for (const pool of pools) {
      const delta = Math.abs(sample.u - pool.at), distance = closed ? Math.min(delta, 1 - delta) : delta;
      const weight = smooth(1 - 2 * distance / pool.length);
      if (weight === 0) continue;
      spread += weight * pool.spread;
      density += weight * pool.strength;
      if (pool.color) tint = [...(tint ?? []), [pool.color, weight]];
    }
    return { spread, density, tint };
  }

  function styledOpacity(base, fade, density, edge) {
    if (fade === 1 && density === 1) return base;
    if (edge === 'hard') return fade * (1 - (1 - base) ** density);
    return -Math.expm1(Math.log1p(-Math.min(.999, base)) * fade * density);
  }

  function continuesFrom(plane, from, to) {
    return [from, to].every(point => {
      const offset = K.V.sub(point, plane.point);
      const epsilon = 1e-8 * Math.max(1, K.V.len(offset));
      return K.V.dot(plane.normal, offset) >= -epsilon && K.V.len(K.V.cross(plane.normal, offset)) <= epsilon;
    });
  }

  function chartWidthSampler(chart) {
    const read = at => (chart.samplePointNormal ?? chart.sample).call(chart, at);
    const contains = uv => chart.topology?.contains(uv) ??
      uv.every((value, i) => (i ? chart.periodicV : chart.periodicU) || finite(value, 0, 1));
    return (uv, axis) => {
      const { n } = read(uv);
      const side = majorAxis(K.V.cross(n, axis), axis, 0);
      const [du, dv] = uv.map((value, i) => {
        const step = sign => uv.map((v, j) => i === j ? value + sign * 1e-4 : v);
        let lo = step(-1), hi = step(1);
        if (!contains(lo)) lo = uv;
        if (!contains(hi)) hi = uv;
        return K.V.mul(K.V.sub(read(hi).p, read(lo).p), 1 / (hi[i] - lo[i]));
      });
      const aa = K.V.dot(du, du), ab = K.V.dot(du, dv), bb = K.V.dot(dv, dv);
      const det = aa * bb - ab * ab, a = K.V.dot(side, du), b = K.V.dot(side, dv);
      if (!(det > aa * bb * 1e-10)) return {};
      return { side, gradient: [(a * bb - b * ab) / det, (b * aa - a * ab) / det] };
    };
  }

  function aggregateGuide(parts, settings) {
    const tracks = parts.map(({ points }) => {
      const knots = points.filter((point, i) => !i || K.V.dist(point, points[i - 1]) > 1e-7);
      return knots.length > 1 ? K.curve.resample(knots, settings.samples) : null;
    });
    if (tracks.some(path => !path)) return;
    let radius = 0, pitch = 0;
    const points = Array.from({ length: settings.samples + 1 }, (_, i) => {
      const locations = tracks.map(stations => stations[i]);
      const center = K.V.mul(locations.reduce((sum, point) => K.V.add(sum, point), [0,0,0]), 1 / locations.length);
      for (let j = 0; j < locations.length; j++)
        radius = Math.max(radius, K.V.dist(center, locations[j]) + parts[j].radius);
      // Use the largest local nearest-neighbour pitch, so an isolated strand
      // can hold the detailed representation even if the rest are clustered.
      if (settings.pitch === undefined && (i === settings.samples || i % Math.ceil(settings.samples / 5) === 0)) {
        for (let j = 0; j < locations.length; j++) {
          let nearest = Infinity;
          for (let k = 0; k < locations.length; k++) if (j !== k) nearest = Math.min(nearest, K.V.dist(locations[j], locations[k]));
          pitch = Math.max(pitch, nearest);
        }
      }
      return center;
    });
    if (points.some((point, i) => i && K.V.dist(point, points[i - 1]) < 1e-7)) return;
    if (settings.width !== undefined) radius = settings.width / 2;
    if (!finite(radius, 1e-6, 100)) return;
    return { points, radius, pitch: settings.pitch ?? Math.max(1e-6, pitch) };
  }

  function aggregatePlan(plan, settings, colors, maxSegments) {
    const parts = plan.strands.filter(strand => strand.rows.length);
    check(parts.length >= 2 && parts.length <= 256, 'an aggregate needs 2 to 256 nonempty strands in the same source');
    const coarse = aggregateGuide(parts.map(strand => ({ points: strand.knots, radius: strand.maxRadius })), settings);
    check(coarse, 'cannot form a continuous aggregate; group strands along the same direction');
    let area = 0, opacity = 0, weight = 0;
    const pigment = [0,0,0];
    for (const { rows } of parts) for (const row of rows) {
      const footprint = K.V.dist(row.from, row.to) * row.radius;
      area += footprint;
      opacity += row.opacity * footprint;
      weight += row.opacity * footprint;
      for (let k = 0; k < 3; k++) pigment[k] += row.shade[k] * row.opacity * footprint;
    }
    const color = settings.color ?? pigment.map(value => Math.round(value / (weight || 1)));
    const proxy = prepare({ kind: 'path', id: 'aggregate', points: coarse.points }, {
      radius: coarse.radius, color, opacity: 0, edge: 'hard', object: plan.object,
      material: plan.material, target: plan.target, maxSegments
    }, colors, true);
    return { ...coarse, settings, plan: proxy, opacity: settings.opacity ?? opacity / area };
  }

  function simplificationRuns(strands, ranges) {
    const runs = [];
    const eligible = row => !row.profile && !row.clips && !row.timeRange && !row.pattern;
    function same(a, b) {
      return b && eligible(b) && a.radius === b.radius && a.opacity === b.opacity &&
        sameValue(a.shade, b.shade) && (a.finish === b.finish || a.finish && b.finish && sameValue(a.finish, b.finish)) &&
        (a.lighting === b.lighting || a.lighting && b.lighting && sameValue(a.lighting, b.lighting));
    }
    for (const [i, { rows }] of strands.entries()) {
      const offset = ranges[i].first;
      for (let start = 0; start < rows.length;) {
        let end = start + 1;
        if (eligible(rows[start])) while (same(rows[start], rows[end]) && sameValue(rows[end - 1].to, rows[end].from)) end++;
        if (end - start > 1) runs.push([offset + start, offset + end]);
        start = end;
      }
    }
    return runs;
  }

  function prepare(source, options = {}, palette, retain = false) {
    const link = source?.kind === 'routed' ? source.link : undefined;
    const { radius, width, taper = 1, twist = 0, section = source?.kind === 'surface' ? 'flattened' : undefined,
      edge = 'gaussian', caps: capInput, joins: joinInput = [], up, profileSamples = 96, opacity = edge === 'hard' ? 1 : .94, color = '#eab876', object = link?.id ?? 'curve',
      material = link?.material ?? 'strand', target, maxSegments = segmentLimit } = options;
    const defaultAspect = section === 'flattened' ? .16 : section === 'elliptical' ? .5 :
      section === 'round' || options.twist === undefined ? 1 : .35;
    const aspect = options.aspect === undefined ? defaultAspect : options.aspect;
    check(section === undefined || ['round', 'elliptical', 'flattened'].includes(section), 'expected a round, elliptical or flattened section');
    check(['gaussian', 'beta', 'hard'].includes(edge), 'expected a gaussian, beta or hard edge');
    check(section !== 'round' || aspect === 1, 'round sections use aspect 1');
    check(section !== 'flattened' || aspect <= .99, 'flattened sections need aspect at most .99');
    check((radius === undefined || finite(radius, 1e-6, 100)) && finite(opacity, 0, 1) && label(object) && label(material) &&
      finite(aspect, .1, 1) && (up === undefined || point(up) && K.V.len(up) > 1e-8) &&
      Number.isSafeInteger(profileSamples) && profileSamples >= 8 && profileSamples <= 1024 &&
      Number.isSafeInteger(maxSegments) && maxSegments >= 0 && maxSegments <= segmentLimit,
      'invalid strand appearance, profile resolution or segment budget');
    const profileWidth = width === undefined ? null : channel(width, 'width', 0, 200);
    const profileTaper = channel(taper, 'taper', 0, 1);
    const profileTwist = channel(twist, 'twist', -64 * Math.PI, 64 * Math.PI);
    const framed = aspect < .99999, flattened = section === 'flattened';
    const materials = materialTracks(options.along, palette, options.paletteRoles);
    const light = lightingTracks(options.lighting);
    const profileCuts = profileStops([profileWidth, profileTaper, framed && profileTwist, ...Object.values(materials),
      ...Object.values(light ?? {})], profileSamples);
    const caps = capStyles(capInput), joins = joinStyles(joinInput), pools = joins.filter(join => join.type === 'pool');
    const endEdits = joins.length || caps.start.type !== 'rounded' || caps.end.type !== 'rounded';
    const fixedColor = typeof color === 'function' ? null : rgb(color);
    const timing = timingProgram(source, options);
    const pattern = CurvePattern.prepare(options.pattern, palette, options.paletteRoles);
    const lod = CurveLod.prepare(options.lod);
    let shadows = 0;
    if (options.shadow !== undefined && options.shadow !== false) {
      const shadow = options.shadow;
      check(shadow && Object.getPrototypeOf(shadow) === Object.prototype && Object.keys(shadow).every(key =>
        ['cast', 'receive'].includes(key) && typeof shadow[key] === 'boolean'), 'shadow needs boolean cast and receive settings');
      if (shadow.cast) shadows |= CurveSplat.castShadow;
      if (shadow.receive) shadows |= CurveSplat.receiveShadow;
    }
    const chart = pattern?.chart && source?.kind === 'surface' && surfaceChart(source.chart);
    const chartWidth = chart && chartWidthSampler(chart);
    if (chart) {
      const { periodicU, periodicV, twistedU } = chart.topology ?? chart;
      if (periodicU || periodicV) pattern.topology = { periodicU, periodicV, twistedU };
    }
    let segments = 0, examined = 0, samples = 0;
    const strands = paths(source).map((strand, index) => {
      const baseRadius = radius ?? strand.radius ?? .03, id = strand.id ?? String(index);
      check(finite(baseRadius, 1e-6, 100) && label(id), 'invalid strand radius or ID');
      const knots = points(strand.points), rows = [];
      const times = timing?.trail && strand.times;
      if (timing?.trail) check(times?.length === knots.length && times.every((time, i) =>
        finite(time, -1e9, 1e9) && (!i || time > times[i - 1])), 'timed trail samples need increasing timestamps in each run');
      const autoClosed = strand.closed && knots.length >= 2 && K.V.dist(knots[0], knots.at(-1)) > 1e-8;
      if (autoClosed) knots.push(knots[0].slice());
      const uvs = autoClosed && strand.uvs ? [...strand.uvs, strand.uvs[0]] : strand.uvs;
      if (pattern?.chart) check(uvs?.length === knots.length && uvs.every(uv =>
        array(uv) && uv.length === 2 && Array.from(uv).every(n => finite(n, -1e9, 1e9))),
      'chart-anchored patterns need surface or textile UVs');
      samples += knots.length;
      check(samples <= 2 * segmentLimit, 'point budget exceeded');
      const lengths = knots.slice(1).map((to, i) => K.V.dist(knots[i], to));
      const total = lengths.reduce((sum, length) => length < 1e-7 ? sum : sum + length, 0);
      if (total === 0) {
        check(!retain, 'a bound strand needs nonzero reference length');
        return { id, rows };
      }
      const closed = strand.closed ?? (!times && knots.length > 3 && K.V.dist(knots[0], knots.at(-1)) <= 1e-8);
      const ends = endEdits ? strandEnds(knots, lengths, total, caps, joins, closed, profileCuts) : null;
      const stops = ends?.stops ?? profileCuts;
      let runIndex = 0;
      const retainedFrame = framed && up === undefined && strand.frame;
      const chartNormals = framed && up === undefined && section !== undefined ? strand.normals : undefined;
      const initial = up ?? strand.up ?? [0, 1, 0];
      check(!framed || point(initial) && K.V.len(initial) > 1e-8, 'invalid path frame up vector');
      const frames = (framed && (!retainedFrame || retain) || chartWidth && retain) ? K.curve.frames(knots, Array.from(initial)) : null;
      const rest = retain && K.procedural.data.freeze({
        id, index: strand.index ?? index, family: strand.family, clump: strand.clump, points: knots, closed, autoClosed: Boolean(autoClosed),
        up: Array.from(initial), ...(strand.uvs && { uvs: strand.uvs.map(v => Array.from(v)) }),
        ...(strand.normals && { normals: strand.normals.map(v => Array.from(v)) }),
        ...(strand.offsets && { offsets: strand.offsets.slice() })
      });
      let distance = 0, stop = 0;
      for (let i = 0; i < lengths.length; i++) {
        const from = knots[i], to = knots[i + 1], length = lengths[i];
        if (length < 1e-7) continue;
        const axis = (framed || chartWidth) && K.V.mul(K.V.sub(to, from), 1 / length);
        const begin = distance / total, end = (distance + length) / total;
        const a = uvs?.[i], b = uvs?.[i + 1];
        const ageParts = times ? Math.max(1, Math.ceil((times[i + 1] - times[i]) / timing.trail.lifetime *
          timing.trail.ageSamples)) : 1;
        check(ageParts <= Math.max(1, maxSegments), 'trail sample interval exceeds the segment budget');
        let previous = 0, agePart = 1;
        while (stop < stops.length && stops[stop] <= begin + 1e-12) stop++;
        do {
          check(++examined <= maxSegments, 'segment budget exceeded');
          const profileEnd = stop < stops.length && stops[stop] < end - 1e-12 ?
            (stops[stop] * total - distance) / length : 1;
          const ageEnd = agePart / ageParts, next = Math.min(profileEnd, ageEnd);
          if (next === profileEnd && profileEnd < 1) stop++;
          if (next === ageEnd) agePart++;

          const middle = (previous + next) / 2, arc = distance + length * middle;
          const sample = { id, family: strand.family, index: strand.index ?? index, clump: strand.clump,
            point: K.V.lerp(from, to, middle), distance: arc, u: arc / total,
            ...(a && b && { uv: a.map((v, k) => v + (b[k] - v) * middle) }) };
          while (ends?.runs[runIndex] && sample.u > ends.runs[runIndex].to) runIndex++;
          const run = ends?.runs[runIndex];
          const active = !ends || run && sample.u >= run.from;
          if (active && (next - previous) * length >= 1e-7) {
            const [tip, fade] = ends ? endWeights(sample, run, caps, closed) : [1, 1];
            const pool = ends ? poolAt(sample, pools, closed) : { spread: 1, density: 1 };
            const size = Math.min(100, (profileWidth ? profileWidth.sample(sample) / 2 : baseRadius) *
              profileTaper.sample(sample) * tip * pool.spread);
            const rowOpacity = styledOpacity(materials.opacity?.sample(sample) ?? opacity, fade, pool.density, edge);
            if (size < 1e-6) {
              previous = next;
              continue;
            }
            segments++;
            const role = materials.paletteRole?.sample(sample), pigment = materials.pigment?.sample(sample);
            let shade = role && pigment ? role.map((value, k) => value * pigment[k] / 255) :
              role ?? pigment ?? fixedColor ?? rgb(color(sample));
            if (role || pigment) shade = shade.map(Math.round);
            for (const [pigment, weight] of pool.tint ?? [])
              shade = shade.map((value, k) => Math.round(value + weight * (pigment[k] - value)));
            const roughness = materials.roughness?.sample(sample) ?? light?.roughness.sample(sample);
            const emission = materials.emission?.sample(sample) ?? 0;
            const emissionColor = materials.emissionColor?.sample(sample) ?? shade;
            const finish = roughness !== undefined || emission > 0 ?
              [(roughness ?? -1) + 1, ...emissionColor.map(value => value * emission / 255)] : undefined;
            const lighting = light && [
              1 + light.anisotropy.sample(sample), light.diffuse.sample(sample), light.sheen.sample(sample),
              light.specular.sample(sample), light.transmission.sample(sample),
              light.highlightColor ? packed(light.highlightColor.sample(sample).map(Math.round)) : 0xffffff,
              packed((light.transmissionColor?.sample(sample) ?? shade).map(Math.round))
            ];
            let profile, roll = 0, twistAngle = 0;
            if (framed) {
              const a = chartNormals?.[i], b = chartNormals?.[i + 1];
              const direction = retainedFrame ? retainedFrame(arc) : a && b ?
                K.V.cross(K.V.lerp(a, b, middle), axis) : K.V.lerp(frames[i].N, frames[i + 1].N, middle);
              check(point(direction), 'invalid strand frame');
              twistAngle = profileTwist.sample(sample);
              profile = { major: majorAxis(direction, axis, twistAngle), aspect, flattened };
              if (retain) {
                const ref = majorAxis(K.V.lerp(frames[i].N, frames[i + 1].N, middle), axis, 0);
                roll = Math.atan2(K.V.dot(axis, K.V.cross(ref, profile.major)), K.V.dot(ref, profile.major));
              }
            }
            // Trim the kernel near an end without clipping distant sections that turn back past it.
            const reach = size * 6 / total;
            const start = previous === 0 ? from : K.V.lerp(from, to, previous);
            const end = next === 1 ? to : K.V.lerp(from, to, next);
            const left = run?.start && ((distance + previous * length) / total <= run.from + reach ||
              continuesFrom(run.start, start, end)) ? run.start : null;
            const right = run?.end && ((distance + next * length) / total >= run.to - reach ||
              continuesFrom(run.end, start, end)) ? run.end : null;
            let patternRow, patternRoll;
            if (pattern) {
              patternRow = { arc: [distance + previous * length, distance + next * length, total] };
              if (pattern.chart) {
                patternRow.uv = [mix(a[0], b[0], previous), mix(a[1], b[1], previous),
                  mix(a[0], b[0], next), mix(a[1], b[1], next)];
                if (chartWidth) Object.assign(patternRow, chartWidth(sample.uv, axis));
                if (retain && patternRow.side) {
                  const ref = majorAxis(K.V.lerp(frames[i].N, frames[i + 1].N, middle), axis, 0);
                  patternRoll = Math.atan2(K.V.dot(axis, K.V.cross(ref, patternRow.side)), K.V.dot(ref, patternRow.side));
                }
              }
            }
            rows.push({ from: start, to: end, shade, radius: size, opacity: rowOpacity, profile, finish, lighting,
              arc: [distance + previous * length, distance + next * length, total],
              clips: left || right ? [left, right] : undefined,
              pattern: patternRow,
              ...(timing && { timeRange: [(distance + previous * length) / total, (distance + next * length) / total,
                times ? mix(times[i], times[i + 1], previous) : 0, times ? mix(times[i], times[i + 1], next) : 0] }),
              ...(retain && { attachment: { segment: i, first: previous, last: next, roll, twist: twistAngle, patternRoll } }) });
          }
          previous = next;
        } while (previous < 1);
        distance += length;
      }
      return { id, rows, rest, length: total, followNormals: Boolean(chartNormals), ...(lod?.aggregate && { knots,
        maxRadius: rows.reduce((best, row) => Math.max(best, row.radius), 0) }) };
    });
    const plan = { object, material, target, edge, strands, segments, examined, timing, pattern, shadows, lod };
    if (lod?.aggregate) {
      plan.proxy = aggregatePlan(plan, lod.aggregate, palette, maxSegments - examined);
      plan.examined += plan.proxy.plan.examined;
    }
    return plan;
  }

  function emit(builder, plan, aggregate = false) {
    check(typeof builder?.curveSplat === 'function', 'expected a native splat builder');
    const first = builder.count(), threads = [];
    const groups = plan.edge === 'hard' ? plan.strands.filter(strand => strand.rows.length).length : 0;
    let nextGroup = groups ? builder.reserveCurveGroups(groups) : 0;
    const timing = plan.timing && plan.segments ? builder.registerCurveTiming(plan.timing) : undefined;
    const program = plan.pattern && plan.segments ? builder.registerCurvePattern(plan.pattern) : undefined;
    for (const { id, rows, length } of plan.strands) {
      const start = builder.count();
      const group = nextGroup && rows.length ? nextGroup++ : undefined;
      const strand = rows.length && builder.registerCurveStrand?.({ name: id, object: plan.object,
        material: plan.material, length, ...(aggregate && { aggregate: true }) });
      for (const { from, to, shade, radius, opacity, profile, clips, finish, lighting, timeRange, pattern, arc } of rows)
        builder.curveSplat(from, to, radius, shade, opacity, profile, plan.edge, group, clips, finish, lighting,
          timing && [timing, ...timeRange], pattern && { ...pattern, program }, plan.shadows, strand ? [strand, ...arc] : undefined);
      const end = builder.count();
      builder.describeSplats?.(start, end, {
        object: plan.object, material: plan.material, target: { entity: plan.object, ...plan.target, surface: id }
      });
      threads.push({ id, first: start, end });
    }
    let proxy, record;
    if (plan.lod) {
      const runs = plan.lod.simplify ? simplificationRuns(plan.strands, threads) : [];
      let aggregate;
      if (plan.proxy) {
        proxy = emit(builder, plan.proxy.plan, true);
        aggregate = { detail: threads.filter(thread => thread.end > thread.first).map(thread => [thread.first, thread.end]),
          proxy: [proxy.first, proxy.end], pitch: plan.proxy.pitch, opacity: plan.proxy.opacity,
          transition: plan.proxy.settings.transition };
        if (plan.lod.simplify) runs.push(...simplificationRuns(plan.proxy.plan.strands, proxy.threads));
      }
      if (runs.length || aggregate) {
        record = { runs, simplify: plan.lod.simplify, aggregate };
        builder.registerCurveLod(record);
      }
    }
    return { first, end: builder.count(), threads, segments: plan.segments + (proxy?.segments ?? 0), ...(record && { lod: record }) };
  }

  function draw(builder, source, options) {
    const palette = options?.along?.paletteRole !== undefined || options?.pattern?.dither ? builder?.P?.map(packed) : undefined;
    return emit(builder, prepare(source, options, palette));
  }

  function bind(builder, source, sample, options) {
    check(typeof sample === 'function', 'a bound strand needs a pose sampler');
    const palette = options?.along?.paletteRole !== undefined || options?.pattern?.dither ? builder?.P?.map(packed) : undefined;
    const plan = prepare(source, options, palette, true);
    const ranges = emit(builder, plan), hidden = new Uint8Array(ranges.segments);
    const slots = [4, 5, 6, 8, 9, 10];
    function pose(world, context = {}) {
      const { stage, rows = stage?.rows } = context;
      const data = world?.anim?.bones && world.rest ? world.rest : world?.data;
      check(data instanceof Float32Array && world.count >= ranges.end && data.length >= ranges.end * 16,
        'a bound strand must be posed on its original splat range');
      const posed = plan.strands.map(({ rest, rows: rowsOfStrand, followNormals }) => {
        const result = sample(rest, { world, ...context });
        const current = points(Array.isArray(result) ? result : result?.points);
        check(current.length === rest.points.length &&
          (!rest.closed || K.V.dist(current[0], current.at(-1)) <= 1e-6), 'pose must keep the reference knots and closure');
        const { normals, up = rest.up, active } = result ?? {};
        check((normals === undefined || Array.isArray(normals) && normals.length === current.length && normals.every(point)) &&
          (active === undefined || Array.isArray(active) && active.length === current.length - 1 &&
            active.every(state => typeof state === 'boolean')) && point(up) && K.V.len(up) > 1e-8,
          'invalid posed normals, up vector or active spans');
        const ends = current.slice(1).map((p, i) => K.V.sub(p, current[i]));
        const lengths = ends.map(v => K.V.len(v));
        const needsFrames = rowsOfStrand.some(row => row.profile) && !(normals && followNormals) ||
          !normals && rowsOfStrand.some(row => row.pattern?.side);
        const frames = needsFrames ? K.curve.frames(current, up) : null;
        return { current, normals, active, ends, lengths, frames, followNormals };
      });
      for (let i = ranges.first; i < (ranges.lod?.aggregate?.proxy[0] ?? ranges.end); i++)
        check(CurveSplat.isRow(data, i * 16) && !stage?.rig?.bid?.[i],
          'bound row must keep its curve payload and use only its curve driver');
      plan.strands.forEach(({ rows: entries }, index) => {
        const { current, normals, active, ends, lengths, frames, followNormals } = posed[index];
        const at = (segment, t) => K.V.mad(current[segment], ends[segment], t);
        const cuts = new Map();
        function clip(ref) {
          if (!ref || lengths[ref.segment] < 1e-7) return null;
          if (!cuts.has(ref)) cuts.set(ref, { point: at(ref.segment, ref.blend),
            normal: K.V.mul(ends[ref.segment], ref.sign / lengths[ref.segment]) });
          return cuts.get(ref);
        }
        entries.forEach((row, i) => {
          const indexOfRow = ranges.threads[index].first + i, q = indexOfRow * 16, h = indexOfRow - ranges.first;
          const { segment, first, last, roll, twist } = row.attachment;
          const from = at(segment, first), to = at(segment, last);
          if (active?.[segment] === false || K.V.dist(from, to) < 1e-7) {
            data[q + 3] = 0;
            hidden[h] = 1;
          } else {
            let profile = row.profile;
            if (profile) {
              const axis = K.V.mul(ends[segment], 1 / lengths[segment]), middle = (first + last) / 2;
              const chart = normals && followNormals;
              const facing = chart ? K.V.cross(K.V.lerp(normals[segment], normals[segment + 1], middle), axis) :
                K.V.lerp(frames[segment].N, frames[segment + 1].N, middle);
              profile = { ...profile, major: majorAxis(facing, axis, chart ? twist : roll) };
            }
            const geometry = CurveSplat.carrier(from, to, row.radius, profile);
            data.set(geometry.center, q);
            if (geometry.normal) world.renderMetadata?.normals?.set(geometry.normal, indexOfRow * 3);
            for (let k = 0; k < slots.length; k++) data[q + slots[k]] = geometry.covariance[k];
            data[q + 13] = geometry.half;
            world.curveStations?.set(geometry.axis, indexOfRow * CurveSplat.stationStride + 4);
            if (row.timeRange) world.curveTiming.set(geometry.axis, indexOfRow * CurveSplat.timingStride + 5);
            if (row.pattern) {
              const at = indexOfRow * CurvePattern.stride;
              world.curvePattern.set(geometry.axis, at + CurvePattern.axisOffset);
              if (row.pattern.side) {
                const blend = (first + last) / 2;
                const facing = normals ? K.V.cross(K.V.lerp(normals[segment], normals[segment + 1], blend), geometry.axis) :
                  K.V.lerp(frames[segment].N, frames[segment + 1].N, blend);
                const side = majorAxis(facing, geometry.axis, normals ? 0 : row.attachment.patternRoll);
                world.curvePattern.set(side, at + CurvePattern.sideOffset);
              }
            }
            if (hidden[h] && data[q + 3] <= 0) data[q + 3] = row.opacity;
            hidden[h] = 0;
            if (row.clips) CurveSplat.writeClips(world.curveClips, indexOfRow, geometry.center, row.clips.map(clip));
          }
          if (rows) rows[indexOfRow >> 9] = 1;
        });
      });
      if (plan.proxy) {
        const descriptor = ranges.lod.aggregate;
        const parts = posed.flatMap(({ current }, i) => plan.strands[i].rows.length ?
          [{ points: current, radius: plan.strands[i].maxRadius }] : []);
        const coarse = aggregateGuide(parts, plan.proxy.settings);
        if (coarse) descriptor.pitch = coarse.pitch;
        const [start, end] = descriptor.proxy;
        for (let i = start; i < end; i++) {
          const { segment, first, last } = plan.proxy.plan.strands[0].rows[i - start].attachment;
          const q = i * 16;
          const from = coarse && K.V.lerp(coarse.points[segment], coarse.points[segment + 1], first);
          const to = coarse && K.V.lerp(coarse.points[segment], coarse.points[segment + 1], last);
          const geometry = coarse && CurveSplat.carrier(from, to, coarse.radius);
          data[q + 13] = geometry?.half ?? 0;
          if (geometry) {
            data.set(geometry.center, q);
            world.curveStations?.set(geometry.axis, i * CurveSplat.stationStride + 4);
            for (let k = 0; k < slots.length; k++) data[q + slots[k]] = geometry.covariance[k];
            data[q + 12] = coarse.radius;
          }
          if (rows) rows[i >> 9] = 1;
        }
      }
      return ranges;
    }
    return { ...ranges, pose, post: (dt, time, stage, clock) => pose(stage.W, { stage, time, dt, clock }) };
  }

  function world(recipe) {
    check(recipe?.format === format && recipe.version === 1 && label(recipe.id) &&
      Array.isArray(recipe.strands) && recipe.strands.length > 0 && recipe.strands.length <= 1024,
      'expected a version 1 curve splat scene with named strands');
    const { seed = 1, background = '#172332', palette = [], paletteRoles, camera = {}, look = {}, liveSun, charts = {},
      atmosphere } = recipe;
    CurveWidth.prepare(look?.curveWidth);
    CurveSubdivision.prepare(look?.curveSubdivision);
    check(Number.isSafeInteger(seed) && Array.isArray(palette) && palette.length <= 255, 'invalid seed or palette');
    const colors = [packed(background), ...Array.from(palette, packed)];
    check(charts && Object.getPrototypeOf(charts) === Object.prototype && Object.keys(charts).length <= 1024,
      'expected a bounded map of surface charts');
    const carriers = new Map(Object.entries(charts).map(([id, input]) => {
      check(label(id), 'invalid surface chart ID');
      return [id, surfaceChart(input, id)];
    }));
    function chartFor(source) {
      if (source?.kind !== 'surface' || typeof source.chart !== 'string') return source;
      check(carriers.has(source.chart), 'unknown surface chart ' + source.chart);
      return { ...source, chart: carriers.get(source.chart) };
    }
    let remaining = segmentLimit;
    const plans = recipe.strands.map(({ source, ...appearance }, i) => {
      const input = source?.kind === 'bundle' ?
        { ...source, seed: source.seed === undefined ? seed : source.seed, guide: chartFor(source.guide) } : chartFor(source);
      const plan = prepare(input, { object: 'curve:' + i, paletteRoles, ...appearance, maxSegments: remaining }, colors);
      remaining -= plan.examined;
      return plan;
    });
    if (!palette.length) {
      const unique = new Set(colors);
      for (const plan of plans) {
        for (const color of plan.pattern?.dither?.swatches ?? []) if (unique.size < 256) unique.add(packed(color));
        for (const strand of plan.strands) for (const row of strand.rows)
          if (unique.size < 256) unique.add(packed(row.shade));
        if (plan.proxy && unique.size < 256) unique.add(packed(plan.proxy.plan.strands[0].rows[0].shade));
      }
      colors.splice(0, colors.length, ...unique);
    }
    const builder = makeBuilder(seed, colors);
    for (const plan of plans) emit(builder, plan);
    return builder.finish({
      id: recipe.id, curveSplatSource: recipe, cam: { target: [0, 0, 0], dist: 7, yaw: 0, pitch: 0, ...camera }, radius: 10,
      ...(paletteRoles !== undefined && { paletteRoles }), ...(liveSun !== undefined && { liveSun }),
      ...(atmosphere !== undefined && { atmosphere }),
      fog: { c: 0, start: 1, max: 0 }, dither: 0, look: { pixelSize: 1, ...look }
    });
  }

  K.curveSplats = Object.freeze({ format, segmentLimit, lightingPresets, bundle, surfacePath, carve, draw, bind, renderKernel: CurveSplat, subdivision: CurveSubdivision, bakedRibbon: CurveRibbons.ribbon, drivers: CurvePoseDrivers, world });
})(KIT);
