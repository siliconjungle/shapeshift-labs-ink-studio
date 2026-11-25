/* Facing evidence and stable corner reversal shared by repair and reflection. */
const meshWinding = (function (K) {
  const { V } = K;
  const unit = v => {
    const length = V.len(v);
    return v.map(n=>n/length || 0);
  };

  function direction(raw, label = 'viewFrom') {
    if (raw === undefined) return;
    if (!Array.isArray(raw) || raw.length !== 3 || !Array.from(raw).every(Number.isFinite) ||
        !Number.isFinite(V.len(raw)) || !V.len(raw))
      throw new TypeError(label + ' needs a nonzero XYZ direction');
    return unit(raw);
  }

  function edit(face, reverse, normal) {
    const ring = reverse ? [face.corners[0],...face.corners.slice(1).reverse()] : face.corners;
    return { ...face, corners: normal ? ring.map(corner=>corner.normal ?
      {...corner,normal:normal(corner.normal)} : corner) : ring };
  }

  function describe(doc, viewFrom) {
    const vertices = new Map(doc.vertices.map(row=>[row.id,row.position]));
    const faces = new Map(doc.faces.map(row=>[row.id,row]));
    return id => {
      const ring = faces.get(id).corners;
      const order = ring.map(({vertex})=>vertex);
      const normal = unit(meshFaceRegionGeometry.area(order.map(vertex=>vertices.get(vertex).map(Math.fround))));
      const dot = viewFrom && V.dot(normal,viewFrom);
      return { corners:ring.map(row=>row.id), vertices:order, normal,
        ...(viewFrom && {facing:Math.abs(dot)<1e-10 ? 'edge-on' : dot>0 ? 'front' : 'back'}) };
    };
  }

  function changes(before, after, pairs, viewFrom) {
    if (!pairs.length) return [];
    const previous = describe(before,viewFrom), next = describe(after,viewFrom);
    return pairs.map(({from,to=from})=>({face:to,...(from!==to && {source:from}),before:previous(from),after:next(to)}));
  }

  function conflicts(doc, faces) {
    if (!faces.size) return [];
    const {edges,corners} = retainedMeshHealth.incidence(doc);
    return edges.filter(({uses})=>uses.length === 2 && uses.some(use=>faces.has(use.face)) &&
      retainedMeshHealth.crossesWinding(...uses,corners)).map(({id,uses})=>({edge:id,faces:uses.map(use=>use.face).sort()}));
  }

  return Object.freeze({direction,edit,changes,conflicts});
})(KIT);
