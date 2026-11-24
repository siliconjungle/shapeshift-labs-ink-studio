/* Portable material parameters and the matching CPU/WebGL lighting equations. */
const PbrMaterials = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const colors = typeof ColorSpace === 'undefined' ? require('./color-space.js') : ColorSpace;
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
  function material(value) {
    record(value, 'PBR material');
    const coat = typeof value.coating === 'number' ? { weight: value.coating } : value.coating;
    const ior = number(value.ior ?? 1.5, 'Material IOR', 1, 4);
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
      highlight: value.highlight ? color(value.highlight.color, 'Highlight swatch') : ZERO,
      threshold: number(value.highlight?.threshold ?? .25, 'Highlight threshold', 0, 64),
      highlightWeight: number(value.highlight ? value.highlight.strength ?? 1 : 0, 'Highlight strength', 0, 1)
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
  function prepare(definition, lightsOverride) {
    if (definition == null || definition === false) return null;
    record(definition, 'PBR recipe');
    const entries = Object.entries(record(definition.materials, 'Named PBR materials'));
    if (!entries.length || entries.length > MAX_MATERIALS)
      throw new RangeError('PBR needs one to ' + MAX_MATERIALS + ' named materials');
    const materials = entries.map(([, value]) => material(value));
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
      return { direction, color: color(value.color ?? WHITE, 'Light color').map(channel => channel * intensity) };
    });
    const settings = definition.environment ?? {};
    const environment = {
      sky: color(settings.sky ?? '#a9c1ef', 'Sky color'),
      horizon: color(settings.horizon ?? '#948e9a', 'Horizon color'),
      ground: color(settings.ground ?? '#50414f', 'Ground color'),
      intensity: number(settings.intensity ?? .45, 'Environment intensity', 0, 16)
    };
    const exposure = number(definition.exposure ?? 1, 'PBR exposure', 0, 32);
    const projections = boundedList(definition.projections ?? [], MAX_PROJECTIONS, 'PBR projections')
      .map(value => projection(value, value.material === undefined ? 0 : id(value.material)));
    function resolve(target) {
      for (let i = bindings.length - 1; i >= 0; i--) {
        if (selectors.matches(bindings[i].select, target ?? {})) return bindings[i].id;
      }
      return defaultId;
    }
    return {
      materials, lights, environment, exposure, projections, resolve,
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
  function shade(plan, id, sample) {
    const m = plan.materials[id - 1];
    if (!m) return sample.color;
    let base = m.base ?? toLinear(sample.color.map(clamp));
    let rough = m.roughness < 0 ? sample.roughness ?? .45 : m.roughness;
    let metal = m.metalness < 0 ? sample.metalness ?? 0 : m.metalness;
    let coat = m.coat < 0 ? sample.coating ?? 0 : m.coat;
    let emission = m.emission.map((channel, i) => channel + (sample.emission?.[i] ?? 0));
    for (const p of plan.projections) {
      if (p.id && p.id !== id) continue;
      const offset = sub(sample.position, p.origin);
      const x = dot(p.u, offset), y = dot(p.v, offset), depth = Math.abs(dot(p.normal, offset));
      const edge = Math.min(x, 1 - x, y, 1 - y);
      if (edge < 0 || depth > p.reach) continue;
      const weight = p.weight * (p.feather ? clamp(edge / p.feather) : 1);
      if (p.base) base = base.map((value, i) => mix(value, p.base[i], weight));
      if (p.roughness >= 0) rough = mix(rough, p.roughness, weight);
      if (p.metalness >= 0) metal = mix(metal, p.metalness, weight);
      if (p.coat >= 0) coat = mix(coat, p.coat, weight);
      if (p.emission) emission = emission.map((value, i) => mix(value, p.emission[i], weight));
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
    const a = Math.max(.012, rough * rough), ac = Math.max(.012, m.coatRoughness ** 2);
    let highlight = 0;
    for (const light of plan.lights) {
      const l = light.direction, nl = dot(n, l);
      if (nl <= 0) continue;
      const h = unit(v.map((value, i) => value + l[i]), n), s = schlick(dot(v, h));
      const specular = lobe(h, l, frame, nl, a / aspect, a * aspect);
      const coatFresnel = coat * mix(.04, 1, s);
      const top = coatFresnel ? coatFresnel * lobe(h, l, frame, nl, ac, ac) : 0;
      for (let i = 0; i < 3; i++) {
        const irradiance = light.color[i] * nl, fresnel = mix(f0[i], 1, s);
        const spec = specular * fresnel;
        const diffuse = base[i] * (1 - metal) * (1 - fresnel) / Math.PI;
        rgb[i] += irradiance * ((diffuse + spec) * (1 - coatFresnel) + top);
        highlight = Math.max(highlight, irradiance * (spec * (1 - coatFresnel) + top));
      }
    }
    const weight = highlight > m.threshold ? m.highlightWeight : 0;
    return toDisplay(rgb.map((channel, i) => mix(clamp(channel * plan.exposure), m.highlight[i], weight)));
  }

  function uniforms(plan) {
    const { materials, lights, projections, environment, exposure } = plan;
    const table = (rows, max, stride) => {
      const result = new Float32Array(max * stride);
      rows.forEach((values, i) => result.set(values, i * stride));
      return result;
    };
    return {
      u_pbrLights: lights.length, u_pbrProjections: projections.length,
      u_pbrMaterial: table(materials.map(m => [
        ...(m.base ?? ZERO), Number(!!m.base), m.roughness, m.metalness, m.f0, m.anisotropy,
        ...m.emission, m.coat, ...m.highlight, m.threshold, m.coatRoughness, m.highlightWeight, 0, 0
      ]), MAX_MATERIALS, 20),
      u_pbrLight: table(lights.map(l => [...l.direction, 0, ...l.color, 0]), MAX_LIGHTS, 8),
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
vec3 pbrLinear(vec3 c) {
  return mix(pow((max(c,0.0)+0.055)/1.055,vec3(2.4)),c/12.92,lessThanEqual(c,vec3(0.04045)));
}
vec3 pbrDisplay(vec3 c) {
  return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,c*12.92,lessThanEqual(c,vec3(0.0031308)));
}
vec3 pbrUnit(vec3 v,vec3 fallback) { float q=dot(v,v); return q>1e-16?v*inversesqrt(q):fallback; }
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
vec3 pbrShade(int id,vec3 pigment,vec3 normal,vec3 tangent,vec3 view,vec3 at,
              float sampledRoughness,float sampledMetalness,float sampledCoat,vec3 sampledEmission) {
  if (id<=0) return pigment;
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
  float highlight=0.0;
  for (int i=0;i<u_pbrLights;i++) {
    vec3 light=u_pbrLight[i*2].xyz;
    float nl=dot(n,light);
    if (nl<=0.0) continue;
    vec3 h=pbrUnit(v+light,n);
    float s=pbrSchlick(dot(v,h)), coatFresnel=coat*mix(0.04,1.0,s);
    vec3 spec=mix(f0,vec3(1),s)*pbrLobe(h,light,n,t,b,v,nl,nv,vec2(a/aspect,a*aspect));
    float top=coatFresnel>0.0?coatFresnel*pbrLobe(h,light,n,t,b,v,nl,nv,vec2(ac)):0.0;
    vec3 direct=base*(1.0-metal)*(1.0-mix(f0,vec3(1),s))/3.141592654;
    vec3 irradiance=u_pbrLight[i*2+1].rgb*nl;
    rgb+=irradiance*((direct+spec)*(1.0-coatFresnel)+top);
    vec3 shine=irradiance*(spec*(1.0-coatFresnel)+top);
    highlight=max(highlight,max(shine.r,max(shine.g,shine.b)));
  }
  return pbrDisplay(mix(clamp(rgb*u_pbrHorizon.a,0.0,1.0),swatch.rgb,highlight>swatch.a?finish.y:0.0));
}
`;
  return Object.freeze({ prepare, shade, uniforms, glsl, splatNormal, splatBindings, encodeNormal });
})();
if (typeof module !== 'undefined') module.exports = PbrMaterials;
