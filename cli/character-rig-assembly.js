const { createHash } = require('node:crypto');

const planFormat = 'ink-studio/character-rig-plan', format = 'ink-studio/character-rig';
const fields = (row, keys) => row && Object.getPrototypeOf(row) === Object.prototype &&
  Object.keys(row).every(key => keys.includes(key));
const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
const safe = value => typeof value === 'string' && !['constructor','prototype','__proto__'].includes(value);
const localName = value => safe(value) && /^[a-z][\w-]{0,55}$/i.test(value);
const jointName = value => safe(value) && value.split('.').length === 2 && value.split('.').every(localName);
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const vector = (row, n = 3, lo = -1e4, hi = 1e4) => Array.isArray(row) && row.length === n &&
  Array.from(row).every(value => range(value, lo, hi));
const zero = [0,0,0], basis = [[1,0,0],[0,1,0],[0,0,1]], defaultLimits = [[-150,150],[-150,150],[-150,150]];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rad = Math.PI / 180;
const interval = row => vector(row, 2, -180, 180) && row[0] <= 0 && row[1] >= 0;

const templates = {
  torso: { joints: [
    { id:'hips', at:[0,0,0], limit:{type:'ball',angles:[[-24,24],[-32,32],[-22,22]]} },
    { id:'spine', parent:'hips', at:[0,.33,0], limit:{type:'ball',angles:[[-30,30],[-34,34],[-28,28]]} },
    { id:'chest', parent:'spine', at:[0,.68,0], limit:{type:'ball',angles:[[-30,30],[-38,38],[-32,32]]} },
    { id:'head', parent:'chest', at:[0,1.05,.015], limit:{type:'ball',angles:[[-35,35],[-70,70],[-38,38]]} }
  ] },
  arm: { joints: [
    { id:'shoulder', at:[0,0,0], limit:{type:'ball',angles:[[-110,110],[-90,90],[-130,130]]} },
    { id:'elbow', parent:'shoulder', at:[.37,-.35,.045], limit:{type:'hinge',axis:[0,0,1],angle:[-15,135]} },
    { id:'hand', parent:'elbow', at:[.58,-.72,.12], limit:{type:'ball',angles:[[-55,55],[-50,50],[-60,60]]} }
  ] },
  leg: { joints: [
    { id:'hip', at:[0,0,0], limit:{type:'ball',angles:[[-80,70],[-40,40],[-35,35]]} },
    { id:'knee', parent:'hip', at:[.04,-.49,.115], limit:{type:'hinge',axis:[1,0,0],angle:[-12,132]} },
    { id:'foot', parent:'knee', at:[.03,-.98,.03], limit:{type:'ball',angles:[[-55,55],[-38,38],[-32,32]]} }
  ] }
};

function normalizeLimit(value = { type:'ball' }, V) {
  if (!record(value)) throw new TypeError('Joint limit needs a fixed, hinge or ball record');
  const { type } = value;
  if (type === 'fixed' && fields(value,['type'])) return {type};
  if (type === 'hinge' && fields(value,['type','axis','angle']) && vector(value.axis) &&
      V.len(value.axis) >= 1e-8 && interval(value.angle)) return {type,axis:V.norm(value.axis),angle:value.angle.slice()};
  if (type === 'ball' && fields(value,['type','angles'])) {
    const angles = value.angles ?? defaultLimits;
    if (Array.isArray(angles) && angles.length === 3 && Array.from(angles).every(interval))
      return {type,angles:angles.map(row=>row.slice())};
  }
  throw new RangeError('Joint limits need finite axes and angle intervals that include the rest pose');
}

function mirrorLimit(limit, mirror) {
  if (!mirror || limit.type === 'fixed') return limit;
  if (limit.type === 'hinge') return { ...limit, axis:[limit.axis[0],-limit.axis[1],-limit.axis[2]] };
  return { ...limit, angles:limit.angles.map(([a,b],i)=>i===0?[a,b]:[-b,-a]) };
}

function hierarchy(rows, label) {
  const byId = new Map(rows.map(row=>[row.id,row])), visiting = new Set(), done = new Set(), sorted = [];
  if (byId.size !== rows.length || rows.filter(row=>row.parent===null).length !== 1)
    throw new RangeError(label+' needs unique names and exactly one root');
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id) || !byId.has(id)) throw new RangeError(label+' needs existing parents without cycles at '+id);
    const row = byId.get(id);
    visiting.add(id);
    if (row.parent!==null) visit(row.parent);
    visiting.delete(id);
    done.add(id);
    sorted.push(row);
  }
  for (const id of byId.keys()) visit(id);
  return sorted;
}

function template(value, V) {
  if (!fields(value,['joints']) || !Array.isArray(value.joints) || value.joints.length < 1 || value.joints.length > 48)
    throw new TypeError('A character component template needs 1–48 authored joints');
  return hierarchy(value.joints.map(row=>{
    if (!fields(row,['id','parent','at','limit']) || !localName(row.id) ||
        row.parent!=null && !localName(row.parent) || !vector(row.at)) throw new TypeError('Invalid template joint');
    return { id:row.id,parent:row.parent ?? null,at:row.at.slice(),limit:normalizeLimit(row.limit,V) };
  }), 'Component template');
}

