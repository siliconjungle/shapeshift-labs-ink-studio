/* Opt-in displacement groups for separately authored vertex IDs. */
const meshCoincidentMotion = (function (K) {
  const { V, procedural: { spatial } } = K;
  const { uv, setsOf } = MaterialUV;
  const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  const sorted = ids => [...ids].sort(order);

  function plan(doc, world, weights, fixed, anchors, raw) {
    if (raw === false || raw === undefined) return;
    const options = raw === true ? {} : raw;
    if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
        Object.keys(options).some(key => !['tolerance','maxPairs'].includes(key)))
      throw new TypeError('Coincident motion needs true, false, or tolerance and maxPairs settings');
    const { tolerance = 1e-6, maxPairs = 250000 } = options;
    if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isSafeInteger(maxPairs) || maxPairs < 1)
      throw new RangeError('Coincident motion needs a nonnegative world tolerance and a positive pair limit');
    const { edges, corners } = retainedMeshHealth.incidence(doc);
    const incidence = new Map(doc.vertices.map(({id}) => [id, { edges: [], faces: new Set(), seams: [] }]));
    for (const face of doc.faces) for (const {vertex} of face.corners) incidence.get(vertex).faces.add(face.id);
    for (const edge of edges) for (const id of edge.vertices) {
      const entry = incidence.get(id);
      entry.edges.push(edge);
      if (edge.uvSeam || edge.uvSeams) entry.seams.push(edge.id);
    }
    const tree = spatial.pointIndex([...world].map(([id, point]) => ({ id, bounds: spatial.boxOf([point]) })));
    const close = (a,b) => V.dist(world.get(a), world.get(b)) <= tolerance;
    const leaders = new Map(), grouped = new Set(), groups = [], blocked = new Map();
    let comparisons = 0;
    function spend() {
      if (++comparisons > maxPairs) throw new RangeError('Coincident motion exceeded its pair limit');
    }
    const oriented = (edge, vertex) => edge.uses.map(use => {
      const a = corners.get(use.from), b = corners.get(use.to);
      return a.vertex === vertex ? [a,b] : [b,a];
    });
    const differentUV = (left,right) => left.some((a,i) => {
      const b = right[i];
      return [...new Set([0, ...setsOf(a), ...setsOf(b)])].some(set => {
        const first = uv(a,set), second = uv(b,set);
        return !first || !second || !MeshUV.sameUV(first,second);
      });
    });
    const other = (edge,id) => edge.vertices[edge.vertices[0] === id ? 1 : 0];
    function separated(a,b) {
      const left = incidence.get(a), right = incidence.get(b);
      for (const face of left.faces) if (right.faces.has(face)) return { reason: 'shared-face', face };
      if (left.seams.length || right.seams.length)
        return { reason: 'authored-seam', edges: sorted(new Set([...left.seams, ...right.seams])) };
      for (const e of left.edges) for (const f of right.edges) {
        spend();
        if (!close(other(e,a),other(f,b))) continue;
        const first = oriented(e,a), second = oriented(f,b);
        for (const x of first) for (const y of second) {
          spend();
          if (differentUV(x,y)) return { reason: 'uv-discontinuity', edges: sorted([e.id,f.id]) };
        }
      }
    }
    function compatible(a,b) {
      spend();
      if (!close(a,b)) return false;
      const seam = separated(a,b);
      if (seam) {
        const vertices = sorted([a,b]);
        blocked.set(JSON.stringify(vertices), { vertices, ...seam });
      }
      return !seam;
    }
    const preferred = new Set(anchors);
    const seeds = [...weights.keys()].sort((a,b) =>
      Number(preferred.has(b))-Number(preferred.has(a)) || weights.get(b)-weights.get(a) || order(a,b));
    for (const leader of seeds) {
      if (grouped.has(leader)) continue;
      const nearby = [];
      tree.box(spatial.expand(spatial.boxOf([world.get(leader)]),tolerance), ({id}) => {
        if (id !== leader && !grouped.has(id)) nearby.push(id);
      });
      const members = [leader];
      for (const id of nearby.sort(order)) if (members.every(otherId => compatible(otherId,id))) members.push(id);
      for (const id of members) grouped.add(id);
      if (members.length === 1) continue;
      const weight = weights.get(leader), held = members.some(id => fixed.has(id));
      for (const id of members) {
        if (held) {
          fixed.add(id);
          weights.delete(id);
        } else {
          leaders.set(id,leader);
          weights.set(id,weight);
        }
      }
      groups.push({ leader, vertices: sorted(members), weight, held });
    }
    const barriers = [...blocked.values()].sort((a,b) => order(a.vertices[0],b.vertices[0]) || order(a.vertices[1],b.vertices[1]));
    return { leaders, report: { tolerance, comparisons, groups, blocked: barriers.slice(0,512), blockedCount: barriers.length } };
  }

  return Object.freeze({ plan });
})(KIT);
