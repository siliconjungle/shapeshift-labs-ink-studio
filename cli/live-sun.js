// An orthographic depth map and hemisphere lighting for the posed splats.
const ColorSpace = require('../src/color-space.js');
const ShadowArt = require('../src/shadow-art.js');
const DirectionalShadowMap = require('../src/directional-shadow-map.js');
const Channels = require('../src/lighting-channels.js');
const StrandShadows = require('./strand-shadows.js');
const linear = ColorSpace.prepare('srgb', 'srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear', 'srgb');
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(n => n / length);
};
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const defaultDirection = [-.52, .64, .57];
const bounceColors = Object.freeze({
  'clear-sky': '#7aaeff', overcast: '#c6d6e3', sand: '#ffbd77', snow: '#edf5ff', water: '#54bdc9'
});

function bounceSettings(value, time) {
  const sample = typeof value === 'function' ? value(time) : value;
  if (sample === false || sample === 'off') return null;
  if (sample === undefined) return;
  if (typeof sample === 'string') return { color: sample };
  if (!sample || Object.getPrototypeOf(sample) !== Object.prototype ||
      Object.keys(sample).some(key => key !== 'color' && key !== 'intensity'))
    throw new TypeError('Bounce needs a color, preset name, settings object or off');
  return sample;
}

