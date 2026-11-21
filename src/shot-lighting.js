/* Surface lighting roles with independent receivers and shadow casters. */
const ShotLighting = (() => {
  let Area, Target, Shadow, Optics, Color;
  try {
    [Area, Target, Shadow, Optics, Color] = [AreaLights, TargetSelectors, ShadowArt, OpticalMaterials, ColorSpace];
  } catch {
    Area = require('./area-lights.js');
    Target = require('./target-selectors.js');
    Shadow = require('./shadow-art.js');
    Optics = require('./optical-materials.js');
    Color = require('./color-space.js');
  }
  const linear = Color.prepare('srgb', 'srgb-linear'), srgb = Color.prepare('srgb-linear', 'srgb');
  const format = 'ink-studio/shot-lighting', roles = ['key', 'fill', 'rim'];
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, names) => Object.keys(value).every(name => names.includes(name));
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const clamp = n => Math.max(0, Math.min(1, n));
  const unnamed = Object.freeze({});

  function prepare(definition, { time = 0 } = {}) {
    if (definition === false || definition === undefined) return null;
    if (!Number.isFinite(time) || !record(definition) ||
        !fields(definition, ['format', 'version', ...roles, 'negativeFill']) ||
        (definition.format !== undefined || definition.version !== undefined) &&
        (definition.format !== format || definition.version !== 1))
      throw new TypeError('Expected version 1 shot lighting settings with key, fill, rim or negativeFill');
    const positive = [];
    for (const role of roles) {
      const value = definition[role];
      if (value === undefined || value === false) continue;
      if (!record(value) || ['id', 'visible', 'reflection', 'volumeIntensity'].some(key => Object.hasOwn(value, key)))
        throw new TypeError('Shot ' + role + ' needs shaped light settings and optional receiver and caster masks');
      const { receive, cast, ...emitter } = value;
      const masks = Shadow.prepare({ receive, cast });
      const [light] = Area.prepare([{
        shadows: role === 'key', ...emitter, id: role, visible: false, reflection: false, volumeIntensity: 0
      }], { time });
      if (light.intensity) positive.push({ light, receive: masks?.receive, cast: masks?.cast });
    }
    let negative;
    if (definition.negativeFill !== undefined && definition.negativeFill !== false) {
      const value = definition.negativeFill;
      if (!record(value) || !fields(value, ['at', 'radius', 'strength', 'receive']))
        throw new TypeError('Negative fill needs a position, radius, strength and optional receiver mask');
      const { at, radius = 3, strength: rawStrength = .5, receive } = value;
      const point = typeof at === 'function' ? at(time) : at;
      const strength = typeof rawStrength === 'function' ? rawStrength(time) : rawStrength;
      if (!vector(point) || !Number.isFinite(radius) || radius <= 0 ||
          !Number.isFinite(strength) || strength < 0 || strength > 1)
        throw new RangeError('Negative fill needs finite XYZ, a positive radius and strength from 0 to 1');
      const masks = Shadow.prepare({ receive });
      if (strength) negative = { at: point.slice(), radius, strength, receive: masks?.receive };
    }
    return positive.length || negative ? { positive, negative } : null;
  }

  function frame(authored, override, time) {
    return prepare(override === undefined || override === true ? authored : override, { time });
  }

  function needsCasters(definition) {
    if (!definition) return false;
    return roles.some(role => definition[role] && definition[role].shadows !== false &&
      (role === 'key' || definition[role].shadows === true) && definition[role].intensity !== 0);
  }

  function bind(rig, world, data, alpha) {
    if (!rig) return null;
    const { positive, negative } = rig;
    const targets = positive.some(entry => entry.receive || entry.cast) || negative?.receive ? Target.index(world) : null;
    const casters = positive.some(entry => entry.light.shadows) ? Area.staticSources(world, data, alpha) : [];
    const byLight = new Map();
    for (const { light, cast } of positive) {
      if (!light.shadows) continue;
      byLight.set(light, !cast ? casters : casters.filter(source =>
        [...source.rows.values()].every(ranges => ranges.every(([start, end]) => {
          for (let i = start; i < end; i++) if (!Shadow.allows(cast, targets.row(i))) return false;
          return true;
        }))));
    }
    const shadow = casters.length ? (origin, direction, stop, light) =>
      Area.occludes(byLight.get(light) ?? [], origin, direction, stop) : undefined;
    const masks = new WeakMap();
    function receiver(row) {
      const target = row >= 0 ? targets?.row(row) ?? unnamed : unnamed;
      if (!masks.has(target)) masks.set(target, {
        lights: positive.filter(entry => Shadow.allows(entry.receive, target)).map(entry => entry.light),
        negative: negative && Shadow.allows(negative.receive, target) ? negative : null
      });
      return masks.get(target);
    }
    return {
      receives(row) {
        const layer = receiver(row);
        return layer.lights.length > 0 || !!layer.negative;
      },
      sample(row, point, normal, out) {
        const layer = receiver(row);
        if (layer.lights.length) Area.evaluate(layer.lights, point, normal, out, { shadow });
        else out.fill(0);
        if (!layer.negative) return 1;
        const { at: [x, y, z], strength, radius } = layer.negative;
        const dx = x - point[0], dy = y - point[1], dz = z - point[2], distance = Math.hypot(dx, dy, dz);
        if (distance >= radius) return 1;
        const facing = distance < 1e-8 ? 1 : clamp((normal[0] * dx + normal[1] * dy + normal[2] * dz) / distance);
        return 1 - strength * facing * (1 - distance / radius) ** 2;
      }
    };
  }

  function shade(rgb, gains) {
    return srgb(linear(rgb).map((value, k) => clamp(value * gains[k])));
  }

  // WebGL applies the same contribution at each posed splat centre through its relight table.
  function rows(world, rig, sampleFrame, base, reuse) {
    if (!rig || !world.count) return base;
    const light = bind(rig, world), { data, count } = world;
    const result = reuse?.length === count * 4 ? reuse : new Float32Array(count * 4);
    if (base) result.set(base);
    else result.fill(0);
    const gain = [0, 0, 0];
    let active = false;
    for (let i = 0; i < count; i++) {
      const q = 16 * i, at = 4 * i;
      if (data[q + 3] < 1 || (Math.round(data[q + 11]) & (16 | 32 | 64 | 128 | 256 | 2048 | 32768)) ||
          world.opticalSplats?.[i * Optics.STRIDE + 3] || !light.receives(i)) continue;
      const surface = sampleFrame(i);
      if (!surface.normal) continue;
      const retention = light.sample(i, surface.position(), surface.normal, gain);
      if (retention === 1 && !gain.some(Boolean)) continue;
      for (let c = 0; c < 3; c++) gain[c] += retention;
      const rgb = [0, 1, 2].map(c => (Math.round(data[q + 7]) >> (c * 8) & 255) / 255 || .5);
      const prior = base?.[at + 3] ? rgb.map((value, c) => clamp(value * base[at + c])) : rgb;
      const edited = shade(prior, gain);
      for (let c = 0; c < 3; c++) result[at + c] = edited[c] / rgb[c];
      result[at + 3] = 1;
      active = true;
    }
    return active ? result : base;
  }

  return Object.freeze({ prepare, frame, needsCasters, bind, rows, shade });
})();
if (typeof module !== 'undefined') module.exports = ShotLighting;
