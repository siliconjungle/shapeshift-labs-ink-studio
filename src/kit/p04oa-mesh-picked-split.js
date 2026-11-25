/* Split one authored quad at a picked face coordinate and trace its pigment UV. */
const meshPickedSplit = (function (K) {
  const topology = K.meshTopology, { V } = K;
  const { epsilon, point: coordinates, record, blend } = meshCutGeometry;
  const { pair, edgeOf, cyclic, rotate, point, requireWinding, edgeCorner, retainUVPins, inheritEdgeSettings } = meshEdgeFlowData;
  const quad = [[0,0],[1,0],[1,1],[0,1]];

  function read(g, op) {
    if (!record(op,['kind','face','selection','axis','at']) || (op.face === undefined) === (op.selection === undefined) ||
        !['u','v'].includes(op.axis) || !coordinates(op.at,2) || op.at.some(n=>n < 0 || n > 1))
      throw new TypeError('Split face needs a quad or saved face selection, axis u or v, and a normalized face pick');
    const face = selectQuad(g,op), axis = op.axis === 'u' ? 0 : 1;
    if (op.at[axis] <= epsilon || op.at[axis] >= 1-epsilon)
      throw new RangeError('Split pick must be inside the quad along the cut axis');
    return {face,axis,coordinate:op.at[axis]};
  }

  function selectQuad(g, op) {
    const selected = topology.select(g.doc,op.selection === undefined ?
      {domain:'faces',ids:[op.face]} : {domain:'faces',from:op.selection});
    const face = g.faces.get(selected.ids[0]);
    if (selected.ids.length !== 1 || face.corners.length !== 4) throw new RangeError('Select exactly one quad to split');
    return face;
  }

  function subdivisionRegion(g, face, edges) {
    const touched = new Set([face.id,...edges.flatMap(edge=>edge.uses.map(use=>use.face))]);
    const neighbors = [...touched].filter(id=>id !== face.id).sort();
    const triangles = new Map([...touched].map(id=>[id,[]]));
    for (const row of topology.triangulate(g.doc).triangleSources)
      if (touched.has(row.face)) triangles.get(row.face).push(row.corners);
    const pinned = edges.filter(edge=>g.protectedEdges.has(edge.id)).map(edge=>edge.id);
    function audit() {
      if (pinned.length) return [{kind:'pinned-edges',edges:pinned}];
      for (const edge of edges) requireWinding(g,edge);
      const findings = [face.id,...neighbors].flatMap(id=>retainedMeshRepair.tileRegistration(g,[g.faces.get(id)],
        triangles.get(id)[0].map(corner=>g.corners.get(corner))));
      return findings.length ? [{kind:'registration-would-change',findings}] : [];
    }
    return {neighbors,triangles,audit};
  }

  function trace(g, face, triangles, axis, coordinate, at, sides) {
    const uvSet = MaterialUV.resolve(g.doc.uvBindings,'pigment'), ring = face.corners;
    const diagonal = triangles[0].filter(id=>triangles[1].includes(id)).map(id=>ring.findIndex(row=>row.id === id));
    const orthogonal = 1-axis;
    function sample([i,j]) {
      const t = (coordinate-quad[i][axis])/(quad[j][axis]-quad[i][axis]), a = ring[i], b = ring[j];
      return {face:blend(quad[i],quad[j],t),position:V.lerp(g.vertices.get(a.vertex).position,g.vertices.get(b.vertex).position,t),
        uv:blend(MaterialUV.uv(a,uvSet),MaterialUV.uv(b,uvSet),t),
        samples:[{corner:a.id,weight:1-t},{corner:b.id,weight:t}]};
    }
    const line = [sample(sides[0]),sample(diagonal),sample(sides[1])];
    const start = line[at[orthogonal] <= line[1].face[orthogonal] ? 0 : 1];
    const end = line[start === line[0] ? 1 : 2];
    const t = (at[orthogonal]-start.face[orthogonal])/(end.face[orthogonal]-start.face[orthogonal]);
    return {uvSet,line,pick:{face:at.slice(),position:V.lerp(start.position,end.position,t),uv:blend(start.uv,end.uv,t)}};
  }

  function straightTrace(line) {
    const [start,middle,end] = line.map(row=>row.position);
    const span = V.sub(end,start), bend = V.sub(middle,start), length = V.len(span);
    if (!length || V.len(V.cross(span,bend)) > epsilon*length*length) return false;
    const fraction = V.dot(bend,span)/(length*length);
    return fraction >= -epsilon && fraction <= 1+epsilon;
  }

  function split(g, op) {
    const {face,axis,coordinate} = read(g,op);
    const sides = axis === 0 ? [[0,1],[3,2]] : [[0,3],[1,2]];
    const ends = sides.map(side=>side.map(i=>face.corners[i].vertex));
    const edges = ends.map(side=>edgeOf(g,...side));
    const {neighbors,triangles,audit} = subdivisionRegion(g,face,edges);
    const detail = {face:face.id,axis:op.axis,at:op.at.slice(),edges:edges.map(row=>row.id),transitionFaces:neighbors,
      cut:trace(g,face,triangles.get(face.id),axis,coordinate,op.at,sides)};
    const issues = audit();
    if (issues[0]?.kind === 'pinned-edges') return {patch:{},affected:[],detail,issues};
    if (!straightTrace(detail.cut.line)) {
      const finding = {kind:'cut-bends-on-face',face:face.id};
      if (issues.length) issues[0].findings.push(finding);
      else issues.push({kind:'registration-would-change',findings:[finding]});
    }
    if (issues.length) return {patch:{},affected:[],detail,issues};

    const conflicts = new Set(), cuts = edges.map((edge,i)=>{
      const [a,b] = ends[i];
      return {edge,a,...point(g,[[a,1-coordinate],[b,coordinate]])};
    });
    const byEdge = new Map(cuts.map(row=>[row.edge.id,row]));
    function ringFor(source) {
      return source.corners.flatMap((a,i)=>{
        const b = cyclic(source.corners,i+1), cut = byEdge.get(edgeOf(g,a.vertex,b.vertex).id);
        if (!cut) return [a];
        const knot = edgeCorner(g,cut.vertex.id,a,b,a.vertex === cut.a ? coordinate : 1-coordinate,conflicts);
        return [a,retainUVPins(knot,[a,b])];
      });
    }
    const ring = ringFor(face), knots = new Set(cuts.map(row=>row.vertex.id));
    const [a,b] = ring.flatMap((row,i)=>knots.has(row.vertex) ? [i] : []);
    const low = ring.slice(b).concat(ring.slice(0,a+1)), high = ring.slice(a,b+1);
    const child = g.fresh('face'), {diagonal:priorDiagonal,...source} = face;
    const children = [
      {...source,corners:rotate(low,low.findIndex(row=>row.id === face.corners[0].id))},
      {...source,id:child,corners:rotate(high,high.findIndex(row=>row.vertex === cuts[0].vertex.id)).map(row=>
        knots.has(row.vertex) ? {...row,id:g.fresh('corner')} : row)}
    ];
    const transitions = neighbors.map(id=>{
      const {diagonal,...polygon} = g.faces.get(id);
      return {...polygon,corners:ringFor(polygon)};
    });
    const faces = children.concat(transitions), edgeSettings = cuts.flatMap(({edge,vertex})=>
      inheritEdgeSettings(edge,[edge.vertices[0],vertex.id,edge.vertices[1]]));
    return {patch:{vertices:cuts.map(row=>row.vertex),faces,...(edgeSettings.length && {edges:edgeSettings})},
      affected:faces.map(row=>row.id),lineage:{faces:[{from:face.id,to:child}]},
      cuts:cuts.map(({edge,vertex})=>({edge:edge.id,at:vertex.id,ends:edge.vertices})),
      detail:{...detail,children:children.map(row=>row.id),sectionEdge:'edge/'+pair(...cuts.map(row=>row.vertex.id)),
        vertices:cuts.map(row=>row.sources)}};
  }

  return {split,selectQuad,subdivisionRegion};
})(KIT);
