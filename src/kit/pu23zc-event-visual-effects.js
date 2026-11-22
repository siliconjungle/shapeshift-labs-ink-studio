/* Sample committed events as read-only world and patch effects. */
(function (K) {
  const W = K.world, P = K.procedural, T = P.takeTime, V = K.V;
  const cues = W.presentationCues, { check, record, copy, id } = W.data;
  const { freeze } = P.data;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const format = 'ink-studio/event-visual-effects', planFormat = format + '-plan';
  const up = [0, 1, 0], zero = [0, 0, 0];
  const common = ['point', 'offset', 'duration', 'attack', 'release', 'value', 'range'];
  const styles = {
    light: ['color', 'radius', 'intensity'],
    fog: ['color', 'radius', 'density', 'height'],
    particles: ['color', 'radius', 'count', 'speed'],
    contact: ['color', 'radius', 'count', 'speed', 'normal', 'heading'],
    mark: ['color', 'normal', 'heading', 'pattern', 'length', 'width', 'reach', 'select'],
    shader: [],
    palette: ['channel', 'colors', 'threshold', 'geometry']
  };
  const channels = ['fog', 'clouds', 'sky', 'emission', 'shadow', 'bounce'];
  const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const point = p => W.data.vector(p) && p.every(n => Math.abs(n) <= 1e7);
  const axis = p => point(p) && V.len(p) > 1e-7;
  const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const clamp = value => Math.max(0, Math.min(1, value));

  function details(kind, detail) {
    check(Object.hasOwn(styles, kind) && fields(detail, [...common, ...styles[kind]]), 'Invalid effect details for ' + kind);
    const { point: at, offset = zero, duration = 1, attack = 0, release = 0,
      value = 1, range = [0, 1], normal = up, heading = [1, 0, 0] } = detail;
    check(point(at) && point(offset) && bounded(duration, .001, 86400) &&
      bounded(attack, 0, duration) && bounded(release, 0, duration) &&
      T.compare(T.add(T.read(attack), T.read(release)), T.read(duration)) <= 0 &&
      bounded(value, -1e12, 1e12) && Array.isArray(range) && range.length === 2 &&
      range.every(n => bounded(n, -1e12, 1e12)) && range[0] < range[1],
    'Effect ' + kind + ' needs a recorded XYZ point, finite value and valid timing and range');
    const base = { at: V.add(at, offset), point: at, duration, attack, release, value,
      gain: clamp((value - range[0]) / (range[1] - range[0])) };
    if (kind === 'shader') return base;
    if (kind === 'palette') {
      const { channel, colors, threshold = .25, geometry = false } = detail;
      check(channels.includes(channel) && Array.isArray(colors) && colors.length >= 1 && colors.length <= 64 &&
        colors.every(color) && bounded(threshold, 0, 1) && typeof geometry === 'boolean', 'Invalid event palette');
      return { ...base, channel, colors, threshold, geometry };
    }
    const tint = detail.color ?? '#ffda8f';
    check(color(tint), 'Effect color needs #rrggbb');
    if (kind === 'mark') {
      const { pattern = 'scuff', length = .6, width = .28, reach = .25, select } = detail;
      check(axis(normal) && axis(heading) && ['scuff','soot','tide-line','repair'].includes(pattern) &&
        [length, width].every(n => bounded(n, .005, 12)) && bounded(reach, .005, 3), 'Invalid event surface mark');
      if (select !== undefined) TargetSelectors.prepare(select);
      return { ...base, color: tint, normal: V.norm(normal), heading: V.norm(heading), pattern, length, width, reach, ...(select !== undefined && { select }) };
    }
    const radius = detail.radius ?? (kind === 'light' || kind === 'fog' ? 1 : .045);
    check(bounded(radius, .005, 50), 'Invalid effect radius');
    if (kind === 'light') {
      const intensity = detail.intensity ?? 6;
      check(bounded(intensity, 0, 64), 'Invalid event light intensity');
      return { ...base, color: tint, radius, intensity };
    }
    if (kind === 'fog') {
      const { density = 2, height = radius * .48 } = detail;
      check(bounded(density, 0, 32) && bounded(height, .005, 50), 'Invalid event fog density or height');
      return { ...base, color: tint, radius, density, height };
    }
    const { count = 28, speed = 2 } = detail;
    check(Number.isSafeInteger(count) && bounded(count, 1, 192) && bounded(speed, 0, 50) &&
      axis(normal) && axis(heading), 'Invalid particle burst or contact direction');
    return { ...base, color: tint, radius, count, speed, normal: V.norm(normal), heading: V.norm(heading) };
  }

  function rules(plan) {
    check(fields(plan, ['format', 'version', 'id', 'rules']) && plan.format === planFormat && plan.version === 1 &&
      id(plan.id) && record(plan.rules) && Object.values(plan.rules).every(rule =>
        Object.hasOwn(styles, rule?.cue?.kind) && rule.cue.assets === undefined), 'Expected a version 1 event visual effects plan');
    // Reuse the cue compiler for matching, pointer validation and exact timing.
    // Defaults resolve from a transient view of the event, with explicit binding overrides.
    return { ...plan, format: cues.planFormat, rules: Object.fromEntries(Object.entries(plan.rules).map(([key, rule]) => {
      const { kind, detail = {}, bindings, ...cue } = rule.cue;
      check(record(detail) && (bindings === undefined || record(bindings)), 'Invalid event visual effect template ' + key);
      const mapped = { ...bindings };
      const context = { point: zero, normal: up, heading: [1, 0, 0] };
      const defaults = kind === 'contact' || kind === 'mark' ? Object.keys(context) : ['point'];
      const template = { ...detail, point: zero };
      for (const name of defaults) {
        if (Object.hasOwn(detail, name)) template[name] = detail[name];
        else {
          template[name] = context[name];
          mapped['/' + name] ??= '/visual/' + name;
        }
      }
      check(mapped['/point'] !== undefined || Object.keys(mapped).some(path => path.startsWith('/point/')),
        'Effect ' + key + ' needs a point bound to the event');
      // Validate literal fields even if the selector matches no event.
      details(kind, template);
      return [key, { ...rule, cue: { ...cue, kind, detail: template, bindings: mapped } }];
    })) };
  }

  function located(event, query) {
    const p = event.payload, sites = [p.contact, p.impact, p, p.at, p.fact?.at, p.custody?.at, p.visit?.at];
    for (const site of sites) {
      const at = point(site) ? site : point(site?.point) ? site.point : undefined;
      if (at) return { ...event, visual: { point: at, normal: site.normal ?? p.normal ?? up,
        heading: site.heading ?? p.heading ?? [1, 0, 0] } };
    }
    const site = sites.find(row => id(row?.entity) && (row.socket === undefined || id(row.socket)));
    const at = site && query?.target({ entity: site.entity, socket: site.socket })?.point;
    return { ...event, visual: { ...(at && { point: at }), normal: p.normal ?? up, heading: p.heading ?? [1, 0, 0] } };
  }

  function sheetFrom(log, plan) {
    const sheet = freeze({ format, version: 1, id: plan.id, presentationCues: cues.project(log, plan) });
    open(sheet);
    return sheet;
  }

  function project(source, definition) {
    const plan = rules(definition), log = W.storyEvents.envelopes(source);
    return sheetFrom({ ...log, events: log.events.map(event => located(event)) }, plan);
  }

  async function replay(source, definition) {
    const plan = copy(rules(definition)), kinds = new Set(Object.values(plan.rules).map(rule => rule.on?.kind));
    const { world, tick: from, dropped } = source.origin;
    const events = [];
    let bytes = 0;
    await W.storySceneTimeline.scan(source, (event, _, query) => {
      if (!kinds.has(event.kind)) return;
      const row = located(event, query);
      bytes += JSON.stringify(row).length;
      check(events.length < 110000 && bytes <= 32 * 1024 * 1024, 'Effect event selection exceeds its budget');
      events.push(row);
    });
    return sheetFrom({ format: W.storyEvents.envelopeFormat, version: 1, world: world.id, dt: world.dt, from: 0,
      to: source.end.tick, coverage: from ? 'retained' : 'complete', dropped: from ? dropped : 0, events,
      ...(world.takeClock && { simulationRate: world.takeClock.simulationRate }) }, plan);
  }

  function open(input) {
    check(fields(input, ['format', 'version', 'id', 'presentationCues']) && input.format === format && input.version === 1 &&
      id(input.id), 'Expected a version 1 event visual effects sheet');
    const sheet = cues.read(freeze(copy(input.presentationCues)));
    check(sheet.id === input.id, 'Effect sheet ID differs from its cue track');
    const rows = sheet.cues.map(row => {
      check(row.source && row.beatId, 'Every effect must reference its committed event');
      const start = T.read(row.timecode ?? row.time), spec = details(row.kind, row.detail);
      return { row, spec, start, end: T.add(start, T.read(spec.duration)) };
    }).sort((a, b) => T.compare(a.start, b.start));
    function sample(time, { world, stream, branch, throughTick = Infinity } = {}) {
      const at = T.read(time), active = [];
      for (const { row, spec, start, end } of rows) {
        if (T.compare(at, start) < 0) break;
        const source = row.source;
        if (T.compare(at, end) >= 0 || source.tick > throughTick || (world !== undefined && source.world !== world) ||
          (branch && source.branch !== branch) ||
          (world !== undefined && source.branch !== W.committedEvents.branchAt(stream, source.tick))) continue;
        const age = T.seconds(T.sub(at, start)), remaining = T.seconds(T.sub(end, at));
        const weight = Math.min(1, spec.attack ? age / spec.attack : 1, spec.release ? remaining / spec.release : 1);
        active.push({ id: row.id, kind: row.kind, target: row.target ?? 'main', beatId: row.beatId,
          ...(row.rule && { rule: row.rule }),
          source, age, amount: spec.gain * weight, ...spec });
      }
      return freeze({ time: T.seconds(at), timecode: T.pack(at), active });
    }
    return Object.freeze({ sample, source: sheet.source });
  }

  function visible(value, kind, limit = 24) {
    const rows = value.active.filter(row => row.kind === kind && row.amount > 0);
    check(rows.length <= limit, 'Too many simultaneous event ' + kind + ' effects. Narrow the plan or shorten the lifetimes.');
    return rows;
  }

  function stamp(B, value) {
    for (const kind of ['particles', 'contact']) {
      for (const row of visible(value, kind)) {
        const { at, normal, heading, radius, age, amount } = row;
        const slot = paletteSlot(row.color, B.P), rgb = B.P[slot], start = B.count();
        // A committed cue owns its random stream, independent of frame and other cues.
        const seed = P.data.hash(row.beatId + '/' + (row.rule ?? row.id), 1);
        const random = Randomness.create(seed).stream('particles').next;
        const tangent = V.norm(V.mad(heading, normal, -V.dot(heading, normal)), V.perp(normal));
        const side = V.cross(normal, tangent);
        const count = Math.ceil(row.count * row.gain);
        const travel = Math.min(age, 1.25);
        for (let i = 0; i < count; i++) {
          const angle = random() * 2 * Math.PI, speed = row.speed * (.45 + .55 * random());
          const u = kind === 'contact' ? -.4 - .6 * random() : Math.cos(angle);
          const v = kind === 'contact' ? Math.sin(angle) * .72 : Math.sin(angle);
          const drift = V.add(V.mul(tangent, u), V.mul(side, v));
          const lift = Math.max(0, speed * travel * (.48 + .53 * random()) - 2.35 * travel * travel);
          const p = V.mad(V.mad(at, drift, speed * travel), normal, radius + lift);
          B.iso(...p, radius * (.7 + .6 * random()), rgb, amount * .95, { nd: true });
        }
        if (kind === 'contact') {
          const spread = radius * 3 + Math.min(age, .45) * row.speed * .58;
          for (let i = 0; i < 24; i++) {
            const angle = (i / 24) * 2 * Math.PI;
            const flat = V.add(V.mul(tangent, Math.cos(angle)), V.mul(side, Math.sin(angle)));
            const p = V.mad(V.mad(at, flat, spread), normal, .014);
            B.disc(...p, normal, radius * 1.15, .012, rgb, amount * 1.9);
          }
        }
        B.describeSplats?.(start, B.count(), { material: 'event-' + kind, target: { surface: 'event-' + kind } });
      }
    }
  }

  function paletteSlot(tint, palette) {
    const n = parseInt(tint.slice(1), 16);
    return PixelLook.nearest([n >> 16, (n >> 8) & 255, n & 255], palette, true);
  }

  function paint(B, value, palette) {
    const rows = visible(value, 'mark', 16);
    if (!rows.length) return;
    const renderSdfs = B.renderSdfSources();
    if (!renderSdfs.length) return { marks: rows.map(row => ({ id: row.id, samples: 0 })) };
    const layers = rows.map(row => ({
      id: 'event-fx-' + row.id, kind: 'imprint', point: row.at, normal: row.normal, heading: row.heading,
      pattern: row.pattern, length: row.length, width: row.width, reach: row.reach, select: row.select,
      color: paletteSlot(row.color, B.P), opacity: row.amount, spacing: Math.max(.028, row.length / 36, row.width / 28)
    }));
    const baked = K.surfaceMarks.bake({ renderSdfs, pal: palette }, { layers, maxWork: 1800000 }).layers;
    return {
      paint: { layers: baked.filter(layer => layer.decals.length) },
      marks: baked.map((layer, i) => ({ id: rows[i].id, samples: layer.decals.length }))
    };
  }

  function optics(scene, value) {
    const authored = scene.areaLights || [];
    const names = new Set(authored.map(light => light.id));
    const lights = visible(value, 'light', 16 - authored.length).map(row => {
      let id = 'event-fx-' + row.id;
      while (names.has(id)) id += '-fx';
      names.add(id);
      return { id, shape: 'disk', at: row.at, normal: [0, -1, 0], size: [row.radius * .35, row.radius * .35],
        color: row.color, intensity: row.intensity * row.amount, radius: row.radius,
        visible: false, shadows: false, volumeIntensity: row.intensity * row.amount };
    });
    if (lights.length) scene.areaLights = [...authored, ...lights];
    const fog = visible(value, 'fog').map(row => {
      const size = [row.radius, row.height, row.radius];
      const bounds = { min: V.sub(row.at, size), max: V.add(row.at, size) };
      return K.atmosphere.field({ density: row.density * row.amount, color: row.color,
        step: Math.min(...size) * .18, field: { bounds, sample(x, y, z) {
          const r = Math.hypot((x - row.at[0]) / size[0], (y - row.at[1]) / size[1], (z - row.at[2]) / size[2]);
          return clamp((1 - r) * 3);
        } } });
    });
    if (fog.length) scene.shapedAtmosphere = [...(scene.shapedAtmosphere || []), ...fog];
    const ramps = visible(value, 'palette');
    if (ramps.length) {
      const effectPalettes = { ...scene.look?.effectPalettes };
      for (const row of ramps) effectPalettes[row.channel] =
        { colors: row.colors, geometry: row.geometry, threshold: 1 - row.amount * (1 - row.threshold) };
      scene.look = { ...scene.look, effectPalettes };
    }
  }

  W.eventVisualEffects = Object.freeze({ format, planFormat, project, replay, open, stamp, paint, optics, visible });
  P.graph.operations = Object.freeze({ ...P.graph.operations, 'scene.eventEffects': {
    description: 'Sample a committed visual effects sheet and route a named shader cue to a patch.',
    inputs: { sheet: 'record', channel: { type: 'string', default: 'main' }, branch: { type: 'string', default: '' } },
    outputs: { value: 'record', active: 'array<record>', amount: 'number', position: 'vec3', shader: 'record' },
    time: true,
    instantiate() {
      let source, track;
      const use = ({ sheet, channel, branch }, { time, take }) => {
        if (sheet !== source) { track = open(sheet); source = sheet; }
        const value = track.sample(take === undefined ? time : T.pack(T.requireFrame(take).start), { branch });
        const shader = value.active.findLast(row => row.kind === 'shader' && row.target === channel);
        return { value, active: value.active, amount: shader?.amount ?? 0, position: shader?.at ?? zero, shader: shader ?? {} };
      };
      use.clear = () => { source = track = undefined; };
      return use;
    }
  } });
})(KIT);
