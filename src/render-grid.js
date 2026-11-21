/* Coherent tessellating image cells. The geometry remains SDFs, splats and optional surfaces. */
const RenderGrid = (() => {
  const root3 = Math.sqrt(3),
    modes = Object.freeze(['hex', 'triangle', 'diamond']);
  const plans = new WeakSet();
  function finite(v, lo, hi, name) {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError('Render grid: invalid ' + name);
    return v;
  }
  function pair(v, name, lo, hi) {
    if (!Array.isArray(v) || v.length !== 2) throw new TypeError('Render grid: invalid ' + name);
    return Object.freeze(Array.from(v, n => finite(n, lo, hi, name)));
  }
  function prepare(definition) {
    if (definition === undefined || definition === false) return null;
    if (plans.has(definition)) return definition;
    if (typeof definition === 'string') definition = { mode: definition };
    if (
      !definition ||
      Object.getPrototypeOf(definition) !== Object.prototype ||
      Object.keys(definition).some(
        k => !['mode', 'size', 'origin', 'angle', 'aspect', 'gap', 'gapColor', 'maxPixels'].includes(k)
      )
    )
      throw new TypeError('Render grid: expected a mode or settings');
    const {
      mode = 'hex',
      size = 8,
      origin = [0, 0],
      angle = 0,
      aspect = 1,
      gap = 0,
      gapColor = [0, 0, 0],
      maxPixels = 8388608
    } = definition;
    if (!modes.includes(mode)) throw new TypeError('Render grid: unknown mode ' + mode);
    finite(size, 2, 2048, 'size');
    finite(angle, -Math.PI * 2, Math.PI * 2, 'angle');
    finite(aspect, 0.25, 4, 'aspect');
    finite(gap, 0, 0.5, 'gap');
    finite(maxPixels, 1, 67108864, 'maxPixels');
    if (!Number.isInteger(maxPixels)) throw new RangeError('Render grid: maxPixels must be an integer');
    if (
      !Array.isArray(gapColor) ||
      gapColor.length !== 3 ||
      Array.from(gapColor).some(v => !Number.isInteger(v) || v < 0 || v > 255)
    )
      throw new TypeError('Render grid: gapColor needs three RGB bytes');
    const plan = {
      mode,
      size,
      origin: pair(origin, 'origin', -32768, 32768),
      angle,
      aspect,
      gap,
      gapColor: Object.freeze(gapColor.slice()),
      maxPixels
    };
    // Derived values are not JSON settings. Plans round-trip between the CLI and a bundled host.
    Object.defineProperties(plan, {
      kind: { value: modes.indexOf(mode) },
      cos: { value: Math.cos(angle) },
      sin: { value: Math.sin(angle) }
    });
    Object.freeze(plan);
    plans.add(plan);
    return plan;
  }
  function dimensions(plan, w, h) {
    if (![w, h].every(v => Number.isInteger(v) && v > 0 && v <= 16384) || w * h > plan.maxPixels)
      throw new RangeError('Render grid: frame exceeds the pixel budget or dimension limit');
    return { pixels: w * h, colorBytes: w * h * 4, textureReadsPerPixel: 1 };
  }
  function local(p, x, y) {
    x -= p.origin[0];
    y -= p.origin[1];
    return [(p.cos * x + p.sin * y) / p.size, (-p.sin * x + p.cos * y) / (p.size * p.aspect)];
  }
  function world(p, x, y) {
    return [
      p.origin[0] + p.size * (p.cos * x - p.sin * y * p.aspect),
      p.origin[1] + p.size * (p.sin * x + p.cos * y * p.aspect)
    ];
  }
  // Output: center x/y, normalized edge distance, lattice i/j, triangle half.
  // No per-pixel allocation; the WebGL resolver uses the same equations below.
  function locate(p, px, py, out) {
    const ax = px - p.origin[0],
      ay = py - p.origin[1];
    const x = (p.cos * ax + p.sin * ay) / p.size,
      y = (-p.sin * ax + p.cos * ay) / (p.size * p.aspect);
    let i,
      j,
      half = 0,
      cx,
      cy,
      edge;
    if (p.kind === 0) {
      const q = x - y / root3,
        r = (2 * y) / root3,
        s = -q - r;
      i = Math.floor(q + 0.5);
      j = Math.floor(r + 0.5);
      const k = Math.floor(s + 0.5);
      const dq = Math.abs(i - q),
        dr = Math.abs(j - r),
        ds = Math.abs(k - s);
      if (dq > dr && dq > ds) i = -j - k;
      else if (dr > ds) j = -i - k;
      cx = i + j / 2;
      cy = (root3 / 2) * j;
      const dx = x - cx,
        dy = y - cy;
      edge =
        1 - 2 * Math.max(Math.abs(dx), Math.abs(0.5 * dx + (root3 / 2) * dy), Math.abs(0.5 * dx - (root3 / 2) * dy));
    } else if (p.kind === 1) {
      const a = x - y / root3,
        b = (2 * y) / root3;
      i = Math.floor(a);
      j = Math.floor(b);
      const u = a - i,
        v = b - j;
      half = u + v <= 1 ? 0 : 1;
      const t = half ? 2 / 3 : 1 / 3;
      cx = i + j / 2 + (half ? 1 : 0.5);
      cy = ((j + t) * root3) / 2;
      edge = 3 * (half ? Math.min(1 - u, 1 - v, u + v - 1) : Math.min(u, v, 1 - u - v));
    } else {
      const a = x + 2 * y,
        b = -x + 2 * y;
      i = Math.floor(a);
      j = Math.floor(b);
      cx = (i - j) / 2;
      cy = (i + j + 1) / 4;
      edge = 1 - Math.max(Math.abs(2 * (a - i) - 1), Math.abs(2 * (b - j) - 1));
    }
    out[0] = p.origin[0] + p.size * (p.cos * cx - p.sin * cy * p.aspect);
    out[1] = p.origin[1] + p.size * (p.sin * cx + p.cos * cy * p.aspect);
    out[2] = Math.max(0, edge);
    out[3] = i;
    out[4] = j;
    out[5] = half;
    return out;
  }
  function vertices(p, i, j, half) {
    let points;
    if (p.kind === 0) {
      const x = i + j / 2,
        y = (j * root3) / 2;
      points = [
        [0.5, 1 / (2 * root3)],
        [0, 1 / root3],
        [-0.5, 1 / (2 * root3)],
        [-0.5, -1 / (2 * root3)],
        [0, -1 / root3],
        [0.5, -1 / (2 * root3)]
      ].map(([a, b]) => [a + x, b + y]);
    } else if (p.kind === 1) {
      points = (
        half
          ? [
              [1, 0],
              [1, 1],
              [0, 1]
            ]
          : [
              [0, 0],
              [1, 0],
              [0, 1]
            ]
      ).map(([a, b]) => [i + a + (j + b) / 2, ((j + b) * root3) / 2]);
    } else {
      const x = (i - j) / 2,
        y = (i + j + 1) / 4;
      points = [
        [0, -0.25],
        [0.5, 0],
        [0, 0.25],
        [-0.5, 0]
      ].map(([a, b]) => [a + x, b + y]);
    }
    return points.map(([x, y]) => world(p, x, y));
  }
  function cellAt(definition, x, y) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Render grid: cell queries need an enabled grid');
    finite(x, -1e7, 1e7, 'x');
    finite(y, -1e7, 1e7, 'y');
    const row = locate(p, x, y, new Float64Array(6));
    const address = [row[3], row[4], row[5]];
    return {
      id: p.mode + ':' + address.join(':'),
      address,
      center: [row[0], row[1]],
      edge: row[2],
      vertices: vertices(p, ...address)
    };
  }
  function cells(definition, bounds, { maxCells = 65536 } = {}) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Render grid: cell enumeration needs an enabled grid');
    if (!Array.isArray(bounds) || bounds.length !== 4)
      throw new TypeError('Render grid: bounds are [x,y,width,height]');
    Array.from(bounds).forEach(v => finite(v, -1e7, 1e7, 'bounds'));
    const [x, y, w, h] = bounds;
    if (w <= 0 || h <= 0 || !Number.isInteger(maxCells) || maxCells < 1 || maxCells > 1000000)
      throw new RangeError('Render grid: invalid bounds or cell budget');
    const corners = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ].map(([a, b]) => local(p, a, b));
    const lattice = corners.map(([a, b]) =>
      p.kind === 2 ? [a + 2 * b, -a + 2 * b] : [a - b / root3, (2 * b) / root3]
    );
    const lo = [0, 1].map(k => Math.floor(Math.min(...lattice.map(q => q[k]))) - 2);
    const hi = [0, 1].map(k => Math.ceil(Math.max(...lattice.map(q => q[k]))) + 2);
    // Bound candidate work as well as retained output; never enumerate an unbounded rotated box.
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (p.kind === 1 ? 2 : 1) > maxCells)
      throw new RangeError('Render grid: cell enumeration exceeds maxCells (including boundary candidates)');
    const result = [];
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let half = 0; half < (p.kind === 1 ? 2 : 1); half++) {
          const polygon = vertices(p, i, j, half);
          if (
            Math.max(...polygon.map(q => q[0])) < x ||
            Math.min(...polygon.map(q => q[0])) > x + w ||
            Math.max(...polygon.map(q => q[1])) < y ||
            Math.min(...polygon.map(q => q[1])) > y + h
          )
            continue;
          const center = [0, 1].map(k => polygon.reduce((sum, q) => sum + q[k], 0) / polygon.length);
          result.push({ id: p.mode + ':' + [i, j, half].join(':'), address: [i, j, half], center, vertices: polygon });
        }
    return result;
  }
  function apply(frame, definition) {
    const p = prepare(definition);
    if (!p) return frame;
    const { w, h, rgb, alpha } = frame;
    dimensions(p, w, h);
    if (
      !(rgb instanceof Uint8Array || rgb instanceof Uint8ClampedArray) ||
      rgb.length !== w * h * 3 ||
      (alpha !== undefined &&
        (!(alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray) || alpha.length !== w * h))
    )
      throw new TypeError('Render grid: expected packed RGB bytes and optional alpha bytes');
    const out = new Uint8Array(rgb.length),
      al = alpha && new Uint8Array(alpha.length),
      row = new Float64Array(6);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        locate(p, x + 0.5, y + 0.5, row);
        const dest = y * w + x;
        if (row[2] < p.gap) {
          out.set(p.gapColor, dest * 3);
          if (al) al[dest] = 255;
        } else {
          const source =
            Math.max(0, Math.min(h - 1, Math.floor(row[1]))) * w + Math.max(0, Math.min(w - 1, Math.floor(row[0])));
          out[dest * 3] = rgb[source * 3];
          out[dest * 3 + 1] = rgb[source * 3 + 1];
          out[dest * 3 + 2] = rgb[source * 3 + 2];
          if (al) al[dest] = alpha[source];
        }
      }
    return { ...frame, rgb: out, ...(al && { alpha: al }) };
  }
  // Shared locator, also exposed for custom WebGL hosts. Coordinates are top-left output pixels.
  const glsl = `
vec3 inkGridCell(vec2 pixel, int kind, float size, vec2 origin, vec2 rotation, float aspect) {
  const float R3 = 1.7320508075688772;
  vec2 delta = pixel-origin;
  vec2 p = vec2(dot(delta,rotation),dot(delta,vec2(-rotation.y,rotation.x)))/vec2(size,size*aspect);
  vec2 center; float edge;
  if(kind==0){
    vec3 cube=vec3(p.x-p.y/R3,2.0*p.y/R3,0.0);cube.z=-cube.x-cube.y;
    vec3 r=floor(cube+.5),d=abs(r-cube);
    if(d.x>d.y&&d.x>d.z)r.x=-r.y-r.z;else if(d.y>d.z)r.y=-r.x-r.z;
    center=vec2(r.x+r.y*.5,r.y*R3*.5);
    vec2 v=p-center;
    edge=1.0-2.0*max(abs(v.x),max(abs(.5*v.x+R3*.5*v.y),abs(.5*v.x-R3*.5*v.y)));
  }else if(kind==1){
    vec2 a=vec2(p.x-p.y/R3,2.0*p.y/R3),r=floor(a),f=a-r;
    bool upper=f.x+f.y>1.0;float t=upper?2.0/3.0:1.0/3.0;
    center=vec2(r.x+r.y*.5+(upper?1.0:.5),(r.y+t)*R3*.5);
    edge=3.0*(upper?min(min(1.0-f.x,1.0-f.y),f.x+f.y-1.0):min(min(f.x,f.y),1.0-f.x-f.y));
  }else{
    vec2 a=vec2(p.x+2.0*p.y,-p.x+2.0*p.y),r=floor(a),f=a-r;
    center=vec2((r.x-r.y)*.5,(r.x+r.y+1.0)*.25);
    edge=1.0-max(abs(2.0*f.x-1.0),abs(2.0*f.y-1.0));
  }
  center*=vec2(size,size*aspect);
  return vec3(origin+vec2(rotation.x*center.x-rotation.y*center.y,rotation.y*center.x+rotation.x*center.y),max(0.0,edge));
}`;
  return Object.freeze({ modes, prepare, dimensions, cellAt, cells, apply, glsl });
})();
if (typeof module !== 'undefined') module.exports = RenderGrid;
