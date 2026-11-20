/* Geometry for bounded scalar and vector fields, independent of a renderer. */
(function (K) {
  const P = K.procedural, V = K.V, { freeze } = P.data;
  const finite = Number.isFinite, epsilon = 1e-9;
  const axes = {x:0,y:1,z:2}, componentsByName = {xy:[0,1],xz:[0,2],yz:[1,2]};
  const check = (ok,message) => { if (!ok) throw new TypeError('Field views: ' + message); };
  const vector = (p,size=3) => Array.isArray(p) && p.length === size && Array.from(p).every(finite);
  const limit = (n,min,max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const validBounds = bounds => vector(bounds?.min) && vector(bounds?.max) &&
    bounds.min.every((n,i) => n <= bounds.max[i] && finite(bounds.max[i]-n));
  const sources = new WeakSet();
  const inside = (bounds,point) => point.every((n,i) => n >= bounds.min[i] && n <= bounds.max[i]);

  function source({ type, sample, bounds, units = null, components = 'xz' } = {}) {
    const pair = Object.hasOwn(componentsByName,components) && componentsByName[components];
    check(['number','vec2','vec3'].includes(type) && (type !== 'vec2' || pair) && typeof sample === 'function' &&
      validBounds(bounds) && (units === null || typeof units === 'string' && units.trim().length),
      'expected a scalar or vector sampler, units and a finite XYZ box');
    const box = freeze({ min:bounds.min.slice(), max:bounds.max.slice() }), scalar = type === 'number';
    const roundoff = box.max.map((n,i) => Number.EPSILON*4*Math.max(Math.abs(n),Math.abs(box.min[i]),n-box.min[i]));
    const field = Object.freeze({ type:scalar ? type : 'vec3', units, bounds:box, sample(x,y,z) {
      const point = [x,y,z];
      check(point.every(finite),'sample coordinates must be finite');
      for (let axis=0;axis<3;axis++) {
        const n = point[axis], lo = box.min[axis], hi = box.max[axis];
        if (n < lo-roundoff[axis] || n > hi+roundoff[axis]) return null;
        point[axis] = Math.min(hi,Math.max(lo,n));
      }
      const value = sample(...point);
      if (value == null) return null;
      check(scalar ? finite(value) : vector(value,type === 'vec2' ? 2 : 3),'invalid field sample');
      if (type !== 'vec2') return scalar ? value : value.slice();
      const xyz = [0,0,0];
      xyz[pair[0]] = value[0];
      xyz[pair[1]] = value[1];
      return xyz;
    } });
    sources.add(field);
    return field;
  }

  function fromQuery(query,name,{ bounds, fallbackBounds, args } = {}) {
    const info = query?.field?.(name), spatial = info?.spatial;
    check(spatial && ['number','vec2','vec3'].includes(info.type),'unknown or non-numeric spatial field ' + name);
    const native = spatial.space === 'world' && spatial.axes === 'xyz' ? spatial.bounds : null;
    const box = bounds ?? native ?? fallbackBounds;
    return source({ type:info.type, units:info.units, bounds:box, components:spatial.components,
      sample:query.sampler(name,{args}) });
  }

  function requireType(field,type) {
    check(sources.has(field) && field.type === type,'expected a ' + (type === 'number' ? 'scalar' : 'vector') + ' field source');
  }

  function magnitude(field) {
    requireType(field,'vec3');
    return source({ ...field, type:'number', sample(x,y,z) {
      const value = field.sample(x,y,z);
      return value && V.len(value);
    } });
  }

  function frameFor(bounds,plane = {axis:'y'}) {
    if (plane && Object.hasOwn(axes,plane.axis)) {
      const fixed = axes[plane.axis], varying = [0,1,2].filter(i => i !== fixed);
      const origin = bounds.min.slice(), u = [0,0,0], v = [0,0,0];
      origin[fixed] = plane.at ?? bounds.min[fixed]+(bounds.max[fixed]-bounds.min[fixed])/2;
      u[varying[0]] = 1;
      v[varying[1]] = 1;
      plane = { origin, u, v, size:varying.map(i => bounds.max[i]-bounds.min[i]) };
    }
    check(vector(plane?.origin) && vector(plane.u) && vector(plane.v) && vector(plane.size,2) &&
      plane.size.every(n => n > 0),'expected a plane with an axis or origin, two directions and positive size');
    const uLength = V.len(plane.u), vLength = V.len(plane.v);
    check(finite(uLength) && uLength > epsilon && finite(vLength) && vLength > epsilon,
      'plane directions must be nonzero');
    const u = V.mul(plane.u,1/uLength), v = V.mul(plane.v,1/vLength);
    check(Math.abs(V.dot(u,v)) < 1e-6,'plane directions must be perpendicular');
    const frame = { origin:plane.origin.slice(),u,v,normal:V.norm(V.cross(u,v)),size:plane.size.slice() };
    check(onPlane(frame,...frame.size).every(finite),'plane extends beyond finite coordinates');
    return freeze(frame);
  }

  function onPlane({ origin,u,v },s,t) {
    return V.mad(V.mad(origin,u,s),v,t);
  }

  function countsFor(counts,dimensions,max) {
    check(Array.isArray(counts) && counts.length === dimensions &&
      Array.from(counts).every(n => limit(n,1,max)) && counts.reduce((n,k) => n*k,1) <= max,
      'grid exceeds the ' + max + ' sample budget');
    return counts;
  }

  function gridPoint(bounds,counts,index) {
    let stride = 1;
    return counts.map((n,i) => {
      const cell = Math.floor(index/stride)%n;
      stride *= n;
      return bounds.min[i]+(bounds.max[i]-bounds.min[i])*((cell+.5)/n);
    });
  }

  function planePoint(frame,counts,index) {
    const [cols,rows] = counts, [width,height] = frame.size;
    return onPlane(frame,((index%cols+.5)/cols)*width,((Math.floor(index/cols)+.5)/rows)*height);
  }

  function rangeOf(values) {
    let min = Infinity, max = -Infinity;
    for (const value of values) if (value !== null) {
      min = Math.min(min,value);
      max = Math.max(max,value);
    }
    return min <= max ? [min,max] : null;
  }

  function slice(field,{ plane, counts = [64,64] } = {}) {
    requireType(field,'number');
    const frame = frameFor(field.bounds,plane), [cols,rows] = countsFor(counts,2,65536);
    const values = Array.from({ length:cols*rows },(_,i) => field.sample(...planePoint(frame,counts,i)));
    return freeze({ kind:'slice', frame, counts:counts.slice(), values, range:rangeOf(values), units:field.units });
  }

  function contours(field,{ plane, levels = [0], cell, maxCells = 120000 } = {}) {
    requireType(field,'number');
    const frame = frameFor(field.bounds,plane), bounds = { min:[0,0],max:frame.size };
    check(Array.isArray(levels) && limit(levels.length,1,32) && Array.from(levels).every(finite) &&
      limit(maxCells,levels.length,500000),'invalid contour levels or cell budget');
    const spacing = cell ?? Math.max(...frame.size)/96;
    const budget = Math.floor(maxCells/levels.length), cache = new Map();
    const sample = (u,v) => {
      const key = u + ',' + v;
      if (!cache.has(key)) cache.set(key,field.sample(...onPlane(frame,u,v)));
      return cache.get(key);
    };
    const paths = levels.flatMap(level => P.contours.march(sample,{bounds,cell:spacing,iso:level,maxCells:budget})
      .map(row => ({ ...row, level,points:row.points.map(point => onPlane(frame,...point)) })));
    return freeze({ kind:'contours', frame, paths, range:rangeOf(levels), units:field.units });
  }

  function isosurface(field,{ level = 0, inside:mode = 'above', resolution, maxCells = 64000, maxTriangles = 250000, edgeRefinements = 0 } = {}) {
    requireType(field,'number');
    const { bounds } = field;
    check(finite(level) && ['above','below'].includes(mode) && limit(maxCells,8,160000) &&
      limit(maxTriangles,1,500000),
      'invalid isosurface level, interior or cell budget');
    const step = resolution ?? Math.max(...bounds.max.map((n,i) => n-bounds.min[i]))/36;
    const sign = mode === 'above' ? -1 : 1;
    const mesh = P.geometry.implicitSurface(point => {
      const value = field.sample(...point);
      return value === null ? null : sign*(value-level);
    },bounds,{ resolution:step,maxCells,maxTriangles,edgeRefinements,allowMissing:true });
    return Object.freeze({ kind:'isosurface',level,inside:mode,mesh,range:freeze([level,level]),units:field.units });
  }

  function streamlines(field,{ seeds, maxChecks = 240000, ...options } = {}) {
    requireType(field,'vec3');
    check(Array.isArray(seeds) && limit(seeds.length,1,512) && Array.from(seeds).every(p => vector(p)) &&
      limit(maxChecks,1,2000000),'expected bounded streamline seeds and a sample budget');
    const { bounds } = field, { mask, ...trace } = options;
    check(mask === undefined || typeof mask === 'function','invalid streamline mask');
    let checks = 0, exhausted = false, previous, velocity;
    function sample(x,y,z) {
      if (!previous || x !== previous[0] || y !== previous[1] || z !== previous[2]) {
        if (checks >= maxChecks) {
          exhausted = true;
          return null;
        }
        checks++;
        previous = [x,y,z];
        velocity = field.sample(x,y,z);
      }
      return velocity;
    }
    const valid = (x,y,z,t) => (!mask || mask(x,y,z,t)) && sample(x,y,z) !== null;
    const speeds = [];
    const paths = seeds.map(seed => {
      const remaining = maxChecks-checks;
      if (remaining <= 0) return { seed:seed.slice(),points:[],magnitudes:[],status:'budget' };
      if (!inside(bounds,seed) || !valid(...seed,trace.time ?? 0))
        return { seed:seed.slice(),points:[],magnitudes:[],status:'missing' };
      const result = P.motion.streamline(sample,seed,{...trace,bounds,mask:valid,maxChecks:remaining});
      const status = exhausted ? 'budget' : result.status;
      const magnitudes = result.points.map(point => {
        const value = sample(...point);
        return value === null ? null : V.len(value);
      });
      speeds.push(...magnitudes);
      return { ...result,status,seed:seed.slice(),magnitudes };
    });
    return freeze({ kind:'streamlines',paths,range:rangeOf(speeds),units:field.units,samples:checks });
  }

  function glyphs(field,{ points, plane, counts, scale = .4, normalize = false, minLength = 0, maxLength = Infinity } = {}) {
    requireType(field,'vec3');
    check(finite(scale) && scale > 0 && finite(minLength) && minLength >= 0 &&
      (maxLength === Infinity || finite(maxLength) && maxLength > 0) && maxLength >= minLength &&
      typeof normalize === 'boolean','invalid glyph length settings');
    check(points === undefined || Array.isArray(points) && points.length <= 16000 &&
      Array.from(points).every(p => vector(p)) && plane === undefined && counts === undefined,
      'explicit glyph points cannot be mixed with a grid or plane');
    const frame = plane === undefined ? null : frameFor(field.bounds,plane);
    if (!points) {
      counts = countsFor(counts ?? (frame ? [11,11] : [8,1,8]),frame ? 2 : 3,16000);
      const total = counts.reduce((n,k) => n*k,1);
      points = Array.from({length:total},(_,i) => frame ? planePoint(frame,counts,i) : gridPoint(field.bounds,counts,i));
    }
    const arrows = [];
    for (const point of points) {
      const vector = field.sample(...point);
      if (vector === null) continue;
      const magnitude = V.len(vector);
      if (magnitude <= epsilon) continue;
      const length = Math.min(maxLength,scale*(normalize ? 1 : magnitude));
      check(finite(length),'non-finite glyph length');
      if (length < minLength) continue;
      const to = V.mad(point,vector,length/magnitude);
      check(to.every(finite),'glyph extends beyond finite coordinates');
      arrows.push({ from:point.slice(),to,vector,magnitude });
    }
    return freeze({ kind:'glyphs',frame,arrows,range:rangeOf(arrows.map(row => row.magnitude)),units:field.units });
  }

  K.fieldViews = { source,fromQuery,magnitude,slice,contours,isosurface,streamlines,glyphs };
})(KIT);
