/* Retained mounts and independent aim targets for native area emitters. */
(function (K) {
  const A = K.authoring, { M,V } = K, G = K.sceneGraph;
  const {clone,freeze} = K.procedural.data;
  const fields = (row,keys)=>K.world.data.record(row) && Object.keys(row).every(key=>keys.includes(key));
  const xyz = value=>Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);
  const unit = (value,label)=>{
    const length = xyz(value) && Math.hypot(...value);
    if (!(length>=1e-8) || !Number.isFinite(length)) throw new TypeError(label+' needs a finite, nonzero XYZ direction');
    return V.mul(value,1/length);
  };

  function anchor(raw, spec, { instances, meshPlacements, assetPartImports, solids, parts }) {
    const kind = raw?.kind, { id,own } = K.world.data;
    const requireFields = keys=>{
      if (!fields(raw,['kind',...keys])) throw new TypeError('Invalid '+kind+' light anchor');
    };
    const need = (value,message)=>{
      if (!value) throw new RangeError(message);
      return value;
    };
    const at = (position, frame)=>frame ? {...frame,position} : G.transform({position});
    if (kind==='world') {
      requireFields(['at']);
      if (!xyz(raw.at)) throw new TypeError('A world light anchor needs an XYZ point');
      return {frame:G.transform({position:raw.at})};
    }
    if (kind==='plane') {
      requireFields(['at','height','snapGrid']);
      const {at:cell=[0,0],height=0,snapGrid=false} = raw, plane = A.constructionPlane.forScene(spec);
      if (!Number.isFinite(height) || typeof snapGrid!=='boolean')
        throw new TypeError('A plane light anchor needs finite height and optional grid snapping');
      const gridAt = snapGrid ? A.constructionPlane.quantize(plane,cell) : cell;
      const position = V.mad(A.constructionPlane.point(plane,gridAt),plane.axes[2],height);
      return {frame:G.transform({position,matrix:M.tr(plane.axes.flat())}),gridAt};
    }
    if (kind==='bone') {
      requireFields(['part']);
      need(id(raw.part) && parts.has(raw.part),'Unknown light mount rig part '+raw.part);
      return {frame:G.transform({position:spec.parts?.[raw.part]?.joint}),part:raw.part,joint:true};
    }
    if (kind==='solid-socket') {
      requireFields(['object','id']);
      const solid = need(solids.get(raw.object),'Unknown light socket owner '+raw.object);
      const point = need(id(raw.id) && own(solid.sockets,raw.id) && solid.sockets[raw.id],
        'Unknown light socket '+raw.object+'/'+raw.id);
      const local = A.objectPoints.socketFrames({ [raw.id]:{position:point.p,direction:point.dir ?? [0,1,0]} })[raw.id];
      const frame = G.compose(K.diorama.solidFrames.rest(solid),local);
      return {frame,part:solid.part,solid:raw.object};
    }
    if (kind==='asset-binding') {
      requireFields(['instance','id']);
      const table = own(assetPartImports,raw.instance) && assetPartImports[raw.instance].part.bindings;
      const binding = own(table,raw.id) && table[raw.id];
      need(binding?.status==='bound' && ['socket','bone'].includes(binding.kind),
        'Unknown light asset socket or bone '+raw.instance+'/'+raw.id);
      return {frame:binding.resolved};
    }
    if (kind==='instance' || kind==='object-point' && raw.instance !== undefined) {
      requireFields(kind==='instance' ? ['instance'] : ['instance','id']);
      const link = need(instances.get(raw.instance),'Unknown light prefab anchor '+raw.instance);
      const frame = link.frame ?? G.transform();
      if (kind==='instance') return {frame:at(link.origin,frame),instance:raw.instance};
      const local = A.objectPoints.socketFrames(link.resolved.points);
      need(own(local,raw.id),'Unknown light object point '+raw.instance+'/'+raw.id);
      return {frame:G.compose(frame,local[raw.id]),instance:raw.instance};
    }
    if (kind==='object-point') {
      requireFields(['object','id']);
      const mesh = need(own(spec.topologyMeshes,raw.object) && spec.topologyMeshes[raw.object],
        'Unknown light mesh anchor '+raw.object);
      const points = A.objectPoints.socketFrames(mesh.points);
      need(own(points,raw.id),'Unknown light object point '+raw.object+'/'+raw.id);
      const placement = meshPlacements.get(raw.object);
      return {frame:placement ? G.compose(placement,points[raw.id]) : points[raw.id],mesh:raw.object};
    }
    if (['vertex','bounds','average'].includes(kind)) {
      const {target} = A.constructionPlane.originTarget(spec,raw);
      const placement = meshPlacements.get(raw.object);
      return {frame:at(placement ? G.point(placement,target) : target,placement),mesh:raw.object};
    }
    throw new TypeError('Choose a world, construction plane, mesh component, prefab, object point, socket, or bone light anchor');
  }

  function context(spec, env, instances, meshPlacements) {
    const rows = Array.isArray(spec.solids) ? spec.solids : [];
    const solids = new Map(rows.filter(row=>row?.id).map(row=>[row.id,row]));
    const parts = new Set(rows.filter(row=>row?.part && !row.hold).map(row=>row.part));
    return {instances,meshPlacements,assetPartImports:env.assetPartImports,solids,parts};
  }

  function prepare(spec, env, instances, meshPlacements, areaLights) {
    if (spec.constructionLights === undefined) return;
    if (!K.world.data.record(spec.constructionLights)) throw new TypeError('Construction lights need a map of named fixtures');
    const ctx = context(spec,env,instances,meshPlacements);
    const rows = Object.entries(spec.constructionLights).map(([id,row])=>{
      if (!K.world.data.id(id) || !fields(row,['mount','aim','local','direction','up','emitter']) ||
          !K.world.data.record(row.emitter) || ['id','at','normal','up'].some(key=>Object.hasOwn(row.emitter,key)))
        throw new TypeError('A construction light needs a mount and native area emitter settings');
      try {
        const mount = anchor(row.mount,spec,ctx), aim = row.aim === undefined ? undefined : anchor(row.aim,spec,ctx);
        if (spec.brushRegion != null && (mount.part || aim?.part))
          throw new RangeError('A bone or rig socket light needs a diorama with articulated parts');
        const direction = unit(row.direction ?? [0,0,1],'Fixture direction');
        const up = unit(row.up ?? [0,1,0],'Fixture up');
        return {id,mount,aim,local:G.transform(row.local),direction,up,emitter:{...row.emitter,id},authored:row};
      } catch (error) {
        throw new RangeError(id+': '+error.message,{cause:error});
      }
    });
    const samples = AreaLights.prepare([...(areaLights || []),...rows.map(({emitter})=>({...emitter,at:[0,0,0]}))]);
    const attached = samples.slice(samples.length-rows.length);
    return { rows, shadows:attached.some(light=>light.shadows && light.intensity) };
  }

  function resolve(ref, rig, joints, hidden) {
    const {part,joint,frame} = ref;
    const rest = joint && joints?.[part] ? {...frame,position:joints[part]} : frame;
    const masked = hidden?.instances.has(ref.instance) || hidden?.solids.has(ref.solid) || hidden?.meshes.has(ref.mesh);
    if (masked) return {frame:rest,visible:false};
    if (!part) return {frame:rest,visible:true};
    if (!rig?.has(part)) return {frame:rest,visible:false};
    const at = rig.names.indexOf(part)*12, pose = {matrix:rig.M.subarray(at,at+9),position:rig.M.subarray(at+9,at+12)};
    try {
      return {frame:G.compose(pose,rest),visible:true};
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      return {frame:rest,visible:false};
    }
  }

  function facing(frame, row, target) {
    const fallback = M.app(M.tr(G.inverse(frame).matrix),row.direction);
    const delta = target && V.sub(target,frame.position);
    const aligned = delta && V.len(delta)>1e-8;
    const normal = V.norm(aligned ? delta : fallback);
    const guides = [[...row.up],[1,0,0],[0,1,0],[0,0,1]];
    const up = V.norm(guides.map(guide=>M.app(frame.matrix,guide)).find(guide=>
      V.len(V.cross(V.norm(guide),normal))>1e-6));
    return {normal,up,coincident:Boolean(target && !aligned)};
  }

  function bind(world, prepared, {hidden,joints} = {}) {
    if (!prepared?.rows.length) return;
    const snapshot = row=>{
      const rig = world.anim?.rig, mount = resolve(row.mount,rig,joints,hidden),
        aim = row.aim && resolve(row.aim,rig,joints,hidden);
      const frame = G.compose(mount.frame,row.local);
      const position = frame.position, target = aim?.frame.position;
      const {normal,up,coincident} = facing(frame,row,target);
      const status = !mount.visible ? 'mount-unavailable' : aim && !aim.visible ? 'target-unavailable' :
        coincident ? 'coincident-target' : 'active';
      return {id:row.id,status,at:position,...(target && {target}),normal,up};
    };
    const emitters = prepared.rows.map(row=>{
      const active = (value,time)=>{
        if (snapshot(row).status!=='active') return 0;
        return typeof value==='function' ? value(time) : value;
      };
      const {intensity=2,volumeIntensity=intensity} = row.emitter;
      return {...row.emitter,at:()=>snapshot(row).at,normal:()=>snapshot(row).normal,up:()=>snapshot(row).up,
        intensity:time=>active(intensity,time),volumeIntensity:time=>active(volumeIntensity,time)};
    });
    world.areaLights = [...(world.areaLights || []),...emitters];
    world.constructionLights = Object.freeze({inspect:()=>prepared.rows.map(row=>clone({
      ...snapshot(row),mount:row.authored.mount,...(row.authored.aim && {aim:row.authored.aim}),
      ...(row.mount.gridAt && {gridAt:row.mount.gridAt})
    }))});
  }

  function plan(scene, env, request) {
    const {id,fixture,parent} = request ?? {}, { equal, id:validId,own } = K.world.data;
    if (!fields(request,['id','fixture','parent']) || !validId(id) ||
        parent !== undefined && !K.world.data.record(fixture))
      throw new TypeError('Choose a named construction light, optional fixture, and optional new parent anchor');
    const lights = {...scene.constructionLights}, before = own(lights,id) ? lights[id] : null;
    let after = fixture === undefined ? before : clone(fixture);
    if (parent !== undefined) {
      const expanded = A.scenePrefabs.expand(scene,env);
      const ctx = context(expanded.spec,env,expanded.instances,expanded.meshPlacements);
      const mount = anchor(fixture.mount,expanded.spec,ctx), next = anchor(parent,expanded.spec,ctx);
      const world = (mount.part || next.part) && K.diorama.build(scene,env);
      const joints = world?.lab?.joints, rig = world?.anim?.rig;
      const current = resolve(mount,rig,joints), destination = resolve(next,rig,joints);
      if (!current.visible || !destination.visible) throw new RangeError('Both fixture mount and parent need resolved frames');
      const local = G.compose(G.inverse(destination.frame),G.compose(current.frame,G.transform(fixture.local)));
      after = {...after,mount:clone(parent),local};
    }
    if (after === null) delete lights[id];
    else lights[id] = after;
    const changed = !equal(before,after);
    const report = {format:'ink-studio/construction-light-edit',version:1,scene:scene.id,id,before,after,changed,canCommit:true};
    return {patch:{constructionLights:lights},report:freeze(report)};
  }

  A.constructionLights = Object.freeze({prepare,bind,plan});
})(KIT);
