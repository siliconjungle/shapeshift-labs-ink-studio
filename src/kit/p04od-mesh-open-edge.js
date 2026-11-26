/* Extrude an exposed edge or directed boundary chain without moving its base. */
const meshOpenEdge = (function (K) {
  const {V} = K, {record,unit,pair} = meshCutGeometry, {boundaryPaths} = meshCutCaps;
  const {name,position,selection,openUse,openEdgeFrame,point} = meshEdgeFlowData;
  const epsilon = 1e-8;

  function path(g, edges) {
    const uses = edges.map(edge=>openUse(g,edge));
    const directed = uses.map(({a,b})=>[a.vertex,b.vertex]);
    const {paths,branched} = boundaryPaths(directed);
    if (branched || paths.length !== 1 || paths[0].closed)
      throw new RangeError('Extrude edge needs one open, consistently wound boundary chain');
    const {vertices} = paths[0], byStart = new Map(uses.map(use=>[use.a.vertex,use]));
    return {vertices,uses:vertices.slice(0,-1).map(id=>byStart.get(id))};
  }

  function extrude(g, op, {resolveBrush} = {}) {
    const {direction:normalize} = meshTopologyShading;
    const {direction='edge',strict=false,uv='strip'} = op;
    if (!record(op,['kind','edge','selection','distance','direction','strict','material','uv','uvSets','brush']) ||
        (op.edge === undefined) === (op.selection === undefined) || op.edge !== undefined && !name(op.edge) ||
        !Number.isFinite(op.distance) || op.distance === 0 || typeof strict !== 'boolean' ||
        op.material !== undefined && !name(op.material) || !meshExtrusionUV.modes.includes(uv) ||
        (uv === 'brush') !== (op.brush !== undefined) || uv === 'extend' && op.material !== undefined ||
        op.uvSets !== undefined && (!Array.isArray(op.uvSets) || !Array.from(op.uvSets).every(MaterialUV.layout) ||
          new Set(op.uvSets).size !== op.uvSets.length))
      throw new TypeError('Extrude edge needs a boundary edge or saved selection, signed distance, and optional direction and material rules');
    const vector = Array.isArray(direction) ? unit(direction,'Edge extrusion direction') : undefined;
    if (!vector && !['face','edge'].includes(direction)) throw new TypeError('Choose edge, face, or an XYZ direction');
    if (op.edge !== undefined && !g.byId.has(op.edge)) throw new RangeError('Unknown edge '+op.edge);
    const edges = op.edge === undefined ? selection(g,op.selection) : [g.byId.get(op.edge)];
    const mapping = meshExtrusionUV.prepare(g.doc,op,Object.values(g.doc.uvBindings ?? {}),resolveBrush);
    const detail = {direction:vector ? 'explicit' : direction,...(vector && {axis:vector}),strict,distance:op.distance,
      uv,uvSets:mapping.sets,edges:edges.map(edge=>edge.id)};
    const refuse = issue=>({patch:{},affected:[],detail,issues:[issue]});
    const sealed = edges.filter(edge=>edge.uses.length !== 1);
    if (sealed.length) return refuse({kind:'edge-is-not-open',edges:sealed.map(edge=>edge.id)});

    const {vertices:rail,uses} = path(g,edges);
    const frames = uses.map(use=>openEdgeFrame(g,use));
    const directions = frames.map(frame=>vector ?? normalize(direction === 'edge' ? frame.outward : frame.normal));
    detail.edges = uses.map(({edge})=>edge);
    detail.edgeDirections = uses.map(({edge,face},i)=>({edge,face:face.id,axis:directions[i]}));
    const degenerate = uses.filter((_,i)=>!frames[i].width || !V.len(directions[i]));
    if (degenerate.length) return refuse({kind:'undefined-edge-direction',edges:degenerate.map(row=>row.edge)});
    const incompatible = strict && directions.some(axis=>V.dist(axis,directions[0]) > epsilon);
    if (incompatible) return refuse({kind:'strict-directions-disagree',edges:detail.edges});
    const locked = vector ?? (strict ? directions[0] : null);
    const axes = rail.map((_,i)=>locked ?? normalize(V.add(directions[i-1] ?? [0,0,0],directions[i] ?? [0,0,0])));
    const cancelled = rail.filter((_,i)=>!V.len(axes[i]));
    if (cancelled.length) return refuse({kind:'edge-directions-cancel',vertices:cancelled});
    const parallel = uses.filter((_,i)=>{
      const tangent = V.mul(frames[i].along,1/frames[i].width);
      return [axes[i],axes[i+1]].some(axis=>V.len(V.cross(tangent,axis))<=epsilon);
    });
    if (parallel.length) return refuse({kind:'direction-parallel-to-edge',edges:parallel.map(row=>row.edge)});

    const span = [0];
    for (const {width} of frames) span.push(span.at(-1)+width);
    const motion = [], vertices = rail.map((from,i)=>{
      const start = position(g,from), displacement = V.mul(axes[i],op.distance), end = V.add(start,displacement);
      const {vertex} = point(g,[[from,1]],end);
      motion.push({from,to:vertex.id,start,end,axis:axes[i],displacement});
      return vertex;
    });
    const strips = [], faces = uses.map(({edge,face,a,b},i)=>{
      const start = uv==='strip' ? span[i]/span.at(-1) : 0, end = uv==='strip' ? span[i+1]/span.at(-1) : 1;
      const id = g.fresh('face'), outer = [vertices[i].id,vertices[i+1].id];
      const material = mapping.brush?.material ?? op.material ?? face.material;
      const corners = meshExtrusionUV.corners(mapping,{id,face,edge,a,b,outer,at:key=>position(g,key),
        offsets:[motion[i].displacement,motion[i+1].displacement],span:[start,end]})
        .map(corner=>({id:g.fresh('corner'),...corner}));
      strips.push({face:id,parent:face.id,sourceEdge:edge,outerEdge:'edge/'+pair(...outer),material});
      return {id,material,corners};
    });
    const sidewallUVs = meshExtrusionUV.report(mapping);
    return {patch:{vertices,faces},affected:faces.map(row=>row.id),issues:mapping.issues,
      detail:{...detail,motion,faces:strips,...(sidewallUVs && {sidewallUVs})}};
  }

  return {extrude};
})(KIT);
