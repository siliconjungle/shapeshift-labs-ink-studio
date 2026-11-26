/* Retain one authored prefab instance and a coordinate-addressed lattice of copies. */
(function (K) {
  const A = K.authoring, {M,V} = K, {freeze} = K.procedural.data;
  const unit = [[1,0,0],[0,1,0],[0,0,1]];
  const spaces = ['world','local','plane'];
  const limit = 512;
  const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
  const fields = (row,keys) => record(row) && Object.keys(row).every(key => keys.includes(key));
  const vector = (row,check=Number.isFinite) => Array.isArray(row) && row.length === 3 && Array.from(row).every(check);

  function layout(count,spacing,space) {
    if (!vector(count,n => Number.isSafeInteger(n) && n>0) || count[0]*count[1]*count[2]>limit ||
        !vector(spacing) || spacing.some((value,i) => value === 0 && count[i]>1) || !spaces.includes(space))
      throw new RangeError('An array needs positive XYZ counts (up to 512 cells), signed spacing on repeated axes, and world, local or plane space');
  }

  function check(arrays) {
    const {id} = K.world.data;
    if (!record(arrays)) throw new TypeError('Prefab arrays need a named record map');
    for (const [name,row] of Object.entries(arrays)) {
      if (!id(name) || !fields(row,['version','instance','count','spacing','space','origin','axes']) ||
          row.version !== 1 || !id(row.instance) || !vector(row.origin) || !vector(row.axes,axis => vector(axis)) ||
          row.axes.some((axis,i) => row.axes.some((other,j) => Math.abs(V.dot(axis,other)-(i===j ? 1 : 0))>1e-8)) ||
          V.dot(V.cross(row.axes[0],row.axes[1]),row.axes[2])<1-1e-8)
        throw new TypeError('Invalid retained prefab array '+name);
      layout(row.count,row.spacing,row.space);
    }
  }

  function* cells([nx,ny,nz]) {
    for (let x=0; x<nx; x++) for (let y=0; y<ny; y++) for (let z=0; z<nz; z++) yield [x,y,z];
  }

  function position({origin,axes,spacing},cell) {
    const placed = axes.reduce((point,axis,i) => V.mad(point,axis,cell[i]*spacing[i]),origin);
    if (!vector(placed)) throw new RangeError('Prefab array placement exceeds world coordinate bounds');
    return placed;
  }

  function state(scene, request, prior) {
    const {id} = K.world.data;
    const instance = request.instance ?? prior?.instance;
    const count = request.count ?? prior?.count, spacing = request.spacing ?? prior?.spacing;
    const space = request.space ?? prior?.space ?? 'world';
    if (!id(instance) || prior && prior.instance !== instance)
      throw new TypeError('Name the source prefab instance when creating an array and keep that identity when resizing it');
    layout(count,spacing,space);
    const source = A.sceneInstances.select(scene,{kind:'prefab',ids:[instance]})[0], template = scene.instances[instance];
    const axes = space === 'plane' ? A.constructionPlane.forScene(scene).axes : space === 'local' ?
      unit.map(axis => M.app(K.diorama.solidFrames.authored(template.transform).basis,axis)) : unit;
    return {template,source,retained:{version:1,instance,count:count.slice(),spacing:spacing.slice(),space,
      origin:source.target,axes}};
  }

  function plan(scene,env,request) {
    const {id:validId,own,equal} = K.world.data;
    if (!fields(request,['id','instance','count','spacing','space']) || !validId(request.id) ||
        Object.values(request).includes(null))
      throw new TypeError('Choose a named prefab array with a source placement and XYZ counts and spacing');
    const {id} = request, registry = scene.prefabArrays ?? {};
    const prior = own(registry,id) ? registry[id] : undefined;
    const {template,source,retained} = state(scene,request,prior);
    const instances = {...scene.instances}, coordinates = new Set(), occupied = new Map();
    const report = {format:'ink-studio/prefab-instance-array',version:1,scene:scene.id,id,source,
      count:retained.count,spacing:retained.spacing,space:retained.space,axes:retained.axes,
      ...(prior && {before:{count:prior.count,spacing:prior.spacing,space:prior.space}}),
      cells:[],retired:[],conflicts:[],instances:[]};
    const outside = cell => !prior || cell.some((index,axis) => index>=prior.count[axis]);
    for (const cell of cells(retained.count)) {
      const seed = cell.every(n => n===0), instance = seed ? source.instance : id+'.'+cell.join('.');
      const nominal = position(retained,cell), key = JSON.stringify(nominal);
      coordinates.add(instance);
      const existing = own(instances,instance) ? instances[instance] : undefined;
      const collision = occupied.get(key);
      if (collision) report.conflicts.push({reason:'repeated-position',instance,other:collision,cell});
      else occupied.set(key,instance);
      if (seed) {
        report.cells.push({cell,instance,status:'source',prefab:template.prefab,at:source.target});
        continue;
      }
      if (!validId(instance) || instance === source.instance || outside(cell) && existing) {
        report.conflicts.push({reason:!validId(instance) ? 'invalid-instance-id' : 'instance-in-use',instance,cell});
        continue;
      }
      if (!existing && !outside(cell)) {
        report.cells.push({cell,instance,status:'missing'});
        continue;
      }
      const original = existing ?? template;
      // Move a surviving copy by the change in its array offset, keeping its local edit.
      const shift = V.sub(nominal,existing ? position(prior,cell) : retained.origin);
      const at = V.add(original.transform?.translation ?? [0,0,0],shift);
      if (!vector(at)) throw new RangeError('Prefab array placement exceeds world coordinate bounds');
      const moved = !existing || shift.some(Boolean);
      const updated = moved ? {...original,transform:{...original.transform,translation:at}} : original;
      instances[instance] = updated;
      report.cells.push({cell,instance,status:existing ? moved ? 'moved' : 'retained' : 'added',
        prefab:updated.prefab,at:A.scenePrefabs.origin(updated.transform)});
    }
    if (prior) for (const cell of cells(prior.count)) {
      if (cell.every(n => n===0)) continue;
      const instance = id+'.'+cell.join('.');
      if (coordinates.has(instance) || !own(instances,instance)) continue;
      const dependents = Object.entries(registry).filter(([name,row]) => name!==id && row.instance===instance)
        .map(([name]) => name);
      if (dependents.length) report.conflicts.push({reason:'array-source-would-be-removed',instance,dependents});
      const {prefab,overrides,meshOverrides} = instances[instance];
      report.retired.push({cell,instance,prefab,overrides:overrides?.length ?? 0,meshOverrides:Object.keys(meshOverrides ?? {}).sort()});
      delete instances[instance];
    }
    const patch = {instances,prefabArrays:{...registry,[id]:retained}};
    const changed = !equal(prior,retained) || !equal(scene.instances,instances);
    if (!report.conflicts.length) {
      const before = A.scenePrefabs.expand(scene,env);
      try {
        const after = A.scenePrefabs.expand({...scene,...patch},env);
        report.conflicts.push(...A.scenePrefabs.indexedTargets(scene,before,after));
        const objects = link => link ? [...link.solids,...[...link.meshes.values()].map(row => row.object)] : [];
        report.instances = [...report.cells,...report.retired].map(({instance}) => ({instance,
          objects:[...new Set([...objects(before.instances.get(instance)),...objects(after.instances.get(instance))])]}));
      } catch (error) {
        return {report:freeze({...report,changed,canCommit:false,problems:error.problems ?? [{level:'error',problem:error.message}]})};
      }
    }
    const canCommit = !report.conflicts.length;
    return {...(canCommit && {patch}),report:freeze({...report,changed,canCommit})};
  }

  A.prefabInstanceArray = Object.freeze({check,plan});
})(KIT);
