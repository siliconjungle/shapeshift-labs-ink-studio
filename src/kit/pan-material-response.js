/* One timestamped contact log for projected marks, particles and sound. */
(function (K) {
  const V = K.V;
  const format = 'ink-studio/material-response';
  const surfacePrefix = 'material-response-surface/';
  const particlePass = 'material-response-particles';
  const kinds = ['step', 'roll', 'impact'];
  const limits = { contacts: 2048, materials: 8, particles: 512 };
  const record = value => value != null && Object.getPrototypeOf(value) === Object.prototype;
  const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const tuple = (v, size) => Array.isArray(v) && v.length === size && Array.from(v).every(n => finite(n, -1e6, 1e6));
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9._/-]{0,127}$/.test(value);
  function check(ok, message) {
    if (!ok) throw new RangeError('Material response: ' + message);
  }
  function fields(value, keys, name) {
    check(record(value) && Object.keys(value).every(key => keys.includes(key)), 'invalid ' + name);
  }
  function swatch(value) {
    return ColorCurves.color(value).map(c => Math.round(c * 255));
  }
  function mark(value, ring) {
    fields(value, ['radius', 'duration', 'decay', 'threshold', 'color', ...(ring ? ['speed', 'width'] : [])],
      ring ? 'ripple' : 'mark');
    const { radius = .14, duration = ring ? 1 : 4, decay = ring ? 1 : .12,
      threshold = .18, color, speed = .9, width = .065 } = value;
    check(finite(radius, 1e-5, 100) && finite(duration, .001, 120) && finite(decay, 0, 1000) &&
      finite(threshold, .001, 1) && finite(speed, 0, 100) && finite(width, 1e-5, 100), 'invalid mark dimensions or timing');
    return { radius, duration, decay, threshold, rgb: swatch(color), speed, width };
  }
  function spray(value) {
    fields(value, ['count', 'speed', 'radius', 'duration', 'gravity', 'color'], 'particles');
    const { count = 8, speed = 1.6, radius = .024, duration = .48, gravity = 6, color } = value;
    check(Number.isSafeInteger(count) && finite(count, 1, 32) && finite(speed, 0, 40) &&
      finite(radius, .001, 1) && finite(duration, .001, 4) && finite(gravity, 0, 100), 'invalid particle settings');
    return { count, speed, radius, duration, gravity, rgb: swatch(color) };
  }
  function sound(value) {
    if (typeof value === 'string') value = { cue: value };
    fields(value, ['cue', 'gain', 'rollInterval'], 'sound');
    const { cue, gain = 1, rollInterval = .14 } = value;
    check(id(cue) && finite(gain, 0, 4) && finite(rollInterval, 0, 4), 'invalid sound cue, gain or roll interval');
    return { cue, gain, rollInterval };
  }

  function create(recipe, { contacts = [] } = {}) {
    fields(recipe, ['format', 'version', 'materials', 'speedReference', 'loadReference', 'pixelSize'], 'recipe');
    const { materials, speedReference = 2, loadReference = 10, pixelSize = 1 } = recipe;
    check(recipe.format === format && recipe.version === 1 && record(materials) &&
      Object.keys(materials).length > 0 && Object.keys(materials).length <= limits.materials &&
      finite(speedReference, .001, 1e4) && finite(loadReference, .001, 1e8) &&
      Number.isInteger(pixelSize) && finite(pixelSize, 1, 16), 'expected a version 1 recipe with 1–8 materials');
    const rules = new Map(Object.entries(materials).map(([name, row]) => {
      fields(row, ['select', 'chart', 'resolution', 'mark', 'ripple', 'particles', 'sound'], 'material ' + name);
      check(id(name), 'invalid material ID');
      const rule = {
        select: TargetSelectors.prepare(row.select ?? { material: name }),
        mark: row.mark === undefined ? null : mark(row.mark, false),
        ripple: row.ripple === undefined ? null : mark(row.ripple, true),
        particles: row.particles === undefined ? null : spray(row.particles),
        sound: row.sound === undefined ? null : sound(row.sound)
      };
      check(rule.mark || rule.ripple || rule.particles || rule.sound, 'material needs a response');
      if (rule.mark || rule.ripple) {
        const { resolution = [128, 128] } = row;
        check(tuple(resolution, 2) && resolution.every(n => Number.isInteger(n) && finite(n, 8, 256)),
          'projected chart resolution must be 8–256 per axis');
        const chart = RenderGraph.projection(row.chart);
        const [u, v, U, T] = chart.bounds;
        rule.chart = chart;
        rule.resolution = resolution.slice();
        rule.field = K.splatEffects.field({ width: resolution[0], height: resolution[1], origin: [u, v],
          cell: [(U - u) / resolution[0], (T - v) / resolution[1]],
          channels: { mark: { decay: rule.mark?.decay ?? 0 }, ripple: { decay: rule.ripple?.decay ?? 0 } } });
      } else check(row.chart === undefined && row.resolution === undefined, 'a chart needs a mark or ripple');
      return [name, rule];
    }));
    const rows = new Map();
    let revision = 0, ordered, cues, mixed, bound;

    function add(records, { time } = {}) {
      check(Array.isArray(records) && records.length <= limits.contacts, 'expected a bounded contact list');
      const pending = new Map(), writes = new Map();
      for (const row of records) {
        check(record(row), 'expected a material contact record');
        const { id: key, interaction, material, point, speed, load = loadReference, normal = [0, 1, 0],
          heading = [1, 0, 0], entity, wheel, source, time: at = time } = row;
        check(typeof key === 'string' && key.length > 0 && key.length <= 256 && kinds.includes(interaction) &&
          (material == null || typeof material === 'string') && tuple(point, 3) &&
          tuple(normal, 3) && V.len(normal) > 1e-8 && tuple(heading, 3) &&
          finite(at, 0, 1e6) && finite(speed, 0, 1e8) && finite(load, 0, 1e12) &&
          [entity, wheel, source].every(value => value == null || typeof value === 'string' && value.length <= 256),
          'expected an ID, step/roll/impact, world position, speed and timestamp');
        if (rows.has(key) || pending.has(key)) continue;
        const rule = rules.get(material);
        const strength = Math.min(1, speed / speedReference * Math.sqrt(Math.min(4, load / loadReference)));
        const n = V.norm(normal), h = V.norm(V.mad(heading, n, -V.dot(heading, n)), V.perp(n));
        const hit = { id: key, interaction, material, point: point.slice(), normal: n, heading: h,
          time: at, speed, load, ...(entity != null && { entity }), ...(wheel != null && { wheel }), ...(source != null && { source }),
          ...(Number.isSafeInteger(row.tick) && { tick: row.tick }),
          ...(Number.isSafeInteger(row.appliedTick) && { appliedTick: row.appliedTick }) };
        pending.set(key, { hit, rule, strength });
        if (!rule?.chart || !strength) continue;
        const relative = V.sub(point, rule.chart.origin);
        if (Math.abs(V.dot(relative, rule.chart.normal)) > rule.chart.reach) continue;
        const uv = [V.dot(relative, rule.chart.u), V.dot(relative, rule.chart.v)];
        if (!writes.has(rule)) writes.set(rule, []);
        for (const name of ['mark', 'ripple']) {
          const effect = rule[name];
          if (!effect) continue;
          writes.get(rule).push({ at: uv, time: at, radius: effect.radius, lifetime: effect.duration, source: key,
            values: { [name]: strength }, ...(name === 'ripple' && { shape: 'ring', speed: effect.speed, width: effect.width }) });
        }
      }
      check(rows.size + pending.size <= limits.contacts, 'contact limit reached');
      if (pending.size) {
        for (const [rule, stamps] of writes) rule.field.stampMany(stamps);
        for (const [key, row] of pending) rows.set(key, row);
        ordered = cues = mixed = undefined;
        revision++;
      }
      return pending.size;
    }
    add(contacts);
    const contactsByTime = () => ordered ??= [...rows.values()].sort((a, b) => a.hit.time - b.hit.time ||
      (a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0));
    function sounds() {
      if (cues) return cues;
      const last = new Map();
      cues = [];
      for (const { hit, rule, strength } of contactsByTime()) {
        if (!rule?.sound || !strength || !rule.sound.gain) continue;
        const { cue, gain, rollInterval } = rule.sound;
        const key = JSON.stringify([hit.source, hit.entity, hit.wheel, hit.material]);
        if (hit.interaction === 'roll') {
          if (hit.time < (last.get(key) ?? -Infinity) + rollInterval) continue;
          last.set(key, hit.time);
        }
        cues.push({ id: 'material-response-' + cues.length, contact: hit.id, cue, time: hit.time, gain: gain * strength });
      }
      return cues;
    }
    function audioTimeline(timeline) {
      return { audioSchedule(clock) {
        mixed ??= K.timeline.compile({ audio: sounds().map(({ contact, ...row }) => row) }, { exact: true });
        return [...(timeline?.audioSchedule(clock) ?? []), ...mixed.audioSchedule(clock)]
          .sort((a, b) => a.firstSample - b.firstSample);
      } };
    }

    function raster(rule, time) {
      const [w, h] = rule.resolution;
      const frame = rule.field.frame(time), rgba = new Uint8Array(w * h * 4);
      for (const key of ['mark', 'ripple']) {
        const effect = rule[key];
        if (!effect) continue;
        const plane = frame.data(key);
        for (let i = 0; i < plane.length; i++) {
          if (plane[i] < effect.threshold) continue;
          rgba.set(effect.rgb, i * 4);
          rgba[i * 4 + 3] = 255;
        }
      }
      return { w, h, rgba };
    }

    function inspectField(material, time, cell) {
      const rule = rules.get(material);
      const frame = cell && rule.field.frame(time);
      return ['mark', 'ripple'].filter(kind => rule[kind]).map(kind => {
        const { threshold, rgb } = rule[kind];
        const sample = frame && frame.traceCell(kind, ...cell);
        const event = sample?.source && rows.get(sample.source)?.hit;
        return { kind, rgb: rgb.slice(), threshold, sample: sample ? {
          value: sample.value, contributors: sample.contributors, uv: sample.uv,
          event: event ? structuredClone(event) : null
        } : null };
      });
    }

    function particlesAt(time) {
      const output = [], active = contactsByTime();
      for (let i = active.length - 1; i >= 0 && output.length < limits.particles; i--) {
        const { hit, rule, strength } = active[i], fx = rule?.particles, age = time - hit.time;
        if (!fx || !strength || age < 0 || age >= fx.duration) continue;
        const side = V.cross(hit.normal, hit.heading);
        for (let j = 0; j < Math.ceil(fx.count * strength) && output.length < limits.particles; j++) {
          const hash = key => K.procedural.data.hash(JSON.stringify([hit.id, j, key]), 37) / 4294967296;
          const velocity = fx.speed * (.5 + .5 * strength);
          let point = V.mad(hit.point, hit.normal, fx.radius + (hash(1) + .35) * velocity * age - .5 * fx.gravity * age ** 2);
          point = V.mad(point, hit.heading, -(hash(2) + .1) * velocity * age);
          point = V.mad(point, side, (hash(3) - .5) * 1.4 * velocity * age);
          if (V.dot(V.sub(point, hit.point), hit.normal) < 0) continue;
          output.push({ point, contact: hit.id, radius: fx.radius * (.65 + .7 * hash(4)), rgb: fx.rgb,
            alpha: Math.round(255 * (1 - age / fx.duration)) });
        }
      }
      return output;
    }
    function projectParticles(time, camera, w, h, draw) {
      const project = DrawingPrimitives.projector(camera, w, h);
      for (const dot of particlesAt(time)) {
        const view = project.toView(dot.point);
        if (!project.visible(view)) continue;
        const [x, y] = project.point(view);
        const radius = Math.min(24, Math.max(.5, dot.radius * project.pixelsPerUnit(view, [0, 1])));
        const cx = Math.floor(x) + .5, cy = Math.floor(y) + .5;
        draw(dot, cx, cy, radius, view[2]);
      }
    }
    function particleRaster({ w, h, time, camera }) {
      const rgba = new Uint8Array(w * h * 4), depth = new Float32Array(w * h).fill(Infinity);
      projectParticles(time, camera, w, h, (dot, cx, cy, radius, z) => {
        for (let iy = Math.max(0, Math.ceil(cy - radius - .5)); iy <= Math.min(h - 1, Math.floor(cy + radius - .5)); iy++)
          for (let ix = Math.max(0, Math.ceil(cx - radius - .5)); ix <= Math.min(w - 1, Math.floor(cx + radius - .5)); ix++) {
            const p = iy * w + ix;
            if (z >= depth[p] || (ix + .5 - cx) ** 2 + (iy + .5 - cy) ** 2 > radius ** 2) continue;
            depth[p] = z;
            rgba.set(dot.rgb, p * 4);
            rgba[p * 4 + 3] = dot.alpha;
          }
      });
      return { w, h, rgba, depth };
    }
    function inspectParticle(time, camera, w, h, x, y) {
      let nearest, depth = Infinity;
      projectParticles(time, camera, w, h, (dot, cx, cy, radius, z) => {
        if (z >= depth || (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 > radius ** 2) return;
        nearest = dot;
        depth = Math.fround(z);
      });
      return nearest?.alpha ? { rgb: nearest.rgb.slice(), depth, alpha: nearest.alpha,
        event: structuredClone(rows.get(nearest.contact).hit) } : null;
    }

    function effectPass(id) {
      if (id === particlePass && [...rules.values()].some(rule => rule.particles))
        return { kind: 'particles', inspect: inspectParticle };
      const material = id.startsWith(surfacePrefix) && id.slice(surfacePrefix.length);
      if (!rules.get(material)?.chart) return null;
      return { kind: 'projected-field', material, inspect: (time, cell) => inspectField(material, time, cell) };
    }

    function bind(world) {
      check(!bound && world && !world.materialResponse?.add, 'bind the track to one world');
      const existing = world.look?.renderGraph;
      const passes = [...(existing?.passes ?? [])];
      let input = RenderGraph.prepare(existing)?.output ?? 'scene';
      for (const [name, rule] of rules) if (rule.chart) {
        const { normal, ...projection } = rule.chart;
        const id = surfacePrefix + name;
        passes.push({ id, input, type: 'composite', select: rule.select, projection,
          layer: { resolution: rule.resolution, filter: 'nearest', source: ({ time }) => raster(rule, time) } });
        input = id;
      }
      if ([...rules.values()].some(rule => rule.particles)) {
        const id = particlePass;
        passes.push({ id, input, type: 'composite', layer: { resolution: pixelSize, filter: 'nearest', needsCamera: true,
          depthTest: { mode: 'occlude', bias: .015 }, source: particleRaster } });
        input = id;
      }
      if (passes.length) {
        const graph = { ...existing, passes, output: input };
        RenderGraph.prepare(graph);
        world.look = { ...world.look, renderGraph: graph };
      }
      bound = world;
      world.materialResponse = api;
      return world;
    }
    const api = Object.freeze({ add, bind, audioTimeline, effectPass,
      createPlayback: (context, resolve) => playback(sounds, context, resolve),
      snapshot: () => ({ recipe: structuredClone(authored), contacts: contactsByTime().map(row => structuredClone(row.hit)) }),
      sounds: () => sounds().map(row => ({ ...row })),
      get revision() { return revision; },
      get duration() {
        let end = 0;
        for (const { hit, rule } of rows.values()) if (rule) end = Math.max(end, hit.time +
          Math.max(rule.mark?.duration ?? 0, rule.ripple?.duration ?? 0, rule.particles?.duration ?? 0, rule.sound ? .001 : 0));
        return end;
      } });
    const authored = structuredClone(recipe);
    return api;
  }

  function playback(read, context, resolve) {
    check(context?.createBufferSource && context?.createGain && typeof resolve === 'function',
      'browser playback needs an AudioContext and a decoded buffer resolver');
    let anchor, dispatched = new Set(), playing = new Set();
    function stop() {
      for (const source of playing) source.stop();
      playing = new Set();
      dispatched = new Set();
      anchor = undefined;
    }
    function sync() {
      if (anchor === undefined) return;
      const now = context.currentTime;
      for (const cue of read()) {
        if (dispatched.has(cue.contact) || anchor + cue.time > now + .12) continue;
        const buffer = resolve(cue.cue, cue);
        if (!buffer) continue;
        const when = anchor + cue.time, elapsed = Math.max(0, now - when);
        dispatched.add(cue.contact);
        if (elapsed >= buffer.duration) continue;
        const source = context.createBufferSource(), gain = context.createGain(), active = playing;
        source.buffer = buffer;
        gain.gain.value = cue.gain;
        source.connect(gain);
        gain.connect(context.destination);
        source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); };
        active.add(source);
        source.start(Math.max(now, when), elapsed);
      }
    }
    function seek(time) {
      check(finite(time, 0, 1e6), 'invalid playback time');
      stop();
      anchor = context.currentTime - time;
      sync();
    }
    return Object.freeze({ seek, sync, stop });
  }

  K.materialResponse = Object.freeze({ create });
})(KIT);
