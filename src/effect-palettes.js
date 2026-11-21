/* Per-effect output ramps, selected by visible coverage on the native art grid. */
const EffectPalettes = (() => {
  const pixel = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  let colorSpace, targets;
  try {
    colorSpace = ColorSpace;
    targets = TargetSelectors;
  } catch {
    colorSpace = require('./color-space.js');
    targets = require('./target-selectors.js');
  }
  const kinds = Object.freeze(['fog', 'clouds', 'sky', 'emission', 'bounce', 'shadow', 'darks']);
  const floors = { fog: .58, clouds: .46, sky: .48, emission: .24, bounce: .12, shadow: .30 };
  const order = ['emission', 'fog', 'clouds', 'darks', 'shadow', 'bounce', 'sky'];
  const lighting = kind => kind === 'shadow' || kind === 'bounce';
  const symbols = Object.freeze(Object.fromEntries(kinds.map((name, i) => [name, i + 1])));
  const list = (value, label) => {
    if (!Array.isArray(value) || Array.from(value).some(item => typeof item !== 'string' || !item.trim()))
      throw new TypeError(label + ' needs an array of names');
    return new Set(value);
  };
  const unit = (value, label) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(label + ' needs a number from 0 to 1');
    return value;
  };
  function record(value, keys, label) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid ' + label + ' settings');
    return value;
  }
  function limits(value, label) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite) || !(value[0] < value[1]))
      throw new RangeError(label + ' needs two increasing numbers');
    return value.slice();
  }

  function prepare(source, palette, roles = {}, { deferRoles = false } = {}) {
    if (source == null || source === false) return null;
    record(source, [...kinds, 'protect'], 'effect palette');
    const protect = record(source.protect ?? {}, ['objects', 'materials'], 'effect palette protection');
    const objects = list(protect.objects ?? [], 'Protected objects'), materials = list(protect.materials ?? [], 'Protected materials');
    const ramps = new Map();
    const select = pixel.paletteSelector(palette, roles);
    function swatches(colors) {
      if (!Array.isArray(colors) || !colors.length || colors.length > 64)
        throw new RangeError('Effect palettes need 1 to 64 colors');
      const packed = Array.from(colors).flatMap(color => {
        if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) return [parseInt(color.slice(1),16)];
        if (Number.isSafeInteger(color) && color >= 0 && color < palette.length) return [palette[color]];
        if (typeof color === 'string' && color.trim() && !color.startsWith('#')) {
          // Environment packs validate structure before binding to a destination scene's roles.
          return deferRoles ? [0] : select(color).map(index=>palette[index]);
        }
        throw new TypeError('Effect colors need #rrggbb, a scene palette index or a scene role');
      });
      if (packed.length > 64) throw new RangeError('Expanded effect palette cannot exceed 64 colors');
      return packed;
    }
    for (const kind of kinds) {
      const raw = source[kind];
      if (raw === undefined || raw === false) continue;
      if (kind === 'darks') {
        if (!Array.isArray(raw) || raw.length > 64) throw new TypeError('Darks need an array of up to 64 target ramps');
        const scoped = Array.from(raw, (entry, slot) => {
          const rule = record(entry, ['select','colors','range','dither'], 'dark palette target');
          const range = limits(rule.range ?? [0,.4], 'Dark palette lightness range');
          range.forEach(n => unit(n, 'Dark palette lightness range'));
          return { select:targets.prepare(rule.select), packed:swatches(rule.colors), range, slot,
            amount:unit(rule.dither ?? 0, 'Dark palette dither') };
        });
        if (scoped.length) ramps.set(kind, { scoped, packed:[...new Set(scoped.flatMap(row=>row.packed))] });
        continue;
      }
      const rule = Array.isArray(raw) ? { colors: raw } :
        record(raw, ['colors', 'threshold', 'geometry', 'mode', 'range', 'dither', 'when', 'combine'], kind + ' palette');
      const { colors, combine, geometry = lighting(kind) || combine === 'material',
        mode = combine === 'material' ? 'nearest' : 'luma', dither = 0, when } = rule;
      if (typeof geometry !== 'boolean' || !['luma','nearest'].includes(mode) || (combine !== undefined && combine !== 'material'))
        throw new TypeError('Invalid ' + kind + ' palette mode, geometry or combine setting');
      const threshold = unit(rule.threshold ?? floors[kind], kind + ' coverage threshold');
      const amount = unit(dither, kind + ' palette dither');
      const range = limits(rule.range ?? [0,1], kind + ' tone range');
      range.forEach(n => unit(n, kind + ' tone range'));
      const packed = swatches(colors);
      let gate;
      if (when !== undefined) {
        const { channel, min = -Infinity, max = Infinity } = record(when,['channel','min','max'],'effect palette profile gate');
        if (typeof channel !== 'string' || !channel.trim() || (min !== -Infinity && !Number.isFinite(min)) ||
            (max !== Infinity && !Number.isFinite(max)) || min > max)
          throw new TypeError('A profile gate needs a numeric channel and an optional min/max range');
        gate = { channel, min, max };
      }
      const rgb = packed.map(c => [(c>>16)/255, ((c>>8)&255)/255, (c&255)/255]);
      ramps.set(kind, { packed, rgb, geometry, mode, amount, range, threshold, gate, combine });
    }
    return ramps.size ? { ramps, objects, materials } : null;
  }

  function bindDarks(settings, world) {
    const scoped = settings?.ramps.get('darks')?.scoped;
    if (!scoped) return;
    const index = targets.index(world), cache = new WeakMap();
    return i => {
      if (i < 0 || i >= world.count) return;
      const entry = index.row(i);
      if (!cache.has(entry)) cache.set(entry, scoped.findLast(rule=>targets.matches(rule.select, entry)));
      return cache.get(entry);
    };
  }

  function activate(settings, parameters) {
    if (!settings) return null;
    const ramps = new Map([...settings.ramps].filter(([, { gate }]) => {
      if (!gate) return true;
      const value = parameters?.[gate.channel];
      return Number.isFinite(value) && value >= gate.min && value <= gate.max;
    }));
    return ramps.size ? { ...settings, ramps } : null;
  }

  const distance = (a,b) => pixel.rgbWeights.reduce((sum,weight,i)=>sum+weight*(a[i]-b[i])**2,0);
  function apply(frame, passes, signals, source, palette, capture, ditherAt, ownership, inspect) {
    const { rules, media, backdropCloud, sky, haze } = signals;
    const { w, h, rgb } = frame, { ramps, objects, materials } = rules;
    const mask = capture ? new Uint8Array(w*h) : null;
    const active = order.filter(kind => ramps.has(kind));
    const protectedObjects = new Set(passes.objects?.flatMap((name,id) => objects.has(name) ? [id] : []));
    const protectedMaterials = new Set(passes.materials?.flatMap((name,id) => materials.has(name) ? [id] : []));
    const sample = [0,0,0];
    const darkLightness = ramps.has('darks') ? new Map() : null;
    let changed = false;
    for (let p=0; p<w*h; p++) {
      if (frame.alpha && !frame.alpha[p] || protectedObjects.has(passes.objectId?.[p]) ||
          protectedMaterials.has(passes.materialId?.[p]) || frame.inkMask?.[p] > 0 && frame.inkMask[p] < 4) continue;
      const x = p%w, y = Math.floor(p/w), bottom = (h-1-y)*w+x, q = p*3;
      const coverage = passes.coverage[p], geometry = Number.isFinite(passes.depth[p]);
      const through = media?.[q+2] ?? 1, cloud = backdropCloud?.[bottom] ?? 0;
      const back = (1-coverage)*through;
      const emission = passes.emission;
      const weights = {
        fog: (media?.[q] ?? 0) + through*(haze?.[bottom] ?? 0),
        clouds: (media?.[q+1] ?? 0) + back*cloud,
        sky: sky ? back*(1-cloud) : 0,
        emission: emission ? Math.max(emission[q],emission[q+1],emission[q+2]) : 0,
        bounce: 0, shadow: 0
      };
      let light;
      for (const kind of active) {
        if (lighting(kind) && geometry && signals.lightAt) light ??= signals.lightAt(p,bottom) ?? {};
        const dark = kind === 'darks';
        const ramp = dark ? geometry && signals.darkAt?.((passes.splatId?.[p] ?? 0)-1) : ramps.get(kind);
        if (!ramp) continue;
        const weight = dark ? 1 : light?.[kind] ?? weights[kind];
        if (dark) {
          if (weights.emission > 0 || frame.inkMask?.[p] === 4 || frame.alpha && frame.alpha[p] < 255) continue;
        } else if (!(weight > 0 && weight >= ramp.threshold) ||
            (geometry && !ramp.geometry && (kind === 'fog' || kind === 'clouds' || lighting(kind)))) continue;
        if ((dark || ramp.combine) && ownership?.outlined?.[bottom]) break;
        const local = geometry && (dark || ramp.combine) && ownership?.material(p,bottom);
        if (local?.reserved) break;
        const lit = lighting(kind) && ownership?.lit;
        for (let c=0;c<3;c++) sample[c] = kind === 'emission' ? emission[q+c] :
          lit && local ? lit[bottom*3+c] : source[bottom*3+c]/255;
        const trace = inspect?.pixel === p ? {} : undefined;
        let index;
        if (ramp.mode === 'nearest') index = pixel.nearest(sample, ramp.rgb, false);
        else {
          let luma;
          if (dark) {
            const start = bottom*3, color = source[start]*65536 + source[start+1]*256 + source[start+2];
            luma = darkLightness.get(color);
            if (luma === undefined) {
              luma = colorSpace.toOKLab(sample)[0];
              if (darkLightness.size < 8192) darkLightness.set(color,luma);
            }
            if (luma < ramp.range[0] || luma > ramp.range[1]) continue;
          } else luma = sample[0]*.30 + sample[1]*.55 + sample[2]*.15;
          const [lo,hi] = ramp.range, span = ramp.packed.length-1;
          const step = Math.min(1, Math.max(0,(luma-lo)/(hi-lo)))*span;
          const [dx,dy] = ramp.amount && ditherAt ? ditherAt(x,y) : [x,y];
          const rank = pixel.bayerRank(dx,dy);
          index = Math.min(span, Math.max(0,Math.round(step + (rank-.5)*ramp.amount)));
          if (trace) {
            trace.method = dark ? 'oklab-lightness' : 'luma';
            const low = Math.floor(step), high = Math.ceil(step);
            if (ramp.amount && low !== high) trace.dither = { mode:'tone', pattern:'bayer', coordinates:[dx,dy],
              pair:[ramp.packed[low],ramp.packed[high]],rank,strength:ramp.amount,share:step-low };
          }
        }
        let color = ramp.packed[index], winner = 'shared';
        const competing = dark ? undefined : local;
        const localTrace = trace && competing ? {} : undefined;
        if (competing) {
          const swatch = ownership.pick(competing, sample, x, y, p, localTrace);
          if (distance(sample,swatch) <= distance(sample,ramp.rgb[index])) {
            color = (Math.round(swatch[0]*255)<<16) | (Math.round(swatch[1]*255)<<8) | Math.round(swatch[2]*255);
            winner = 'material';
          }
        }
        rgb[q] = color>>16;
        rgb[q+1] = (color>>8)&255;
        rgb[q+2] = color&255;
        if (mask) mask[p] = symbols[kind];
        ownership?.mark(p,{kind,ramp,local:competing,winner,weight});
        if (trace) inspect.effect(kind,ramp,competing,winner,sample,index,winner === 'material' ? localTrace : trace,weight);
        changed = true;
        break;
      }
    }
    if (mask) frame.effectPaletteMask = mask;
    if (!changed) return frame;
    const counts = new Map(Array.from(frame.palette ?? palette, color => [color,0]));
    for (let q=0;q<rgb.length;q+=3) {
      const color = rgb[q]*65536 + rgb[q+1]*256 + rgb[q+2];
      counts.set(color, (counts.get(color) ?? 0)+1);
    }
    return { ...frame, palette:[...counts.keys()], use:Uint32Array.from(counts.values()) };
  }
  return Object.freeze({ prepare, activate, apply, bindDarks, kinds });
})();
if (typeof module !== 'undefined') module.exports = EffectPalettes;
