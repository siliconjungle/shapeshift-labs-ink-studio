// Revision-checked Boolean planning on explicitly selected closed mesh solids.
(function(K) {
  const api=K.meshTopology, {V,procedural:{spatial,data:{freeze}}}=K;
  const S=meshBooleanSurfaces;
  const record=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype && Object.keys(row).every(key=>keys.includes(key));
  const name=value=>typeof value==='string' && value.trim().length>0;
  const positive=n=>Number.isFinite(n) && n>0;
  const xyz=row=>Array.isArray(row) && row.length===3 && Array.from(row).every(Number.isFinite);
  function probes(raw) {
    if (!Array.isArray(raw) || raw.length>64 || new Set(raw.map(row=>row?.id)).size!==raw.length)
      throw new RangeError('Use up to 64 Boolean wall probes with unique IDs');
    return raw.map(row=>{
      if (!record(row,['id','origin','direction','distance']) || !name(row.id) || row.id.length>96 || !xyz(row.origin) ||
          !xyz(row.direction) || !positive(V.len(row.direction)) || !positive(row.distance))
        throw new TypeError('A Boolean wall probe needs an ID, ray origin, direction and length');
      return {id:row.id,origin:row.origin.slice(),direction:V.norm(row.direction),distance:row.distance};
    });
  }

  function closed(input,tolerance) {
    const {edges,corners}=retainedMeshHealth.incidence(input.doc);
    const boundaries=edges.filter(edge=>edge.uses.length!==2 ||
      retainedMeshHealth.crossesWinding(edge.uses[0],edge.uses[1],corners));
    if (boundaries.length) return {code:'operand-open-or-winding',edges:boundaries.slice(0,64).map(row=>row.id),count:boundaries.length};
    const byVertex=new Map();
    for (const edge of edges) for (const vertex of edge.vertices) {
      if (!byVertex.has(vertex)) byVertex.set(vertex,[]);
      byVertex.get(vertex).push(edge.uses.map(row=>row.face));
    }
    const bad=[];
    for (const [vertex,links] of byVertex) {
      const neighbors=new Map();
      for (const [a,b] of links) {
        if (!neighbors.has(a)) neighbors.set(a,[]);
        if (!neighbors.has(b)) neighbors.set(b,[]);
        neighbors.get(a).push(b);
        neighbors.get(b).push(a);
      }
      const visited=new Set(), queue=[links[0][0]];
      for (let i=0;i<queue.length;i++) {
        const face=queue[i];
        if (visited.has(face)) continue;
        visited.add(face);
        queue.push(...neighbors.get(face));
      }
      if (visited.size!==neighbors.size) bad.push(vertex);
    }
    if (bad.length) return {code:'operand-nonmanifold-vertex',vertices:bad.slice(0,64),count:bad.length};
    const origin=input.triangles[0].a;
    const volume=input.triangles.reduce((n,{a,b,c})=>n+V.dot(V.sub(a,origin),V.cross(V.sub(b,origin),V.sub(c,origin)))/6,0);
    if (volume<=tolerance**3) return {code:'operand-winding-or-zero-volume',signedVolume:volume};
    return null;
  }

  function planBoolean(source,request) {
    if (!record(request,['id','revision','operation','selection','operand','solver','cutMaterial','tolerance','maxWork']) ||
        typeof request.id!=='string' || !/^[\w.-]{1,96}$/.test(request.id) ||
        !['union','difference','intersection'].includes(request.operation) ||
        !record(request.operand,['document','revision','selection']) ||
        request.cutMaterial!==undefined && (request.operation!=='difference' || !name(request.cutMaterial)))
      throw new TypeError('Use a Boolean edit ID, operation, revisions and two closed mesh operands');
    const doc=api.create(source), beforeRevision=api.revision(doc);
    if (beforeRevision!==request.revision) throw new RangeError('Stale mesh Boolean target revision');
    const sameDocument=request.operand.document===undefined, tool=sameDocument ? doc : api.create(request.operand.document);
    const toolRevision=api.revision(tool);
    if (request.operand.revision!==toolRevision) throw new RangeError('Stale mesh Boolean operand revision');
    if (sameDocument && (request.selection===undefined || request.operand.selection===undefined))
      throw new TypeError('A same-mesh Boolean needs distinct target and tool selections');
    const left=S.input(api,doc,request.selection,'target'),right=S.input(api,tool,request.operand.selection,'tool');
    if (sameDocument && [...left.ids].some(id=>right.ids.has(id))) throw new RangeError('Mesh Boolean operands cannot share selected faces');
    const bounds=spatial.boxOf([left.bounds.min,left.bounds.max,right.bounds.min,right.bounds.max]);
    const span=Math.max(...V.sub(bounds.max,bounds.min));
    const {operation,id,cutMaterial,tolerance=Math.max(span*1e-7,1e-8),maxWork=1500000,solver={kind:'mesh'}}=request;
    if (!record(solver,['kind','cell','maxCells','edgeTolerance','thicknessTolerance','probes']) ||
        !['mesh','sdf'].includes(solver.kind) || !positive(tolerance) || tolerance>span*.01 ||
        !Number.isSafeInteger(maxWork) || maxWork<1 || maxWork>5000000)
      throw new RangeError('Use a bounded mesh Boolean solver and positive tolerance');
    const {cell,maxCells=250000,edgeTolerance=cell*.08,thicknessTolerance=cell*.16}=solver;
    if (solver.kind==='sdf' ? !positive(cell) || cell<tolerance*8 || cell>span ||
        !Number.isSafeInteger(maxCells) || maxCells<64 || maxCells>1000000 ||
        !positive(edgeTolerance) || !positive(thicknessTolerance) :
        Object.keys(solver).some(key=>key!=='kind')) throw new RangeError('An SDF Boolean needs an explicit cell size and valid diagnostic limits');
    const config={id,operation,cutMaterial,tolerance,maxWork,cell,maxCells,edgeTolerance,thicknessTolerance,probes:probes(solver.probes ?? [])};
    const original={format:'ink-studio/mesh-boolean',version:1,mesh:doc.id,operand:tool.id,beforeRevision,operandRevision:toolRevision,
      operation,solver:solver.kind,bounds,selections:{target:[...left.ids],tool:[...right.ids]},sameDocument};
    const blocked=(issues,extra)=>freeze({document:null,patch:{},report:{...original,...extra,canCommit:false,issues}});
    const problems=[left,right].flatMap((row,i)=>{
      const issue=closed(row,tolerance);
      return issue ? [{...issue,operand:i===0 ? 'target' : 'tool'}] : [];
    });
    if (problems.length) return blocked(problems);
    if (left.triangles.length+right.triangles.length>16000)
      return blocked([{code:'operand-face-budget'}]);
    const checks=[left,right].flatMap(operand=>{
      const check=S.intersections(api,operand,tolerance,maxWork);
      return check.findings.length || !check.complete ?
        [{code:check.findings.length ? 'operand-self-intersection' : 'operand-validation-budget',
          operand:operand.triangles[0].side,findings:check.findings.slice(0,16)}] : [];
    });
    if (checks.length && solver.kind==='mesh') return blocked(checks);
    const activeVertices=new Set([...left.vertexIds,...(sameDocument ? right.vertexIds : [])]);
    const context={api,doc,left,right,sameDocument,config,bounds};
    function validate(result) {
      const candidate=S.assemble(api,doc,result,activeVertices,config);
      if (candidate.side.faces.length) {
        const output=S.input(api,candidate.side,undefined,'result'), issue=closed(output,tolerance);
        if (issue) throw new RangeError('Boolean result is not an oriented closed mesh ('+issue.code+')');
        if (!result.field) {
          const health=S.intersections(api,output,tolerance,maxWork);
          if (health.findings.length || !health.complete)
            throw Object.assign(new RangeError('Mesh Boolean result intersection check failed or exceeded its budget'),
              {findings:health.findings.slice(0,16)});
        }
      }
      return candidate;
    }
    function native() {
      const [a,b]=[left,right].map(S.polies);
      const {polys,work}=spatial.overlap(left.bounds,right.bounds) ?
        meshBooleanBsp.solve(a,b,operation,tolerance,maxWork) :
        {polys:operation==='union' ? a.concat(b) : operation==='difference' ? a : [],work:0};
      const result=validate(S.output({...context,polys}));
      return {...result,work};
    }
    let mesh, meshIssue, chosen, field;
    if (checks.length) meshIssue=checks[0];
    else try { mesh=native(); }
    catch(error) { meshIssue={code:'mesh-solve-failed',message:error.message,...(error.findings && {findings:error.findings})}; }
    if (solver.kind==='mesh') {
      if (!mesh) return blocked([meshIssue]);
      chosen=mesh;
    } else {
      try {
        const sampled=meshBooleanField.convert(context);
        field=sampled.field;
        chosen=validate(sampled);
      } catch(error) {
        return blocked([...(meshIssue ? [meshIssue] : []),{code:'field-solve-failed',message:error.message}],field && {field});
      }
    }
    const {document,patch,owners}=chosen;
    const diagnostics=field && meshBooleanDiagnostics.review({...context,native:mesh,candidate:chosen});
    const report={...original,afterRevision:api.revision(document),canCommit:true,issues:[],
      work:{inputTriangles:left.triangles.length+right.triangles.length,polygonChecks:mesh?.work ?? null},
      faces:owners,empty:document.faces.length===0,...(field && {field,diagnostics,meshReference:meshIssue ?? 'available'})};
    return freeze({document,patch,report,...(field && mesh && {reference:mesh.document})});
  }

  K.meshTopology=Object.freeze({...api,planBoolean});
})(KIT);
