/* Carry authored geometry and surface coordinates through a tracked screen-space displacement. */
(function (K) {
  const P = K.procedural, { V, M } = K;
  const validWorld = P.graphTypes.validator('world');
  const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 1e6;
  const vector = (v, size) => (Array.isArray(v) || ArrayBuffer.isView(v)) &&
    v.length === size && Array.from(v).every(coordinate);
  const maxHandles = 128, maxVisits = 8e6;

  function handles({ from, to } = {}) {
    if (!Array.isArray(from) || !Array.isArray(to) || from.length > maxHandles || from.length !== to.length)
      throw new RangeError('Motion deformation needs aligned from and to landmarks');
    return Array.from(from, (p, i) => {
      const q = to[i];
      if (!vector(p, 2) || !vector(q, 2) || from.slice(0, i).some(a => Math.hypot(p[0] - a[0], p[1] - a[1]) <= 1e-6))
        throw new RangeError('Motion landmarks need finite XY coordinates and distinct rest positions');
      return { x: p[0], y: p[1], u: q[0] - p[0], v: q[1] - p[1] };
    });
  }

  function map2D(control) {
    const rows = handles(control);
    function sample([x, y], gradient) {
      let closest, nearest = Infinity;
      for (const row of rows) {
        const distance2 = (x - row.x) ** 2 + (y - row.y) ** 2;
        if (distance2 < nearest) [closest, nearest] = [row, distance2];
      }
      if (!closest) return gradient ? [1, 0, 0, 1] : [x, y];
      if (nearest < 1e-24) return gradient ? [1, 0, 0, 1] : [x + closest.u, y + closest.v];

      let weight = 0, u = 0, v = 0, wx = 0, wy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
      for (const row of rows) {
        const dx = x - row.x, dy = y - row.y, distance2 = dx * dx + dy * dy;
        const w = nearest / distance2, du = row.u - closest.u, dv = row.v - closest.v;
        weight += w;
        u += w * du;
        v += w * dv;
        if (gradient) {
          const gx = -2 * dx * w / distance2, gy = -2 * dy * w / distance2;
          wx += gx; wy += gy;
          ux += gx * du; uy += gy * du;
          vx += gx * dv; vy += gy * dv;
        }
      }
      u /= weight;
      v /= weight;
      // The common weight scale cancels in the quotient. Relative displacements keep the gradient stable near a handle.
      if (gradient) return [1 + (ux - u * wx) / weight, (uy - u * wy) / weight,
        (vx - v * wx) / weight, 1 + (vy - v * wy) / weight];
      return [x + closest.u + u, y + closest.v + v];
    }
    const map = point => sample(point, false);
    map.jacobian = point => sample(point, true);
    map.count = rows.length;
    return map;
  }

  function map3D(control, { chart: { origin = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0] } = {} } = {}) {
    if (![origin, u, v].every(p => vector(p, 3))) throw new RangeError('Motion chart needs finite XYZ axes and origin');
    const cross = V.cross(u, v), area = V.len(cross);
    if (area < 1e-18 || area <= V.len(u) * V.len(v) * 1e-6)
      throw new RangeError('Motion chart axes need to be independent');
    const base = M.cols(u, v, V.mul(cross, 1 / area)), inverse = M.inv(base), offset = Array.from(origin);
    const local = p => M.app(inverse, V.sub(p, offset)), planar = map2D(control);
    const map = p => {
      const q = local(p), [x, y] = planar(q);
      return V.add(p, M.app(base, [x - q[0], y - q[1], 0]));
    };
    map.jacobian = p => {
      const [a, b, c, d] = planar.jacobian(local(p));
      return M.mul(M.mul(base, [a, b, 0, c, d, 0, 0, 0, 1]), inverse);
    };
    map.count = planar.count;
    return map;
  }

  function track(observations, bindings) {
    if (!Array.isArray(bindings) || bindings.length > maxHandles)
      throw new RangeError('Motion deformation accepts up to 128 landmark bindings');
    const ids = new Set(), active = [];
    const authored = Array.from(P.data.clone(bindings), ({ id, rest, track, ...settings }) => {
      if (!(typeof id === 'string' && id.length > 0 && id.length <= 128 ||
          Number.isSafeInteger(id) && id > 0) || ids.has(id) || !vector(rest, 2))
        throw new RangeError('Motion landmarks need unique IDs and a rest XY point');
      ids.add(id);
      if (track !== undefined) {
        const { offset, boundsAnchor, silhouetteDirection, smoothing, lag, hold, minConfidence } = settings;
        active.push({ id, track, ...Object.fromEntries(Object.entries({
          offset, boundsAnchor, silhouetteDirection, smoothing, lag, hold, minConfidence
        }).filter(([, value]) => value !== undefined)) });
      }
      return { id, rest };
    });
    const rest = authored.map(({ rest }) => rest);
    handles({ from: rest, to: rest });
    const clip = P.drawing2d.trackedAnchors(observations, active);
    const sample = time => {
      const byId = new Map(clip.sample(time).anchors.map(anchor => [anchor.id, anchor]));
      const landmarks = authored.map(({ id, rest }) => {
        const anchor = byId.get(id);
        const position = anchor?.position ?? rest.slice();
        if (!vector(position, 2)) throw new RangeError('Observed motion landmark exceeds its coordinate budget');
        return { id, rest: rest.slice(), position, status: anchor?.status ?? 'pinned' };
      });
      return { value: { from: landmarks.map(row => row.rest), to: landmarks.map(row => row.position) }, landmarks };
    };
    return Object.freeze({ sample });
  }

  function visitBudget(count, map) {
    if (count * map.count > maxVisits) throw new RangeError('Motion deformation exceeds its landmark visit budget');
  }

  function mesh(source, control, options) {
    const result = P.sceneGraph.mesh(source), map = map3D(control, options);
    visitBudget(result.pos.length / 3, map);
    if (!map.count) return result;
    for (let i = 0; i < result.pos.length; i += 3) {
      const p = result.pos.subarray(i, i + 3), moved = map(p), j = result.normals && map.jacobian(p);
      if (!moved.every(coordinate)) throw new RangeError('Motion-deformed mesh exceeds its coordinate budget');
      result.pos.set(moved, i);
      if (j && Math.abs(M.det(j)) > 1e-12) {
        const normal = result.normals.subarray(i, i + 3);
        result.normals.set(V.norm(M.app(M.tr(M.inv(j)), normal), normal), i);
      }
    }
    return result;
  }

  function splats(source, ids, control, options) {
    if (!validWorld(source) || source.anim || source.rest && source.rest !== source.data)
      throw new TypeError('Motion splats need a baked world with static rows');
    if (!Array.isArray(ids) || ids.length > source.count || !Array.from(ids).every(id =>
      Number.isSafeInteger(id) && id >= 0 && id < source.count) || new Set(ids).size !== ids.length)
      throw new RangeError('Motion splats need distinct row indices from the baked world');
    const map = map3D(control, options);
    visitBudget(ids.length, map);
    const data = Float32Array.from(source.data), world = { ...source, data, ...(source.rest && { rest: data }) };
    K.deform.apply(world, ids, K.deform.rest(world, ids), map);
    for (const id of ids) {
      const row = data.subarray(id * 16, id * 16 + 11);
      if (!row.every(Number.isFinite)) throw new RangeError('Motion-deformed splats exceed their numeric range');
    }
    return world;
  }

  const options = { type: 'record', default: {} };
  const operations = {
    'motion.landmarks': {
      description: 'Sample tracked points and silhouettes as corresponding rest and posed landmarks.',
      inputs: { observations: 'array<record>', bindings: 'array<record>', options },
      outputs: { value: 'record', landmarks: 'array<record>' }, time: true,
      instantiate() {
        let clip, observed, bound;
        const run = ({ observations, bindings, options }, { time }) => {
          if (observations !== observed || bindings !== bound) {
            clip = track(observations, bindings);
            [observed, bound] = [observations, bindings];
          }
          return clip.sample(options.time ?? time);
        };
        run.clear = () => { clip = observed = bound = undefined; };
        return run;
      }
    },
    'geo.motionMesh': {
      description: 'Deform an indexed mesh from planar landmark motion while retaining its authored surface channels.',
      inputs: { source: 'mesh', control: 'record', options },
      outputs: { value: 'mesh' },
      run({ source, control, options }) { return { value: mesh(source, control, options) }; }
    },
    'scene.motionSplats': {
      description: 'Deform selected rows of a baked world, including covariance and brush footprint axes.',
      inputs: { source: 'world', ids: 'array<number>', control: 'record', options },
      outputs: { value: 'world' },
      run({ source, ids, control, options }) { return { value: splats(source, ids, control, options) }; }
    }
  };

  P.motionDeformation = Object.freeze({ track, map2D, map3D, mesh, splats, visitBudget, operations: Object.freeze(operations) });
  K.deform.motion = map3D;
})(KIT);
