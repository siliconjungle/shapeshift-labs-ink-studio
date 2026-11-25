/* Named scalar noise families shared by procedural fields and typed material generators. */
const NamedNoiseCells = ['worley','voronoi','cellular'];
const NamedNoiseStacks = ['fractal','ridged'];
const NamedNoiseIntegerPeriods = (family, carrier) =>
  ['perlin','white','gaussian',...NamedNoiseCells].includes(family) ||
  NamedNoiseStacks.includes(family) && (carrier ?? 'perlin') === 'perlin';

(function (P) {
  const dimensions = Object.freeze({
    perlin:[2,3,4], simplex:[2,3,4], gaussian:[2,3,4], white:[2,3,4], blue:[2],
    worley:[2,3], voronoi:[2,3], cellular:[2,3], fractal:[2,3,4], ridged:[2,3,4],
    anisotropic:[2], directional:[2]
  });
  const families = Object.freeze(Object.keys(dimensions));
  const extra = {
    gaussian:['mean','deviation'], blue:['rankSize','sigma','density'],
    worley:['metric','jitter'], voronoi:['metric','jitter'], cellular:['metric','jitter'],
    fractal:['carrier','octaves','octaveRange','gain','lacunarity'], ridged:['carrier','octaves','octaveRange','gain','lacunarity'],
    anisotropic:['angle','aspect'], directional:['angle','wander']
  };
  const isCells = family => NamedNoiseCells.includes(family);
  const isStack = family => NamedNoiseStacks.includes(family);
  const phaseControls = ['disorder','animationSpeed'];
  const canEvolve = family => !['blue','white','gaussian'].includes(family);
  const finite = Number.isFinite, integer = Number.isSafeInteger, TAU = 2 * Math.PI;
  const range = (n,min,max) => finite(n) && n >= min && n <= max;
  const unit = n => Math.max(0,Math.min(1,n));
  const signed = n => Math.max(-1,Math.min(1,n));
  const mod = (n,period) => { const x = n % period; return x < 0 ? x + period : x; };
  const fold = (n,period) => period === null ? n : mod(n,period);
  const list = (values,count,test) => Array.isArray(values) && values.length === count && Array.from(values).every(test);
  const validateRecord = P.graphTypes.validator('record');
  const seed32 = (seed, label) => P.data.hash(label + '/' + seed);
  const random = (seed, coords) => (NoiseLatticeHash(seed, coords) + .5) / 4294967296;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

  function phaseAt(options, time) {
    const { disorder = 0, animationSpeed = 0 } = options;
    if (!range(disorder,-1e6,1e6) || !range(animationSpeed,-64,64) ||
        animationSpeed !== 0 && !finite(1 / animationSpeed) || !range(time,-1e7,1e7))
      throw new RangeError('Invalid noise disorder phase, animation speed or sample time');
    const loopSeconds = animationSpeed === 0 ? null : 1 / Math.abs(animationSpeed);
    const phase = mod(mod(disorder,1) + time*animationSpeed,1);
    return { disorder,animationSpeed,loopSeconds,phase:phase === 1 ? 0 : phase };
  }

  function phaseKeys(seed, phase) {
    const cursor = phase * 3, from = Math.floor(cursor), weight = fade(cursor - from);
    const key = step => step === 0 ? seed : NoiseLatticeHash(seed,[0x27d9,step]);
    return [key(from), key((from + 1) % 3), weight];
  }

  function evolvingKernel(make, seed, phase) {
    const [from,to,weight] = phaseKeys(seed,phase), a = make(from);
    if (!weight) return a;
    const b = make(to), norm = Math.hypot(1-weight,weight), low = (1-weight)/norm, high = weight/norm;
    return { ...a, cost:a.cost+b.cost, run:p=>signed(low*a.run(p) + high*b.run(p)) };
  }

  function tileBlend(base, periods) {
    const axes = periods.flatMap((period, i) => period === null ? [] : [i]);
    if (!axes.length) return { run: base, cost: 1, tiling: 'open' };
    return { tiling: 'smooth-periodic-blend', cost: 1 << axes.length, run(p) {
      const q = p.slice();
      function blend(i) {
        if (i === axes.length) return base(q);
        const axis = axes[i], period = periods[axis], coordinate = q[axis], weight = fade(p[axis] / period);
        const low = blend(i + 1);
        q[axis] -= period;
        const high = blend(i + 1);
        q[axis] = coordinate;
        // Keep the variance of the mixed, substantially decorrelated samples.
        return (low * (1 - weight) + high * weight) / Math.hypot(1 - weight, weight);
      }
      return blend(0);
    } };
  }

  function gradient(family, dimension, seed, periods) {
    if (family === 'perlin') {
      if (periods.some(n => n !== null && !integer(n))) throw new RangeError('Perlin needs integer lattice periods');
      const noise = P.fields.periodic({ dimension,seed,periods });
      return { run: p => signed(noise.value(...p) * 1.65), cost: 1 << dimension, tiling: 'gradient-lattice' };
    }
    const wrapped = periods.filter(n => n !== null).length, embedded = dimension + wrapped;
    if (wrapped && embedded <= 4) {
      const noise = P.fields.simplex({ dimension:embedded,seed });
      return { cost:embedded+1, tiling:'circular-embedding', run(p) {
        const q = [];
        for (let i = 0; i < dimension; i++) {
          const period = periods[i];
          if (period === null) q.push(p[i]);
          else {
            const theta = TAU * p[i] / period, radius = period / TAU;
            q.push(radius * Math.cos(theta), radius * Math.sin(theta));
          }
        }
        return signed(noise.value(...q));
      } };
    }
    const noise = P.fields.simplex({ dimension, seed });
    const periodic = tileBlend(p => noise.value(...p), periods);
    return { run: p => signed(periodic.run(p)), cost: periodic.cost * (dimension+1), tiling: periodic.tiling };
  }

  function cells(family, dimension, seed, periods, options, phase) {
    const { metric = 'euclidean', jitter = 1 } = options;
    if (!['euclidean','manhattan','chebyshev'].includes(metric) || !range(jitter,0,1))
      throw new RangeError('Cell noise needs a distance metric and jitter from zero to one');
    const euclidean = metric === 'euclidean', d3 = dimension === 3, pad = (1 - jitter) / 2;
    const metricOf = euclidean ? (x,y,z) => x*x + y*y + z*z : metric === 'manhattan' ?
      (x,y,z) => x + y + z : Math.max;
    const length = euclidean ? Math.sqrt : n => n;
    const keys = [1,2,3,4].map(n => NoiseLatticeHash(seed,[n,0x71be]));
    const motion = keys.slice(0,3).map(key=>phaseKeys(key,phase));
    const site = phase === 0 ? (axis,coords)=>random(keys[axis],coords) : (axis,coords) => {
      const [from,to,weight] = motion[axis], a = random(from,coords);
      return a + weight * (random(to,coords) - a);
    };
    return { cost: (d3 ? 512 : 64) * (phase === 0 ? 1 : 2), tiling: 'cell-lattice', defaults:{ metric,jitter }, run(p) {
      const [u,v,w = 0] = p, a = Math.floor(u), b = Math.floor(v), c = Math.floor(w);
      const side = u - a < .5 ? a - 1 : a + 1, coords = new Array(dimension);
      let first = Infinity, second = Infinity, id = Infinity;
      function test(x,y,z) {
        const dx = Math.max(0,x+pad-u,u-x-1+pad), dy = Math.max(0,y+pad-v,v-y-1+pad);
        const dz = d3 ? Math.max(0,z+pad-w,w-z-1+pad) : 0;
        if (metricOf(dx,dy,dz) > second) return;
        coords[0] = fold(x,periods[0]); coords[1] = fold(y,periods[1]);
        if (d3) coords[2] = fold(z,periods[2]);
        const xDist = Math.abs(x+pad+jitter*site(0,coords)-u);
        const yDist = Math.abs(y+pad+jitter*site(1,coords)-v);
        const zDist = d3 ? Math.abs(z+pad+jitter*site(2,coords)-w) : 0;
        const d = metricOf(xDist,yDist,zDist), key = NoiseLatticeHash(keys[3],coords);
        if (d < first || d === first && key < id) {
          second = first; first = d; id = key;
        } else if (d < second) second = d;
      }
      test(a,b,c); test(side,b,c);
      // A cell can only improve F2 if its feature box meets this radius.
      const reach = length(second);
      const lo = coordinate => Math.floor(coordinate - reach), hi = coordinate => Math.floor(coordinate + reach);
      for (let z = d3 ? lo(w) : 0; z <= (d3 ? hi(w) : 0); z++)
        for (let y = lo(v); y <= hi(v); y++)
          for (let x = lo(u); x <= hi(u); x++) {
            if (y !== b || z !== c || x !== a && x !== side) test(x,y,z);
          }
      if (family === 'voronoi') return (id + .5) / 4294967296;
      return family === 'worley' ? length(first) : length(second) - length(first);
    } };
  }

  function octaveNoise(family, dimension, seed, periods, options, phase) {
    const { carrier = 'perlin', octaves = 4, gain = .5, lacunarity = 2 } = options;
    if (!['perlin','simplex'].includes(carrier) || !integer(octaves) || !range(octaves,1,8) ||
        !range(gain,0,1) || !range(lacunarity,1,4))
      throw new RangeError('Invalid fractal carrier, octave count, gain or lacunarity');
    const { octaveRange = [0,octaves-1] } = options;
    if (Object.hasOwn(options,'octaveRange') && Object.hasOwn(options,'octaves'))
      throw new TypeError('Choose octaveRange or octaves for a noise stack');
    if (!list(octaveRange,2,n=>integer(n) && range(n,0,7)) || octaveRange[0] > octaveRange[1])
      throw new RangeError('Noise octave range needs ordered inclusive bounds from zero to seven');
    const [first,last] = octaveRange;
    const bands = [];
    let sum = 0, cost = 0;
    for (let i = first, weight = 1; i <= last && weight; i++, weight *= gain) {
      const frequency = lacunarity ** i;
      const octavePeriods = periods.map(n => n === null ? null : n*frequency);
      const kernel = evolvingKernel(key=>gradient(carrier,dimension,key,octavePeriods),NoiseLatticeHash(seed,[i,0x235]),phase);
      bands.push({ ...kernel,frequency,weight });
      sum += weight;
      cost += kernel.cost;
    }
    return { cost, defaults:{carrier,octaves:last-first+1,octaveRange:octaveRange.slice(),gain,lacunarity}, tiling: bands[0].tiling, run(p) {
      let value = 0;
      for (const band of bands) {
        const n = band.run(p.map(x => x * band.frequency));
        value += band.weight * (family === 'ridged' ? (1 - Math.abs(n)) ** 2 : n);
      }
      return value / sum;
    } };
  }

  function oriented(family, seed, periods, options) {
    const { angle = 0, aspect = 4, wander = .26 } = options;
    if (!finite(angle) || !range(aspect,1,128) || !range(wander,0,4))
      throw new RangeError('Invalid noise angle, aspect or directional wander');
    const theta = angle % 360 * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
    const base = P.fields.periodic({ dimension:2,seed }), variation = P.fields.periodic({dimension:2,seed:NoiseLatticeHash(seed,[17,5])});
    const line = seed / 4294967296 * 31 + .37;
    const periodic = tileBlend(p => {
      const along = c*p[0] + s*p[1], across = c*p[1] - s*p[0];
      if (family === 'anisotropic') return base.value(along / aspect, across) * 1.65;
      return base.value(across + (wander ? wander * variation.value(along / 5, across / 3) : 0),line) * 2.2;
    },periods);
    return { run:p=>signed(periodic.run(p)), tiling:periodic.tiling, cost:periodic.cost * (family === 'anisotropic' || !wander ? 4 : 8),
      defaults: family === 'anisotropic' ? {angle,aspect} : {angle,wander} };
  }

  function settings(family, options) {
    if (!Object.hasOwn(dimensions,family) || !validateRecord(options) ||
        Object.keys(options).some(key => !['dimension','seed','periods','output',...(extra[family] ?? []),
          ...(canEvolve(family) ? phaseControls : [])].includes(key)))
      throw new TypeError('Unknown named noise family or option');
    const { dimension = 2, seed = 0, output = 'unit' } = options;
    if (!dimensions[family].includes(dimension) || !integer(seed) || !['unit','native'].includes(output))
      throw new RangeError('Invalid dimensions, seed or noise sample encoding');
    const { periods = Array(dimension).fill(null) } = options;
    if (!list(periods,dimension,n => n === null || range(n,1e-4,1e6) &&
        (!NamedNoiseIntegerPeriods(family) || isStack(family) || integer(n))))
      throw new RangeError('Invalid per-axis noise periods');
    return { dimension,seed,periods:periods.slice(),output };
  }

  function create(family, options = {}, time = 0) {
    const { dimension,seed,periods,output } = settings(family,options);
    const salt = seed32(seed,'noise lattice');
    const animation = canEvolve(family) ? phaseAt(options,time) : undefined, phase = animation?.phase ?? 0;
    let kernel, normalize = unit, nativeUnits = 'unitless';
    if (canEvolve(family) && !isCells(family)) {
      kernel = isStack(family) ? octaveNoise(family,dimension,salt,periods,options,phase) : evolvingKernel(
        key=>['anisotropic','directional'].includes(family) ? oriented(family,key,periods,options) :
          gradient(family,dimension,key,periods),salt,phase);
      if (family !== 'ridged') normalize = n => unit(.5+.5*n);
    } else if (isCells(family)) {
      kernel = cells(family,dimension,salt,periods,options,phase);
      if (family !== 'voronoi') nativeUnits = 'noise-cells';
    } else if (family === 'blue') {
      const { rankSize = [32,32],sigma = 1.4,density = .13 } = options;
      if (!list(rankSize,2,n => integer(n) && range(n,4,96)) || !range(sigma,.35,8) || !range(density,1e-6,.499999) ||
          periods.some((n,i) => n !== null && (!integer(n) || n % rankSize[i])))
        throw new RangeError('Blue noise periods must be multiples of its 4–96 texel rank tile');
      const ranks = P.materials.blueNoise({ width:rankSize[0],height:rankSize[1],sigma,density,seed:salt });
      kernel = { run:p=>ranks.sample(p[0],p[1]),cost:1,tiling:'toroidal-ranks',defaults:{ rankSize:rankSize.slice(),sigma,density } };
    } else {
      let draw = p => random(salt,p);
      if (family === 'gaussian') {
        const { mean = 0, deviation = 1 } = options;
        const bell = Randomness.distribution({ type:'normal',mean,deviation });
        draw = p => bell.quantile(random(salt,p));
        normalize = n => unit(.5 + n / 6);
        kernel = { defaults:{mean,deviation} };
      }
      kernel = { ...kernel, run:p=>draw(p.map(Math.floor)),cost:1,tiling:'discrete-lattice' };
    }
    const spec = P.data.freeze({ family,dimension,seed,periods,output,
      units:output === 'native' ? nativeUnits : 'unitless', tiling:kernel.tiling,...kernel.defaults,...animation });
    function value(...p) {
      if (!list(p,dimension,n=>range(n,-5e7,5e7))) throw new RangeError('Noise coordinates must match the field dimension');
      const n = kernel.run(p.map((x,i)=>fold(x,periods[i])));
      return output === 'unit' ? normalize(n) : n;
    }
    const field = (...p) => value(...p.slice(0,dimension));
    return Object.freeze(Object.assign(field,{ value,spec,cost:kernel.cost }));
  }

  P.namedNoise = Object.freeze({ families, create });
})(KIT.procedural);