function assemble(source, K) {
  if (!fields(source,['format','version','id','templates','components','placements']) || source.format !== planFormat ||
      source.version !== 1 || !localName(source.id) || !Array.isArray(source.components) ||
      source.components.length<1 || source.components.length>24)
    throw new TypeError('Use a version 1 character rig plan with 1–24 components');
  const { V } = K, custom = source.templates ?? {}, placements = source.placements ?? {};
  if (!record(custom) || Object.keys(custom).length>24 || !Object.keys(custom).every(localName) ||
      !record(placements) || Object.keys(placements).length>96 ||
      Object.entries(placements).some(([id,at])=>!jointName(id)||!vector(at)))
    throw new TypeError('Invalid named rig templates or absolute joint placements');
  const rest = new Map(), instances = new Map(), types = new Map();
  for (const [id,value] of Object.entries({...templates,...custom})) types.set(id, template(value,V));
  for (const row of source.components) {
    if (!fields(row,['id','template','attach','offset','scale','mirror','joints','limits']) ||
        !localName(row.id) || instances.has(row.id) || !types.has(row.template) ||
        row.attach!==undefined && !jointName(row.attach) || !vector(row.offset ?? zero) ||
        !range(row.scale ?? 1,.05,20) || row.mirror!==undefined && row.mirror!=='x')
      throw new TypeError('Invalid rig component, attachment or scale');
    instances.set(row.id,row);
  }
  const sorted = hierarchy([...instances.values()].map(row=>({...row,parent:row.attach?.split('.')[0] ?? null})), 'Character assembly');
  const components = [];
  for (const row of sorted) {
    const shape = types.get(row.template), at = row.attach && rest.get(row.attach);
    if (row.attach && !at) throw new RangeError('Unknown attachment joint '+row.attach);
    const names = new Set(shape.map(joint=>joint.id)), overrides = row.joints ?? {}, limits = row.limits ?? {};
    if (!record(overrides) || !record(limits) || [...Object.keys(overrides),...Object.keys(limits)].some(id=>!names.has(id)) ||
        !Object.values(overrides).every(at=>vector(at))) throw new RangeError('Unknown component joint placement or limit override');
    if (rest.size+shape.length > 96) throw new RangeError('Character rig exceeds 96 joints');
    const base = V.add(at?.at ?? zero, row.offset ?? zero), prefix = row.id+'.';
    const joints = shape.map(joint=>{
      const id = prefix+joint.id, local = overrides[joint.id] ?? joint.at, sign = row.mirror ? -1 : 1;
      const at = placements[id] ?? V.mad(base, [local[0]*sign,local[1],local[2]], row.scale ?? 1);
      const parent = joint.parent===null ? row.attach ?? null : prefix+joint.parent;
      const limit = Object.hasOwn(limits,joint.id) ? normalizeLimit(limits[joint.id],V) : joint.limit;
      rest.set(id,{id,parent,at,limit:mirrorLimit(limit,row.mirror)});
      return id;
    });
    components.push({id:row.id,template:row.template,attach:row.attach ?? null,
      offset:row.offset ?? zero,scale:row.scale ?? 1,mirror:row.mirror ?? null,joints});
  }
  if (Object.keys(placements).some(id=>!rest.has(id))) throw new RangeError('Unknown absolute joint placement');
  const document = { format,version:1,id:source.id,components,joints:[...rest.values()] };
  compile(document,K);
  return document;
}

function compile(document, K) {
  const {V} = K;
  if (!fields(document,['format','version','id','components','joints']) || document.format!==format ||
      document.version!==1 || !localName(document.id) || !Array.isArray(document.components) ||
      !Array.isArray(document.joints) || document.joints.length<1 || document.joints.length>96)
    throw new TypeError('Use an assembled version 1 character rig');
  const sorted = hierarchy(document.joints.map(row=>{
    if (!fields(row,['id','at','parent','limit']) || !jointName(row.id) ||
        row.parent!==null && !jointName(row.parent) || !vector(row.at)) throw new TypeError('Invalid assembled joint');
    return {...row,limit:normalizeLimit(row.limit,V)};
  }), 'Character rig');
  const indices=new Map(sorted.map((row,i)=>[row.id,i])), parameters=[];
  const joints = sorted.map((row,index)=>{
    const parent = row.parent===null ? -1 : indices.get(row.parent);
    const offset = parent<0 ? row.at.slice() : V.sub(row.at,sorted[parent].at), length=parent<0?0:V.len(offset);
    if (parent>=0 && length<1e-5 && row.id.split('.')[0]===sorted[parent].id.split('.')[0])
      throw new RangeError('Coincident joints within one component at '+row.id);
    const { limit } = row, axes=limit.type==='ball'?basis:limit.type==='hinge'?[limit.axis]:[];
    const limits=limit.type==='ball'?limit.angles:limit.type==='hinge'?[limit.angle]:[];
    const dofs = axes.map((axis,i)=>{
      const [min,max]=limits[i].map(n=>n*rad), slot=parameters.length;
      parameters.push({index,axis,min,max});
      return slot;
    });
    return {...row,parent,offset,length,dofs};
  });
  return {id:document.id,hash:sha(JSON.stringify(document)),joints,parameters,indices,document};
}

module.exports = { assemble, compile, templates, fields, record, localName, jointName, range, vector, sha, rad };
