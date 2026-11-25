/* Seeded component transforms and revision-checked playback of their exact edits. */
const meshRandomTransform = (function (K) {
  const { V, M, meshTopology: T, procedural: { data: { hash, hash01, freeze } } } = K;
  const channels = ['translation','rotation','scale'], axes = ['x','y','z'];
  const rounding = Object.freeze({ nearest:Math.round, floor:Math.floor, ceiling:Math.ceil });
  const cardinal = [[1,0,0],[0,1,0],[0,0,1]];
  const record = (raw, keys) => raw && Object.getPrototypeOf(raw) === Object.prototype &&
    Object.keys(raw).every(key => keys.includes(key));
  const xyz = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isFinite);
  const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
  const integerAtPrecision = value => {
    const rounded = Math.round(value);
    return Math.abs(rounded-value) <= Math.min(.001,4*Number.EPSILON*Math.abs(value)) ? rounded : value;
  };

  function axisRange(raw, channel, axis) {
    const name = channel + '.' + axis;
    if (!record(raw,['min','max','step','rounding'])) throw new TypeError('Invalid random transform axis ' + name);
    const { min,max,step,rounding:mode } = raw;
    if (![min,max,max-min].every(Number.isFinite) || max < min || channel === 'scale' && min <= 0)
      throw new RangeError('Random ' + name + ' needs finite ordered bounds, with positive scale factors');
    if (step === undefined) {
      if (mode !== undefined) throw new TypeError('Random ' + name + ' needs a step to use rounding');
      return { bounds: {min,max}, at: roll => clamp(min+(max-min)*roll,min,max) };
    }
    const method = mode === undefined ? 'nearest' : mode;
    if (!Number.isFinite(step) || step <= 0 || typeof method !== 'string' || !Object.hasOwn(rounding,method))
      throw new RangeError('Random ' + name + ' needs a positive step and nearest, floor or ceiling rounding');
    const lo = Math.ceil(integerAtPrecision(min/step)), hi = Math.floor(integerAtPrecision(max/step));
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo > hi)
      throw new RangeError('Random ' + name + ' has no representable step inside its bounds');
    return { bounds: {min,max,step,rounding:method}, at(roll) {
      const sample = integerAtPrecision((min+(max-min)*roll)/step);
      return clamp(clamp(rounding[method](sample),lo,hi)*step,min,max);
    } };
  }

  function parse(raw) {
    if (!record(raw,['kind','seed','mode',...channels]))
      throw new TypeError('Randomize needs a seed and optional per-axis translation, rotation and scale ranges');
    const { seed, mode = 'assembly' } = raw;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !['assembly','individual'].includes(mode))
      throw new RangeError('Randomize needs a 32-bit unsigned seed and assembly or individual mode');
    const paths = Object.fromEntries(channels.filter(key => raw[key] !== undefined).map(key => {
      if (!record(raw[key],axes) || !Object.keys(raw[key]).length)
        throw new TypeError('Random ' + key + ' needs at least one of x, y or z');
      return [key,Object.fromEntries(axes.filter(axis => Object.hasOwn(raw[key],axis))
        .map(axis => [axis,axisRange(raw[key][axis],key,axis)]))];
    }));
    if (!Object.keys(paths).length) throw new TypeError('Set at least one random transform axis');
    const bounds = Object.fromEntries(Object.entries(paths).map(([key,rows]) =>
      [key,Object.fromEntries(Object.entries(rows).map(([axis,row]) => [axis,row.bounds]))]));
    return { seed, mode, paths, bounds };
  }

  function plan(settings, doc, selection, selected, vertices, weights, coincident, pivot, sharedPivot) {
    const { seed, mode, paths, bounds } = settings;
    const groups = mode === 'assembly' ? [[...new Set([...selected,...weights.keys()])].sort()] :
      meshTransformGroups(doc,selection,selected,coincident,mode);
    const byVertex = new Map();
    const evidence = groups.map(ids => {
      const picked = ids.filter(id => selected.has(id));
      const localPivot = mode === 'assembly' || sharedPivot ? pivot.slice() :
        V.mul(picked.reduce((sum,id) => V.add(sum,vertices.get(id).position),[0,0,0]),1/picked.length);
      const groupSeed = hash(JSON.stringify(['mesh-randomize-v1',doc.id,picked]),seed);
      const values = Object.fromEntries(channels.map(channel => [channel,axes.map(axis => {
        const range = paths[channel]?.[axis];
        return range ? range.at(hash01(channel+'/'+axis,groupSeed)) || 0 : channel === 'scale' ? 1 : 0;
      })]));
      const radians = values.rotation.map(degrees => degrees*(Math.PI/180));
      function rotation(weight) {
        return radians.reduce((turn,angle,i) => angle ? M.mul(M.rot(cardinal[i],angle*weight),turn) : turn, M.id());
      }
      const turn = rotation(1);
      const row = { pivot:localPivot, delta(p,weight) {
        const scaled = p.map((value,i) => value*(weight === 1 ? values.scale[i] : 1+(values.scale[i]-1)*weight));
        const moved = M.app(weight === 1 ? turn : rotation(weight),scaled);
        return V.mad(V.sub(moved,p),values.translation,weight);
      } };
      for (const id of ids) byVertex.set(id,row);
      return { vertices:ids, pivot:localPivot, ...values };
    });
    return { byVertex, evidence: {kind:'randomize',version:1,seed,mode,bounds,groups:evidence} };
  }

  function replay(doc, request) {
    const { operation, selection:from } = request;
    const beforeRevision = T.revision(doc);
    if (!record(request,['operation','selection','frame']) ||
        !record(operation,['kind','version','beforeRevision','afterRevision','vertices']) ||
        operation.version !== 1 || typeof operation.beforeRevision !== 'string' ||
        typeof operation.afterRevision !== 'string' || !Array.isArray(operation.vertices) || !from)
      throw new TypeError('Use a version 1 recorded random transform');
    if (operation.beforeRevision !== beforeRevision) throw new RangeError('Stale recorded random transform revision');
    const selection = T.select(doc,{from}), selected = new Set(T.select(doc,{from:selection,convert:'vertices'}).ids);
    const original = new Map(doc.vertices.map(({id,position}) => [id,position]));
    const ids = new Set();
    const patch = {vertices:operation.vertices.map(row => {
      if (!record(row,['id','position']) || !original.has(row.id) || ids.has(row.id) || !xyz(row.position))
        throw new TypeError('Recorded random transforms need unique existing vertices and finite positions');
      ids.add(row.id);
      return {id:row.id,position:row.position.slice()};
    })};
    const document = patch.vertices.length ? T.edit(doc,patch) : doc;
    const afterRevision = T.revision(document);
    if (operation.afterRevision !== afterRevision) throw new RangeError('Recorded random transform output revision differs');
    return freeze({ document, patch, report: {
      format:'ink-studio/mesh-component-transform',version:1,mesh:doc.id,beforeRevision,afterRevision,selection,
      operation:{kind:'replay-randomize',version:1}, vertices:patch.vertices.map(({id,position}) =>
        ({id,before:original.get(id),after:position,selected:selected.has(id)}))
    } });
  }

  return Object.freeze({parse,plan,replay});
})(KIT);
