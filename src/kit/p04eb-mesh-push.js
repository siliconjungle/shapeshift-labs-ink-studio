/* Directional contact between authored components and a stationary mesh snapshot. */
const meshPush = (function (K) {
  const T = K.meshTopology, { V, procedural: { spatial } } = K;
  const tolerance = 1e-8, angularTolerance = 1e-12;
  const record = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
    Object.keys(raw).every(key => keys.includes(key));
  const name = value => typeof value === 'string' && !!value.trim();
  const edgeKey = (a,b) => JSON.stringify(a < b ? [a,b] : [b,a]);
  const unit = v => {
    const length = Math.hypot(...v);
    return length ? V.mul(v,1/length) : v;
  };

  function groupComponents(doc, selection, selected, fixed, coincident, mode) {
    const parents = new Map([...selected].map(id => [id,id]));
    function root(id) {
      while (parents.get(id) !== id) {
        parents.set(id,parents.get(parents.get(id)));
        id = parents.get(id);
      }
      return id;
    }
    function join(ids) {
      for (const id of ids) if (!parents.has(id)) parents.set(id,id);
      for (let i = 1; i < ids.length; i++) parents.set(root(ids[i]),root(ids[0]));
    }
    if (mode === 'assembly') join([...selected]);
    else if (selection.domain !== 'vertices') {
      const picked = new Set(selection.ids);
      for (const row of doc[selection.domain]) if (picked.has(row.id))
        join(selection.domain === 'edges' ? row.vertices : row.corners.map(({ vertex }) => vertex));
    }
    for (const group of coincident?.report.groups ?? []) join(group.vertices);
    const sets = new Map();
    for (const id of [...parents.keys()].sort()) {
      const leader = root(id);
      if (!sets.has(leader)) sets.set(leader,[]);
      sets.get(leader).push(id);
    }
    return [...sets.values()].map(vertices => ({
      vertices, held: vertices.some(id => fixed.has(id)), primitives: []
    }));
  }

  function triangles(doc, world, accept) {
    const faces = new Map(doc.faces.map(face => [face.id,new Map(face.corners.map(row => [row.id,row.vertex]))]));
    const { triangleSources } = T.triangulate(doc);
    return triangleSources.flatMap(({ face, corners }, triangle) => {
      const ids = corners.map(id => faces.get(face).get(id));
      return accept(face,ids) ? [primitive('faces',face,ids,world,triangle)] : [];
    });
  }

  function primitive(domain, id, vertices, world, triangle) {
    const points = vertices.map(vertex => world.get(vertex));
    const edges = points.slice(0,points.length === 2 ? 1 : points.length === 3 ? 3 : 0)
      .map((p,i) => unit(V.sub(points[(i+1)%points.length],p)));
    const normal = points.length === 3 ? unit(V.cross(edges[0],edges[1])) : undefined;
    return { domain,id,vertices,points,edges,normal,triangle,bounds:spatial.boxOf(points) };
  }

  function movingPrimitives(doc, world, groups, owners) {
    const coveredEdges = new Set(), coveredVertices = new Set();
    const ownerOf = ids => {
      const group = owners.get(ids[0]);
      return group && ids.every(id => owners.get(id) === group) ? group : undefined;
    };
    for (const row of triangles(doc,world,(_,ids) => !!ownerOf(ids))) {
      ownerOf(row.vertices).primitives.push(row);
      for (const [i,id] of row.vertices.entries()) {
        coveredVertices.add(id);
        coveredEdges.add(edgeKey(id,row.vertices[(i+1)%3]));
      }
    }
    for (const edge of doc.edges) {
      const owner = ownerOf(edge.vertices);
      if (!owner || coveredEdges.has(edgeKey(...edge.vertices))) continue;
      owner.primitives.push(primitive('edges',edge.id,edge.vertices,world));
      for (const id of edge.vertices) coveredVertices.add(id);
    }
    for (const group of groups) if (!group.held) for (const id of group.vertices)
      if (!coveredVertices.has(id)) group.primitives.push(primitive('vertices',id,[id],world));
  }

  function projected(points, origin, axis) {
    const dots = points.map(p => V.dot(V.sub(p,origin),axis));
    return [Math.min(...dots),Math.max(...dots)];
  }

  function contactDistance(a, b, direction, limit) {
    if (V.len(b.normal) < angularTolerance) return;
    // Intersect the time intervals in which both shapes overlap on each
    // separating axis. In-plane axes also detect coplanar edge contact.
    const axes = [b.normal,...b.edges.map(edge => V.cross(b.normal,edge))];
    if (a.normal) axes.push(a.normal,...a.edges.map(edge => V.cross(a.normal,edge)));
    for (const e of a.edges) {
      axes.push(V.cross(b.normal,e));
      for (const f of b.edges) axes.push(V.cross(e,f));
    }
    let first = 0, last = limit;
    for (const normal of axes) {
      if (V.len(normal) < angularTolerance) continue;
      const axis = unit(normal), speed = V.dot(direction,axis), origin = b.points[0];
      const [a0,a1] = projected(a.points,origin,axis), [b0,b1] = projected(b.points,origin,axis);
      if (Math.abs(speed) < angularTolerance) {
        if (a1 < b0-tolerance || a0 > b1+tolerance) return;
        continue;
      }
      const t0 = (b0-a1)/speed, t1 = (b1-a0)/speed;
      first = Math.max(first,Math.min(t0,t1));
      last = Math.min(last,Math.max(t0,t1));
      if (first > last+tolerance) return;
    }
    return Math.min(first,limit);
  }

  function targetMesh(raw, doc, frame, context, world, moving) {
    if (!record(raw, ['object','faces']) || raw.object !== undefined && !name(raw.object) ||
        raw.faces !== undefined && (!Array.isArray(raw.faces) || !raw.faces.length ||
          !Array.from(raw.faces).every(name) || new Set(raw.faces).size !== raw.faces.length))
      throw new TypeError('Push target needs a mesh object and/or unique face IDs');
    const { source, frame: targetFrame } = raw.object === context.object ? { source:doc,frame } :
      meshComponentSnap.meshTarget(doc,frame,raw.object,context,'push');
    const same = source === doc && ['position','matrix'].every(key => frame[key].every((value,i) => value === targetFrame[key][i]));
    const faceIds = raw.faces && new Set(raw.faces);
    if (faceIds) {
      const faces = new Map(source.faces.map(face => [face.id,face]));
      for (const id of faceIds) {
        if (!faces.has(id)) throw new RangeError('Unknown push target face ' + id);
        if (same && faces.get(id).corners.some(({ vertex }) => moving.has(vertex)))
          throw new RangeError('Push target face ' + id + ' must remain stationary');
      }
    }
    const points = same ? world : new Map(source.vertices.map(({ id, position }) => [id,K.sceneGraph.point(targetFrame,position)]));
    const stationary = new Set(source.faces.filter(face => (!faceIds || faceIds.has(face.id)) &&
      (!same || !face.corners.some(({ vertex }) => moving.has(vertex)))).map(face => face.id));
    const rows = triangles(source,points,id => stationary.has(id));
    return { tree: spatial.pointIndex(rows), evidence: {
      mesh: source.id, revision: T.revision(source), ...(raw.object !== undefined && { object: raw.object }),
      ...(faceIds && { faces: [...faceIds].sort() }), frame: targetFrame, triangles: rows.length
    } };
  }

  function plan(raw, direction, doc, world, frame, selection, selected, fixed, coincident, context) {
    if (!record(raw,['kind','direction','target','mode','maxDistance','clearance','miss','maxPairs']))
      throw new TypeError('Use a push direction, target, and distance settings');
    const { mode = 'individual', maxDistance, clearance = 0, miss = 'keep', maxPairs = 250000, target = {} } = raw;
    if (!['individual','assembly'].includes(mode) || !['keep','limit','error'].includes(miss) ||
        !Number.isFinite(maxDistance) || maxDistance <= 0 || !Number.isFinite(clearance) || clearance < 0 ||
        clearance > maxDistance || !Number.isSafeInteger(maxPairs) || maxPairs < 1)
      throw new RangeError('Push needs individual or assembly mode, positive reach and pair limit, clearance within reach, and a valid miss policy');
    const groups = groupComponents(doc,selection,selected,fixed,coincident,mode), owners = new Map();
    for (const group of groups) if (!group.held) for (const id of group.vertices) owners.set(id,group);
    const { tree, evidence } = targetMesh(target,doc,frame,context,world,owners);
    if (owners.size && !evidence.triangles) throw new RangeError('Push needs at least one stationary target triangle');
    if (owners.size) movingPrimitives(doc,world,groups,owners);
    let pairs = 0;
    const distances = new Map(), reports = [];
    for (const group of groups) {
      let hit;
      for (const row of group.primitives) {
        if (hit?.distance === 0) break;
        const delta = V.mul(direction,hit?.distance ?? maxDistance);
        const sweep = spatial.expand(spatial.boxOf([...row.points,...row.points.map(p => V.add(p,delta))]),tolerance);
        tree.box(sweep, obstacle => {
          if (++pairs > maxPairs) throw new RangeError('Push exceeded its contact pair limit');
          const distance = contactDistance(row,obstacle,direction,hit?.distance ?? maxDistance);
          if (distance !== undefined && (!hit || distance < hit.distance ||
              distance === hit.distance && row === hit.row && obstacle.triangle < hit.obstacle.triangle))
            hit = { row, obstacle, distance };
        });
      }
      if (!group.held && !hit && miss === 'error')
        throw new RangeError('Push missed its target for the component containing ' + group.vertices[0]);
      const distance = hit ? Math.max(0,hit.distance-clearance) : group.held || miss === 'keep' ? 0 : maxDistance;
      for (const id of group.vertices) distances.set(id,distance);
      const describe = ({ domain,id,vertices,triangle }) => ({ domain,id,vertices,...(triangle !== undefined && { triangle }) });
      reports.push({ vertices:group.vertices, distance, status:group.held ? 'pinned' : hit ? 'contact' : 'miss',
        ...(hit && { contact: { distance:hit.distance, source:describe(hit.row), target:describe(hit.obstacle) } }) });
    }
    return { distances, report: { kind:'push', mode, direction, maxDistance, clearance, miss, maxPairs,
      testedPairs:pairs, target:evidence, groups:reports } };
  }

  return Object.freeze({ plan });
})(KIT);
