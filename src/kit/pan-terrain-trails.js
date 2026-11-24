/* One seekable contact field, with independent reactions on a native terrain raster. */
(function (K) {
  const channels = Object.freeze(['print', 'press', 'ripple']);
  const presets = {
    print: { bands: [[.12, '#a08469'], [.36, '#795f4f'], [.62, '#523f3c']] },
    press: { shift: [2, 2] },
    ripple: { bands: [[.14, '#417d81'], [.34, '#6ab4aa'], [.56, '#addec3']] }
  };
  const record = value => value != null && Object.getPrototypeOf(value) === Object.prototype;
  const bounded = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const point = value => Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);
  const bytes = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Terrain trails: ' + message);
  };

  function response(value) {
    check(record(value) && channels.includes(value.kind), 'each reaction needs a print, press or ripple kind');
    const { kind, bands = presets[kind].bands, shift = presets[kind].shift } = value;
    if (kind === 'press') {
      check(point(shift) && shift.every(n => Number.isInteger(n) && Math.abs(n) <= 32),
        'press shift needs two signed whole-pixel offsets of up to 32');
      return { kind, shift: shift.slice() };
    }
    check(Array.isArray(bands) && bands.length >= 1 && bands.length <= 16, 'expected 1–16 swatch bands');
    const colors = Array.from(bands, (band, i) => {
      check(Array.isArray(band) && band.length === 2 && bounded(band[0], .001, 1) &&
        (!i || band[0] > bands[i - 1][0]), 'swatch bands need increasing thresholds in (0, 1]');
      return [band[0], ColorCurves.color(band[1]).map(n => Math.round(n * 255))];
    });
    return { kind, colors };
  }

  function create({ width, height, cell = 1, origin = [0, 0], contacts = [],
    print: printOptions = {}, press: pressOptions = {}, ripple: rippleOptions = {} } = {}) {
    function shape(options, defaults) {
      check(record(options) && Object.keys(options).every(key => Object.hasOwn(defaults, key)), 'unknown contact shape setting');
      const settings = { ...defaults, ...options };
      check(bounded(settings.radius, 1e-5, 1e4) && bounded(settings.duration, .001, 3600) &&
        bounded(settings.decay, 0, 1000), 'invalid contact radius, duration or decay');
      return settings;
    }
    check(Number.isFinite(cell) || point(cell), 'cell must be a finite size or UV size pair');
    const spacing = Array.isArray(cell) ? cell.slice() : cell;
    const unit = Array.isArray(spacing) ? Math.min(spacing[0], spacing[1]) : spacing;
    check(point(origin), 'origin must be a finite UV pair');
    const grid = { width, height, cell: spacing, origin: origin.slice() };
    const print = shape(printOptions, { radius: 3.4 * unit, duration: 4, decay: .35 });
    const press = shape(pressOptions, { radius: 11 * unit, duration: 1.3, decay: 1.8 });
    const ripple = shape(rippleOptions, {
      radius: 2.5 * unit, duration: 1.15, decay: .65, speed: 19 * unit, width: 1.6 * unit
    });
    check(bounded(ripple.speed, 0, 1e4) && bounded(ripple.width, 1e-5, 1e4), 'invalid ripple speed or width');
    const horizon = Math.max(print.duration, press.duration, ripple.duration);
    const settings = { print: { decay: print.decay }, press: { decay: press.decay }, ripple: { decay: ripple.decay } };
    const limit = 1024;

    function contact(row) {
      const { at, time, strength = 1, channels: writes = channels } = row ?? {};
      check(record(row) && point(at) && bounded(time, -1e6, 1e6) && bounded(strength, 0, 1) &&
        Array.isArray(writes) && writes.length >= 1 && writes.length <= channels.length &&
        Array.from(writes).every(name => channels.includes(name)) && new Set(writes).size === writes.length,
      'expected a finite UV contact, time in seconds, optional strength in [0, 1] and distinct channel names');
      return { at: at.slice(), time, strength, writes: writes.slice() };
    }
    check(Array.isArray(contacts) && contacts.length <= limit, 'at most 1024 contacts may be retained');
    let rows = Array.from(contacts, contact), revision = 0;
    function stamps({ at, time, strength, writes }) {
      const shapes = {
        print: { at, time, radius: print.radius, lifetime: print.duration, values: { print: strength } },
        press: { at, time, radius: press.radius, lifetime: press.duration, values: { press: strength } },
        ripple: { at, time, radius: ripple.radius, lifetime: ripple.duration, values: { ripple: strength },
          shape: 'ring', width: ripple.width, speed: ripple.speed }
      };
      return writes.map(name => shapes[name]);
    }
    function compile() {
      return K.splatEffects.field({ ...grid, channels: settings, stamps: rows.flatMap(stamps) });
    }
    let compiled = compile();
    function frame(time) {
      compiled ??= compile();
      return compiled.frame(time);
    }

    function stamp(row) {
      const hit = contact(row);
      check(rows.length < limit, 'contact limit reached, prune expired contacts or clear before adding more');
      compiled?.stampMany(stamps(hit));
      rows.push(hit);
      revision++;
    }

    function prune(before) {
      check(bounded(before, -1e6, 1e6), 'prune time must be finite');
      const keep = rows.filter(row => before - row.time < horizon);
      const removed = rows.length - keep.length;
      if (removed) {
        rows = keep;
        revision++;
        compiled = undefined;
      }
      return removed;
    }

    function clear() {
      rows = [];
      revision++;
      compiled?.clear();
    }

    function paint({ raster, materials, reactions } = {}) {
      const size = width * height;
      check(raster?.w === width && raster.h === height && bytes(raster.rgba) && raster.rgba.length === size * 4 &&
        bytes(materials) && materials.length === size && record(reactions),
      'paint needs matching RGBA pixels, byte material IDs and a reaction map');
      const base = new Uint8Array(raster.rgba), receivers = new Uint8Array(materials);
      const styles = Object.entries(reactions).reduce((map, [id, style]) => {
        check(String(Number(id)) === id && bounded(Number(id), 0, 255) && Number.isInteger(Number(id)),
          'reaction keys must be byte material IDs');
        map[id] = response(style);
        return map;
      }, new Array(256));
      const used = [...new Set(styles.flatMap(style => [style.kind]))];

      function render(time) {
        const snapshot = frame(time);
        const planes = Object.fromEntries(used.map(kind => [kind, snapshot.data(kind)]));
        const rgba = base.slice();
        for (let i = 0; i < size; i++) {
          const style = styles[receivers[i]], p = i * 4;
          if (!style || !base[p + 3]) continue;
          const amount = planes[style.kind][i];
          if (style.kind === 'press') {
            if (!amount) continue;
            const x = i % width + Math.round(amount * style.shift[0]);
            const y = Math.floor(i / width) + Math.round(amount * style.shift[1]);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const j = y * width + x, q = j * 4;
            if (receivers[j] === receivers[i] && base[q + 3]) {
              rgba[p] = base[q];
              rgba[p + 1] = base[q + 1];
              rgba[p + 2] = base[q + 2];
            }
          } else {
            for (let band = style.colors.length - 1; band >= 0; band--) {
              const [threshold, color] = style.colors[band];
              if (amount < threshold) continue;
              rgba.set(color, p);
              break;
            }
          }
        }
        return { w: width, h: height, rgba };
      }

      function layer({ rect, clock = 'scene' } = {}) {
        check(['scene', 'interface'].includes(clock), 'layer clock must be scene or interface');
        return {
          resolution: [width, height], filter: 'nearest', ...(rect !== undefined && { rect }),
          source({ time, sceneTime }) { return render(clock === 'scene' ? sceneTime ?? time : time); }
        };
      }
      return Object.freeze({ render, layer });
    }

    const field = Object.freeze({ channels, frame, get revision() { return revision; } });
    return Object.freeze({ field, stamp, prune, clear, paint });
  }

  K.terrainTrails = Object.freeze({ create });
})(KIT);
