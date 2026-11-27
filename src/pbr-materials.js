/* Portable material parameters and the matching CPU/WebGL lighting equations. */
const PbrMaterials = (() => {
  let selectors, colors, surface, pixelLook, shadows, curves, finishPaint;
  try { finishPaint = PaintFinish; } catch { finishPaint = require('./paint-finish.js'); }
  try { selectors = TargetSelectors; } catch { selectors = require('./target-selectors.js'); }
  try { colors = ColorSpace; } catch { colors = require('./color-space.js'); }
  try { surface = SurfaceLook; } catch { surface = require('./surface-look.js'); }
  try { pixelLook = PixelLook; } catch { pixelLook = require('./pixel-look.js'); }
  try { shadows = PbrShadows; } catch { shadows = require('./pbr-shadows.js'); }
  try { curves = CurveSplat; } catch { curves = require('./curve-splat.js'); }
  const shadowBands = surface.shadowBandPaint;
  const toLinear = colors.prepare('srgb', 'srgb-linear');
  const toDisplay = colors.prepare('srgb-linear', 'srgb');
  const MAX_MATERIALS = 16, MAX_LIGHTS = 4, MAX_PROJECTIONS = 8;
  const WHITE = [1, 1, 1], ZERO = [0, 0, 0];
  const clamp = value => Math.max(0, Math.min(1, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => a.map((value, i) => value - b[i]);
  const unit = (v, fallback) => {
    const length = Math.hypot(...v);
    return length > 1e-8 ? v.map(value => value / length) : fallback;
  };
  const schlick = cosine => (1 - clamp(cosine)) ** 5;
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError(label + ' needs an object');
    return value;
  }
  function number(value, label, low, high) {
    if (!Number.isFinite(value) || value < low || value > high)
      throw new RangeError(label + ' must be between ' + low + ' and ' + high);
    return value;
  }
  const optional = (value, label) => value === undefined ? -1 : number(value, label, 0, 1);
  function vector(value, label) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(Number.isFinite))
      throw new TypeError(label + ' needs three finite numbers');
    return value.slice();
  }
  function color(value, label) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
      const n = parseInt(value.slice(1), 16);
      return toLinear([n >>> 16, (n >>> 8) & 255, n & 255].map(v => v / 255));
    }
    return toLinear(vector(value, label).map(v => number(v, label, 0, 1)));
  }
  function material(value, name, palette, roles, overrides, paintShadowBands) {
    record(value, 'PBR material');
    const coat = typeof value.coating === 'number' ? { weight: value.coating } : value.coating;
    const ior = number(value.ior ?? 1.5, 'Material IOR', 1, 4);
    const rampRoles = pixelLook.bindRoles(palette, roles, value.paletteRoles);
    const ramp = (definition, type) => definition === undefined || definition === false ? null :
      surface.prepareLightingRamp(definition, palette, rampRoles, name + '.' + type, type);
    const diffuseRamp = ramp(overrides?.diffuse ?? value.lightingRamp, 'diffuse');
    const band = value.shadowBand;
    let readBand;
    if (band !== undefined && band !== false) {
      if (!diffuseRamp || Object.keys(record(band, name + '.shadowBand')).some(key => key !== 'strokes'))
        throw new TypeError(name + '.shadowBand needs an ordered stroke list on a diffuse lighting ramp');
      const paint = shadowBands.prepare(band.strokes);
      if (paintShadowBands && band.strokes.length) readBand = paint;
    }
    const highlightRamp = ramp(overrides?.specular ?? value.highlight?.lightingRamp, 'specular');
    return {
      base: value.baseColor === undefined ? null : color(value.baseColor, 'Base color'),
      roughness: optional(value.roughness, 'Roughness'),
      metalness: optional(value.metalness, 'Metalness'),
      f0: ((ior - 1) / (ior + 1)) ** 2,
      anisotropy: number(value.anisotropy ?? 0, 'Anisotropy', -.9, .9),
      coat: coat ? number(coat.weight ?? 1, 'Coating weight', 0, 1) : -1,
      coatRoughness: number(coat?.roughness ?? .18, 'Coating roughness', 0, 1),
      emission: value.emission === undefined ? ZERO : color(value.emission, 'Emission').map(
        channel => channel * number(value.emissionStrength ?? 1, 'Emission strength', 0, 64)
      ),
      diffuseRamp, highlightRamp, readBand,
      wrap: number(value.wrap ?? 0, 'PBR diffuse ramp wrap', 0, 1),
      rampStrength: number(value.rampStrength ?? 1, 'PBR diffuse ramp strength', 0, 1),
      highlight: value.highlight?.color === undefined ? ZERO : color(value.highlight.color, 'Highlight swatch'),
      threshold: number(value.highlight?.threshold ?? .25, 'Highlight threshold', 0, 64),
      highlightWeight: number(highlightRamp || value.highlight?.color !== undefined ? value.highlight?.strength ?? 1 : 0,
        'Highlight strength', 0, 1)
    };
  }
  function projection(value, id) {
    record(value, 'PBR projection');
    const origin = vector(value.origin, 'Projection origin');
    const u = vector(value.u, 'Projection U span'), v = vector(value.v, 'Projection V span');
    const normal = unit(cross(u, v));
    if (!normal) throw new RangeError('Projection spans must enclose an area');
    const dualU = cross(v, normal), dualV = cross(normal, u);
    const channels = value.channels ?? {};
    return {
      id, origin, normal, u: dualU.map(n => n / dot(u, dualU)), v: dualV.map(n => n / dot(v, dualV)),
      reach: number(value.reach ?? .1, 'Projection reach', .00001, 1e6),
      feather: number(value.feather ?? .05, 'Projection feather', 0, .5),
      weight: number(value.opacity ?? 1, 'Projection opacity', 0, 1),
      base: channels.baseColor === undefined ? null : color(channels.baseColor, 'Projected color'),
      roughness: optional(channels.roughness, 'Projected roughness'),
      metalness: optional(channels.metalness, 'Projected metalness'),
      coat: optional(channels.coating, 'Projected coating'),
      emission: channels.emission === undefined ? null : color(channels.emission, 'Projected emission')
    };
  }
  function boundedList(value, limit, label) {
    if (!Array.isArray(value) || value.length > limit) throw new RangeError(label + ' supports up to ' + limit + ' entries');
    return value;
  }
  function prepare(definition, lightsOverride, {palette = [], paletteRoles = {}, surfaceLightRamps, specularSampling, paintShadowBands = true} = {}) {
    if (definition == null || definition === false) return null;
    record(definition, 'PBR recipe');
    const entries = Object.entries(record(definition.materials, 'Named PBR materials'));
    if (!entries.length || entries.length > MAX_MATERIALS)
      throw new RangeError('PBR needs one to ' + MAX_MATERIALS + ' named materials');
    const overrides = surface.lightRamps(surfaceLightRamps);
    const materials = entries.map(([name, value]) => material(value, name, palette, paletteRoles,
      overrides && Object.hasOwn(overrides,name) ? overrides[name] : undefined, paintShadowBands));
    const ids = new Map(entries.map(([key], index) => [key, index + 1]));
    const id = key => {
      if (!ids.has(key)) throw new RangeError('Unknown PBR material: ' + key);
      return ids.get(key);
    };
    const defaultId = definition.default === undefined ? 0 : id(definition.default);
    const bindings = boundedList(definition.bindings ?? [],4096,'PBR bindings')
      .map(value => ({ select: selectors.prepare(value.select), id: id(value.material) }));
    const lights = boundedList(lightsOverride ?? definition.lights ?? [], MAX_LIGHTS, 'PBR lights').map(value => {
      const direction = unit(vector(value.direction, 'Light direction'));
      if (!direction) throw new RangeError('Light direction must be nonzero');
      const intensity = number(value.intensity ?? 1, 'Light intensity', 0, 64);
      const light = color(value.color ?? WHITE, 'Light color').map(channel => channel * intensity);
      const {shadows:castShadows=false,mapSize=256,bias=.02,filter=1}=value;
      if(typeof castShadows!=='boolean' || !Number.isSafeInteger(mapSize) || mapSize<32 || mapSize>1024 ||
          !Number.isSafeInteger(filter) || filter<0 || filter>2)
        throw new RangeError('PBR shadows need a switch, mapSize of 32–1024 and filter of 0–2');
      number(bias,'PBR shadow bias',0,10);
      return { direction,color:light,rampIntensity:clamp(Math.max(...light)),shadows:castShadows&&light.some(Boolean),mapSize,bias,filter,bounds:shadows.bounds(value.bounds) };
    });
    const settings = definition.environment ?? {};
    const environment = {
      sky: color(settings.sky ?? '#a9c1ef', 'Sky color'),
      horizon: color(settings.horizon ?? '#948e9a', 'Horizon color'),
      ground: color(settings.ground ?? '#50414f', 'Ground color'),
      intensity: number(settings.intensity ?? .45, 'Environment intensity', 0, 16)
    };
    const exposure = number(definition.exposure ?? 1, 'PBR exposure', 0, 32);
    const sampleSpecular = specularSampling ?? definition.specularSampling ?? false;
    if(typeof sampleSpecular!=='boolean') throw new TypeError('PBR specularSampling needs a boolean');
    const projections = boundedList(definition.projections ?? [], MAX_PROJECTIONS, 'PBR projections')
      .map(value => projection(value, value.material === undefined ? 0 : id(value.material)));
    function resolve(target) {
      for (let i = bindings.length - 1; i >= 0; i--) {
        if (selectors.matches(bindings[i].select, target ?? {})) return bindings[i].id;
      }
      return defaultId;
    }
    return {
      materials, lights, environment, exposure, projections, resolve, specularSampling:sampleSpecular, hasBands:materials.some(m=>m.readBand),
      surface(chart) {
        return resolve(chart && {
          object:chart.objectId, entity:chart.objectId, material:chart.materialId,
          part:chart.partId, surface:chart.id
        });
      }
    };
  }

  function shadingFrame(normal, tangent, view) {
    const v = unit(view, [0, 0, 1]);
    let n = unit(normal ?? ZERO, v);
    if (dot(n, v) < 0) n = n.map(value => -value);
    const stable = cross(Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0], n);
    const t = tangent ? unit(tangent.map((value, i) => value - dot(tangent, n) * n[i]), unit(stable)) : unit(stable);
    return { n, v, t, b: cross(n, t), nv: Math.max(1e-4, dot(n, v)) };
  }
  function lobe(half, light, frame, nl, ax, ay) {
    const { t, b, n, v, nv } = frame;
    const nh = Math.max(0, dot(n, half));
    const denominator = (dot(t, half) / ax) ** 2 + (dot(b, half) / ay) ** 2 + nh * nh;
    const distribution = 1 / (Math.PI * ax * ay * denominator * denominator);
    const length = (w, nw) => Math.hypot(dot(t, w) * ax, dot(b, w) * ay, nw);
    return .5 * distribution / Math.max(1e-6, nl * length(v, nv) + nv * length(light, nl));
  }
  const tapPositions = [[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  function footprint(x, y, scale, sample) {
    const left=Math.floor(x/scale)*scale, top=Math.floor(y/scale)*scale;
    return tapPositions.map(([u,v])=>sample(left+u*scale,top+v*scale));
  }
  function shine(l,frame,nl,{half,s,f0,axes,coatFresnel}) {
    const base=lobe(half,l,frame,nl,axes[0],axes[1]);
    const top=coatFresnel ? coatFresnel*lobe(half,l,frame,nl,axes[2],axes[2]) : 0;
    return f0.map(fresnel=>base*mix(fresnel,1,s)*(1-coatFresnel)+top);
  }
  function highlightSwatch(m, response) {
    const level=clamp(response), ramp=m.highlightRamp;
    return {
      weight:ramp ? m.highlightWeight*(ramp.amount?.(level)??level) : response>m.threshold ? m.highlightWeight : 0,
      color:ramp ? toLinear(ramp.tint(level)) : m.highlight
    };
  }
  function projectionWeight(p, id, position) {
    if (p.id && p.id !== id) return 0;
    const offset = sub(position, p.origin);
    const x = dot(p.u, offset), y = dot(p.v, offset), depth = Math.abs(dot(p.normal, offset));
    const edge = Math.min(x, 1 - x, y, 1 - y);
    return edge < 0 || depth > p.reach ? 0 : p.weight * (p.feather ? clamp(edge / p.feather) : 1);
  }

  function finish(plan, id, position, roughness, metalness) {
    const m = plan?.materials[id - 1];
    if (!m) return [roughness, metalness];
    let rough = m.roughness < 0 ? roughness ?? .45 : m.roughness;
    let metal = m.metalness < 0 ? metalness ?? 0 : m.metalness;
    for (const p of plan.projections) {
      const weight = projectionWeight(p, id, position);
      if (!weight) continue;
      if (p.roughness >= 0) rough = mix(rough, p.roughness, weight);
      if (p.metalness >= 0) metal = mix(metal, p.metalness, weight);
    }
    return [rough, metal];
  }

  function shade(plan, id, sample) {
    const m = plan.materials[id - 1];
    if (!m) return sample.color;
    let base = m.base ?? toLinear(sample.color.map(clamp));
    let rough = m.roughness < 0 ? sample.roughness ?? .45 : m.roughness;
    let metal = m.metalness < 0 ? sample.metalness ?? 0 : m.metalness;
    let coat = m.coat < 0 ? sample.coating ?? 0 : m.coat;
    let emission = m.emission.map((channel, i) => channel + (sample.emission?.[i] ?? 0));
    for (const p of plan.projections) {
      const weight = projectionWeight(p, id, sample.position);
      if (!weight) continue;
      if (p.base) base = base.map((value, i) => mix(value, p.base[i], weight));
      if (p.roughness >= 0) rough = mix(rough, p.roughness, weight);
      if (p.metalness >= 0) metal = mix(metal, p.metalness, weight);
      if (p.coat >= 0) coat = mix(coat, p.coat, weight);
      if (p.emission) emission = emission.map((value, i) => mix(value, p.emission[i], weight));
    }
    let coatRoughness = m.coatRoughness;
    const finish = sample.paintedFinish;
    if (finish) {
      base = finishPaint.gradeLinear(finish, base);
      rough = finishPaint.roughness(finish, rough);
      [coat, coatRoughness] = finishPaint.coat(finish, coat, coatRoughness);
      if (sample.finishEmission) emission = emission.map((value, i) => value + sample.finishEmission[i]);
    }
    const frame = shadingFrame(sample.normal, sample.tangent, sample.view);
    const { n, v, nv } = frame, env = plan.environment;
    const envAt = y => env.horizon.map((value, i) => mix(value, (y >= 0 ? env.sky : env.ground)[i], Math.abs(y)));
    const diffuseEnv = envAt(n[1]);
    const reflectionEnv = envAt((2 * nv * n[1] - v[1]) * (1 - rough * rough));
    const f0 = base.map(value => mix(m.f0, value, metal));
    const grazing = schlick(nv);
    const coatView = coat * mix(.04, 1, grazing);
    const rgb = base.map((value, i) => {
      const fresnel = mix(f0[i], 1, grazing);
      const diffuse = value * (1 - metal) * (1 - fresnel) * diffuseEnv[i];
      const reflected = fresnel * reflectionEnv[i] * (1 - .5 * rough);
      return emission[i] + env.intensity * ((diffuse + reflected) * (1 - coatView) + coatView * reflectionEnv[i]);
    });
    const aspect = Math.sqrt(1 - .9 * m.anisotropy);
    const a = Math.max(.012, rough * rough), ac = Math.max(.012, coatRoughness ** 2);
    const axes=[a/aspect,a*aspect,ac], taps=plan.specularSampling && sample.highlightSamples;
    const visibilityAt=(index,point,normal)=>sample.receiveShadow!==false && plan.shadows ?
      plan.shadows.visibility(index,point,normal) : 1;
    const band = m.readBand?.(sample.restPosition ?? sample.position) ?? 0;
    const directSpecular = sample.directSpecular;
    if (directSpecular) directSpecular.fill(0);
    let highlight = 0, incidence = 0;
    for (const [index,light] of plan.lights.entries()) {
      const l = light.direction, nl = dot(n, l);
      const response = m.diffuseRamp ? shadowBands.level((nl+m.wrap)/(1+m.wrap),light.rampIntensity,band) : 0;
      if(nl<=0 && !response)continue;
      const visibility = visibilityAt(index,sample.position,unit(sample.shadowNormal??ZERO,n));
      incidence=Math.max(incidence,response*visibility);
      if (nl <= 0 || !visibility) continue;
      const half = unit(v.map((value, i) => value + l[i]), n), s = schlick(dot(v, half));
      const coatFresnel = coat * mix(.04, 1, s);
      const specular = taps ? ZERO : shine(l,frame,nl,{half,s,f0,axes,coatFresnel});
      for (let i = 0; i < 3; i++) {
        const irradiance = light.color[i] * nl * visibility, fresnel = mix(f0[i], 1, s);
        const diffuse = base[i] * (1 - metal) * (1 - fresnel) / Math.PI;
        rgb[i] += irradiance * (diffuse*(1-coatFresnel)+specular[i]);
        if (directSpecular) directSpecular[i] += irradiance * specular[i];
        highlight = Math.max(highlight,irradiance*specular[i]);
      }
    }
    const accent=[0,0,0];
    let cover=0;
    if(taps){
      const cap=1/Math.max(1e-4,plan.exposure);
      // Each tap represents a quarter pixel. Widen the lobe when normals
      // move substantially within that area, where a single tap could alias.
      const spread=Math.max(0,...taps.map(tap=>tap?.normal && tap.coverage>0 ?
        1-Math.abs(dot(n,unit(tap.normal,n))) : 0));
      const sampledAxes=axes.map(axis=>Math.hypot(axis,.5*Math.sqrt(spread)));
      for(const tap of taps){
        if(!tap || !(tap.coverage>0))continue;
        const basis=shadingFrame(tap.normal,sample.tangent,tap.view), specular=[0,0,0];
        let response=0;
        for(const [index,light] of plan.lights.entries()){
          const l=light.direction,nl=dot(basis.n,l);
          if(nl<=0)continue;
          const visibility=visibilityAt(index,tap.position,unit(tap.shadowNormal??ZERO,basis.n));
          if(!visibility)continue;
          const half=unit(basis.v.map((value,i)=>value+l[i]),basis.n),s=schlick(dot(basis.v,half));
          const lobeColor=shine(l,basis,nl,{half,s,f0,axes:sampledAxes,coatFresnel:coat*mix(.04,1,s)});
          for(let i=0;i<3;i++){
            const value=lobeColor[i]*light.color[i]*nl*visibility;
            specular[i]+=value;
            response=Math.max(response,value);
          }
        }
        const swatch=highlightSwatch(m,response), area=tap.coverage/tapPositions.length;
        cover+=swatch.weight*area;
        for(let i=0;i<3;i++){
          rgb[i]+=Math.min(cap,specular[i])*area;
          if (directSpecular) directSpecular[i]+=Math.min(cap,specular[i])*area;
          accent[i]+=swatch.color[i]*swatch.weight*area;
        }
      }
    }else{
      const swatch=highlightSwatch(m,highlight);
      cover=swatch.weight;
      for(let i=0;i<3;i++)accent[i]=swatch.color[i]*cover;
    }
    let display = rgb.map(channel => clamp(channel * plan.exposure));
    if (m.diffuseRamp) {
      const {tint,amount} = m.diffuseRamp, swatch = finishPaint.gradeLinear(finish, toLinear(tint(incidence)));
      const weight = m.rampStrength * (amount?.(incidence) ?? 1);
      display = rgb.map((channel,i) => clamp(mix(clamp((channel-emission[i])*plan.exposure),swatch[i],weight) +
        emission[i]*plan.exposure));
    }
    return toDisplay(display.map((channel,i)=>channel*(1-cover)+accent[i]));
  }

  function rampTable(plan) {
    // Each ramp starts with a header, followed by a pair of texels for each exact stop.
    const rows = [], indices = [], bands = [];
    for (const material of plan.materials) {
      const pair = [];
      for (const [ramp,strength,wrap] of [[material.diffuseRamp,material.rampStrength,material.wrap],[material.highlightRamp,1,0]]) {
        pair.push(ramp ? rows.length/4+1 : 0);
        if (!ramp) continue;
        const mode = ['step','linear','smooth'].indexOf(ramp.interpolation);
        rows.push(ramp.positions.length,mode,strength,wrap);
        for (const at of ramp.positions) rows.push(...ramp.tint(at),at,ramp.amount?.(at) ?? -1,0,0,0);
      }
      indices.push(pair);
      bands.push(material.readBand?.pack(rows) ?? 0);
    }
    return { rows:Float32Array.from(rows), indices, bands };
  }

  function uniforms(plan, ramps = rampTable(plan)) {
    const { materials, lights, projections, environment, exposure } = plan;
    const table = (rows, max, stride) => {
      const result = new Float32Array(max * stride);
      rows.forEach((values, i) => result.set(values, i * stride));
      return result;
    };
    return {
      u_pbrLights: lights.length, u_pbrProjections: projections.length,
      u_pbrBands: Int32Array.from({length:MAX_MATERIALS},(_,i)=>ramps.bands?.[i]??0),
      u_pbrMaterial: table(materials.map((m,i) => [
        ...(m.base ?? ZERO), Number(!!m.base), m.roughness, m.metalness, m.f0, m.anisotropy,
        ...m.emission, m.coat, ...m.highlight, m.threshold, m.coatRoughness, m.highlightWeight, ...ramps.indices[i]
      ]), MAX_MATERIALS, 20),
      u_pbrLight: table(lights.map(l => [...l.direction, l.rampIntensity, ...l.color, 0]), MAX_LIGHTS, 8),
      u_pbrProjection: table(projections.map(p => [
        ...p.origin, p.reach, ...p.u, p.feather, ...p.v, p.weight, ...p.normal, p.id,
        ...(p.base ?? ZERO), Number(!!p.base), p.roughness, p.metalness, p.coat, Number(!!p.emission), ...(p.emission ?? ZERO), 0
      ]), MAX_PROJECTIONS, 28),
      u_pbrSky: [...environment.sky, environment.intensity],
      u_pbrHorizon: [...environment.horizon, exposure],
      u_pbrGround: environment.ground
    };
  }
  function splatNormal(world, i, frame, M) {
    if (frame.normal) return frame.normal;
    const captured = world.gaussianHarmonics?.normals?.subarray(i * 3, i * 3 + 3);
    if (captured?.some(Boolean)) return unit(frame.worldNormal(Array.from(captured)), ZERO);
    const q = i * 16;
    const [xx, xy, xz, yy, yz, zz] = [4, 5, 6, 8, 9, 10].map(k => world.data[q + k]);
    let a = [xx, xy, xz, xy, yy, yz, xz, yz, zz];
    const basis = frame.basis().covariance;
    if (basis) a = M.mul(M.mul(basis, a), M.tr(basis));
    const scale = Math.max(a[0], a[4], a[8]);
    if (!(scale > 0)) return ZERO;
    a = a.map(n => n / scale);
    if (Math.max(Math.abs(a[0] - a[4]), Math.abs(a[0] - a[8]), Math.abs(a[4] - a[8]),
      Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[5])) < .025) return ZERO;
    // A regularized inverse has the same axes, led by the narrowest axis of the covariance.
    a[0] += .001;
    a[4] += .001;
    a[8] += .001;
    if (!(M.det(a) > 1e-12)) return ZERO;
    const inverse = M.inv(a);
    let normal = [inverse.slice(0, 3), inverse.slice(3, 6), inverse.slice(6, 9)]
      .reduce((best, axis) => dot(axis, axis) > dot(best, best) ? axis : best, ZERO);
    normal = unit(normal, ZERO);
    for (let step = 0; step < 6; step++) normal = unit(M.app(inverse, normal), ZERO);
    return normal;
  }
  function splatBindings(world, plan) {
    const targets = selectors.index(world), cache = new Map();
    return i => {
      const target = targets.row(i);
      if (!cache.has(target)) cache.set(target, plan.resolve(target));
      return cache.get(target);
    };
  }
  function restTransform(world, i, frame) {
    const q = i * 16, at = frame.position();
    const stored = world.curveRest?.[q+3] && world.curveRest.subarray(q,q+16);
    const shape = stored && curves.spanShape(world.data,q,1);
    let map = frame.localOffset, rest = frame.rest;
    if (shape) {
      const authored = world.curveStations?.subarray(i*curves.stationStride+4,i*curves.stationStride+7);
      const axis = authored && dot(authored,shape.axis)<0 ? shape.axis.map(n=>-n) : shape.axis;
      const u = stored.subarray(12,15), v = cross(axis,u);
      const restAxis = stored.subarray(4,7), restU = stored.subarray(8,11), restV = cross(restAxis,restU);
      const along = stored[3] / Math.max(1e-8,shape.half), radial = stored[7] / shape.radius;
      rest = stored.subarray(0,3);
      map = (x,y,z) => {
        const offset = [x,y,z], t = dot(offset,axis)*along;
        const across = dot(offset,u)*radial, up = dot(offset,v)*radial;
        return restAxis.map((n,k)=>n*t+restU[k]*across+restV[k]*up);
      };
    }
    if (rest.length!==3) return undefined;
    const x = map(1,0,0), y = map(0,1,0), z = map(0,0,1);
    const moved = map(...at);
    const affine = [0,1,2].map(k=>[x[k],y[k],z[k],rest[k]-moved[k]]);
    const identity = affine.every((row,k)=>row.every((n,j)=>Math.abs(n-Number(k===j))<1e-8));
    return identity ? undefined : affine;
  }

  function restPoint(affine, point) {
    return affine ? affine.map(row=>dot(row,point)+row[3]) : point;
  }

  function restTable(world, plan, frameAt, materialAt) {
    const transforms = [];
    let offsets;
    if (plan.hasBands) for(let i=0;i<world.count;i++){
      if (!plan.materials[materialAt(i)-1]?.readBand) continue;
      const transform=restTransform(world,i,frameAt(i));
      if (!transform) continue;
      offsets ??= new Float32Array(world.count*4);
      offsets[i*4]=world.count+transforms.length/4;
      for(const row of transform) transforms.push(...row);
    }
    return {offsets,transforms};
  }

  function encodeNormal(n) {
    const scale = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
    if (!scale) return [2, 2];
    const x = n[0] / scale, y = n[1] / scale;
    if (n[2] >= 0) return [x, y];
    return [(1 - Math.abs(y)) * (x < 0 ? -1 : 1), (1 - Math.abs(x)) * (y < 0 ? -1 : 1)];
  }
  const glsl = `
uniform int u_pbrLights, u_pbrProjections;
uniform vec4 u_pbrMaterial[${MAX_MATERIALS * 5}], u_pbrLight[${MAX_LIGHTS * 2}], u_pbrProjection[${MAX_PROJECTIONS * 7}];
uniform vec4 u_pbrSky, u_pbrHorizon;
uniform vec3 u_pbrGround;
#ifdef INK_PBR_FOOTPRINT
const bool pbrSampleSpecular=true;
#else
const bool pbrSampleSpecular=false;
#endif
struct PbrTap { vec3 position; vec3 normal; vec3 shadowNormal; vec3 view; float coverage; };
vec2 pbrTapOffset(vec2 pixel,float scale,int index){
  vec2 fraction=vec2(float(index&1),float(index>>1))*.5+.25;
  return (floor(pixel/scale)+fraction)*scale-pixel;
}
uniform highp sampler2D u_pbrRows;
uniform highp int u_pbrRampOffset;
uniform vec4 u_pbrShadow[16],u_pbrShadowBounds[4];
uniform float u_pbrShadowRamp[16],u_pbrShadowStrength;
uniform int u_pbrShadowRampCount;
vec4 pbrRow(int at){
  return texelFetch(u_pbrRows,ivec2(at&511,at>>9),0);
}
vec4 pbrRampRow(int index){
  return pbrRow(u_pbrRampOffset+index);
}

#ifdef INK_PBR_BANDS
uniform highp int u_pbrBands[${MAX_MATERIALS}], u_pbrRestOffset;
vec3 pbrRestPoint(int row,vec3 point){
  if(u_pbrRestOffset<0)return point;
  int offset=int(pbrRow(u_pbrRestOffset+row).x);
  if(offset==0)return point;
  int at=u_pbrRestOffset+offset;
  vec4 p=vec4(point,1.0);
  return vec3(dot(pbrRow(at),p),dot(pbrRow(at+1),p),dot(pbrRow(at+2),p));
}
float pbrBand(int start,vec3 at){
  if(start==0)return 0.0;
  int count=int(pbrRampRow(start-1).x), cursor=start;
  float bias=0.0;
  for(int i=0;i<count;i++){
    vec4 lo=pbrRampRow(cursor),hi=pbrRampRow(cursor+1),brush=pbrRampRow(cursor+2);
    int segments=int(brush.x);
    cursor+=3;
    if(all(greaterThanEqual(at,lo.xyz))&&all(lessThanEqual(at,hi.xyz))){
      float nearest=lo.w*lo.w;
      for(int j=0;j<segments;j++){
        vec4 a=pbrRampRow(cursor+j*2);
        vec3 d=pbrRampRow(cursor+j*2+1).xyz, q=at-a.xyz;
        vec3 delta=q-d*clamp(dot(q,d)*a.w,0.0,1.0);
        nearest=min(nearest,dot(delta,delta));
      }
      if(nearest<lo.w*lo.w){
        float weight=hi.w>0.0?clamp((1.0-sqrt(nearest)/lo.w)/hi.w,0.0,1.0):1.0;
        bias=mix(bias,brush.y,weight*weight*(3.0-2.0*weight));
      }
    }
    cursor+=segments*2;
  }
  return bias;
}
#else
vec3 pbrRestPoint(int row,vec3 point){return point;}
#endif
vec4 pbrRamp(int start,vec4 info,float value,float fallbackWeight){
  int lo=0, hi=int(info.x)-1;
  for(int i=0;i<8&&lo<hi;i++){
    int mid=(lo+hi)/2;
    if(pbrRampRow(start+mid*2).a<value)lo=mid+1;
    else hi=mid;
  }
  int second=start+hi*2;
  vec4 b=pbrRampRow(second);
  float w=pbrRampRow(second+1).x;
  if(hi>0&&value<b.a){
    vec4 a=pbrRampRow(second-2);
    float t=info.y==0.0?0.0:(value-a.a)/(b.a-a.a);
    if(info.y==2.0)t=t*t*(3.0-2.0*t);
    b.rgb=mix(a.rgb,b.rgb,t);
    w=mix(pbrRampRow(second-1).x,w,t);
  }
  return vec4(b.rgb,w<0.0?fallbackWeight:w);
}
vec3 pbrLinear(vec3 c) {
  return mix(pow((max(c,0.0)+0.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(0.04045)));
}
vec3 pbrDisplay(vec3 c) {
  return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,c*12.92,lessThanEqual(c,vec3(0.0031308)));
}
vec3 pbrUnit(vec3 v,vec3 fallback) { float q=dot(v,v); return q>1e-16?v*inversesqrt(q):fallback; }
float pbrVisibility(int index,vec3 at,vec3 normal,vec3 light){
  int row=index*4;
  vec4 u=u_pbrShadow[row],v=u_pbrShadow[row+1],shape=u_pbrShadow[row+2],options=u_pbrShadow[row+3];
  if(shape.z<=0.0)return 1.0;
  vec4 bounds=u_pbrShadowBounds[index];
  vec2 lightAt=vec2(dot(at,u.xyz),dot(at,v.xyz));
  if(bounds.z>bounds.x && (any(lessThan(lightAt,bounds.xy))||any(greaterThanEqual(lightAt,bounds.zw))))return 1.0;
  vec2 uv=(lightAt-vec2(u.a,v.a))/shape.z;
  float facing=dot(normal,light);
  if(facing<0.0)normal=-normal;
  vec2 slope=-vec2(dot(normal,u.xyz),dot(normal,v.xyz))*shape.z/max(.1,abs(facing));
  float depth=dot(at,light)+shape.w, clear=0.0;
  ivec2 cell=ivec2(floor(uv)),size=ivec2(shape.xy);
  int radius=int(options.y);
  for(int y=-radius;y<=radius;y++)for(int x=-radius;x<=radius;x++){
    ivec2 test=cell+ivec2(x,y);
    if(any(lessThan(test,ivec2(0)))||any(greaterThanEqual(test,size)))clear+=1.0;
    else{
      int texel=test.y*size.x+test.x;
      float closest=pbrRow(int(options.x)+(texel>>2))[texel&3];
      float cutoff=depth+dot(vec2(test)+.5-uv,slope);
      if(closest>cutoff)continue;
      float through=1.0;
      if(options.z>0.0){
        int first=int(pbrRow(int(options.z)-1+(texel>>2))[texel&3])-1;
        if(first>=0)for(int j=0;j<${shadows.curveLayers/2};j++){
          vec4 layer=pbrRow(first+j);
          if(layer.x>cutoff)through*=1.0-layer.y;
          if(layer.z>cutoff)through*=1.0-layer.w;
        }
      }
      clear+=through;
    }
  }
  float count=float(2*radius+1);
  float visibility=clear/(count*count);
  if(u_pbrShadowRampCount>0)visibility=u_pbrShadowRamp[int(floor(visibility*float(u_pbrShadowRampCount-1)+.5))];
  return mix(1.0,visibility,u_pbrShadowStrength);
}
vec3 pbrDecodeNormal(vec2 oct) {
  if(oct.x>1.0)return vec3(0);
  vec3 n=vec3(oct,1.0-abs(oct.x)-abs(oct.y));
  n.xy+=mix(vec2(-1),vec2(1),lessThan(n.xy,vec2(0)))*max(0.0,-n.z);
  return normalize(n);
}
float pbrSchlick(float cosine) { return pow(1.0-clamp(cosine,0.0,1.0),5.0); }
vec3 pbrEnv(float y) { return mix(u_pbrHorizon.rgb,y>=0.0?u_pbrSky.rgb:u_pbrGround,abs(y)); }
float pbrLobe(vec3 h,vec3 l,vec3 n,vec3 t,vec3 b,vec3 v,float nl,float nv,vec2 a) {
  vec3 halfScale=vec3(vec2(dot(t,h),dot(b,h))/a,max(0.0,dot(n,h)));
  float q=dot(halfScale,halfScale);
  float d=1.0/(3.141592654*a.x*a.y*q*q);
  float lv=length(vec3(vec2(dot(t,v),dot(b,v))*a,nv));
  float ll=length(vec3(vec2(dot(t,l),dot(b,l))*a,nl));
  return 0.5*d/max(1e-6,nl*lv+nv*ll);
}
vec3 pbrShine(vec3 h,vec3 l,vec3 n,vec3 t,vec3 b,vec3 v,float nl,float nv,vec3 axes,
              vec3 f0,float s,float coatFresnel) {
  float base=pbrLobe(h,l,n,t,b,v,nl,nv,axes.xy);
  float top=coatFresnel>0.0?coatFresnel*pbrLobe(h,l,n,t,b,v,nl,nv,vec2(axes.z)):0.0;
  return base*mix(f0,vec3(1),s)*(1.0-coatFresnel)+top;
}
vec4 pbrHighlight(int rampId,vec4 swatch,float strength,float response) {
  if(rampId>0){
    float level=clamp(response,0.0,1.0);
    vec4 ramp=pbrRamp(rampId,pbrRampRow(rampId-1),level,level);
    float weight=ramp.a*strength;
    return vec4(pbrLinear(ramp.rgb)*weight,weight);
  }
  float weight=response>swatch.a?strength:0.0;
  return vec4(swatch.rgb*weight,weight);
}
vec3 pbrTapShine(PbrTap tap,vec3 tangent,vec3 f0,vec3 axes,
                  float coat,bool receiveShadow,out float response){
  vec3 v=pbrUnit(tap.view,vec3(0,0,1)),n=pbrUnit(tap.normal,v);
  if(dot(n,v)<0.0)n=-n;
  vec3 stable=normalize(cross(abs(n.y)<0.9?vec3(0,1,0):vec3(1,0,0),n));
  vec3 t=pbrUnit(tangent-dot(tangent,n)*n,stable),b=cross(n,t);
  float nv=max(1e-4,dot(n,v));
  vec3 sum=vec3(0);
  response=0.0;
  for(int i=0;i<u_pbrLights;i++){
    vec3 light=u_pbrLight[i*2].xyz;
    float nl=dot(n,light);
    if(nl<=0.0)continue;
    float visibility=receiveShadow?pbrVisibility(i,tap.position,pbrUnit(tap.shadowNormal,n),light):1.0;
    if(visibility<=0.0)continue;
    vec3 h=pbrUnit(v+light,n);
    float s=pbrSchlick(dot(v,h));
    vec3 color=pbrShine(h,light,n,t,b,v,nl,nv,axes,f0,s,coat*mix(0.04,1.0,s))*
      (u_pbrLight[i*2+1].rgb*(nl*visibility));
    sum+=color;
    response=max(response,max(color.r,max(color.g,color.b)));
  }
  return sum;
}
vec3 pbrShade(int id,vec3 pigment,vec3 normal,vec3 shadowNormal,vec3 tangent,vec3 view,vec3 at,vec3 rest,
              float sampledRoughness,float sampledMetalness,float sampledCoat,vec3 sampledEmission,PbrTap taps[4]) {
  if (id==0) return pigment;
  bool receiveShadow=id>0;
  id=abs(id);
  int m=(id-1)*5;
  vec4 baseRow=u_pbrMaterial[m], controls=u_pbrMaterial[m+1], emissionCoat=u_pbrMaterial[m+2];
  vec4 swatch=u_pbrMaterial[m+3], finish=u_pbrMaterial[m+4];
  vec3 base=baseRow.a>0.0?baseRow.rgb:pbrLinear(pigment);
  float rough=controls.x>=0.0?controls.x:sampledRoughness;
  float metal=controls.y>=0.0?controls.y:sampledMetalness;
  float coat=emissionCoat.a>=0.0?emissionCoat.a:sampledCoat;
  vec3 emission=emissionCoat.rgb+sampledEmission;
  for (int i=0;i<u_pbrProjections;i++) {
    int s=i*7;
    vec4 origin=u_pbrProjection[s], u=u_pbrProjection[s+1], v=u_pbrProjection[s+2], plane=u_pbrProjection[s+3];
    if (plane.a!=0.0&&int(plane.a)!=id) continue;
    vec3 offset=at-origin.xyz;
    vec2 local=vec2(dot(u.xyz,offset),dot(v.xyz,offset));
    float edge=min(min(local.x,1.0-local.x),min(local.y,1.0-local.y));
    if (edge<0.0||abs(dot(plane.xyz,offset))>origin.a) continue;
    float weight=v.a*(u.a>0.0?clamp(edge/u.a,0.0,1.0):1.0);
    vec4 projectedBase=u_pbrProjection[s+4], channels=u_pbrProjection[s+5];
    if (projectedBase.a>0.0) base=mix(base,projectedBase.rgb,weight);
    if (channels.x>=0.0) rough=mix(rough,channels.x,weight);
    if (channels.y>=0.0) metal=mix(metal,channels.y,weight);
    if (channels.z>=0.0) coat=mix(coat,channels.z,weight);
    if (channels.w>0.0) emission=mix(emission,u_pbrProjection[s+6].rgb,weight);
  }
  vec3 v=pbrUnit(view,vec3(0,0,1)), n=pbrUnit(normal,v);
  if (dot(n,v)<0.0) n=-n;
  vec3 casterNormal=pbrUnit(shadowNormal,n);
  vec3 stable=normalize(cross(abs(n.y)<0.9?vec3(0,1,0):vec3(1,0,0),n));
  vec3 t=pbrUnit(tangent-dot(tangent,n)*n,stable), b=cross(n,t);
  float nv=max(1e-4,dot(n,v)), grazing=pbrSchlick(nv);
  vec3 f0=mix(vec3(controls.z),base,metal), fresnel=mix(f0,vec3(1),grazing);
  vec3 reflectedEnv=pbrEnv((2.0*nv*n.y-v.y)*(1.0-rough*rough));
  float coatView=coat*mix(0.04,1.0,grazing);
  vec3 diffuse=base*(1.0-metal)*(1.0-fresnel)*pbrEnv(n.y);
  vec3 reflected=fresnel*reflectedEnv*(1.0-0.5*rough);
  vec3 rgb=emission+u_pbrSky.a*((diffuse+reflected)*(1.0-coatView)+coatView*reflectedEnv);
  float aspect=sqrt(1.0-0.9*controls.a), a=max(0.012,rough*rough), ac=max(0.012,finish.x*finish.x);
  vec3 axes=vec3(a/aspect,a*aspect,ac);
  float highlight=0.0, incidence=0.0;
  int diffuseRamp=int(finish.z), specularRamp=int(finish.w);
  #ifdef INK_PBR_BANDS
  float band=pbrBand(u_pbrBands[id-1],rest);
  #else
  const float band=0.0;
  #endif
  vec4 diffuseInfo=diffuseRamp>0?pbrRampRow(diffuseRamp-1):vec4(0);
  for (int i=0;i<u_pbrLights;i++) {
    vec4 lightRow=u_pbrLight[i*2];
    vec3 light=lightRow.xyz;
    float nl=dot(n,light);
    float response=diffuseRamp>0?clamp((nl+diffuseInfo.w)/(1.0+diffuseInfo.w)-band,0.0,1.0)*lightRow.w:0.0;
    if(nl<=0.0&&response==0.0)continue;
    float visibility=receiveShadow?pbrVisibility(i,at,casterNormal,light):1.0;
    incidence=max(incidence,response*visibility);
    if (nl<=0.0||visibility<=0.0) continue;
    vec3 h=pbrUnit(v+light,n);
    float s=pbrSchlick(dot(v,h)), coatFresnel=coat*mix(0.04,1.0,s);
    vec3 spec=pbrSampleSpecular?vec3(0):pbrShine(h,light,n,t,b,v,nl,nv,axes,f0,s,coatFresnel);
    vec3 direct=base*(1.0-metal)*(1.0-mix(f0,vec3(1),s))/3.141592654;
    vec3 irradiance=u_pbrLight[i*2+1].rgb*(nl*visibility);
    rgb+=irradiance*(direct*(1.0-coatFresnel)+spec);
    vec3 shine=irradiance*spec;
    highlight=max(highlight,max(shine.r,max(shine.g,shine.b)));
  }
  float exposure=u_pbrHorizon.a;
  vec4 accent=vec4(0);
  if(pbrSampleSpecular){
    float cap=1.0/max(1e-4,exposure);
    float spread=0.0;
    for(int j=0;j<4;j++)if(taps[j].coverage>0.0)
      spread=max(spread,1.0-abs(dot(n,pbrUnit(taps[j].normal,n))));
    vec3 sampledAxes=sqrt(axes*axes+vec3(.25*spread));
    for(int j=0;j<4;j++){
      if(taps[j].coverage<=0.0)continue;
      float response;
      float area=taps[j].coverage*.25;
      vec3 sampled=pbrTapShine(taps[j],tangent,f0,sampledAxes,coat,receiveShadow,response);
      rgb+=min(vec3(cap),sampled)*area;
      accent+=pbrHighlight(specularRamp,swatch,finish.y,response)*area;
    }
  }else accent=pbrHighlight(specularRamp,swatch,finish.y,highlight);
  vec3 display=clamp(rgb*exposure,0.0,1.0);
  if(diffuseRamp>0){
    vec4 ramp=pbrRamp(diffuseRamp,diffuseInfo,incidence,1.0);
    display=clamp(mix(clamp((rgb-emission)*exposure,0.0,1.0),pbrLinear(ramp.rgb),ramp.a*diffuseInfo.z)+
      emission*exposure,0.0,1.0);
  }
  return pbrDisplay(display*(1.0-accent.a)+accent.rgb);
}
`;
  return Object.freeze({ prepare, shade, finish, footprint, uniforms, rampTable, glsl, restTransform, restPoint, restTable, splatNormal, splatBindings, encodeNormal, shadows });
})();
if (typeof module !== 'undefined') module.exports = PbrMaterials;
