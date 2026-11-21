const { render } = require('./render.js');
const linear = require('../src/color-space.js').prepare('srgb','srgb-linear');

const groupId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id) && !['base','reference'].includes(id);
const memberId = id => typeof id === 'string' && /^(area|spot|point|shot|spill):\S(?:.*\S)?$/.test(id) && id.length <= 262;
const shotRoles = ['key','fill','rim','negativeFill'];

function settings(groups) {
  if (groups === undefined || groups === false) return [];
  if (!Array.isArray(groups) || !groups.length || groups.length > 8) throw new TypeError('Use 1–8 named light groups');
  const names = new Set(), members = new Set();
  return Array.from(groups, row => {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
        Object.keys(row).some(key=>!['id','lights'].includes(key)) || !groupId(row.id) || names.has(row.id) ||
        !Array.isArray(row.lights) || !row.lights.length || row.lights.length > 64)
      throw new TypeError('Light groups need unique IDs and 1–64 named light members');
    names.add(row.id);
    for (const light of row.lights) {
      if (!memberId(light) || members.has(light)) throw new TypeError('Light group members must be unique qualified light names');
      members.add(light);
    }
    return {id:row.id, lights:row.lights.slice()};
  });
}

function lightOptions(world, view, groups) {
  const area = view.areaLights === true ? world.areaLights : view.areaLights ?? world.areaLights;
  const volume = view.volumeLighting ?? world.volumeLighting;
  const shot = view.shotLighting === true ? world.shotLighting : view.shotLighting ?? world.shotLighting;
  const spill = view.emissiveFinishes ?? world.emissiveFinishes;
  const available = new Map();
  function register(type, id) {
    if (typeof id !== 'string' || !id.trim()) return;
    const key = type+':'+id;
    available.set(key,(available.get(key) ?? 0)+1);
  }
  for (const row of area || []) register('area',row.id);
  for (const row of volume?.spots || []) register('spot',row.id);
  for (const row of volume?.points || []) register('point',row.id);
  register('point',volume?.point?.id);
  for (const role of shotRoles) if (shot?.[role]) register('shot',role);
  if (area !== false) for (const row of spill || []) if (row.spill) register('spill',row.id);
  const selected = new Set(groups.flatMap(group=>group.lights));
  for (const light of selected)
    if (available.get(light) !== 1) throw new RangeError('Light group member must name one configured light: '+light);
  return enabled => {
    const keep = (type,id) => !selected.has(type+':'+id) || enabled.has(type+':'+id);
    return {
      areaLights: Array.isArray(area) ? area.map(row=>keep('area',row.id) ? row : {...row,intensity:0,volumeIntensity:0}) : area,
      volumeLighting: volume && { ...volume,
        ...(volume.point && !keep('point',volume.point.id) && {point:null}),
        ...(volume.points && {points:volume.points.filter(row=>keep('point',row.id))}),
        ...(volume.spots && {spots:volume.spots.filter(row=>keep('spot',row.id))})
      },
      shotLighting: shot && { ...shot, ...Object.fromEntries(shotRoles.filter(role=>!keep('shot',role)).map(role=>[role,false])) },
      emissiveFinishes: Array.isArray(spill) ? spill.map(row=>keep('spill',row.id) ? row : {...row,spill:false}) : spill
    };
  };
}

function captureLightGroups(world, { groups, view = {} } = {}) {
  const plan = settings(groups);
  if (!plan.length) throw new TypeError('Light capture needs named groups');
  const select = lightOptions(world,view,plan);
  // These are matched raw lighting plates. Each evaluation uses the same pose
  // and camera, with temporal feedback and final screen treatments disabled.
  const options = { ...view, raw:true, transparent:view.transparent ?? true, passes:false, captureLightPlate:true,
    renderGraph:false, composite:false, renderGrid:false, inspection:false, shutter:false, afterimages:false,
    cameraGuides:false, objectMattes:false, captureMotion:false, capturePartMotion:false,
    artHistory:undefined, renderHistory:undefined, volumeHistory:undefined, afterimageHistory:undefined,
    transparencyHistory:undefined, motionalCoverageHistory:undefined, partMotionHistory:undefined,
    lookInputSession:undefined, shotFrame:undefined, cameraFrame:undefined, fragmentProbe:undefined,
    pick:undefined, lookAudit:false, captureColorStages:false, captureQuantization:false };
  const enabled = new Set();
  function sample() {
    const frame = render(world,{...options,...select(enabled)});
    const data = frame.lightPlate;
    if (!data) throw new Error('The renderer did not supply the raw lighting plate');
    if (data.length > 4_000_000) throw new RangeError('Light group plates support up to one million pixels');
    for (let i=0;i<data.length;i+=4) {
      const a = data[i+3], rgb = linear([data[i],data[i+1],data[i+2]]);
      data[i]=rgb[0]*a;
      data[i+1]=rgb[1]*a;
      data[i+2]=rgb[2]*a;
    }
    return {width:frame.w,height:frame.h,channels:4,data};
  }
  const base = sample(), layers = [];
  let previous = base;
  for (const group of plan) {
    for (const light of group.lights) enabled.add(light);
    const current = sample();
    if (current.width !== base.width || current.height !== base.height) throw new Error('Light group art grids differ');
    const data = Float32Array.from(current.data,(value,i)=>value-previous.data[i]);
    layers.push({...group,value:{...current,data}});
    previous = current;
  }
  return {base,reference:previous,groups:layers};
}

module.exports = { settings, captureLightGroups };
