/* Surface lighting roles with independent receivers and shadow casters. */
const ShotLighting = (() => {
  let Area, Target, Shadow, Optics, Color, Channels;
  try {
    [Area, Target, Shadow, Optics, Color, Channels] = [AreaLights, TargetSelectors, ShadowArt, OpticalMaterials, ColorSpace, LightingChannels];
  } catch {
    Area = require('./area-lights.js');
    Target = require('./target-selectors.js');
    Shadow = require('./shadow-art.js');
    Optics = require('./optical-materials.js');
    Color = require('./color-space.js');
    Channels = require('./lighting-channels.js');
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
        !fields(definition, ['format', 'version', ...roles, 'negativeFill', 'exposureEV', 'bounceEV', 'channels', 'shadeNormals', 'shadowBands', 'spill']) ||
        (definition.format !== undefined || definition.version !== undefined) &&
        (definition.format !== format || definition.version !== 1))
      throw new TypeError('Expected version 1 shot lighting settings with key, fill, rim or negativeFill');
    const { exposureEV = 0, bounceEV = 0 } = definition;
    if (!Number.isFinite(exposureEV) || Math.abs(exposureEV) > 4)
      throw new RangeError('Shot surface exposure needs a value from -4 to 4 EV');
    if (!Number.isFinite(bounceEV) || Math.abs(bounceEV) > 4)
      throw new RangeError('Shot probe bounce needs a value from -4 to 4 EV');
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
    const art=Channels.prepare(definition);
    return positive.length || negative || exposureEV || bounceEV || art
      ? { positive, negative, exposure:2**exposureEV, ...(bounceEV&&{bounceScale:2**bounceEV}), ...(art&&{art}) } : null;
  }

  function frame(authored, override, time) {
    return prepare(override === undefined || override === true ? authored : override, { time });
  }

  function needsCasters(definition) {
    if (!definition) return false;
    return roles.some(role => definition[role] && definition[role].shadows !== false &&
      (role === 'key' || definition[role].shadows === true) && definition[role].intensity !== 0);
  }

  function bind(rig, world, data, alpha, art=Channels.bind(rig?.art,world), shadowSettings=Shadow.prepare(world.look?.shadowArt)) {
    if (!rig) return null;
    const { positive, negative, exposure } = rig;
    const targets = shadowSettings?.objects || positive.some(entry => entry.receive || entry.cast) || negative?.receive ? Target.index(world) : null;
    const casters = positive.some(entry => entry.light.shadows) ? Area.staticSources(world, data, alpha, [], shadowSettings) : [];
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
    const shapedKey=art?.curves.key || art?.curves.shadow || art?.band;
    function receiver(row) {
      const target = row && typeof row==='object' ? row : row >= 0 ? targets?.row(row) ?? unnamed : unnamed;
      if (!masks.has(target)) {
        const shadowed=Shadow.objectAllows(shadowSettings,'receive',target);
        const lights=positive.filter(entry=>Shadow.allows(entry.receive,target)).map(entry=>entry.light);
        masks.set(target,{
          lights,shadow:shadowed ? shadow : undefined,
          ...(shapedKey&&{keys:lights.filter(light=>light.id==='key'),other:lights.filter(light=>light.id!=='key')}),
          negative:negative&&Shadow.allows(negative.receive,target)?negative:null
        });
      }
      return masks.get(target);
    }
    return {
      exposure,
      receives(row) {
        const layer = receiver(row);
        return exposure !== 1 || layer.lights.length > 0 || !!layer.negative;
      },
      sample(row, point, normal, out, biasNormal=normal) {
        const layer = receiver(row), shadeNormal=art?.normal?.(row,normal) ?? normal;
        if(layer.keys?.length){
          Area.evaluate(layer.other,point,shadeNormal,out,{shadow:layer.shadow,biasNormal});
          const key=[0,0,0];
          Area.evaluate(layer.keys,point,shadeNormal,key,{shadow:layer.shadow,biasNormal,
            incidence:art.band && ((light,value)=>art.band(row,value)), visibility:art.curves.shadow});
          const graded=art.curves.key?.(key) ?? key;
          for(let c=0;c<3;c++)out[c]+=graded[c];
        } else if(layer.lights.length)Area.evaluate(layer.lights,point,shadeNormal,out,{shadow:layer.shadow,biasNormal});
        else out.fill(0);
        if (!layer.negative) return 1;
        const { at: [x, y, z], strength, radius } = layer.negative;
        const dx = x - point[0], dy = y - point[1], dz = z - point[2], distance = Math.hypot(dx, dy, dz);
        if (distance >= radius) return 1;
        const facing = distance < 1e-8 ? 1 : clamp((shadeNormal[0] * dx + shadeNormal[1] * dy + shadeNormal[2] * dz) / distance);
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
      if (retention === 1 && light.exposure === 1 && !gain.some(Boolean)) continue;
      for (let c = 0; c < 3; c++) gain[c] = (gain[c] + retention) * light.exposure;
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
