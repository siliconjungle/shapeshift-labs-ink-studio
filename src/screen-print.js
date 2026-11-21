/* Analytic, area-calibrated printing screens and ordered subtractive ink plates. */
const ScreenPrint = (() => {
  const shapes = Object.freeze(['circle', 'diamond', 'line']);
  const channels = Object.freeze(['luma', 'cyan', 'magenta', 'yellow', 'black', 'midtone', 'red', 'green', 'blue']);
  const prepared = new WeakSet(),
    cache = new WeakMap(),
    buffers = new WeakMap();
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const number = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError('Screen print: invalid ' + name);
    return v;
  };
  const record = (v, keys, name) => {
    if (!v || Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).some(k => !keys.includes(k)))
      throw new TypeError('Screen print: invalid ' + name);
  };
  const vector = (v, n, lo, hi, name) => {
    if (!Array.isArray(v) || v.length !== n) throw new TypeError('Screen print: invalid ' + name);
    return Object.freeze(Array.from(v, x => number(x, lo, hi, name)));
  };
  const color = (v, name) => {
    if (typeof v === 'string' && /^#[a-f\d]{6}$/i.test(v))
      v = [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
    return vector(v, 3, 0, 1, name);
  };
  const presets = Object.freeze(['mono', 'duotone', 'cmyk']);
  function preset(name = 'duotone', overrides = {}) {
    const definitions = {
      mono: { plates: [{ id: 'key', ink: '#17334b', channel: 'luma', angle: Math.PI / 4 }] },
      duotone: {
        plates: [
          { id: 'blue', ink: '#14607e', channel: 'luma', angle: Math.PI / 12, gamma: 1.25 },
          { id: 'vermilion', ink: '#ed6744', channel: 'midtone', angle: Math.PI / 3, gain: 0.78 }
        ]
      },
      cmyk: {
        paper: '#f8f0dc',
        plates: [
          { id: 'cyan', ink: '#1db5d0', channel: 'cyan', angle: Math.PI / 12 },
          { id: 'magenta', ink: '#db387d', channel: 'magenta', angle: (Math.PI * 5) / 12 },
          { id: 'yellow', ink: '#f5d839', channel: 'yellow', angle: 0 },
          { id: 'key', ink: '#253039', channel: 'black', angle: Math.PI / 4 }
        ]
      }
    };
    if (!presets.includes(name)) throw new TypeError('Screen print: unknown recipe');
    return prepare({ ...definitions[name], ...overrides });
  }
  function prepare(value = true) {
    if (value === false || value === undefined) return null;
    if (prepared.has(value)) return value;
    if (value && typeof value === 'object' && cache.has(value)) return cache.get(value);
    if (typeof value === 'string') return preset(value);
    if (value === true) value = {};
    record(
      value,
      [
        'paper',
        'spacing',
        'space',
        'strength',
        'contrast',
        'exposure',
        'dotGain',
        'blackGeneration',
        'grain',
        'grainScale',
        'seed',
        'lighting',
        'plates'
      ],
      'settings'
    );
    const {
      paper = '#f6e9cc',
      spacing = 0.22,
      space = 'surface',
      strength = 1,
      contrast = 1,
      exposure = 0,
      dotGain = 0,
      blackGeneration = 0.82,
      grain = 0.035,
      grainScale = 16,
      seed = 1,
      lighting = 0,
      plates = [{ id: 'key', ink: '#17334b', channel: 'luma', angle: Math.PI / 4 }]
    } = value;
    if (!['surface', 'screen'].includes(space) || !Array.isArray(plates) || !plates.length || plates.length > 6)
      throw new TypeError('Screen print: invalid space or ink plate budget');
    const ids = new Set(),
      p = {
        paper: color(paper, 'paper'),
        spacing: number(spacing, 0.001, 4096, 'spacing'),
        space,
        strength: number(strength, 0, 1, 'strength'),
        contrast: number(contrast, 0.1, 4, 'contrast'),
        exposure: number(exposure, -2, 2, 'exposure'),
        dotGain: number(dotGain, -0.25, 0.25, 'dot gain'),
        blackGeneration: number(blackGeneration, 0, 1, 'black generation'),
        grain: number(grain, 0, 0.3, 'grain'),
        grainScale: number(grainScale, 1, 64, 'grain scale'),
        seed: number(seed, 0, 4294967295, 'seed'),
        lighting: number(lighting, 0, 1, 'lighting')
      };
    if (!Number.isInteger(seed)) throw new RangeError('Screen print: seed must be uint32');
    p.plates = Object.freeze(
      plates
        .map((raw, index) => {
          record(
            raw,
            [
              'id',
              'ink',
              'shape',
              'channel',
              'angle',
              'frequency',
              'offset',
              'gain',
              'gamma',
              'range',
              'opacity',
              'order',
              'blend',
              'invert',
              'enabled'
            ],
            'plate'
          );
          const {
            id = 'ink-' + index,
            ink = '#17334b',
            shape = 'circle',
            channel = 'luma',
            angle = 0,
            frequency = 1,
            offset = [0, 0],
            gain = 1,
            gamma = 1,
            range = [0, 1],
            opacity = 1,
            order = index,
            blend = 'overprint',
            invert = false,
            enabled = true
          } = raw;
          if (
            typeof id !== 'string' ||
            !id.length ||
            id.length > 128 ||
            ids.has(id) ||
            !shapes.includes(shape) ||
            !channels.includes(channel) ||
            !['overprint', 'knockout'].includes(blend) ||
            typeof invert !== 'boolean' ||
            typeof enabled !== 'boolean'
          )
            throw new TypeError('Screen print: invalid or duplicate ink plate');
          ids.add(id);
          const r = vector(range, 2, 0, 1, 'range');
          if (r[1] - r[0] < 1e-5) throw new RangeError('Screen print: plate range must increase');
          if (!Number.isSafeInteger(order)) throw new RangeError('Screen print: order must be an integer');
          return Object.freeze({
            id,
            ink: color(ink, 'ink'),
            shape,
            channel,
            angle: number(angle, -Math.PI * 8, Math.PI * 8, 'angle'),
            frequency: number(frequency, 0.125, 8, 'frequency'),
            offset: vector(offset, 2, -8, 8, 'registration'),
            gain: number(gain, 0, 2, 'gain'),
            gamma: number(gamma, 0.25, 4, 'gamma'),
            range: r,
            opacity: number(opacity, 0, 1, 'opacity'),
            order: number(order, -1024, 1024, 'order'),
            blend,
            invert,
            enabled,
            index
          });
        })
        .sort((a, b) => a.order - b.order || a.index - b.index)
        .map(({ index, ...p }) => Object.freeze(p))
    );
    Object.freeze(p);
    prepared.add(p);
    cache.set(value, p);
    return p;
  }
  function separate(definition, rgb, { light = 1 } = {}) {
    const p = prepare(definition);
    if (!p) return [];
    const c = vector(rgb, 3, 0, 1, 'sample color').map((v, i) =>
      clamp(
        (v / Math.max(0.0001, p.paper[i])) *
          Math.pow(2, p.exposure) *
          (1 - p.lighting + p.lighting * number(light, 0, 1, 'lighting'))
      )
    );
    const d = c.map(v => 1 - v),
      k = Math.min(...d) * p.blackGeneration,
      luma = 1 - (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
    const values = [
      luma,
      (d[0] - k) / Math.max(0.0001, 1 - k),
      (d[1] - k) / Math.max(0.0001, 1 - k),
      (d[2] - k) / Math.max(0.0001, 1 - k),
      k,
      4 * luma * (1 - luma),
      d[0],
      d[1],
      d[2]
    ];
    return p.plates.map(plate => {
      let area = clamp((values[channels.indexOf(plate.channel)] - 0.5) * p.contrast + 0.5);
      if (plate.invert) area = 1 - area;
      area = clamp((area - plate.range[0]) / (plate.range[1] - plate.range[0]));
      area = clamp(Math.pow(area, plate.gamma) * plate.gain);
      area = clamp(area + p.dotGain * 4 * area * (1 - area));
      return { id: plate.id, area: plate.enabled ? area : 0, plate };
    });
  }
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  function mark(shape, u, v, area, footprint = 0) {
    if (!shapes.includes(shape)) throw new TypeError('Screen print: unknown screen');
    number(u, -1e12, 1e12, 'screen coordinate');
    number(v, -1e12, 1e12, 'screen coordinate');
    number(area, 0, 1, 'coverage');
    number(footprint, 0, 1e6, 'footprint');
    if (area === 0 || area === 1) return area;
    const x = Math.abs(u - Math.floor(u) - 0.5),
      y = Math.abs(v - Math.floor(v) - 0.5);
    let rank, gradient;
    if (shape === 'line') {
      rank = x * 2;
      gradient = 2;
    } else if (shape === 'diamond') {
      const r = x + y;
      rank = r <= 0.5 ? 2 * r * r : 1 - 2 * (1 - r) ** 2;
      gradient = 4 * Math.min(r, 1 - r) * Math.SQRT2;
    } else {
      const r = Math.hypot(x, y),
        a = r > 0.5 ? Math.acos(0.5 / r) : 0;
      rank = Math.PI * r * r - (r > 0.5 ? 4 * (r * r * a - 0.5 * Math.sqrt(Math.max(0, r * r - 0.25))) : 0);
      gradient = 2 * r * (Math.PI - 4 * a);
    }
    const aa = Math.max(0.00001, footprint * gradient * 0.5),
      coverage = 1 - smooth(area - aa, area + aa, rank),
      average = smooth(0.35, 0.9, footprint);
    return coverage * (1 - average) + area * average;
  }
  function noise(u, v, seed) {
    const x = ((Math.floor(u) % 65536) + 65536) % 65536,
      y = ((Math.floor(v) % 65536) + 65536) % 65536;
    let h = (Math.imul(x, 1664525) ^ Math.imul(y, 1013904223) ^ seed) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 2246822519) >>> 0;
    h ^= h >>> 13;
    return (h >>> 8) / 16777216;
  }
  function shade(definition, uv, rgb, { footprint = 0, screen, light = 1 } = {}) {
    const p = prepare(definition);
    if (!p) return rgb;
    vector(uv, 2, -1e6, 1e6, 'surface coordinate');
    vector(rgb, 3, 0, 1, 'sample color');
    number(footprint, 0, 1e6, 'footprint');
    number(light, 0, 1, 'lighting');
    if (p.space === 'screen') {
      if (!screen) throw new TypeError('Screen print: screen-space sampling needs pixel coordinates');
      uv = vector(screen, 2, -1e6, 1e6, 'pixel coordinate');
      footprint = 1;
    }
    const input = rgb.map(v => v * (1 - p.lighting + p.lighting * light)),
      plates = separate(p, input),
      q = uv.map(v => v / p.spacing),
      filter = footprint / p.spacing;
    const hash = (x, y) => {
      x = ((Math.floor(x) % 65536) + 65536) % 65536;
      y = ((Math.floor(y) % 65536) + 65536) % 65536;
      let h = (Math.imul(x, 1664525) ^ Math.imul(y, 1013904223) ^ p.seed) >>> 0;
      h ^= h >>> 16;
      h = Math.imul(h, 2246822519) >>> 0;
      h ^= h >>> 13;
      return (h >>> 8) / 16777216;
    };
    const noise = p.grain * (1 - smooth(0.03, 0.2, filter)),
      result = p.paper.map(v => v * (1 + (noise ? hash(q[0] * p.grainScale, q[1] * p.grainScale) - 0.5 : 0) * noise));
    for (const { area, plate } of plates) {
      const co = Math.cos(plate.angle),
        si = Math.sin(plate.angle),
        u = (q[0] * co + q[1] * si) * plate.frequency + plate.offset[0],
        v = (-q[0] * si + q[1] * co) * plate.frequency + plate.offset[1],
        a = mark(plate.shape, u, v, area, filter * plate.frequency) * plate.opacity;
      for (let i = 0; i < 3; i++)
        result[i] =
          plate.blend === 'overprint'
            ? result[i] * (1 - a + a * plate.ink[i])
            : result[i] * (1 - a) + p.paper[i] * plate.ink[i] * a;
    }
    return result.map((v, i) => clamp(rgb[i] * (1 - p.strength) + v * p.strength));
  }
  function pack(definition) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Screen print: expected a recipe');
    if (buffers.has(p)) return buffers.get(p);
    const data = new Float32Array(16 + p.plates.length * 16);
    data.set([
      ...p.paper,
      p.strength,
      p.spacing,
      p.contrast,
      p.exposure,
      p.dotGain,
      p.grain,
      p.grainScale,
      p.seed & 65535,
      p.seed >>> 16,
      p.blackGeneration,
      +(p.space === 'screen'),
      p.plates.length,
      p.lighting
    ]);
    p.plates.forEach((q, i) =>
      data.set(
        [
          ...q.ink,
          q.opacity,
          shapes.indexOf(q.shape),
          channels.indexOf(q.channel),
          Math.cos(q.angle),
          Math.sin(q.angle),
          q.frequency,
          ...q.offset,
          q.gain,
          q.gamma,
          ...q.range,
          +(q.blend === 'knockout') + 2 * +q.invert + 4 * +!q.enabled
        ],
        16 + i * 16
      )
    );
    buffers.set(p, data);
    return data;
  }
  const glsl = `
float printSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
float printMark(int shape,vec2 uv,float area,float footprint){
 if(area<=0.||area>=1.)return area;vec2 q=abs(fract(uv)-.5);float rank,gradient;
 if(shape==2){rank=q.x*2.;gradient=2.;}
 else if(shape==1){float r=q.x+q.y;rank=r<=.5?2.*r*r:1.-2.*(1.-r)*(1.-r);gradient=4.*min(r,1.-r)*1.41421356237;}
 else{float r=length(q),a=r>.5?acos(clamp(.5/r,0.,1.)):0.;rank=3.14159265359*r*r-(r>.5?4.*(r*r*a-.5*sqrt(max(0.,r*r-.25))):0.);gradient=2.*r*(3.14159265359-4.*a);}
 float aa=max(.00001,footprint*gradient*.5),coverage=1.-printSmooth(area-aa,area+aa,rank);return mix(coverage,area,printSmooth(.35,.9,footprint));
}
float printGrain(vec2 uv,uint seed){uvec2 p=uvec2(mod(floor(uv),65536.));uint h=p.x*1664525u^p.y*1013904223u^seed;h^=h>>16;h*=2246822519u;h^=h>>13;return float(h>>8)/16777216.;}
vec3 screenPrintShade(int start,vec2 uv,vec3 rgb,float footprint,float light){
 vec4 paper=screenPrintFetch(start),params=screenPrintFetch(start+1),grain=screenPrintFetch(start+2),mode=screenPrintFetch(start+3);
 if(paper.w<=0.)return rgb;
 if(mode.y>.5){uv=gl_FragCoord.xy;footprint=1.;}
 uv/=params.x;footprint/=params.x;
 vec3 c=clamp(rgb/max(vec3(.0001),paper.rgb)*exp2(params.z)*mix(1.,light,mode.w),0.,1.),d=1.-c;
 float black=min(d.r,min(d.g,d.b))*mode.x,lum=1.-dot(c,vec3(.2126,.7152,.0722));
 float values[9]=float[9](lum,(d.r-black)/max(.0001,1.-black),(d.g-black)/max(.0001,1.-black),(d.b-black)/max(.0001,1.-black),black,4.*lum*(1.-lum),d.r,d.g,d.b);
 float paperNoise=grain.x*(1.-printSmooth(.03,.2,footprint));
 vec3 result=paper.rgb;if(paperNoise>0.)result*=1.+(printGrain(uv*grain.y,uint(grain.z)+(uint(grain.w)<<16))-.5)*paperNoise;
 for(int i=0;i<6;i++){if(i>=int(mode.z))break;vec4 ink=screenPrintFetch(start+4+i*4),screen=screenPrintFetch(start+5+i*4),offset=screenPrintFetch(start+6+i*4),response=screenPrintFetch(start+7+i*4);int flags=int(response.w);if((flags&4)!=0)continue;
 float area=clamp((values[int(screen.y)]-.5)*params.y+.5,0.,1.);if((flags&2)!=0)area=1.-area;
 area=clamp((area-response.y)/(response.z-response.y),0.,1.);area=clamp(pow(area,response.x)*offset.w,0.,1.);area=clamp(area+params.w*4.*area*(1.-area),0.,1.);
 vec2 q=vec2(uv.x*screen.z+uv.y*screen.w,-uv.x*screen.w+uv.y*screen.z)*offset.x+offset.yz;
 float a=printMark(int(screen.x),q,area,footprint*offset.x)*ink.w;
 result=(flags&1)==0?result*(1.-a+a*ink.rgb):mix(result,paper.rgb*ink.rgb,a);
 }
 return clamp(mix(rgb,result,paper.w),0.,1.);
}
`;
  return Object.freeze({ shapes, channels, presets, prepare, preset, separate, mark, shade, pack, glsl });
})();
if (typeof module !== 'undefined') module.exports = ScreenPrint;