function bounce(authored, override, fallback, time) {
  const chosen = bounceSettings(override, time);
  if (chosen === null) return null;
  const previous = bounceSettings(authored, time);
  if (!chosen && !previous) return null;
  const { color = fallback, intensity = .4 } = { ...previous, ...chosen };
  const value = typeof color === 'string' && Object.hasOwn(bounceColors, color) ? bounceColors[color] : color;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw new TypeError('Bounce color needs #rrggbb or one of ' + Object.keys(bounceColors).join(', '));
  if (!range(intensity, 0, 4)) throw new RangeError('Bounce intensity needs a number from 0 to 4');
  const rgb = linear([1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
  return intensity && rgb.some(Boolean) ? rgb.map(c => c * intensity) : null;
}

function prepare(authored, override, time, celestialSun) {
  const enabled = override ?? authored;
  if (enabled === undefined || enabled === false) return null;
  const settings = value => {
    if (value === true || value === undefined || value === false) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('liveSun needs a settings object or boolean');
    return value;
  };
  const base = settings(authored), selected = settings(override ?? undefined);
  const { direction = defaultDirection, ambient = .32, intensity = .88,
    shadows = true, mapSize = 512, bias = .02, filter = 1 } = { ...base, ...selected };
  const strandShadows = selected.strandShadows === false ? {} :
    { ...StrandShadows.prepare(base.strandShadows), ...StrandShadows.prepare(selected.strandShadows) };
  const sky = bounce(base.skyBounce, selected.skyBounce, 'clear-sky', time);
  const ground = bounce(base.groundBounce, selected.groundBounce, 'sand', time);
  const directionAt = celestialSun?.direction ?? (typeof direction === 'function' ? direction(time) : direction);
  if (!Array.isArray(directionAt) || directionAt.length !== 3 || !Array.from(directionAt).every(Number.isFinite) ||
      !Number.isFinite(Math.hypot(...directionAt)) || Math.hypot(...directionAt) === 0)
    throw new TypeError('Live sun direction needs a finite nonzero XYZ vector');
  if (!range(ambient, 0, 4) || !range(intensity, 0, 4) || !range(bias, 0, 10) || !range(mapSize, 32, 2048) ||
      !Number.isInteger(mapSize) || !Number.isInteger(filter) || !range(filter, 0, 2) || typeof shadows !== 'boolean')
    throw new RangeError('Invalid live sun lighting or shadow map settings');
  return { direction: unit(directionAt), ambient, intensity: intensity * (celestialSun?.gain ?? 1), shadows, mapSize, bias, filter, sky, ground,
    strandShadows };
}

function shadowMap(sun, world, pose, normalAt, casts, {curveAt,curveProxyAt,curveData,curveStats}) {
  if (!sun.shadows || !sun.intensity) return null;
  const {x,y,z,scale} = pose, policy = sun.strandShadows ?? {};
  const map = DirectionalShadowMap.build(sun,world,pose,normalAt,casts,{curveAt,
    drawCurves(frame,strands,camera) {
      const {map,right,up,light,minU,minV,width,height,texel} = frame;
      const {submit,stats} = StrandShadows.plan(world,{...camera,focal:1/texel},strands,
        [minU,minV,minU+width*texel,minV+height*texel],policy,{
          data:curveData ?? world.data,positionAt:i=>[x[i],y[i],z[i]],scaleAt:i=>scale[i],
          proxyAt:curveProxyAt && ((i,opacity)=>curveProxyAt(i,camera,opacity))
        });
      const layers = DirectionalShadowMap.rasterCurves(submit,map,[right,up,light],{minU,minV,width,height,texel},policy,stats);
      curveStats?.({...stats,texel,width,height});
      return layers;
    }
  });
  return map && ((x,y,z,normal,facing)=>DirectionalShadowMap.visibility(map,x,y,z,normal,facing));
}

function create(sun, world, pose, normalAt, cloudShadow, exposure,
  { shadowArt, footprint, probes, curveAt, curveProxyAt, curveData, curveStats, artLighting, traced, paintShadowBands } = {}) {
  // Albedo exists on opted-in sculpt bakes and explicitly described builder rows.
  // Older pixel-material bakes still carry the original material ramps.
  const fill = new Int32Array(pose.alpha.length).fill(-1);
  const normals = [], geometryNormals=artLighting?.normal ? [] : normals;
  for (let i = 0; i < fill.length; i++) {
    if (!pose.alpha[i] || (Math.round(world.data[i*16+11]) & (32 | 64 | 256))) continue;
    const reference = world.materialAlbedo?.[i], palette = world.pix?.[i*8];
    const rgb = reference ? reference - 1 : palette ? world.pal[world.ramps?.[palette - 1]?.at(-1)] : undefined;
    if (rgb === undefined) continue;
    const normal = normalAt(i);
    if (!normal) continue;
    geometryNormals[i] = normal;
    normals[i] = artLighting?.normal?.(i,normal) ?? normal;
    fill[i] = rgb;
  }
  const art = ShadowArt.prepare(shadowArt ?? world.look?.shadowArt);
  const receives = ShadowArt.bind(art, world, 'receive');
  const coarse = ShadowArt.small(art, footprint);
  const shadow = shadowMap(sun,world,pose,normalAt,ShadowArt.bind(art,world,'cast'),{curveAt,curveProxyAt,curveData,curveStats});
  const facing = new Float32Array(fill.length), curves=artLighting?.curves;
  const splitIndirect=curves?.sky || curves?.bounce;
  const indirect = (sun.sky || sun.ground) && new Float32Array(fill.length * 3);
  const inkControls=paintShadowBands && world.renderMetadata?.inkControls;
  function direct(i,cosine,bias=inkControls?.[i*4]) {
    const facing=bias ? Math.min(1,cosine-bias) : cosine;
    return Math.max(0,artLighting?.band?.(i,facing) ?? facing);
  }
  for (let i = 0; i < normals.length; i++) {
    const normal = normals[i];
    if (!normal) continue;
    const cosine=dot(normal,sun.direction);
    facing[i] = direct(i,cosine);
    if (indirect) {
      // A cosine-weighted hemisphere sends half its light to a vertical surface.
      const upper = (1 + normal[1]) * .5;
      for (let c = 0; c < 3; c++)
        indirect[3*i+c] = upper * (sun.sky?.[c] ?? 0) + (1 - upper) * (sun.ground?.[c] ?? 0);
    }
  }
  const visibility = (i, x, y, z, exact, cosine=facing[i]) => {
    if (!normals[i]) return undefined;
    const normal=exact ?? geometryNormals[i];
    const geometry = shadow && cosine > 0 && (!receives || receives(i)) ?
      ShadowArt.transfer(art, shadow(x, y, z, normal, artLighting?.normal || artLighting?.band || inkControls ?
        Math.abs(dot(normal,sun.direction)) : cosine), coarse) : 1;
    const value=geometry && geometry * (cloudShadow?.(x,y,z) ?? 1) * (exposure?.(x,y,z) ?? 1);
    return curves?.shadow ? curves.shadow(value) : value;
  };
  function transmissionVisibility(i, point, normal, bias) {
    const cosine = dot(normal, sun.direction);
    const toward = cosine < 0 ? normal.map(value => -value) : normal;
    const geometry = shadow && (!receives || receives(i)) ? ShadowArt.transfer(art, shadow(
      ...point.map((value, axis) => value + sun.direction[axis] * bias), toward, Math.abs(cosine)
    ), coarse) : 1;
    const [x, y, z] = point;
    return geometry * (cloudShadow?.(x, y, z) ?? 1) * (exposure?.(x, y, z) ?? 1);
  }
  function curveVisibility(i, point, normal = sun.direction) {
    if (!shadow || receives && !receives(i)) return 1;
    const cosine = dot(normal, sun.direction);
    const toward = cosine < 0 ? normal.map(value => -value) : normal;
    const value=ShadowArt.transfer(art, shadow(...point, toward, Math.abs(cosine)), coarse);
    return curves?.shadow ? curves.shadow(value) : value;
  }
  function level(i,x,y,z,exact,inkControl) {
    const amount=exact ? direct(i,dot(artLighting?.normal?.(i,exact) ?? exact,sun.direction),
      paintShadowBands ? inkControl : undefined) : facing[i];
    return sun.ambient + sun.intensity*amount*visibility(i,x,y,z,exact,amount);
  }
  const indirectScratch = [0,0,0];
  function indirectAt(i,x,y,z,out = [0,0,0]) {
    const offset = i * 3;
    const local = probes?.(i,x,y,z,normals[i]);
    if (!local && (!indirect || !(indirect[offset] || indirect[offset+1] || indirect[offset+2]))) return null;
    const mix = local?.mix ?? 0, openness = exposure?.(x,y,z) ?? 1;
    if(splitIndirect){
      const upper=(1+normals[i][1])*.5, fill=openness*(1-mix);
      const sky=[0,1,2].map(c=>upper*(sun.sky?.[c]??0)*fill+(local?.sky[c]??0)*mix);
      const bounce=[0,1,2].map(c=>(1-upper)*(sun.ground?.[c]??0)*fill+((local?.bounce[c]??0)+(local?.ground?.[c]??0))*mix);
      const value=Channels.indirect(curves,sky,bounce);
      for(let c=0;c<3;c++)out[c]=value[c];
      return out;
    }
    for (let c=0;c<3;c++) out[c] = (indirect?.[offset+c] ?? 0) * openness * (1-mix) + (local?.rgb[c] ?? 0) * mix;
    return out;
  }
  function gains(i, x, y, z, rgb, exact, inkControl) {
    rgb.fill(level(i, x, y, z, exact, inkControl));
    const bounce = indirectAt(i,x,y,z,indirectScratch);
    const baked=traced?.at(i);
    if (!bounce && !baked && !curves?.key) return rgb;
    linear(rgb, rgb);
    if(curves?.key){
      const ambient=linear([sun.ambient,sun.ambient,sun.ambient])[0];
      const key=curves.key(rgb.map(v=>Math.max(0,v-ambient)));
      for(let c=0;c<3;c++)rgb[c]=ambient+key[c];
    }
    const fill=baked && (curves?.bounce ? curves.bounce(baked) : baked);
    for (let c=0;c<3;c++) rgb[c]+=(bounce?.[c] ?? 0) + (fill ? fill[c]*traced.strength : 0);
    return srgb(rgb, rgb);
  }
  function rampLevel(i, x, y, z, tint, exact, inkControl) {
    gains(i, x, y, z, tint, exact, inkControl);
    const brightness = luminance(tint);
    if (brightness > 0) for (let c = 0; c < 3; c++) tint[c] /= brightness;
    else tint.fill(1);
    return brightness;
  }
  const albedo = i => {
    const n = fill[i];
    return n >= 0 ? [(n >> 16)/255, (n >> 8 & 255)/255, (n & 255)/255] : null;
  };
  return { albedo, normal: i => geometryNormals[i], level, gains, rampLevel, visibility, transmissionVisibility, curveVisibility,
    indirectAt, hasTint: Boolean(indirect || probes || traced || curves?.key) };
}

module.exports = { prepare, create };
