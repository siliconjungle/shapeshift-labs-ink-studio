// The existing mesh-to-field converter and dual contour extractor compose the explicit fallback.
const meshBooleanField = (function(K) {
  const {V,procedural:{spatial,geometry}}=K;
  const S=meshBooleanSurfaces;
  const value=(op,a,b)=>op==='union' ? Math.min(a,b) : Math.max(a,op==='difference' ? -b : b);
  const toolWins=(op,a,b)=>op==='union' ? b<a : (op==='difference' ? -b : b)>a;

  function field(operand,cell,maxCells) {
    const extent=V.sub(operand.bounds.max,operand.bounds.min), span=Math.max(...extent);
    const cells=Math.max(2,Math.ceil(span/cell));
    const pitch=span/cells, samples=extent.reduce((n,axis)=>n*(Math.ceil(axis/pitch)+7),1);
    if (cells>128 || samples>maxCells) throw new RangeError('Mesh-to-field conversion exceeds its sample budget');
    const pts=[], indices=[], byId=new Map();
    for (const row of operand.triangles) for (const [i,vertex] of row.authored.entries()) {
      if (!byId.has(vertex.id)) { byId.set(vertex.id,pts.length/3); pts.push(...row.points[i]); }
      indices.push(byId.get(vertex.id));
    }
    // Closed input is already validated. A fallback never adds an implicit shell.
    const sampled=K.mesh.field(K.mesh.make(pts,indices),{cells,thick:0});
    return {sampled,nearest:S.nearest(operand.triangles),triangles:operand.triangles};
  }

  function convert({doc,left,right,sameDocument,config,bounds}) {
    const {cell,maxCells,operation}=config;
    const [a,b]=[left,right].map(row=>field(row,cell,maxCells));
    const signed=(x,y,z)=>value(operation,a.sampled.sd(x,y,z),b.sampled.sd(x,y,z));
    const box=spatial.expand(bounds,cell*2.37);
    const surface=geometry.dualContour(signed,box,{cell,maxCells,refine:3});
    if (surface.triangles.length>48000) throw new RangeError('Mesh Boolean fallback exceeds its face budget');
    const taken=new Set([...left.ids,...(sameDocument ? right.ids : [])]);
    const untouched=doc.faces.filter(row=>!taken.has(row.id));
    const used=new Set([...doc.vertices,...doc.faces,...doc.faces.flatMap(row=>row.corners)].map(row=>row.id));
    const faces=[], owners=[], vertices=new Map(), unmapped=[];
    let serial=0;
    function fresh(kind) {
      let id;
      do { id='boolean/'+config.id+'/field-'+kind+'/'+ ++serial; } while (used.has(id));
      used.add(id);
      return id;
    }
    for (const triangle of surface.triangles) {
      const points=triangle.map(i=>surface.points[i].map(Math.fround));
      const ab=V.sub(points[1],points[0]), ac=V.sub(points[2],points[0]);
      if (V.len(V.cross(ab,ac))<=config.tolerance**2) continue;
      const center=points.reduce((sum,p)=>V.mad(sum,p,1/3),[0,0,0]);
      const fromTool=toolWins(operation,a.sampled.sd(...center),b.sampled.sd(...center));
      const from=fromTool ? b : a, flipped=fromTool && operation==='difference';
      const nearby=from.nearest(center,cell*3);
      const meta=nearby?.row ?? from.triangles[from.sampled.tri(...center)];
      if (!meta) throw new RangeError('A field face has no source material');
      const id=fresh('face'), material=flipped && config.cutMaterial || meta.source.material;
      if (!nearby) unmapped.push(id);
      const corners=points.map((p,i)=>{
        const hit=geometry.closestTrianglePoint(p,meta), key=p.join('/');
        if (!vertices.has(key)) vertices.set(key,{id:fresh('vertex'),position:p,...S.vertexData(meta,hit.weights)});
        return {id:fresh('corner'),vertex:vertices.get(key).id,...S.cornerData(meta,hit.weights,flipped,false)};
      });
      faces.push({id,material,corners});
      owners.push({face:id,operand:meta.side,sourceFace:meta.source.id,material});
    }
    return {untouched,faces,newVertices:[...vertices.values()],lineage:{},owners,
      field:{cell,spacing:surface.spacing,operands:[a,b].map(({sampled})=>({spacing:sampled.h,dimensions:sampled.n})),
        cells:surface.work.cells,samples:surface.work.samples,farFromSource:unmapped}};
  }

  return { convert };
})(KIT);
