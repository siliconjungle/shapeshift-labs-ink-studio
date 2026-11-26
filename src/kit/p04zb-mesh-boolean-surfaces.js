// Shared triangle sources, geometry stitching and authored attribute transfer.
const meshBooleanSurfaces = (function(K) {
  const {V,procedural:{spatial,geometry}}=K;
  const {mix}=meshBooleanBsp;
  const even=[[1,0,0],[0,1,0],[0,0,1]];
  const pair=(a,b)=>JSON.stringify(a<b ? [a,b] : [b,a]);
  const index=rows=>new Map(rows.map(row=>[row.id,row]));
  const unit=q=>Math.min(1,Math.max(0,q));
  const combine=(rows,weights)=>rows.reduce((sum,n,i)=>sum+n*weights[i],0);
  const vector=(rows,weights)=>rows[0].map((_,i)=>combine(rows.map(row=>row[i]),weights));
  const blend=(rows,weights)=>Object.fromEntries(Object.keys(rows[0] ?? {}).map(k=>
    [k,Array.isArray(rows[0][k]) ? vector(rows.map(row=>row[k]),weights) : combine(rows.map(row=>row[k]),weights)]));

  function input(api,document,selection,side) {
    const query=selection?.format===undefined ? selection : {from:selection};
    const ids=selection===undefined ? new Set(document.faces.map(row=>row.id)) :
      new Set(api.select(document,{...query,convert:'faces'}).ids);
    const faces=document.faces.filter(row=>ids.has(row.id)), vertices=index(document.vertices);
    const vertexIds=new Set(faces.flatMap(face=>face.corners.map(row=>row.vertex)));
    const edgeIds=new Set(faces.flatMap(face=>face.corners.map((row,i)=>pair(row.vertex,face.corners[(i+1)%face.corners.length].vertex))));
    const selected=api.create({id:document.id,faces,vertices:document.vertices.filter(row=>vertexIds.has(row.id)),
      edges:document.edges.filter(edge=>edgeIds.has(pair(...edge.vertices)))});
    if (!faces.length) throw new RangeError('Select at least one mesh face for each Boolean operand');
    const slots=index(faces), corners=index(faces.flatMap(face=>face.corners)), counts=new Map();
    const triangles=api.triangulate(selected).triangleSources.map(({face,corners:ids},i)=>{
      const source=slots.get(face), attributes=ids.map(id=>corners.get(id));
      const authored=attributes.map(row=>vertices.get(row.vertex));
      const points=authored.map(row=>row.position.map(Math.fround));
      const [a,b,c]=points, normal=V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
      counts.set(face,(counts.get(face) ?? 0)+1);
      return {i,side,source,attributes,authored,points,normal,offset:V.dot(a,normal),bounds:spatial.boxOf(points),
        a,b,c,u:V.sub(b,a),v:V.sub(c,a)};
    });
    const bounds=spatial.boxOf(selected.vertices.map(row=>row.position));
    return {doc:selected,ids,vertexIds,faces,triangles,counts,bounds};
  }

  function polies(input) {
    return input.triangles.map(meta=>({meta,normal:meta.normal,offset:meta.offset,flipped:false,
      points:meta.points.map((p,i)=>({p,weights:even[i]}))}));
  }

  function cornerData(meta,weights,flipped,shade) {
    const rows=meta.attributes;
    const uv=vector(rows.map(row=>row.uv),weights).map(unit);
    const attributes=rows[0].attributes && blend(rows.map(row=>row.attributes),weights);
    const normal=shade && rows.some(row=>row.normal) &&
      V.norm(vector(rows.map(row=>row.normal ?? meta.normal),weights));
    return {uv,...(attributes && {attributes}),...(normal && V.len(normal)>.99 && {normal:flipped ? V.mul(normal,-1) : normal})};
  }
  function vertexData(meta,weights) {
    const rows=meta.authored, channels=[...new Set(rows.flatMap(row=>Object.keys(row.weights ?? {})))].sort();
    return channels.length ? {weights:Object.fromEntries(channels.map(id=>
      [id,unit(combine(rows.map(row=>row.weights?.[id] ?? 0),weights))]))} : {};
  }

  function nearest(triangles) {
    const tree=spatial.pointIndex(triangles);
    return (point,radius,accept)=>{
      let best;
      tree.box(spatial.expand(spatial.boxOf([point]),radius),row=>{
        if (accept && !accept(row)) return;
        const hit=geometry.closestTrianglePoint(point,row), distance=V.dist(point,hit.at);
        if (distance<=radius && (!best || distance<best.distance || distance===best.distance && row.i<best.row.i))
          best={...hit,distance,row};
      });
      return best;
    };
  }

  function output({api,doc,left,right,sameDocument,config,polys}) {
    const {tolerance:eps}=config, used=new Set([...doc.vertices,...doc.faces,...doc.faces.flatMap(face=>face.corners)].map(row=>row.id));
    const selected=new Set([...left.ids,...(sameDocument ? right.ids : [])]);
    const untouched=doc.faces.filter(row=>!selected.has(row.id));
    const original=index(doc.vertices), buckets=new Map(), points=[];
    let serial=0;
    function fresh(kind) {
      let id;
      do { id='boolean/'+config.id+'/'+kind+'/'+ ++serial; } while (used.has(id));
      used.add(id);
      return id;
    }
    function weld(point,poly) {
      const bucket=point.p.map(n=>Math.floor(n/eps));
      let best;
      for (let z=-1;z<=1;z++) for (let y=-1;y<=1;y++) for (let x=-1;x<=1;x++)
        for (const row of buckets.get([bucket[0]+x,bucket[1]+y,bucket[2]+z].join('/')) ?? [])
          if (V.dist(row.p,point.p)<=eps && (!best || row.order<best.order)) best=row;
      if (best) return best;
      const corner=point.weights.indexOf(1), meta=poly.meta;
      const keep=corner>=0 && (meta.side==='target' || sameDocument) && meta.authored[corner].id;
      const source=keep && original.get(keep);
      const row={p:point.p,order:points.length,vertex:source || {id:fresh('vertex'),position:point.p,...vertexData(meta,point.weights)}};
      points.push(row);
      const key=bucket.join('/');
      if (!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(row);
      return row;
    }
    const rank=poly=>poly.meta.side==='target' ? 0 : 1;
    const rows=polys.slice().sort((a,b)=>rank(a)-rank(b)||a.meta.i-b.meta.i).flatMap(poly=>{
      const corners=poly.points.map(point=>({...point,node:weld(point,poly)}))
        .filter((row,i,all)=>row.node!==all[(i+all.length-1)%all.length].node);
      if (corners.length<3 || new Set(corners.map(row=>row.node)).size!==corners.length) return [];
      const origin=corners[0].node.p;
      const area=corners.reduce((sum,row,i)=>sum+V.dot(poly.normal,
        V.cross(V.sub(row.node.p,origin),V.sub(corners[(i+1)%corners.length].node.p,origin))),0);
      return area>eps*eps ? [{...poly,corners}] : [];
    });
    const tree=spatial.pointIndex(points.map(node=>({node,bounds:spatial.boxOf([node.p])})));
    let checks=0;
    for (const poly of rows) {
      poly.corners=poly.corners.flatMap((a,i,ring)=>{
        const b=ring[(i+1)%ring.length], direction=V.sub(b.node.p,a.node.p), length=V.len(direction), interior=[];
        tree.box(spatial.expand(spatial.boxOf([a.node.p,b.node.p]),eps),({node})=>{
          if (++checks>config.maxWork) throw new RangeError('Mesh Boolean boundary stitching exceeded its budget');
          if (node===a.node || node===b.node) return;
          const t=V.dot(V.sub(node.p,a.node.p),direction)/(length*length);
          if (t>eps/length && t<1-eps/length && V.dist(node.p,V.mad(a.node.p,direction,t))<=eps)
            interior.push({...mix(a,b,t),node,t});
        });
        return [a,...interior.sort((p,q)=>p.t-q.t || p.node.order-q.node.order)];
      });
    }
    const groups=new Map();
    for (const row of rows) {
      const key=row.meta.side+'/'+row.meta.source.id;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(row);
    }
    const faceLinks=[],cornerLinks=[],owners=[],faces=[],cornersUsed=new Set(), faceMaterial=poly=>
      config.operation==='difference' && poly.meta.side==='tool' && config.cutMaterial || poly.meta.source.material;
    for (const group of groups.values()) {
      const first=group[0], {meta}=first, side=meta.side, original=meta.source;
      const local=side==='target' || sameDocument;
      const intact=group.length===(side==='target' ? left : right).counts.get(original.id) &&
        new Set(group.map(poly=>poly.meta.i)).size===group.length && group.every(poly=>!poly.flipped &&
          poly.corners.length===3 && poly.corners.every((row,i)=>row.weights[i]===1 &&
            (!local || row.node.vertex.id===poly.meta.authored[i].id))) && faceMaterial(first)===original.material;
      if (intact) {
        const vertexMap=new Map(group.flatMap(poly=>poly.corners.map((row,i)=>
          [poly.meta.authored[i].id,row.node.vertex.id])));
        let face = original;
        if (!local) {
          const id = fresh('face'), corners = original.corners.map(row=>
            ({...row,id:fresh('corner'),vertex:vertexMap.get(row.vertex)}));
          const diagonal = meshQuadDiagonal.remap(original,corners);
          face = {...original,id,corners,...(diagonal && {diagonal})};
        }
        faces.push(face);
        face.corners.forEach(row=>cornersUsed.add(row.id));
        owners.push({face:face.id,operand:side,sourceFace:original.id,material:face.material});
        continue;
      }
      for (const [i,poly] of group.entries()) {
        const id=local && i===0 ? original.id : fresh('face'), material=faceMaterial(poly);
        if (local && i) faceLinks.push({from:original.id,to:id});
        const corners=poly.corners.map(row=>{
          const match=row.weights.indexOf(1), from=local && match>=0 && poly.meta.attributes[match].id;
          const id=from && !cornersUsed.has(from) ? from : fresh('corner');
          cornersUsed.add(id);
          if (from && id!==from) cornerLinks.push({from,to:id});
          return {id,vertex:row.node.vertex.id,...cornerData(poly.meta,row.weights,poly.flipped,true)};
        });
        faces.push({id,material,corners,...(original.smoothingGroup !== undefined && {smoothingGroup:original.smoothingGroup})});
        owners.push({face:id,operand:side,sourceFace:original.id,material});
      }
    }
    const newVertices=points.map(row=>row.vertex), lineage={faces:faceLinks,corners:cornerLinks};
    return {untouched,faces,newVertices,lineage,owners};
  }

  function assemble(api,doc,result,activeVertices,config) {
    const {untouched,faces,newVertices,lineage,owners}=result;
    const used=new Set([...untouched,...faces].flatMap(face=>face.corners.map(row=>row.vertex)));
    const known=index(doc.vertices), oldFaces=index(doc.faces);
    const updates=faces.filter(face=>face!==oldFaces.get(face.id));
    const patch={};
    const kept=new Set([...untouched,...faces].map(row=>row.id));
    const deleted=doc.faces.filter(face=>!kept.has(face.id)).map(row=>row.id);
    const dropped=doc.vertices.filter(row=>activeVertices.has(row.id) && !used.has(row.id)).map(row=>row.id);
    if (updates.length) patch.faces=updates;
    if (deleted.length) patch.removeFaces=deleted;
    if (dropped.length) patch.removeVertices=dropped;
    const vertices=newVertices.filter(row=>!known.has(row.id) && used.has(row.id));
    if (vertices.length) patch.vertices=vertices;
    const document=Object.keys(patch).length ? api.edit(doc,patch) : doc;
    if (!result.field && Object.keys(patch).length) {
      const originals=new Set(doc.edges.map(row=>row.id)), eps=config.tolerance;
      const index=spatial.pointIndex(doc.edges.filter(row=>row.vertices.every(id=>activeVertices.has(id))).map(row=>{
        const ends=row.vertices.map(id=>known.get(id).position);
        return {id:row.id,ends,bounds:spatial.boxOf(ends)};
      }));
      const positions=new Map(document.vertices.map(row=>[row.id,row.position]));
      let checks=0;
      lineage.edges=document.edges.flatMap(edge=>{
        if (originals.has(edge.id)) return [];
        const ends=edge.vertices.map(id=>positions.get(id)), matches=[];
        index.box(spatial.expand(spatial.boxOf(ends),eps),row=>{
          if (++checks>config.maxWork) throw new RangeError('Mesh Boolean edge correspondence exceeded its budget');
          const [a,b]=row.ends,d=V.sub(b,a),length=V.len(d);
          if (length<=eps) return;
          if (ends.every(point=>{
            const t=V.dot(V.sub(point,a),d)/(length*length);
            return t>=-eps/length && t<=1+eps/length && V.dist(point,V.mad(a,d,t))<=eps;
          })) matches.push(row.id);
        });
        return matches.length===1 ? [{from:matches[0],to:edge.id}] : [];
      });
    }
    if (Object.values(lineage).some(rows=>rows.length)) patch.lineage=lineage;
    const sideVertices=new Set(faces.flatMap(face=>face.corners.map(row=>row.vertex)));
    const side=api.create({id:doc.id,faces,vertices:document.vertices.filter(row=>sideVertices.has(row.id))});
    return {document,patch,owners,side};
  }

  function intersections(api,input,tolerance,maxWork,selection) {
    const health=api.health(input.doc,{maxPairs:Math.min(maxWork,250000),intersectionTolerance:tolerance,limit:1024,selection});
    const complete=health.work.intersectionsComplete && !health.truncated.includes('selfIntersections');
    if (!health.findings.selfIntersections.length) return {complete,findings:[]};
    const lookup=new Map(input.triangles.map(row=>[JSON.stringify(row.attributes.map(c=>c.id)),row]));
    const vertices=new Map(input.doc.vertices.map(row=>[row.id,row.position]));
    const faceEdges=face=>face.corners.map(({vertex},i)=>pair(vertex,face.corners[(i+1)%face.corners.length].vertex));
    const cap=tolerance*8;
    const findings=health.findings.selfIntersections.filter(issue=>{
      const [a,b]=issue.triangles.map(ids=>lookup.get(JSON.stringify(ids))), {point}=issue;
      if (!a || !b) return true;
      // Triangle contacts are computed with clipping slack. Confirm they lie
      // on both triangles, then remove any contacts on a shared polygon seam.
      if ([a,b].some(row=>V.dist(point,geometry.closestTrianglePoint(point,row).at)>cap)) return false;
      const right=new Set(b.source.corners.map(row=>row.vertex));
      if (a.source.corners.some(row=>right.has(row.vertex) && V.dist(point,vertices.get(row.vertex))<=cap)) return false;
      const edges=new Set(faceEdges(b.source));
      return !faceEdges(a.source).some(key=>{
        if (!edges.has(key)) return false;
        const [from,to]=JSON.parse(key).map(id=>vertices.get(id)), axis=V.sub(to,from);
        const t=Math.max(0,Math.min(1,V.dot(V.sub(point,from),axis)/V.dot(axis,axis)));
        return V.dist(point,V.mad(from,axis,t))<=cap;
      });
    });
    return {complete,findings};
  }

  return {input,polies,output,assemble,nearest,cornerData,vertexData,intersections};
})(KIT);
