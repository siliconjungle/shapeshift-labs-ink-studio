/* Named skin weights on authored vertices, shared by edits and native pose bindings. */
(function (K) {
  const topology = K.meshTopology, native = K.sceneMeshes;
  const epsilon = 1e-10, limit = 4;
  const record = (row, keys) => !!row && Object.getPrototypeOf(row) === Object.prototype &&
    Object.keys(row).every(key => keys.includes(key));
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const sum = values => values.reduce((total, weight) => total + weight, 0);
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const has = (row,id) => Object.hasOwn(row,id);
  const entries = values => Object.fromEntries(values);
  const vec = (value, length) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length === length && Array.from(value).every(Number.isFinite);

  function solver(skin) {
    const { joints, fallback } = skin, locked = new Set(skin.locked);
    const slots = new Map(joints.map((joint,i)=>[joint,i]));
    const weight = (row,joint) => has(row,joint) ? row[joint] : 0;
    const authored = row => entries(joints.filter(joint=>has(row,joint)).map(joint=>[joint,row[joint]]));

    function resolve(raw, desired = raw, pin) {
      const fixed = joints.filter(joint=>locked.has(joint) && weight(raw,joint)>0)
        .map(joint=>[joint,weight(raw,joint)]);
      const lockedTotal = sum(fixed.map(([,n])=>n));
      if (lockedTotal > 1+epsilon || fixed.length > limit) return {problem:'locked-influences-exceed-budget'};
      let clipped;
      if (pin) {
        const value = Math.min(pin[1], Math.max(0,1-lockedTotal));
        if (value>0 && fixed.length===limit) return {problem:'influence-slots-locked'};
        clipped = value < pin[1]-epsilon;
        if (value>0) fixed.push([pin[0],value]);
      }

      const available = limit - fixed.length;
      const remaining = Math.max(0, 1-sum(fixed.map(([,n])=>n)));
      const writable = joints.filter(joint=>!locked.has(joint) && joint!==pin?.[0]);
      const ranked = writable.filter(joint=>weight(desired,joint)>0).sort((a,b)=>
        weight(desired,b)-weight(desired,a) || slots.get(a)-slots.get(b));
      let chosen = ranked.slice(0,available), filled;
      if (!chosen.length && remaining>epsilon && available) {
        const alternate = writable.includes(fallback) ? fallback : writable[0];
        if (alternate !== undefined) {
          chosen = [alternate];
          filled = alternate;
        }
      }
      if (remaining>epsilon && !chosen.length) return {problem:'no-editable-influence-for-remainder'};
      const editableTotal = filled ? 1 : sum(chosen.map(joint=>weight(desired,joint)));
      if (remaining>0 && editableTotal>0) {
        const scale = !filled && Math.abs(editableTotal-remaining)<=epsilon ? 1 : remaining/editableTotal;
        for (const joint of chosen) fixed.push([joint, Math.min(1,(filled ? 1 : weight(desired,joint))*scale)]);
      }
      const weights = entries(fixed.sort(([a],[b])=>slots.get(a)-slots.get(b)));
      return {weights, ...(filled && {fallback:filled}), ...(clipped && {clamped:true}),
        dropped:ranked.filter(joint=>!has(weights,joint))};
    }
    return { authored, resolve, weight, slots };
  }

  function selected(doc, value) {
    if (value === undefined) return doc.vertices.map(row=>row.id);
    const query = Array.isArray(value) ? {domain:'vertices',ids:value} : {from:value,convert:'vertices'};
    return topology.select(doc,query).ids;
  }

  function evidence(raw, solve) {
    const authored = solve.authored(raw), result = solve.resolve(raw);
    return { authored, total:sum(Object.values(authored)), effective:result.weights ?? null,
      effectiveTotal:result.weights ? sum(Object.values(result.weights)) : null,
      ...(result.problem ? {problem:result.problem} : {
        dropped:result.dropped, ...(result.fallback && {fallback:result.fallback})
      }) };
  }

  function inspect(source, selection) {
    const doc = topology.create(source);
    const ids = new Set(selected(doc,selection));
    if (!doc.skin) return {mesh:doc.id,revision:topology.revision(doc),skin:null,vertices:[]};
    const solve = solver(doc.skin);
    return {mesh:doc.id,revision:topology.revision(doc),skin:doc.skin,
      vertices:doc.vertices.filter(row=>ids.has(row.id)).map(row=>({id:row.id,...evidence(row.weights ?? {},solve)}))};
  }

  function mirrorLookup(doc, axis, origin, tolerance) {
    const spatial = K.procedural.spatial;
    const lookup = spatial.pointIndex(doc.vertices.map(vertex=>({vertex,
      bounds:spatial.expand(spatial.boxOf([vertex.position]),tolerance)})));
    function reflection(vertex) {
      const at = vertex.position.slice();
      at[axis] = 2*origin-at[axis];
      const matches = [];
      lookup(at,({vertex:row})=>{
        const distance = Math.hypot(...row.position.map((n,i)=>n-at[i]));
        if (distance<=tolerance) matches.push({row,distance});
      });
      matches.sort((a,b)=>a.distance-b.distance);
      if (!matches.length) return {reason:'unmatched-mirror'};
      const aliases = matches.filter(row=>Math.abs(row.distance-matches[0].distance)<=tolerance*1e-5);
      if (aliases.length!==1) return {reason:'ambiguous-mirror', candidates:aliases.map(({row})=>row.id).sort()};
      return {target:matches[0].row,distance:matches[0].distance};
    }
    return vertex=>{
      if (Math.abs(vertex.position[axis]-origin)<=tolerance) return {reason:'mirror-centerline'};
      const match = reflection(vertex);
      if (match.target && reflection(match.target).target?.id!==vertex.id) return {reason:'nonreciprocal-mirror'};
      return match;
    };
  }

  const operationFields = {
    assign:['op','joint','weight','selection'],
    paint:['op','joint','weight','selection','at','radius','strength','falloff'],
    lock:['op','joint','locked'],
    normalize:['op','selection'],
    mirror:['op','selection','axis','origin','tolerance']
  };

  function plan(source, request) {
    const doc = topology.create(source), revision = topology.revision(doc);
    if (!record(request,['revision','skin','operations']) ||
        !Array.isArray(request.operations) || request.operations.length>128 ||
        (request.skin === undefined && !request.operations.length))
      throw new TypeError('Use a mesh skin request with a binding or up to 128 named operations');
    if (request.revision!==undefined && request.revision!==revision) throw new RangeError('Mesh skin revision changed');
    if (doc.skin && request.skin!==undefined) throw new RangeError('The mesh already has a skin binding');
    const original = request.skin===undefined ? doc : topology.edit(doc,{skin:request.skin});
    let skin = original.skin;
    if (!skin) throw new RangeError('Bind the mesh to named joints before editing weights');
    const vertices = new Map(doc.vertices.map(row=>[row.id,row]));
    const edits = new Map(), notes = [];
    let solve = solver(skin);
    const rawAt = id => edits.get(id) ?? vertices.get(id).weights ?? {};

    function write(id, result, operation, details) {
      if (result.problem) {
        notes.push({operation,vertex:id,reason:result.problem,...details});
        return;
      }
      const raw = rawAt(id);
      const auxiliary = Object.entries(raw).filter(([joint])=>!solve.slots.has(joint));
      const next = entries([...auxiliary,...Object.entries(result.weights)].sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0));
      if (!equal(raw,next)) edits.set(id,next);
      if (result.clamped || result.dropped.length || details)
        notes.push({operation,vertex:id,...details,...(result.clamped && {clamped:true}),dropped:result.dropped});
    }

    for (const [operation,row] of request.operations.entries()) {
      const op = row?.op;
      if (!has(operationFields,op) || !record(row,operationFields[op])) throw new TypeError('Unknown mesh skin operation');
      const { joint, weight, selection } = row;
      if (['lock','assign','paint'].includes(op) && !solve.slots.has(joint))
        throw new RangeError('Unknown skin joint ' + joint);
      if (op === 'lock') {
        if (typeof row.locked!=='boolean') throw new TypeError('Set a skin joint lock to true or false');
        const locks = new Set(skin.locked);
        if (row.locked === locks.has(joint)) continue;
        // Capture the current effective weight before fixing its value.
        for (const id of vertices.keys()) {
          const raw = rawAt(id), resolved = solve.resolve(raw);
          if (resolved.weights && Math.abs(solve.weight(raw,joint)-solve.weight(resolved.weights,joint))>epsilon)
            write(id,resolved,operation);
        }
        if (row.locked) locks.add(joint);
        else locks.delete(joint);
        skin = {...skin,locked:skin.joints.filter(id=>locks.has(id))};
        solve = solver(skin);
        continue;
      }
      const ids = selected(doc,selection);
      if (op === 'mirror') {
        const {axis='x',origin=0,tolerance=.001} = row, dimension = ['x','y','z'].indexOf(axis);
        if (selection===undefined || dimension<0 || !Number.isFinite(origin) || !Number.isFinite(tolerance) || tolerance<=0)
          throw new RangeError('Mirror needs a source selection, a plane axis and a positive rest-space tolerance');
        const match = mirrorLookup(doc,dimension,origin,tolerance);
        const joints = new Map(skin.mirrors.flatMap(([a,b])=>[[a,b],[b,a]]));
        const sources = new Map(ids.map(id=>[id,solve.resolve(rawAt(id))]));
        for (const id of ids) {
          const {target,reason,distance,candidates} = match(vertices.get(id));
          const value = sources.get(id);
          if (!target || value.problem) {
            notes.push({operation,vertex:id,reason:reason ?? value.problem,...(candidates && {candidates})});
            continue;
          }
          const desired = entries(Object.entries(value.weights).map(([key,n])=>[joints.get(key) ?? key,n]));
          write(target.id,solve.resolve(rawAt(target.id),desired),operation,{source:id,distance});
        }
        continue;
      }
      if (op === 'normalize') {
        for (const id of ids) write(id,solve.resolve(rawAt(id)),operation);
        continue;
      }
      if (!unit(weight)) throw new RangeError('Choose a skin weight in [0, 1]');
      const {at,radius,strength=1,falloff='smooth'} = row;
      if (op === 'assign' && selection===undefined) throw new TypeError('Assign needs a component selection');
      if (op === 'paint' && (!vec(at,3) || !(Number.isFinite(radius) && radius>0) ||
          !unit(strength) || !['smooth','linear','hard'].includes(falloff)))
        throw new RangeError('Paint needs a rest-space center, positive radius and valid strength and falloff');
      if (skin.locked.includes(joint)) {
        notes.push({operation,joint,reason:'joint-locked'});
        continue;
      }
      for (const id of ids) {
        const distance = op==='paint' ? Math.hypot(...vertices.get(id).position.map((n,i)=>n-at[i]))/radius : 0;
        if (distance>1) continue;
        const t = 1-distance, alpha = strength*(falloff==='hard' ? 1 : falloff==='linear' ? t : t*t*(3-2*t));
        if (!alpha) continue;
        const raw = rawAt(id), base = solve.resolve(raw);
        if (base.problem) {
          notes.push({operation,vertex:id,reason:base.problem});
          continue;
        }
        const prior = solve.weight(base.weights,joint);
        const target = prior+(weight-prior)*alpha;
        write(id,solve.resolve(raw,base.weights,[joint,target]),operation);
      }
    }

    const patch = {};
    if (!equal(doc.skin,skin)) patch.skin = skin;
    const changed = doc.vertices.filter(row=>edits.has(row.id) && !equal(edits.get(row.id),row.weights ?? {}));
    if (changed.length) patch.vertices = changed.map(row=>({...row,weights:edits.get(row.id)}));
    const document = Object.keys(patch).length ? topology.edit(doc,patch) : doc;
    const prior = doc.skin && solver(doc.skin);
    const problems = document.vertices.flatMap(({id,weights})=>{
      const {problem} = solve.resolve(weights ?? {});
      return problem ? [{id,reason:problem}] : [];
    });
    const report = {format:'ink-studio/mesh-skin-edit',version:1,mesh:doc.id,beforeRevision:revision,
      afterRevision:topology.revision(document),beforeSkin:doc.skin ?? null,skin:document.skin,
      canCommit:!problems.length,problems,notes, changes:changed.map(({id,weights})=>({
        id,before:prior ? evidence(weights ?? {},prior) : null,after:evidence(edits.get(id),solve)
      }))};
    return { document, patch, report };
  }

  function bind(mesh) {
    const doc = topology.sourceDocument(mesh);
    if (!doc?.skin) throw new TypeError('Skin binding needs a retained mesh with named joints');
    const {joints} = doc.skin, solve = solver(doc.skin);
    const weights = new Map(doc.vertices.map(({id,weights})=>{
      const result = solve.resolve(weights ?? {});
      if (result.problem) throw new RangeError('Invalid skin on ' + id + ' (' + result.problem + ')');
      return [id,Object.entries(result.weights).map(([joint,value])=>[solve.slots.get(joint),value])];
    }));
    const skin = native.skin(mesh,Array.from({length:mesh.vertices},(_,i)=>weights.get(topology.sourceVertex(mesh,i))));
    function pose(matrices) {
      let rows = matrices;
      if (matrices && Object.getPrototypeOf(matrices)===Object.prototype) {
        if (Object.keys(matrices).length!==joints.length || !joints.every(joint=>has(matrices,joint) && vec(matrices[joint],12)))
          throw new RangeError('A named mesh pose needs one finite twelve-value matrix for each joint');
        rows = joints.flatMap(joint=>Array.from(matrices[joint]));
      }
      if (rows?.length !== joints.length*12) throw new RangeError('Provide a matrix for every named skin joint');
      return skin.pose(rows);
    }
    return Object.freeze({mesh,joints,pose});
  }

  K.meshTopology = Object.freeze({...topology,skin:Object.freeze({inspect,plan,bind})});
})(KIT);
