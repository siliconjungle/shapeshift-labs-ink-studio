/* Subdivide one authored quad while preserving its surface registration. */
const meshFaceGrid = (function (K) {
  const {V} = K, {record} = meshCutGeometry;
  const {selectQuad,subdivisionRegion} = meshPickedSplit;
  const {edgeOf,cyclic,point,cornerData,corners,edgeCorner,retainUVPins,inheritEdgeSettings} = meshEdgeFlowData;
  const gridLimit = 32;

  function convex(g, face) {
    const points = face.corners.map(({vertex})=>g.vertices.get(vertex).position);
    const area = meshFaceRegionGeometry.area(points);
    return points.every((p,i)=>{
      const next = cyclic(points,i+1), last = cyclic(points,i+2);
      return V.dot(area,V.cross(V.sub(next,p),V.sub(last,next))) > 0;
    });
  }

  function subdivide(g, op) {
    if (!record(op,['kind','face','selection','rows','columns']) || (op.face === undefined) === (op.selection === undefined) ||
        ![op.rows,op.columns].every(n=>Number.isInteger(n) && n>=1 && n<=gridLimit))
      throw new TypeError('Subdivide face needs a quad or saved face selection and 1 to '+gridLimit+' rows and columns');
    const face = selectQuad(g,op), {rows,columns} = op, source = face.corners;
    const sides = [
      [columns,i=>[0,i]], [rows,i=>[i,columns]],
      [columns,i=>[rows,columns-i]], [rows,i=>[rows-i,0]]
    ].flatMap(([segments,gridAt],i)=>segments === 1 ? [] :
      [{segments,gridAt,edge:edgeOf(g,source[i].vertex,cyclic(source,i+1).vertex)}]);
    const edges = sides.map(row=>row.edge), noop = rows === 1 && columns === 1;
    const {neighbors,audit} = noop ? {neighbors:[]} : subdivisionRegion(g,face,edges);
    const uvSet = MaterialUV.resolve(g.doc.uvBindings,'pigment');
    const detail = {face:face.id,rows,columns,uvSet,edges:edges.map(row=>row.id),transitionFaces:neighbors};
    const issues = noop ? [] : audit();
    if (!noop && !convex(g,face)) issues.push({kind:'non-convex-grid-face',face:face.id});
    if (issues.length) return {patch:{},affected:[],detail,issues};

    const vertices = [], conflicts = new Set();
    function gridPoint(column,row) {
      const u = column/columns, v = row/rows;
      const values = [(1-u)*(1-v),u*(1-v),u*v,(1-u)*v];
      const samples = source.flatMap((corner,i)=>values[i] > 0 ? [[corner,values[i]]] : []);
      const sources = samples.map(([corner,weight])=>[corner.vertex,weight]);
      if (samples.length === 1) return {corner:samples[0][0],vertex:g.vertices.get(sources[0][0]),sources};
      const {vertex} = point(g,sources);
      vertices.push(vertex);
      const [corner] = corners(g,[vertex.id],[cornerData(samples)],conflicts);
      const pinned = retainUVPins(corner,samples.map(([item])=>item));
      return {corner:{...pinned,...(source[0].normal && {normal:source[0].normal})},vertex,sources};
    }
    const grid = Array.from({length:rows+1},(_,row)=>Array.from({length:columns+1},(_,column)=>gridPoint(column,row)));
    const kept = new Set(), cells = [], children = [];
    const {diagonal,...polygon} = face;
    const claim = ({corner})=>{
      if (kept.has(corner.id)) return {...corner,id:g.fresh('corner')};
      kept.add(corner.id);
      return corner;
    };
    for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
      const id = cells.length ? g.fresh('face') : face.id;
      const ring = [grid[row][column],grid[row][column+1],grid[row+1][column+1],grid[row+1][column]].map(claim);
      children.push({...polygon,id,corners:ring});
      cells.push({face:id,row,column,corners:ring.map(({id})=>id),vertices:ring.map(({vertex})=>vertex)});
    }
    const updatedDetail = {...detail,cells,children:cells.map(row=>row.face),grid:grid.map(row=>row.map(({vertex,corner,sources})=>
      ({vertex:vertex.id,position:vertex.position,uv:MaterialUV.uv(corner,uvSet),sources})))};
    if (noop) return {patch:{},affected:[],detail:updatedDetail};

    const cuts = sides.map(({edge,segments,gridAt})=>({edge,chain:Array.from({length:segments+1},(_,i)=>{
      const [row,column] = gridAt(i);
      return grid[row][column].vertex.id;
    })}));
    const byEdge = new Map(cuts.map(row=>[row.edge.id,row.chain]));
    const transition = neighbors.map(id=>{
      const {diagonal,...neighbor} = g.faces.get(id);
      const ring = neighbor.corners.flatMap((a,i)=>{
        const b = cyclic(neighbor.corners,i+1), chain = byEdge.get(edgeOf(g,a.vertex,b.vertex).id);
        if (!chain) return [a];
        const order = a.vertex === chain[0] ? chain : chain.slice().reverse();
        const insert = order.slice(1,-1).map((vertex,j)=>
          retainUVPins(edgeCorner(g,vertex,a,b,(j+1)/(chain.length-1),conflicts),[a,b]));
        return [a,...insert];
      });
      return {...neighbor,corners:ring};
    });
    const faces = children.concat(transition), settings = cuts.flatMap(({edge,chain})=>inheritEdgeSettings(edge,chain));
    return {patch:{vertices,faces,...(settings.length && {edges:settings})},affected:faces.map(row=>row.id),
      lineage:{faces:cells.slice(1).map(row=>({from:face.id,to:row.face}))},
      cuts:cuts.map(({edge,chain})=>({edge:edge.id,chain})),detail:updatedDetail};
  }

  return {subdivide};
})(KIT);
