/* Paint optional RGB multipliers on authored mesh corners. */
(function(K) {
  const T = K.meshTopology, {freeze} = K.procedural.data;
  const object = value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const fields = (value,keys)=>object(value) && Object.keys(value).every(key=>keys.includes(key));
  const name = value=>typeof value==='string' && !!value.trim();
  const format = 'ink-studio/mesh-tint-edit';

  function pigment(value) {
    if (typeof value==='string' && /^#[a-f\d]{6}$/i.test(value))
      return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255);
    if (Array.isArray(value) && value.length===3 && Array.from(value).every(n=>Number.isFinite(n) && n>=0 && n<=1))
      return value.slice();
    throw new RangeError('Mesh tint needs normalized RGB or a six-digit hex color');
  }

  function target(doc,request) {
    const {corner,face,vertex,selection} = request;
    if ([corner,face,vertex,selection].filter(value=>value!==undefined).length!==1 ||
        [corner,face,vertex].some(id=>id!==undefined && !name(id)))
      throw new TypeError('Choose one corner, face, vertex, or component selection');
    if (corner!==undefined) return {domain:'corners',ids:T.uv.select(doc,{domain:'corners',ids:[corner]}).ids};
    if (face!==undefined) return T.select(doc,{domain:'faces',ids:[face]});
    if (vertex!==undefined) return T.select(doc,{domain:'vertices',ids:[vertex]});
    if (!object(selection)) throw new TypeError('Use a saved mesh or UV selection, or component IDs');
    if (selection.format==='ink-studio/uv-selection' || selection.format===undefined && selection.domain==='corners') {
      if (selection.format===undefined && !fields(selection,['domain','ids']))
        throw new TypeError('Choose a corner selection by ID');
      const selected = T.uv.select(doc,{domain:selection.domain,...(selection.format===undefined ?
        {ids:selection.ids} : {from:selection})});
      return {domain:'corners',ids:selected.corners};
    }
    if (selection.format===undefined && (!fields(selection,['domain','ids']) || !Array.isArray(selection.ids)))
      throw new TypeError('Choose face, vertex, or edge IDs');
    const selected = T.select(doc,selection.format===undefined ? selection : {from:selection});
    if (selected.domain==='edges') return {domain:'corners',ids:T.uv.select(doc,{domain:'edges',topology:selected}).corners};
    return selected;
  }

  function planTint(source,request) {
    if (!fields(request,['tool','color','corner','vertex','face','selection']) ||
        !['paint','eyedropper','erase'].includes(request.tool) || request.tool!=='paint' && request.color!==undefined)
      throw new TypeError('Choose a mesh tint paint, eyedropper, or erase request');
    const doc = T.create(source), {tool} = request;
    const color = tool==='paint' ? pigment(request.color) : undefined;
    const {domain,ids} = target(doc,request), selected = new Set(ids);
    const samples = [], changes = [], faces = [];
    for (const face of doc.faces) {
      let dirty = false;
      const corners = face.corners.map(corner=>{
        const id = domain==='faces' ? face.id : domain==='vertices' ? corner.vertex : corner.id;
        if (!selected.has(id)) return corner;
        const {attributes,...rest} = corner, before = attributes?.tint ?? null;
        const hit = {face:face.id,corner:corner.id,vertex:corner.vertex};
        if (tool==='eyedropper') {
          const tint = meshCornerTint.read(corner);
          samples.push({...hit,tint:tint ?? null,color:(tint ?? [1,1,1]).slice(0,3)});
          return corner;
        }
        const after = tool==='erase' ? null : before?.length===4 && meshCornerTint.read(corner) ? [...color,before[3]] : color;
        if (JSON.stringify(before)===JSON.stringify(after)) return corner;
        changes.push({...hit,before,after});
        dirty=true;
        const {tint,...other} = attributes ?? {};
        if (after) other.tint=after;
        return {...rest,...(Object.keys(other).length && {attributes:other})};
      });
      if (dirty) faces.push({...face,corners});
    }
    const patch = faces.length ? {faces} : {};
    const document = faces.length ? T.edit(doc,patch) : doc;
    const report = {format,version:1,mesh:doc.id,tool,domain,ids,beforeRevision:T.revision(doc),
      afterRevision:T.revision(document),
      ...(tool==='eyedropper' ? {samples,coveredCorners:samples.length} : {changes,changedCorners:changes.length})};
    return {patch,document,report:freeze(report)};
  }

  K.meshTopology = Object.freeze({...T,planTint});
})(KIT);
