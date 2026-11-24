/* Editable chart-space velocity grids, shared by authoring and simulation. */
const FlowMap = (() => {
  const format = 'ink-studio/flow-map', version = 1, maxSpeed = 1000;
  const finite = Number.isFinite;
  const tuple = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(finite);
  const record = v => v && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const fields = (v, keys) => record(v) && Object.keys(v).every(key => keys.includes(key));
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

  function chart(bounds) {
    if (!tuple(bounds, 4) || bounds.some(n => Math.abs(n) > 1e6) ||
        bounds[2] - bounds[0] < 1e-4 || bounds[3] - bounds[1] < 1e-4)
      throw new RangeError('Flow map bounds need ordered [minU, minV, maxU, maxV] in chart units');
    return bounds.slice();
  }

  function dimensions(width, height) {
    if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 256))
      throw new RangeError('Flow map dimensions must be whole numbers from 1 to 256');
  }

  function speedScale(scale) {
    if (!finite(scale) || scale < 0 || scale > 1000)
      throw new RangeError('Flow map speed scale must be between 0 and 1,000');
    return scale;
  }

  function create({ width = 48, height = 32, bounds = [-3, -2, 3, 2] } = {}) {
    dimensions(width, height);
    return editor(width, height, chart(bounds), new Float64Array(width * height * 2));
  }

  function open(value) {
    if (!fields(value, ['format','version','width','height','bounds','vectors']) ||
        value.format !== format || value.version !== version)
      throw new TypeError('Expected a version 1 Ink flow map');
    const { width, height, bounds, vectors } = value;
    dimensions(width, height);
    if (!Array.isArray(vectors) || vectors.length !== width * height * 2)
      throw new TypeError('Flow maps store one interleaved UV velocity pair per cell');
    for (let i = 0; i < vectors.length; i += 2) {
      if (!finite(vectors[i]) || !finite(vectors[i + 1]) ||
          Math.hypot(vectors[i], vectors[i + 1]) > maxSpeed + 1e-9)
        throw new RangeError('Flow map vectors must be finite with speed at most 1,000');
    }
    return editor(width, height, chart(bounds), Float64Array.from(vectors));
  }

  function editor(width, height, bounds, data) {
    Object.freeze(bounds);
    const [u0, v0, u1, v1] = bounds, du = (u1 - u0) / width, dv = (v1 - v0) / height;
    const past = [], future = [], historyLimit = 32;
    let revision = 0;
    const inside = (u, v) => u >= u0 && u <= u1 && v >= v0 && v <= v1;
    const index = (x, y) => 2 * (y * width + x);

    function cell(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height)
        throw new RangeError('Choose an in-bounds flow map column and row');
      const i = index(x, y);
      return [data[i], data[i + 1]];
    }

    function sample(u, v, out = [0, 0]) {
      if (!inside(u, v)) return null;
      const x = clamp((u - u0) / du - .5, 0, width - 1);
      const y = clamp((v - v0) / dv - .5, 0, height - 1);
      const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b;
      const c = Math.min(a + 1, width - 1), d = Math.min(b + 1, height - 1);
      const i = index(a, b), j = index(c, b), k = index(a, d), l = index(c, d);
      for (let n = 0; n < 2; n++)
        out[n] = mix(mix(data[i+n], data[j+n], fx), mix(data[k+n], data[l+n], fx), fy);
      return out;
    }

    function inspect(u, v) {
      const velocity = sample(u, v);
      if (!velocity) return null;
      const column = Math.min(width - 1, Math.floor((u - u0) / du));
      const row = Math.min(height - 1, Math.floor((v - v0) / dv));
      const speed = Math.hypot(...velocity);
      return { at: [u,v], velocity, speed, direction: speed > 1e-10 ? Math.atan2(velocity[1],velocity[0]) * 180 / Math.PI : null,
        cell: [column,row], center: [u0 + (column+.5)*du,v0 + (row+.5)*dv], cellVelocity: cell(column,row) };
    }

    function stroke(options) {
      if (!fields(options, ['points','radius','speed','mode','direction','opacity','hardness']))
        throw new TypeError('Expected a flow brush stroke');
      const { points, radius, speed = 1, mode = 'paint', direction = 'stroke', opacity = 1, hardness = .42 } = options;
      if (!Array.isArray(points) || !points.length || points.length > 1024 ||
          !Array.from(points).every(at => tuple(at, 2) && at.every(n => Math.abs(n) <= 1e7)) ||
          !finite(radius) || radius < 1e-6 || radius > 1e6 || !finite(speed) || speed < 0 || speed > maxSpeed ||
          !['paint','speed','erase'].includes(mode) ||
          ![opacity, hardness].every(n => finite(n) && n >= 0 && n <= 1) ||
          direction !== 'stroke' && (!tuple(direction, 2) || !finite(Math.hypot(...direction)) || Math.hypot(...direction) < 1e-9))
        throw new RangeError('Flow brush needs bounded points, radius, speed, opacity and a direction');
      const fixed = mode === 'paint' && direction !== 'stroke' ? direction.map(n => n / Math.hypot(...direction)) : null;
      const weights = new Float64Array(width * height), goal = new Float64Array(data.length);
      let work = 0;
      for (let n = 0; n < Math.max(1, points.length - 1); n++) {
        const [ax, ay] = points[n], [bx, by] = points[n + 1] ?? points[n];
        const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
        if (mode === 'paint' && !fixed && !length) continue;
        const heading = fixed || (length ? [dx / length, dy / length] : [0, 0]);
        const left = Math.max(0, Math.ceil((Math.min(ax,bx) - radius - u0) / du - .5));
        const right = Math.min(width-1, Math.floor((Math.max(ax,bx) + radius - u0) / du - .5));
        const top = Math.max(0, Math.ceil((Math.min(ay,by) - radius - v0) / dv - .5));
        const bottom = Math.min(height-1, Math.floor((Math.max(ay,by) + radius - v0) / dv - .5));
        if (left > right || top > bottom) continue;
        work += (right-left+1)*(bottom-top+1);
        if (work > 16000000) throw new RangeError('Flow brush stroke exceeds its sampling budget');
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
          const u = u0 + (x+.5)*du - ax, v = v0 + (y+.5)*dv - ay;
          const t = length ? clamp((u*dx + v*dy) / (length*length), 0, 1) : 0;
          const distance = Math.hypot(u - dx*t, v - dy*t) / radius;
          if (distance >= 1) continue;
          const p = y*width+x, i = 2*p;
          const edge = distance <= hardness ? 1 : (1-distance)/(1-hardness);
          const weight = opacity * edge*edge*(3 - 2*edge);
          if (!weight || weight < weights[p]) continue;
          weights[p] = weight;
          if (mode === 'paint') {
            goal[i] = heading[0]*speed;
            goal[i+1] = heading[1]*speed;
          }
        }
      }
      const next = data.slice();
      let changed = 0;
      for (let p = 0; p < weights.length; p++) {
        const weight = weights[p], i = 2*p;
        if (!weight) continue;
        if (mode === 'speed') {
          const before = Math.hypot(data[i], data[i+1]);
          if (!before) continue;
          goal[i] = data[i]/before*speed;
          goal[i+1] = data[i+1]/before*speed;
        }
        next[i] = mix(data[i], goal[i], weight);
        next[i+1] = mix(data[i+1], goal[i+1], weight);
        if (next[i] !== data[i] || next[i+1] !== data[i+1]) changed++;
      }
      if (changed) {
        past.push(data);
        if (past.length > historyLimit) past.shift();
        future.length = 0;
        data = next;
        revision++;
      }
      return { changed, revision };
    }

    function travel(from, to) {
      if (!from.length) return false;
      to.push(data);
      data = from.pop();
      revision++;
      return true;
    }

    function planar({ bounds: placement = bounds, scale = 1 } = {}) {
      const [x0, y0, x1, y1] = chart(placement);
      speedScale(scale);
      return (x, y) => {
        if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) return null;
        const velocity = placement === bounds ? sample(x,y) :
          sample(clamp(mix(u0,u1,(x-x0)/(x1-x0)),u0,u1), clamp(mix(v0,v1,(y-y0)/(y1-y0)),v0,v1));
        velocity[0] *= scale;
        velocity[1] *= scale;
        return velocity;
      };
    }

    function world({ origin = [0,0,0], u = [1,0,0], v = [0,0,1], bounds: placement = bounds, scale = 1, outside = 'calm' } = {}) {
      if (!tuple(origin, 3) || !tuple(u, 3) || !tuple(v, 3) || Math.abs(Math.hypot(...u)-1) > 1e-6 ||
          Math.abs(Math.hypot(...v)-1) > 1e-6 || Math.abs(dot(u,v)) > 1e-6 || !['calm','none'].includes(outside))
        throw new TypeError('World flow needs a finite origin and perpendicular unit U and V axes');
      const center = origin.slice(), uAxis = u.slice(), vAxis = v.slice(), uv = planar({ bounds:placement,scale });
      return (x, y, z) => {
        const delta = [x-center[0],y-center[1],z-center[2]];
        const velocity = uv(dot(delta,uAxis),dot(delta,vAxis));
        if (!velocity) return outside === 'none' ? null : [0,0,0];
        return uAxis.map((n,i) => n*velocity[0] + vAxis[i]*velocity[1]);
      };
    }

    return Object.freeze({ width,height,bounds,cell,sample,inspect,stroke,planar,world,
      asset: () => ({ format,version,width,height,bounds:bounds.slice(),vectors:Array.from(data) }),
      undo: () => travel(past,future), redo: () => travel(future,past),
      history: () => ({ revision,undo:past.length,redo:future.length })
    });
  }

  return Object.freeze({ format,version,create,open });
})();
if (typeof module !== 'undefined') module.exports = FlowMap;