const TypedNoiseImage = ({ named, descriptor, wrap, pack, storage, dimensions, fields, borders, freeze }) => {
  const nominal = { perlin:8, simplex:8, worley:7, voronoi:7, cellular:7, fractal:4, ridged:4, anisotropic:8, directional:8 };
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const range = (n,min,max) => finite(n) && n >= min && n <= max;
  const tuple = (value,size,check) => Array.isArray(value) && value.length === size && Array.from(value).every(check);

  function noise(family, width, height, options = {}, graphSeed = 0, time = 0) {
    if (![width,height].every(n => integer(n) && n > 0) || !dimensions({width,height}) || width*height > 4e6)
      throw new RangeError('Noise image extent exceeds its four-million-texel budget');
    // Field settings are validated by the family after stripping the raster-only controls.
    if (!fields(options,['dimension','seed','output','mean','deviation','rankSize','sigma','density','metric','jitter',
      'carrier','octaves','octaveRange','gain','lacunarity','angle','aspect','wander','disorder','animationSpeed',
      'extent','scale','tileOffset','nonSquareExpansion','tiling','offset','slicePeriods','precision','pixelPitchMm']))
      throw new TypeError('Unknown noise image option');
    const { extent, scale = 1, tileOffset = [0,0], nonSquareExpansion = false,
      tiling = 'wrap', offset, slicePeriods, precision = 'float32', pixelPitchMm, ...fieldOptions } = options;
    const { dimension = 2, seed = graphSeed, output = 'unit' } = fieldOptions;
    if (!integer(dimension) || !range(dimension,2,4) || !Object.hasOwn(storage,precision) ||
        output === 'native' && !['float32','float64'].includes(precision))
      throw new RangeError('Noise image needs two to four field dimensions and floating precision for native samples');
    const edges = borders(tiling, {u:'wrap',v:'wrap'});
    const wrapped = [edges.u === 'wrap',edges.v === 'wrap'];
    const defaultRank = [width,height].map(n => n >= 4 && n <= 64 ? n : 32);
    const rankSize = fieldOptions.rankSize ?? defaultRank;
    const hasNominal = Object.hasOwn(nominal,family);
    let base = hasNominal ? [nominal[family],nominal[family]] : [width,height];
    if (family === 'blue') {
      if (!tuple(rankSize,2,n => integer(n) && range(n,4,96))) throw new RangeError('Invalid noise rank size');
      base = base.map((n,i)=>rankSize[i]*Math.max(1,Math.round(n/rankSize[i])));
      fieldOptions.rankSize = rankSize;
    }
    base = extent === undefined ? base : typeof extent === 'number' ? [extent,extent] : extent;
    const baseOffset = offset ?? Array(dimension).fill(0), tail = slicePeriods ?? Array(dimension-2).fill(null);
    if (!tuple(base,2,n=>range(n,1e-4,1e6)) || !tuple(baseOffset,dimension,n=>range(n,-1e6,1e6)) ||
        !tuple(tail,dimension-2,n=>n===null || range(n,1e-4,1e6)))
      throw new RangeError('Noise image needs positive XY extent, a matching offset and valid slice periods');
    if (!range(scale,1/16,64) || typeof nonSquareExpansion !== 'boolean' ||
        !tuple(tileOffset,2,n=>range(n,-64,64)))
      throw new RangeError('Invalid noise scale, tile offset or non-square expansion');

    // Rank and discrete image defaults already use a rectangular sampling window.
    const expand = nonSquareExpansion && (hasNominal || extent !== undefined);
    const shortSide = Math.min(width,height), ratios = expand ? [width/shortSide,height/shortSide] : [1,1];
    const requestedExtent = base.map((n,i)=>n*scale*ratios[i]);
    const adjust = expand || scale !== 1;
    const spans = requestedExtent.map((n,i)=>{
      if (!adjust || !wrapped[i]) return n;
      const step = family === 'blue' ? rankSize[i] : NamedNoiseIntegerPeriods(family,fieldOptions.carrier) ? 1 : 0;
      return step ? Math.max(step,Math.round(n/step)*step) : n;
    });
    if (spans.some(n=>!range(n,1e-4,1e6))) throw new RangeError('Scaled noise extent exceeds its coordinate budget');
    const periods = [...spans.map((n,i)=>wrapped[i] ? n : null), ...tail];
    const origin = baseOffset.slice();
    for (let i=0;i<2;i++) {
      const tiles = wrapped[i] ? ((tileOffset[i]%1)+1)%1 : tileOffset[i];
      origin[i] += tiles*spans[i];
    }
    if (origin.slice(0,2).some((n,i)=>Math.abs(n)+spans[i] > 5e7))
      throw new RangeError('Noise tile offset exceeds its coordinate budget');
    const field = named.create(family,{...fieldOptions,seed,periods},time);
    if (width*height*field.cost > 160e6) throw new RangeError('Noise image exceeds its family work budget');
    const data = new storage[precision](width*height), grid = {width,height,channels:1,data};
    const spec = descriptor(grid,{intent:'data',precision,units:field.spec.units,tiling:edges,pixelPitchMm,materialSeed:seed,
      sampling:['white','gaussian','blue','voronoi'].includes(family) ? 'nearest' : 'linear'});
    const p = origin.slice();
    for (let y=0,i=0; y<height; y++) {
      p[1] = origin[1] + (y+.5)*spans[1]/height;
      for (let x=0; x<width; x++,i++) {
        p[0] = origin[0] + (x+.5)*spans[0]/width;
        data[i] = pack(field.value(...p),spec,false,'error');
      }
    }
    return { value:wrap(grid,spec), info:freeze({ ...field.spec, width,height,extent:spans,offset:origin,
      baseExtent:base.slice(),requestedExtent,scale,tileOffset:tileOffset.slice(),nonSquareExpansion,address:edges,precision }) };
  }
  return noise;
};
