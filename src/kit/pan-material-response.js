/* One timestamped contact log for projected marks, particles and sound. */
(function (K) {
  const V = K.V;
  const format = 'ink-studio/material-response';
  const surfacePrefix = 'material-response-surface/';
  const particlePass = 'material-response-particles';
  const flightPass = 'material-response-flight';
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
  const sole = [
    '...6666....', '..899998...', '.89999998..', '.899..998..', '.69999996..',
    '.89999996..', '..79..97...', '..688887...', '...5..5....',
    '...4.55....', '...78887...', '...89998...', '...89.98...',
    '...89998...', '....777....'
  ];
  function pickup(value) {
    fields(value, ['amount'], 'pickup');
    const { amount = 1 } = value;
    check(finite(amount, .001, 1), 'pickup amount must be in [.001, 1]');
    return { amount };
  }
  function transfer(value) {
    fields(value, ['from', 'fraction', 'size', 'tread', 'bands', 'duration', 'decay'], 'transfer');
    const { from, fraction = .5, size = [.22, .38], tread = sole, duration = 30, decay = 0,
      bands = [{ at: .02, color: '#a39884' }, { at: .055, color: '#887968' },
        { at: .12, color: '#75604f' }, { at: .22, color: '#654c3d' }, { at: .35, color: '#49372e' }] } = value;
    const w = tread?.[0]?.length, h = tread?.length;
    check(id(from) && finite(fraction, .001, 1) && tuple(size, 2) && size.every(n => finite(n, 1e-5, 100)) &&
      finite(duration, .001, 120) && finite(decay, 0, 1000), 'invalid transfer source, fraction, size or timing');
    check(Array.isArray(tread) && Number.isInteger(w) && finite(w, 1, 32) && finite(h, 1, 32) &&
      Array.from(tread).every(row => typeof row === 'string' && row.length === w && /^[.1-9]+$/.test(row)) &&
      tread.some(row => /[1-9]/.test(row)), 'transfer tread needs equal-width rows of dots and weights 1–9');
    const settings = FieldBands.settings({ stops: bands });
    check(settings.stops[0].at > 0, 'transfer band thresholds must be positive');
    const palette = FieldBands.bind(settings, swatch);
    const mask = { width: w, height: h, data: [...tread.join('')].map(value => value === '.' ? 0 : Number(value)/9) };
    return { from, fraction, size: size.slice(), mask, duration, decay, palette,
      first: { at: settings.stops[0].at, rgb: palette.palette[0] } };
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

  function create(recipe, { contacts = [], particleImpacts } = {}) {
    fields(recipe, ['format', 'version', 'materials', 'speedReference', 'loadReference', 'pixelSize'], 'recipe');
    const { materials, speedReference = 2, loadReference = 10, pixelSize = 1 } = recipe;
    check(recipe.format === format && recipe.version === 1 && record(materials) &&
      Object.keys(materials).length > 0 && Object.keys(materials).length <= limits.materials &&
      finite(speedReference, .001, 1e4) && finite(loadReference, .001, 1e8) &&
      Number.isInteger(pixelSize) && finite(pixelSize, 1, 16), 'expected a version 1 recipe with 1–8 materials');
    const rules = new Map(Object.entries(materials).map(([name, row]) => {
      fields(row, ['select', 'chart', 'resolution', 'mark', 'ripple', 'particles', 'sound', 'pickup', 'transfer'], 'material ' + name);
      check(id(name), 'invalid material ID');
      const rule = {
        select: TargetSelectors.prepare(row.select ?? { material: name }),
        mark: row.mark === undefined ? null : mark(row.mark, false),
        ripple: row.ripple === undefined ? null : mark(row.ripple, true),
        particles: row.particles === undefined ? null : spray(row.particles),
        sound: row.sound === undefined ? null : sound(row.sound),
        pickup: row.pickup === undefined ? null : pickup(row.pickup),
        transfer: row.transfer === undefined ? null : transfer(row.transfer)
      };
      check(rule.mark || rule.ripple || rule.particles || rule.sound || rule.pickup || rule.transfer, 'material needs a response');
      if (rule.mark || rule.ripple || rule.transfer) {
        const { resolution = [128, 128] } = row;
        check(tuple(resolution, 2) && resolution.every(n => Number.isInteger(n) && finite(n, 8, 256)),
          'projected chart resolution must be 8–256 per axis');
        const chart = RenderGraph.projection(row.chart);
        const [u, v, U, T] = chart.bounds;
        rule.chart = chart;
        rule.resolution = resolution.slice();
        rule.grid = { width: resolution[0], height: resolution[1], origin: [u, v],
          cell: [(U - u) / resolution[0], (T - v) / resolution[1]] };
        if (rule.mark || rule.ripple) rule.field = K.splatEffects.field({ ...rule.grid,
          channels: { mark: { decay: rule.mark?.decay ?? 0 }, ripple: { decay: rule.ripple?.decay ?? 0 } } });
      } else check(row.chart === undefined && row.resolution === undefined, 'a chart needs a mark, ripple or transfer');
      return [name, rule];
    }));
    const receivers = [...rules.values()].filter(rule => rule.transfer);
    for (const [material, rule] of rules) if (rule.transfer)
      check(rule.transfer.from !== material && rules.get(rule.transfer.from)?.pickup,
        'transfer on ' + material + ' needs a different source material with pickup');
    const flight = particleImpacts === undefined ? null : K.particleImpacts.compile(particleImpacts);
    const generated = flight?.contacts() ?? [], generatedIds = new Set(generated.map(hit => hit.id));
    const rows = new Map();
    let revision = 0, ordered, cues, mixed, transferState, bound;

    function add(records, { time } = {}) {
      check(Array.isArray(records) && records.length <= limits.contacts, 'expected a bounded contact list');
      const pending = new Map(), writes = new Map();
      for (const row of records) {
        check(record(row), 'expected a material contact record');
        const { id: key, interaction, material, point, speed, load = loadReference, normal = [0, 1, 0],
          heading = [1, 0, 0], entity, wheel, source, carrier, particle, receiver, time: at = time } = row;
        check(typeof key === 'string' && key.length > 0 && key.length <= 256 && kinds.includes(interaction) &&
          (material == null || typeof material === 'string') && tuple(point, 3) &&
          tuple(normal, 3) && V.len(normal) > 1e-8 && tuple(heading, 3) &&
          finite(at, 0, 1e6) && finite(speed, 0, 1e8) && finite(load, 0, 1e12) &&
          [entity, wheel, source].every(value => value == null || typeof value === 'string' && value.length <= 256) &&
          (particle === undefined && receiver === undefined || interaction === 'impact' &&
            typeof particle === 'string' && particle.length > 0 && particle.length <= 256 && id(receiver)) &&
          (carrier === undefined || typeof carrier === 'string' && carrier.length > 0 && carrier.length <= 256),
          'expected an ID, step/roll/impact, world position, speed and timestamp');
        if (rows.has(key) || pending.has(key)) continue;
        const rule = rules.get(material);
        const strength = Math.min(1, speed / speedReference * Math.sqrt(Math.min(4, load / loadReference)));
        const n = V.norm(normal), h = V.norm(V.mad(heading, n, -V.dot(heading, n)), V.perp(n));
        const hit = { id: key, interaction, material, point: point.slice(), normal: n, heading: h,
          time: at, speed, load, ...(entity != null && { entity }), ...(wheel != null && { wheel }), ...(source != null && { source }),
          ...(carrier !== undefined && { carrier }), ...(particle !== undefined && { particle, receiver }),
          ...(Number.isSafeInteger(row.tick) && { tick: row.tick }),
          ...(Number.isSafeInteger(row.appliedTick) && { appliedTick: row.appliedTick }) };
        pending.set(key, { hit, rule, strength });
        if (!rule?.field || !strength) continue;
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
        ordered = cues = mixed = transferState = undefined;
        revision++;
      }
      return pending.size;
    }
    check(Array.isArray(contacts) && contacts.every(hit => !generatedIds.has(hit?.id)),
      'authored contacts must use IDs distinct from computed particle impacts');
    add([...contacts, ...generated]);
    const contactsByTime = () => ordered ??= [...rows.values()].sort((a, b) => a.hit.time - b.hit.time ||
      (a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0));
    function impacts(time = 1e6) {
      check(finite(time, 0, 1e6), 'invalid particle impact sample time');
      return contactsByTime().filter(({hit}) => hit.particle !== undefined && hit.time <= time)
        .map(({hit}) => structuredClone(hit));
    }
    function compileTransfers() {
      if (transferState) return transferState;
      const byRule = new Map(receivers.map(rule => [rule, []]));
      const loads = new Map(), deposits = new Map(), events = [];
      for (const { hit, rule } of contactsByTime()) {
        if (hit.interaction !== 'step' || !(rule?.pickup || rule?.transfer)) continue;
        const carrier = hit.carrier ?? hit.entity;
        if (!carrier || !hit.load) continue;
        const key = hit.carrier === undefined ? JSON.stringify([hit.source, carrier]) : JSON.stringify([carrier]);
        const pressure = Math.min(1, hit.load / loadReference);
        if (!loads.has(key)) loads.set(key, new Map());
        const carried = loads.get(key);
        const info = { contact: hit.id, carrier, receiver: hit.material, time: hit.time,
          ...(hit.source !== undefined && { source: hit.source }) };
        if (rule.transfer) {
          const fx = rule.transfer, charge = carried.get(fx.from);
          const relative = V.sub(hit.point, rule.chart.origin);
          const uv = [V.dot(relative, rule.chart.u), V.dot(relative, rule.chart.v)];
          const [u, v, U, T] = rule.chart.bounds;
          const amount = (charge?.amount ?? 0) * fx.fraction * pressure;
          if (amount > 0 && Math.abs(V.dot(relative, rule.chart.normal)) <= rule.chart.reach &&
              uv[0] >= u && uv[0] < U && uv[1] >= v && uv[1] < T) {
            const before = charge.amount;
            charge.amount -= amount;
            const row = { ...info, action: 'deposit', material: fx.from, before, amount, after: charge.amount, pickup: charge.pickup };
            const direction = [V.dot(hit.heading, rule.chart.u), V.dot(hit.heading, rule.chart.v)];
            byRule.get(rule).push({
              at: uv, time: hit.time, lifetime: fx.duration, source: hit.id, shape: 'mask', mask: fx.mask, size: fx.size,
              direction: Math.hypot(...direction) > 1e-8 ? direction : [1, 0], values: { transfer: amount }
            });
            events.push(row);
            deposits.set(hit.id, row);
          }
        }
        if (rule.pickup) {
          const before = carried.get(hit.material)?.amount ?? 0;
          const amount = Math.min(1 - before, rule.pickup.amount * pressure);
          if (amount > 0) {
            carried.set(hit.material, { amount: before + amount, pickup: hit.id });
            events.push({ ...info, action: 'pickup', material: hit.material, before, amount, after: before + amount });
          }
        }
      }
      const fields = new Map([...byRule].map(([rule, stamps]) => [rule,
        K.splatEffects.field({ ...rule.grid, channels: { transfer: { decay: rule.transfer.decay } }, stamps })]));
      return transferState = { fields, events, deposits };
    }

    function transfers(time = 1e6) {
      check(finite(time, 0, 1e6), 'invalid transfer sample time');
      return compileTransfers().events.filter(row => row.time <= time).map(row => ({ ...row }));
    }
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
      const frame = rule.field?.frame(time), rgba = new Uint8Array(w * h * 4);
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
      if (rule.transfer) {
        const plane = compileTransfers().fields.get(rule).frame(time).data('transfer');
        for (let i = 0; i < plane.length; i++) {
          const band = rule.transfer.palette.sample(plane[i]);
          if (!band) continue;
          rgba.set(band.rgb, i * 4);
          rgba[i * 4 + 3] = 255;
        }
      }
      return { w, h, rgba };
    }

    function inspectField(material, time, cell) {
      const rule = rules.get(material);
      const frame = cell && rule.field?.frame(time);
      const channels = ['mark', 'ripple'].filter(kind => rule[kind]).map(kind => {
        const { threshold, rgb } = rule[kind];
        const sample = frame && frame.traceCell(kind, ...cell);
        const event = sample?.source && rows.get(sample.source)?.hit;
        return { kind, rgb: rgb.slice(), threshold, sample: sample ? {
          value: sample.value, contributors: sample.contributors, uv: sample.uv,
          event: event ? structuredClone(event) : null
        } : null };
      });
      if (rule.transfer) {
        const state = cell && compileTransfers();
        const sample = state && state.fields.get(rule).frame(time).traceCell('transfer', ...cell);
        const event = sample?.source && rows.get(sample.source)?.hit;
        const deposit = sample?.source && state.deposits.get(sample.source);
        const band = (sample && rule.transfer.palette.sample(sample.value)) ?? rule.transfer.first;
        channels.push({ kind: 'transfer', rgb: band.rgb.slice(), threshold: band.at, sample: sample ? {
          value: sample.value, contributors: sample.contributors, uv: sample.uv,
          event: event ? structuredClone(event) : null, transfer: deposit ? { ...deposit } : null
        } : null });
      }
      return channels;
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
    function projectParticles(particles, camera, w, h, draw) {
      const project = DrawingPrimitives.projector(camera, w, h);
      for (const dot of particles) {
        const view = project.toView(dot.point);
        if (!project.visible(view)) continue;
        const [x, y] = project.point(view);
        const radius = Math.min(24, Math.max(.5, dot.radius * project.pixelsPerUnit(view, [0, 1])));
        const cx = Math.floor(x) + .5, cy = Math.floor(y) + .5;
        draw(dot, cx, cy, radius, view[2]);
      }
    }
    function particleRaster({ w, h, time, camera }, particles = particlesAt(time)) {
      const rgba = new Uint8Array(w * h * 4), depth = new Float32Array(w * h).fill(Infinity);
      projectParticles(particles, camera, w, h, (dot, cx, cy, radius, z) => {
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
      projectParticles(particlesAt(time), camera, w, h, (dot, cx, cy, radius, z) => {
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
      if (flight) {
        passes.push({ id: flightPass, input, type: 'composite', layer: { resolution: pixelSize, filter: 'nearest',
          needsCamera: true, depthTest: { mode: 'occlude', bias: .015 }, source: ctx => particleRaster(ctx, flight.frame(ctx.time)) } });
        input = flightPass;
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
    const api = Object.freeze({ add, bind, audioTimeline, effectPass, transfers, impacts,
      createPlayback: (context, resolve) => playback(sounds, context, resolve),
      snapshot: () => ({ recipe: structuredClone(authored),
        contacts: contactsByTime().filter(({hit}) => !generatedIds.has(hit.id)).map(({hit}) => structuredClone(hit)),
        ...(flight && { particleImpacts: flight.snapshot() }) }),
      sounds: () => sounds().map(row => ({ ...row })),
      get revision() { return revision; },
      get duration() {
        let end = flight?.duration ?? 0;
        for (const { hit, rule } of rows.values()) if (rule) end = Math.max(end, hit.time +
          Math.max(rule.mark?.duration ?? 0, rule.ripple?.duration ?? 0, rule.particles?.duration ?? 0, rule.sound ? .001 : 0));
        if (receivers.length) for (const deposit of compileTransfers().deposits.values())
          end = Math.max(end, deposit.time + rules.get(deposit.receiver).transfer.duration);
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
