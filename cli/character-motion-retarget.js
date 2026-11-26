const { fields, localName, vector, range } = require('./character-rig-assembly.js');
const { compileCatalog, getClip, controlsAt, timeline, poseAt, validateContacts, format } = require('./character-motion.js');

const one = [1, 1, 1], zero = [0, 0, 0], epsilon = 1e-9;
const scaled = (row, scale) => row.map((n,i)=>n*scale[i]);

function roles(source, target, pairs, {V}) {
  if (pairs===undefined)
    pairs = source.joints.filter(joint=>target.indices.has(joint.id)).map(({id})=>({source:id,target:id}));
  if (!Array.isArray(pairs) || !range(pairs.length,1,96)) throw new RangeError('Use 1–96 joint mappings');
  const from = new Map(), to = new Set();
  for (const pair of pairs) {
    if (!fields(pair,['source','target']) || from.has(pair.source) || to.has(pair.target) ||
        !source.indices.has(pair.source) || !target.indices.has(pair.target))
      throw new RangeError('Retarget joints must exist and form distinct pairs');
    const a = source.joints[source.indices.get(pair.source)], b = target.joints[target.indices.get(pair.target)];
    const signs = a.dofs.map((slot,i) => {
      if (a.dofs.length!==b.dofs.length) return 0;
      const dot = V.dot(source.parameters[slot].axis,target.parameters[b.dofs[i]].axis);
      return Math.abs(dot)>=.9999 ? Math.sign(dot) : 0;
    });
    from.set(a.id,{source:a,target:b,signs,compatible:a.dofs.length===b.dofs.length&&signs.every(Boolean)});
    to.add(b.id);
  }
  return {from,to};
}

function transferContacts(contacts, from, scale, {V}) {
  return contacts.map(({joint,offset=zero,at,ref,...contact}) => {
    const pair = from.get(joint);
    if (!pair) throw new RangeError('No target joint mapped for contact ' + ref + ' on ' + joint);
    const targetOffset = scaled(offset,scale);
    const displacement = V.sub(at,V.add(pair.source.at,offset));
    const targetMarker = V.add(pair.target.at,targetOffset);
    return {...contact,joint:pair.target.id,offset:targetOffset,at:V.add(targetMarker,scaled(displacement,scale)),ref};
  });
}

function bakeTimes(duration, fps, boundaries, contacts) {
  if (Math.ceil(duration*fps)>511 || boundaries.size>512)
    throw new RangeError('A retarget bake supports up to 512 times. Reduce the bake rate or clip duration.');
  const explicit = [...new Set([...boundaries,...contacts.flatMap(({start,end})=>[start,end])])].sort((a,b)=>a-b);
  // Prefer exact authored boundaries to a nearby uniform sample.
  const times = new Set(explicit);
  let next = 0;
  for (let frame=1;frame<duration*fps;frame++) {
    const time = frame/fps;
    while (next<explicit.length && explicit[next]<time-epsilon) next++;
    if (next===explicit.length || Math.abs(explicit[next]-time)>epsilon) times.add(time);
  }
  if (times.size>512) throw new RangeError('A retarget bake supports up to 512 distinct times including authored boundaries');
  return [...times].sort((a,b)=>a-b);
}

function retarget(catalog, name, target, plan, K) {
  if (!fields(plan,['format','version','id','clip','fps','scale','rootAllowance','joints']) ||
      plan.format!=='ink-studio/character-motion-retarget' || plan.version!==1 ||
      !localName(plan.id) || !localName(plan.clip ?? name) || !range(plan.fps ?? 24,1,120) ||
      !vector(plan.scale ?? one,3,.001,1000) ||
      plan.rootAllowance!==undefined && !vector(plan.rootAllowance,3,0,10000))
    throw new TypeError('Use a version 1 motion retarget plan with an output ID and a bounded bake rate and scale');
  const clip = getClip(catalog,name), source = catalog.rig;
  const {id,clip:targetClip=name,fps=24,scale=one,rootAllowance=scaled(catalog.rootAllowance,scale)} = plan;
  if (!vector(rootAllowance,3,0,10000)) throw new RangeError('Scaled root allowance exceeds rig space');
  const {from,to} = roles(source,target,plan.joints,K);
  const {contacts:sourceContacts,boundaries} = timeline(catalog,clip,true);
  const contacts = transferContacts(sourceContacts,from,scale,K);
  validateContacts(contacts);
  const timeList = bakeTimes(clip.duration,fps,boundaries,contacts);
  const influenced = new Set(), skipped = new Set();
  const frames = timeList.map(time => {
    const mapped = new Map();
    for (const [channel,value] of controlsAt(catalog,clip,time)) {
      if (channel==='root') mapped.set(channel,scaled(value,scale));
      else {
        const pair = from.get(channel);
        if (pair?.compatible) mapped.set(pair.target.id,value.map((n,i)=>n*pair.signs[i]));
        else skipped.add(channel);
      }
    }
    for (const channel of mapped.keys()) influenced.add(channel);
    const pose = poseAt(target,mapped,contacts,time,rootAllowance,K);
    for (const [joint,values] of Object.entries(pose.angles))
      if (values.some(n=>n!==0)) influenced.add(joint);
    if (pose.rootTranslation.some(n=>n!==0)) influenced.add('root');
    return {time,pose};
  });
  const keys = channel => frames.map(({time,pose})=>({time,value:channel==='root'?pose.rootTranslation:pose.angles[channel]}));
  const joints = Object.fromEntries(target.joints.filter(joint=>influenced.has(joint.id)).map(({id})=>[id,keys(id)]));
  const row = {type:'curves',duration:clip.duration,joints,...(influenced.has('root')&&{root:keys('root')}),
    contacts:contacts.map(({ref,...contact})=>contact)};
  const result = {format,version:1,id,rigHash:target.hash,rootAllowance,clips:{[targetClip]:row}};
  compileCatalog(target,result,K);
  const report = {format:'ink-studio/character-motion-retarget-report',version:1,
    source:{catalog:catalog.id,clip:name,rig:source.id,rigHash:source.hash},
    target:{catalog:id,clip:targetClip,rig:target.id,rigHash:target.hash},fps,scale,rootAllowance,contacts,
    mapping:[...from.values()].map(({source,target,compatible,signs})=>
      ({source:source.id,target:target.id,controls:compatible,signs})),
    skippedSourceControls:[...skipped].sort(),
    unmappedTargetJoints:target.joints.filter(joint=>!to.has(joint.id)).map(({id})=>id),
    passed:frames.every(({pose})=>pose.solve.passed),
    maxContactResidual:Math.max(0,...frames.flatMap(({pose})=>pose.solve.targets.map(row=>row.position.residual))),
    samples:frames.map(({time,pose})=>({time,passed:pose.solve.passed,clamped:pose.motion.clamped,
      initialError:pose.solve.initialError,targets:pose.solve.targets}))};
  return {result,report};
}

module.exports = { retarget };
