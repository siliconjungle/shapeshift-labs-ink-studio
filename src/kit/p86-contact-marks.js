/* Native-pixel impacts selected from measured contact and view directions. */
(function (K) {
  const V = K.V, stamps = K.pixelStamps;
  const kinds = ['direct', 'glancing'], sizes = ['small', 'large'];
  const names = kinds.flatMap(kind => sizes.flatMap(size =>
    ['east', 'ne'].map(angle => 'contact-' + kind + '-' + size + '-' + angle)));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const durationEpsilon = 1e-9;
  function check(ok, message) {
    if (!ok) throw new RangeError('Contact marks: ' + message);
  }
  function rotate(slots, size, turns) {
    let source = slots;
    for (let turn = 0; turn < turns; turn++) {
      const result = new Array(source.length);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        result[x * size + size - 1 - y] = source[y * size + x];
      source = result;
    }
    return source;
  }
  function octant(hit, project, origin) {
    for (const axis of [hit.direction, hit.secondary]) {
      const next = project(V.mad(hit.at, axis, .01));
      const dx = next[0] - origin[0], dy = next[1] - origin[1];
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 1e-5)
        return Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7;
    }
    return 6;
  }
  function activeAge(hit, time) {
    let age = time - hit.time;
    if (age < -durationEpsilon || !Number.isFinite(age)) return null;
    age = Math.max(0, age);
    if (hit.period !== undefined) {
      age %= hit.period;
      if (hit.period - age <= durationEpsilon) age = 0;
    }
    return age + durationEpsilon < hit.art.duration ? age : null;
  }

  function create({ directAt = .7, largeAt = .67, speedReference = 6, lift = .02,
    keepSwatches = true, swatches, clips = {} } = {}, colors = {}) {
    check(bounded(directAt, 0, 1) && bounded(largeAt, 0, 1) && bounded(speedReference, .001, 1e8) &&
      bounded(lift, 0, 10) && typeof keepSwatches === 'boolean' && record(clips) &&
      Object.keys(clips).every(id => names.includes(id)), 'invalid thresholds, lift, swatches or custom clip IDs');
    const authored = structuredClone(clips), palette = structuredClone(swatches);
    const families = new Map();
    function family(kind, scale) {
      const key = 'contact-' + kind + '-' + scale;
      if (families.has(key)) return families.get(key);
      const art = ['east', 'ne'].map(angle => {
        const id = key + '-' + angle;
        return stamps.prepare(authored[id] ?? stamps.clip(id, { swatches: palette }));
      });
      const [straight, diagonal] = art, { width, height, entries, duration } = straight;
      check(width === height && width % 2 === 1 && width <= 63 && diagonal.width === width && diagonal.height === height &&
        entries.length <= 32 && diagonal.entries.length === entries.length &&
        JSON.stringify(straight.palette) === JSON.stringify(diagonal.palette) &&
        art.every(clip => clip.entries.every((row, i) => row.duration === entries[i].duration &&
          bounded(row.duration, .0001, 60))), 'horizontal and diagonal clips need matching odd square grids, palettes and cel holds');
      const frames = Array.from({ length: 8 }, (_, dir) => {
        const turns = dir % 2 ? ((dir + 1) % 8) / 2 : dir / 2;
        return art[dir % 2].entries.map(({ slots, duration }) => ({ slots: rotate(slots, width, turns), duration }));
      }).flat();
      const spec = { width, height, frames, palette: straight.palette };
      const clock = SpriteCels.playback(entries, 12, 'once');
      const frameAt = (age, dir) => dir * entries.length + clock(age + durationEpsilon);
      let atlas;
      const images = new Map();
      const result = {
        width, duration, frameAt,
        atlas: () => atlas ??= stamps.atlas(spec, { ...colors, keepSwatches }),
        image(index) {
          if (!images.has(index))
            images.set(index, stamps.image({ width, height, slots: frames[index].slots, palette: spec.palette }, colors));
          return images.get(index);
        }
      };
      families.set(key, result);
      return result;
    }

    function contact(row) {
      check(record(row), 'each cue needs a material contact record');
      const { point, normal, heading, velocity, kind = 'auto', size = 'auto', strength,
        speed, time = 0, period, objectId, materialId } = row;
      check(vector(point) && vector(normal) && bounded(V.len(normal), 1e-8, 1e8) &&
        (heading === undefined || vector(heading) && bounded(V.len(heading), 0, 1e8)) &&
        (velocity === undefined || vector(velocity) && bounded(V.len(velocity), 0, 1e8)) &&
        ['auto', ...kinds].includes(kind) && ['auto', ...sizes].includes(size) &&
        (strength === undefined || bounded(strength, 0, 1)) && (speed === undefined || bounded(speed, 0, 1e8)) &&
        Number.isFinite(time), 'expected a point, nonzero normal, optional heading or velocity, and valid cue options');
      const n = V.norm(normal), v = velocity && V.len(velocity) > 1e-8 ? V.norm(velocity) : null;
      const incidence = v ? Math.max(0, -V.dot(n, v)) : 1;
      const familyKind = kind === 'auto' ? incidence >= directAt ? 'direct' : 'glancing' : kind;
      const power = strength ?? Math.min(1, (speed ?? (velocity ? V.len(velocity) : speedReference)) / speedReference);
      const scale = size === 'auto' ? power >= largeAt ? 'large' : 'small' : size;
      const art = family(familyKind, scale);
      check(period === undefined || Number.isFinite(period) && period >= art.duration - durationEpsilon,
        'repeat periods must cover the full contact clip');
      const along = heading ?? v ?? V.perp(n);
      const tangent = V.norm(V.mad(along, n, -V.dot(along, n)), V.perp(n));
      const direct = familyKind === 'direct';
      return { at: V.mad(point, n, lift), direction: direct ? n : tangent, secondary: direct ? tangent : n,
        kind: familyKind, size: scale, time, period, art, objectId, materialId };
    }
    function track(contacts) {
      check(Array.isArray(contacts) && contacts.length <= 128, 'a track accepts up to 128 contacts');
      const hits = Array.from(contacts, contact);
      function placements() {
        return hits.map(hit => AtlasSprites.place({
          atlas: hit.art.atlas(), at: hit.at, mode: 'card', nativePixels: true, clock: 'interface',
          objectId: hit.objectId, materialId: hit.materialId,
          visibleAt: time => activeAge(hit, time) !== null,
          frame: (time, view) => {
            const dir = view?.project ? octant(hit, view.project, view.project(hit.at)) : 0;
            return hit.art.frameAt(activeAge(hit, time) ?? 0, dir);
          }
        }));
      }
      function layer({ resolution } = {}) {
        return { ...(resolution !== undefined && { resolution }), filter: 'nearest', needsCamera: true,
          source({ w, h, time, camera }) {
            const rgba = new Uint8Array(w * h * 4);
            const active = hits.map(hit => ({ hit, age: activeAge(hit, time) })).filter(row => row.age !== null);
            if (!active.length) return { w, h, rgba };
            const view = DrawingPrimitives.projector(camera, w, h);
            const project = point => {
              const p = view.toView(point);
              return [...view.point(p), p[2]];
            };
            const visible = active.map(row => ({ ...row, origin: project(row.hit.at) }))
              .filter(({ origin }) => view.visible(origin)).sort((a, b) => b.origin[2] - a.origin[2]);
            for (const { hit, age, origin } of visible) {
              const index = hit.art.frameAt(age, octant(hit, project, origin));
              const image = hit.art.image(index), half = hit.art.width / 2;
              const left = Math.round(origin[0] - half), top = -Math.round(half - origin[1]);
              for (let y = Math.max(0, -top); y < Math.min(image.height, h - top); y++)
                for (let x = Math.max(0, -left); x < Math.min(image.width, w - left); x++) {
                  const at = (y * image.width + x) * 4;
                  if (image.rgba[at + 3])
                    rgba.set(image.rgba.subarray(at, at + 4), ((y + top) * w + left + x) * 4);
                }
            }
            return { w, h, rgba };
          }
        };
      }
      return Object.freeze({ placements, layer,
        hits: Object.freeze(hits.map(({ kind, size, time, period }) => Object.freeze({ kind, size, time, period }))) });
    }
    function fromEvents(events, { name = 'contact-mark', period } = {}) {
      check(Array.isArray(events) && events.length <= 10000 && typeof name === 'string' && name.length > 0,
        'expected a named clip-event track');
      return track(events.filter(event => event?.name === name).map(event => {
        check(record(event.data) && Number.isFinite(event.time), 'matching events need contact data and a time');
        return { ...event.data, time: event.time, period: event.data.period ?? period };
      }));
    }
    function fromClip(clip, options) {
      check(typeof clip?.eventsBetween === 'function' && bounded(clip.dur, .0001, 1e8),
        'expected a native animation clip');
      const events = clip.eventsBetween(-1, clip.dur, { playback: 'once' });
      return fromEvents(events.map(event => ({ ...event, time: K.anim.wallTime(clip, event.sourceTime) })), options);
    }
    return Object.freeze({ track, fromEvents, fromClip });
  }
  K.contactMarks = Object.freeze({ create });
})(KIT);
