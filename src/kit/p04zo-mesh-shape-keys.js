/* Stable vertex morph tracks with the same local-rotation drivers as splat correctives. */
(function (K) {
  const topology=K.meshTopology, native=K.sceneMeshes, {V,M,procedural:{data}}=K;
  const kernel=K.poseCorrectives.kernel, format='ink-studio/mesh-shape-keys';
  const name=TargetSelectors.name;
  const record=(row,fields)=>row&&Object.getPrototypeOf(row)===Object.prototype&&
    (!fields||Object.keys(row).every(key=>fields.includes(key)));
  const vector=(value,n=3)=>Array.isArray(value)&&value.length===n&&
    Array.from(value).every(x=>Number.isFinite(x)&&Number.isFinite(Math.fround(x)));
  const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
  const index=doc=>new Map(doc.vertices.map(row=>[row.id,row]));
  const sum=rows=>rows.reduce((a,b)=>a+b,0);
  const has=(row,id)=>Object.hasOwn(row??{},id);
  function need(ok,reason) {
    if (!ok) throw new RangeError('Mesh shape keys: '+reason);
  }

  function status(source,asset) {
    if (asset===undefined) return 'empty';
    const doc=topology.create(source);
    need(record(asset,['format','version','mesh','restRevision','keys'])&&asset.format===format&&asset.version===1&&
      asset.mesh===doc.id&&name(asset.restRevision)&&Array.isArray(asset.keys)&&asset.keys.length<=32,'expected a shape key set for this mesh');
    return asset.restRevision===topology.revision(doc) ? 'ready' : 'needs-recapture';
  }

  function joints(rows,readRotation) {
    const used=new Set();
    need(Array.isArray(rows)&&rows.length>0&&rows.length<=8,'provide 1–8 named drivers');
    return Array.from(rows,row=>{
      const {part,radius}=row??{};
      need(record(row,readRotation?['part','radius']:['part','radius','at'])&&name(part)&&!used.has(part)&&
        Number.isFinite(radius)&&radius>0&&radius<=180,'drivers need distinct joint names and radii in degrees');
      const at=readRotation ? readRotation(part) : row.at;
      need(kernel.rotation(at),'a driver needs a local rotation matrix for '+part);
      used.add(part);
      return {part,radius,at:at.slice()};
    });
  }

  function rotations(raw,names) {
    need(record(raw),'provide named local rotation matrices');
    return new Map(names.map(part=>{
      const at=has(raw,part)&&raw[part];
      need(kernel.rotation(at),'a pose needs a local rotation matrix for '+part);
      return [part,at];
    }));
  }

  function compile(source,asset) {
    const doc=topology.create(source), vertices=index(doc), known=new Set();
    need(status(doc,asset)==='ready','shape keys belong to a different rest revision');
    return Array.from(asset.keys,key=>{
      const {id,pose,joints:drivers,moves,corrective}=key??{};
      need(record(key,['id','pose','joints','moves','corrective'])&&name(id)&&!known.has(id)&&name(pose)&&
        (corrective===undefined||name(corrective))&&Array.isArray(moves)&&moves.length>0&&moves.length<=16384,
      'invalid or duplicate shape key');
      known.add(id);
      const drive=joints(drivers), used=new Set(), from=[], to=[], track=[];
      for (const row of moves) {
        const {vertex,delta,keys=[]}=row??{}, base=vertices.get(vertex)?.position;
        need(record(row,['vertex','delta','keys'])&&base&&!used.has(vertex)&&vector(delta)&&Array.isArray(keys)&&keys.length<=16,
          'shape key moves need distinct authored vertices and finite deltas');
        used.add(vertex);
        from.push({id:vertex,position:base});
        to.push({id:vertex,position:V.add(base,delta)});
        track.push({id:vertex,from:vertex,to:vertex,keys:Array.from(keys,point=>{
          need(record(point,['at','delta','ease'])&&point.at>0&&point.at<1&&vector(point.delta),
            'a morph waypoint needs an interior progress and a finite delta');
          return {at:point.at,position:V.add(base,point.delta),ease:point.ease};
        })});
      }
      return {id,pose,joints:drive,points:used,track:K.procedural.motion.geometryMorph(from,to,{points:track,ease:'linear'})};
    });
  }

  function captureMoves(doc,request) {
    const {destination,pose,moves=[],strokes,selection}=request;
    const vertices=index(doc), selected=selection===undefined ? null : new Set(topology.select(doc,
      Array.isArray(selection)?{domain:'vertices',ids:selection}:{from:selection,convert:'vertices'}).ids);
    const paint=strokes===undefined ? null : kernel.brush(strokes), edits=new Map();
    need(Array.isArray(moves)&&moves.length<=16384,'provide at most 16384 vertex moves');
    for (const row of moves) {
      const {vertex,move,keys=[]}=row??{};
      need(record(row,['vertex','move','keys'])&&vertices.has(vertex)&&(!selected||selected.has(vertex))&&
        !edits.has(vertex)&&vector(move)&&Array.isArray(keys)&&keys.length<=16&&
        (destination==='pose'||!keys.length),'moves need distinct selected vertices and finite XYZ offsets');
      for (const key of keys)
        need(record(key,['at','move','ease'])&&key.at>0&&key.at<1&&vector(key.move),
          'a waypoint needs interior progress and a finite XYZ offset');
      edits.set(vertex,{move,keys});
    }
    let linear, positions;
    if (destination==='pose'&&doc.skin) {
      const mesh=topology.toSceneMesh(doc), skin=topology.skin.bind(mesh);
      skin.pose(pose.matrices);
      linear=skin.linear(pose.matrices);
      const {positions:xyz}=native.geometry(mesh);
      positions=new Map(Array.from({length:mesh.vertices},(_,i)=>
        [topology.sourceVertex(mesh,i),Array.from(xyz.subarray(i*3,i*3+3))]));
    }
    const result=[];
    for (const [vertex,source] of vertices) {
      if (selected&&!selected.has(vertex)) continue;
      const point=positions ? positions.get(vertex) : source.position;
      const stroke=paint&&point&&kernel.sculpt(point,paint), authored=edits.get(vertex);
      if (!stroke&&!authored) continue;
      need(point,'a posed edit needs a rendered vertex '+vertex);
      if (stroke) {
        const gradient=M.id().map((n,i)=>n+stroke.change[i]);
        need(M.det(gradient)>1e-4,'sculpt folds over at vertex '+vertex);
      }
      let delta=V.add(authored?.move??[0,0,0],stroke?.delta??[0,0,0]);
      let keys=authored?.keys.map(({at,move,ease})=>({at,delta:move,...(ease!==undefined&&{ease})}));
      if (linear) {
        const basis=linear(vertex);
        need(Math.abs(M.det(basis))>1e-9,'skinning is singular at vertex '+vertex);
        const inverse=M.inv(basis);
        delta=M.app(inverse,delta);
        keys=keys?.map(row=>({...row,delta:M.app(inverse,row.delta)}));
      }
      if (delta.some(Boolean)||keys?.length) result.push({vertex,delta,...(keys?.length&&{keys})});
    }
    need(result.length>0&&result.length<=16384,'the edit must move 1–16384 vertices');
    return result;
  }

  function plan(source,request,{shapeKeys:prior}={}) {
    const doc=topology.create(source), revision=topology.revision(doc), previous=status(doc,prior);
    need(record(request,['destination','revision','id','pose','drivers','corrective','moves','selection','strokes','remove'])&&
      ['rest','pose'].includes(request.destination),'choose an explicit rest or pose edit destination');
    need(request.revision===undefined||request.revision===revision,'mesh rest revision changed');
    const {destination,id,pose,drivers,corrective,remove}=request;
    let document=doc, shapeKeys=prior, patch={}, moves=[], drive;
    if (destination==='rest') {
      need([id,pose,drivers,corrective,remove].every(n=>n===undefined),'rest edits use rest coordinates and no pose fields');
      moves=captureMoves(doc,request);
      const vertices=index(doc);
      patch={vertices:moves.map(({vertex,delta})=>({...vertices.get(vertex),position:V.add(vertices.get(vertex).position,delta)}))};
      document=topology.edit(doc,patch);
    } else {
      need(name(id),'pose edits need a shape key ID');
      // A stale set is retained for review. An explicit recapture starts a set on this revision.
      const keys=previous==='ready' ? prior.keys.filter(row=>row.id!==id) : [];
      if (remove===true) {
        need(previous==='ready'&&keys.length<prior.keys.length&&
          [pose,drivers,corrective,request.moves,request.selection,request.strokes].every(n=>n===undefined),
        'remove an existing key without sculpt fields');
      } else {
        need(remove===undefined&&record(pose,['id','matrices','rotations'])&&name(pose.id)&&pose.id!=='rest'&&
          Boolean(drivers)!==Boolean(corrective),'capture a named pose and choose authored or splat corrective drivers');
        const supplied=corrective?.joints??drivers;
        need(Array.isArray(supplied),'provide driver rows');
        const local=rotations(pose.rotations,supplied.map(row=>row?.part));
        if (corrective) {
          need(corrective.format==='ink-studio/pose-corrective'&&corrective.version===1&&name(corrective.id),
            'expected a captured splat corrective');
          drive=joints(supplied);
          need(kernel.weight(drive,local)>.999999,'the mesh capture pose must match the splat corrective pose');
        } else drive=joints(supplied,part=>local.get(part));
        moves=captureMoves(doc,request);
        keys.push({id,pose:pose.id,joints:drive,moves,...(corrective&&{corrective:corrective.id})});
      }
      shapeKeys=data.freeze(data.clone({format,version:1,mesh:doc.id,restRevision:revision,keys}));
      compile(doc,shapeKeys);
    }
    const afterRevision=topology.revision(document);
    const report={format:'ink-studio/mesh-shape-revision-report',version:1,destination,
      ...(id!==undefined&&{id}),...(pose&&{pose:pose.id}),...(corrective&&{corrective:corrective.id}),
      beforeRevision:revision,afterRevision,restChanged:afterRevision!==revision,
      shapeKeyStatus:status(document,shapeKeys),...(previous==='needs-recapture'&&destination==='pose'&&{
        replacedStaleKeys:prior.keys.map(row=>row.id)
      }),moves,...(drive&&{drivers:drive})};
    return {document,shapeKeys,patch,report};
  }

  function bind(mesh,asset,frame) {
    const doc=topology.sourceDocument(mesh);
    need(doc,'bind shape keys to retained mesh topology');
    const layers=compile(doc,asset), source=index(doc), skin=doc.skin&&topology.skin.bind(mesh);
    const drivers=Object.freeze([...new Set(layers.flatMap(row=>row.joints.map(joint=>joint.part)))]);
    const ids=Array.from({length:mesh.vertices},(_,i)=>topology.sourceVertex(mesh,i));
    const rest=Float32Array.from(ids.flatMap(id=>{
      const point=source.get(id).position;
      return frame ? K.sceneGraph.point(frame,point) : point;
    })), shaped=new Float32Array(rest.length);
    let state=[];
    function sample(weights) {
      const sums=new Map();
      for (const [i,row] of layers.entries()) {
        const weight=weights[i];
        if (!weight) continue;
        for (const {from:id,position} of row.track.sample(weight)) {
          const total=sums.get(id)??{delta:[0,0,0],weight:0};
          total.delta=V.add(total.delta,V.sub(position,source.get(id).position));
          total.weight+=weight;
          sums.set(id,total);
        }
      }
      shaped.set(rest);
      for (const [i,id] of ids.entries()) {
        const edit=sums.get(id);
        if (!edit) continue;
        const delta=frame ? K.M.app(frame.matrix,edit.delta) : edit.delta;
        for (let k=0;k<3;k++) shaped[i*3+k]+=delta[k]/Math.max(1,edit.weight);
      }
      state=layers.map(({id,pose,points},i)=>({id,pose,weight:weights[i],vertices:points.size}));
      return shaped;
    }
    function pose(matrices,{rotations:local}={}) {
      const prepared=drivers.length ? rotations(local,drivers) : new Map();
      const weights=layers.map(row=>kernel.weight(row.joints,prepared));
      return skin ? skin.pose(matrices,sample(weights)) : native.pose(mesh,sample(weights));
    }
    function morph(weights,matrices) {
      need(record(weights)&&Object.keys(weights).every(id=>layers.some(row=>row.id===id))&&
        Object.values(weights).every(unit),'provide named morph weights in [0, 1]');
      const points=sample(layers.map(row=>has(weights,row.id)?weights[row.id]:0));
      return matrices!==undefined&&skin ? skin.pose(matrices,points) : native.pose(mesh,points);
    }
    return Object.freeze({mesh,drivers,joints:skin?.joints??Object.freeze([]),pose,morph,
      rest(){sample(layers.map(()=>0));return native.pose(mesh,rest);},
      state:()=>state.map(row=>({...row}))});
  }

  function inspect(source,shapeKeys) {
    const doc=topology.create(source);
    const state=status(doc,shapeKeys);
    if (state==='ready') compile(doc,shapeKeys);
    return {mesh:doc.id,restRevision:topology.revision(doc),status:state,
      keys:data.clone(shapeKeys?.keys??[])};
  }
  K.meshTopology=Object.freeze({...topology,shapeKeys:Object.freeze({format,plan,bind,status,inspect})});
})(KIT);
