/* Signed paint along rest-space brush paths. */
const ShadowBandPaint = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const range = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  const xyz = point => Array.isArray(point) && point.length === 3 && Array.from(point).every(n => range(n, -1e6, 1e6));

  function path({ points, radius, softness = .16 }) {
    if (!Array.isArray(points) || !points.length || points.length > 1024 || !Array.from(points).every(xyz) ||
        !range(radius, 1e-5, 1e4) || !range(softness, 0, 1))
      throw new RangeError('A surface paint stroke needs finite XYZ points, positive radius and softness in [0, 1]');
    return { points: points.map(point => point.slice()), radius, softness };
  }

  function stroke(spec) {
    if (!record(spec) || Object.keys(spec).some(key => !['points','radius','bias','softness'].includes(key)))
      throw new TypeError('Shadow band paint needs points, radius, bias and optional softness');
    if (!range(spec.bias, -1, 1)) throw new RangeError('Shadow band paint needs bias in [-1, 1]');
    return { ...path(spec), bias: spec.bias };
  }

  function normalStroke(spec) {
    if (!record(spec) || Object.keys(spec).some(key => !['points','radius','normal','strength','softness'].includes(key)))
      throw new TypeError('Shade normal paint needs points, radius, normal and optional strength and softness');
    const { normal, strength = 1 } = spec;
    if (normal !== null && (!xyz(normal) || Math.hypot(...normal) < 1e-8))
      throw new RangeError('Shade normal paint needs a nonzero finite XYZ normal or null to erase');
    if (!range(strength, 0, 1)) throw new RangeError('Shade normal strength must be in [0, 1]');
    return { ...path(spec), normal: normal?.slice() ?? null, strength };
  }

  function paths(strokes, validate) {
    if (!Array.isArray(strokes) || strokes.length > 256)
      throw new RangeError('Surface paint needs a list of up to 256 strokes');
    return Array.from(strokes, spec => {
      const { points, radius, ...paint } = validate(spec);
      const first = points[0], min = first.slice(), max = first.slice();
      for (const point of points) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
      const segments = points.map(([x,y,z], i) => {
        const end = points[i+1] ?? points[i], dx=end[0]-x, dy=end[1]-y, dz=end[2]-z;
        return { x,y,z,dx,dy,dz,inverse:1/(dx*dx+dy*dy+dz*dz || 1) };
      });
      return { min:min.map(n=>n-radius), max:max.map(n=>n+radius), radius, segments, ...paint };
    });
  }

  function weight({ min,max,radius,softness,segments }, [x,y,z]) {
    if (x<min[0] || x>max[0] || y<min[1] || y>max[1] || z<min[2] || z>max[2]) return 0;
    let nearest = radius*radius;
    for (const segment of segments) {
      const ox=x-segment.x, oy=y-segment.y, oz=z-segment.z;
      const t=Math.max(0,Math.min(1,(ox*segment.dx+oy*segment.dy+oz*segment.dz)*segment.inverse));
      const distance=(ox-t*segment.dx)**2+(oy-t*segment.dy)**2+(oz-t*segment.dz)**2;
      nearest=Math.min(nearest,distance);
    }
    if (nearest >= radius*radius) return 0;
    const u=softness ? Math.min(1,(1-Math.sqrt(nearest)/radius)/softness) : 1;
    return u*u*(3-2*u);
  }

  function prepare(strokes) {
    const compiled = paths(strokes, stroke);
    return position => {
      let value = 0;
      for (const mark of compiled) {
        const alpha = weight(mark, position);
        if (alpha) value = alpha===1 ? mark.bias : value+(mark.bias-value)*alpha;
      }
      return value;
    };
  }

  function prepareNormals(strokes) {
    const compiled = paths(strokes, normalStroke);
    for (const mark of compiled) if (mark.normal) {
      const length = Math.hypot(...mark.normal);
      mark.normal = mark.normal.map(n => n/length);
    }
    return (position, base) => {
      let normal = base;
      for (const mark of compiled) {
        const alpha = mark.strength * weight(mark, position);
        if (!alpha) continue;
        const target = mark.normal ?? base;
        normal = alpha===1 ? target : normal.map((n,k) => n+(target[k]-n)*alpha);
      }
      if (normal===base) return base;
      const length = Math.hypot(...normal);
      return length > 1e-8 ? normal.map(n => n/length) : base;
    };
  }

  const level = (incidence, visibility, bias = 0) => Math.max(0,Math.min(1,incidence-bias))*visibility;
  return Object.freeze({ stroke, prepare, level, normals:Object.freeze({stroke:normalStroke,prepare:prepareNormals}) });
})();
if (typeof module !== 'undefined') module.exports = ShadowBandPaint;
