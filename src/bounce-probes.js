/* Versioned diffuse probes. Coefficients hold linear RGB irradiance in real SH. */
const BounceProbes = (() => {
  const shadowArt = typeof ShadowArt === 'undefined' ? require('./shadow-art.js') : ShadowArt;
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const format = 'ink-studio/bounce-probes';
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const smooth = t => t*t*(3-2*t);
  const clamp = value => Math.max(0, Math.min(1, value));

  function dynamicSettings(value) {
    if (value === undefined || value === false) return;
    if (!record(value) || Object.keys(value).some(key => !['reflect', 'emit', 'lights'].includes(key)))
      throw new TypeError('Dynamic bounce needs reflector selectors, emitter selectors or named area lights');
    const { reflect = [], emit = [], lights = [] } = value;
    if (![reflect, emit, lights].every(rows => Array.isArray(rows) && rows.length <= 16) ||
        !Array.from(lights).every(targets.name) || new Set(lights).size !== lights.length ||
        !reflect.length && !emit.length && !lights.length)
      throw new TypeError('Dynamic bounce needs one or more sources and up to 16 entries of each kind');
    return {
      reflect: Array.from(reflect, targets.prepare),
      emit: Array.from(emit, item => {
        if (!record(item) || Object.keys(item).some(key => key !== 'select' && key !== 'gain') ||
            !bounded(item.gain ?? 1, 0, 16)) throw new TypeError('A dynamic bounce emitter needs a selector and gain from 0 to 16');
        return { select: targets.prepare(item.select), gain: item.gain ?? 1 };
      }),
      lights: lights.slice()
    };
  }

  function geometrySettings(value) {
    if (value === undefined || value === false) return;
    if (!record(value) || Object.keys(value).some(key => !['meshes','sdfs','epsilon','steps','light'].includes(key)))
      throw new TypeError('Probe geometry needs mesh IDs and retained SDF object IDs');
    const { meshes=[],sdfs=[],epsilon=.003,steps=128,light }=value;
    if (![meshes,sdfs].every(rows=>Array.isArray(rows)&&rows.length<=32) || !meshes.length&&!sdfs.length ||
        !bounded(epsilon,.0001,.05) || !Number.isInteger(steps) || !bounded(steps,16,256))
      throw new RangeError('Probe geometry needs 1–64 proxies, a finite SDF tolerance and a bounded step count');
    function list(rows,key) {
      const ids=new Set();
      return Array.from(rows,row=>{
        const fields=key==='object'?[key,'mode','color']:[key,'mode'];
        if(!record(row)||Object.keys(row).some(field=>!fields.includes(field)) ||
            !targets.name(row[key]) || ids.has(row[key]) || !['reflect','occlude'].includes(row.mode ?? 'reflect') ||
            row.color!==undefined && !(typeof row.color==='string' && /^#[0-9a-f]{6}$/i.test(row.color)))
          throw new TypeError('Probe proxies need distinct IDs, reflect or occlude mode, and optional SDF hex color');
        ids.add(row[key]);
        return {[key]:row[key],mode:row.mode??'reflect',...(row.color!==undefined&&{color:row.color.toLowerCase()})};
      });
    }
    let lighting;
    if(light!==undefined){
      if(!record(light)||Object.keys(light).some(key=>!['direction','color','intensity','ambient'].includes(key)))
        throw new TypeError('Probe bake light needs a direction, color, intensity, and ambient level');
      const {direction,color='#ffffff',intensity=1,ambient=0}=light;
      if(!vector(direction)||!(Math.hypot(...direction)>1e-8)||!Number.isFinite(Math.hypot(...direction))||
          typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||!bounded(intensity,0,4)||!bounded(ambient,0,1))
        throw new RangeError('Probe bake light needs a finite nonzero direction, hex color, intensity 0–4 and ambient 0–1');
      lighting={direction:direction.slice(),color:color.toLowerCase(),intensity,ambient};
    }
    return { meshes:list(meshes,'id'),sdfs:list(sdfs,'object'),epsilon,steps,...(lighting&&{light:lighting}) };
  }

  function prepare(value) {
    if (value === false || value === undefined) return null;
    if (!record(value) || Object.keys(value).some(key=>!['format','version','probes','samples','reach','strength',
      'bounceStrength','skyStrength','cast','receive','dynamic','geometry'].includes(key))) throw new TypeError('Invalid bounce probe settings');
    const baked = value.format !== undefined || value.version !== undefined;
    if (baked && (value.format !== format || value.version !== 1)) throw new TypeError('Unsupported bounce probe format or version');
    const { probes, samples = 96, reach = 8, strength = 1, bounceStrength = .9, skyStrength = .4, cast, receive } = value;
    if (!Array.isArray(probes) || probes.length > 128 || !Number.isInteger(samples) || !bounded(samples,24,256) ||
        !bounded(reach,.05,400) || !bounded(strength,0,1) || !bounded(bounceStrength,0,4) || !bounded(skyStrength,0,4))
      throw new RangeError('Bounce probes need up to 128 sites, 24–256 samples, positive reach and valid strengths');
    const masks = shadowArt.prepare({ cast, receive }), dynamic = dynamicSettings(value.dynamic);
    const geometry=geometrySettings(value.geometry), ids = new Set();
    return {
      ...(geometry && { geometry }), ...(baked && { format, version:1 }), samples, reach, strength, bounceStrength, skyStrength,
      ...(dynamic && { dynamic }), ...(masks?.cast && { cast:masks.cast }), ...(masks?.receive && { receive:masks.receive }),
      probes: Array.from(probes, probe=>{
        const fields=['id','at','radius','bounds', ...(baked ? ['coefficients','open'] : [])];
        if (!record(probe) || Object.keys(probe).some(key=>!fields.includes(key))) throw new TypeError('Invalid bounce probe site');
        const { id, at, radius = 3, bounds, coefficients, open } = probe;
        if (typeof id !== 'string' || !id.trim() || ids.has(id) || !vector(at) || !bounded(radius,.01,400))
          throw new RangeError('Bounce probe sites need unique IDs, XYZ positions and positive radii');
        ids.add(id);
        let region;
        if (bounds !== undefined) {
          if (!record(bounds) || Object.keys(bounds).some(key=>!['min','max','feather'].includes(key)) ||
              !vector(bounds.min) || !vector(bounds.max) || bounds.min.some((n,k)=>n>=bounds.max[k]) ||
              !bounded(bounds.feather ?? 0,0,400))
            throw new RangeError('Bounce probe bounds need ordered XYZ limits and a nonnegative feather');
          region = { min:bounds.min.slice(),max:bounds.max.slice(),feather:bounds.feather ?? 0 };
        }
        if (baked && (!Array.isArray(coefficients) || coefficients.length !== 27 ||
            !Array.from(coefficients).every(n=>bounded(n,-64,64)) || !Array.isArray(open) ||
            open.length !== samples || !Array.from(open).every(n=>bounded(n,0,1))))
          throw new RangeError('Invalid baked bounce coefficients or sky visibility');
        return { id,at:at.slice(),radius, ...(region && {bounds:region}),
          ...(baked && {coefficients:coefficients.slice(),open:open.slice()}) };
      })
    };
  }

  function basis([x,y,z], out = new Float64Array(9)) {
    out[0]=.28209479177387814;
    out[1]=.4886025119029199*y; out[2]=.4886025119029199*z; out[3]=.4886025119029199*x;
    out[4]=1.0925484305920792*x*y; out[5]=1.0925484305920792*y*z;
    out[6]=.31539156525252005*(3*z*z-1); out[7]=1.0925484305920792*x*z;
    out[8]=.5462742152960396*(x*x-y*y);
    return out;
  }

  function directions(count) {
    const golden = Math.PI * (3-Math.sqrt(5));
    return Array.from({length:count},(_,i)=>{
      const y=1-2*(i+.5)/count, span=Math.sqrt(1-y*y), angle=golden*i;
      const direction=[span*Math.cos(angle),y,span*Math.sin(angle)];
      return { direction, basis:basis(direction) };
    });
  }

  function project(coefficients, basis, rgb, weight) {
    for (let i=0;i<9;i++) for (let c=0;c<3;c++)
      coefficients[i*3+c] += basis[i]*rgb[c]*weight*(i===0 ? 1 : i<4 ? 2/3 : .25);
  }

  function influence(probe, point) {
    const distance=Math.hypot(point[0]-probe.at[0],point[1]-probe.at[1],point[2]-probe.at[2])/probe.radius;
    if (distance>=1) return 0;
    const blend = smooth(clamp((1-distance)*2));
    const {bounds}=probe;
    if (!bounds) return blend;
    const edge=Math.min(...point.map((n,i)=>Math.min(n-bounds.min[i],bounds.max[i]-n)));
    return edge<0 ? 0 : bounds.feather ? blend*smooth(clamp(edge/bounds.feather)) : blend;
  }

  return Object.freeze({ format,prepare,basis,directions,project,influence });
})();
if (typeof module !== 'undefined') module.exports = BounceProbes;
