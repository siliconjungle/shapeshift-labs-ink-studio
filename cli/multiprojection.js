const CameraLens = require('../src/camera-lens.js');
const Selectors = require('../src/target-selectors.js');

const dot = (a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const sub = (a,b)=>a.map((value,i)=>value-b[i]);
const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normal = v=>{
  const length=Math.hypot(...v);
  return length>1e-8 ? v.map(n=>n/length) : null;
};
const point = value=>Array.isArray(value) && value.length===3 && Array.from(value).every(Number.isFinite);
const name = value=>typeof value==='string' && value.trim().length>0 && value.length<=128;
const amount = value=>Number.isFinite(value) && value>=0 && value<=1;

function record(value,keys,label) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype ||
      Object.keys(value).some(key=>!keys.includes(key))) throw new TypeError('Invalid '+label);
}

function pinAt(pin,time) {
  if (pin.point) return pin.point;
  const samples=pin.track;
  const next=samples.findIndex(sample=>sample.time>=time);
  if (next===0) return samples[0].point;
  if (next<0) return samples.at(-1).point;
  const a=samples[next-1],b=samples[next], fraction=(time-a.time)/(b.time-a.time);
  return a.point.map((value,i)=>value+(b.point[i]-value)*fraction);
}

function prepare(value) {
  if (value===undefined || value===false) return null;
  record(value,['rules'],'multiprojection settings');
  if (!Array.isArray(value.rules) || !value.rules.length || value.rules.length>24)
    throw new RangeError('Use 1–24 multiprojection rules');
  const ids=new Set();
  return Array.from(value.rules,rule=>{
    record(rule,['id','select','pivot','facing','up','flatten','strength','pins'],'multiprojection rule');
    const {id,select,pivot,facing,up=[0,1,0],flatten=.75,strength=1,pins=[]}=rule;
    if (!name(id) || ids.has(id) || !point(pivot) || !point(facing) || !point(up) || !amount(flatten) || !amount(strength) ||
        !Array.isArray(pins) || pins.length>12)
      throw new RangeError('Multiprojection needs a distinct ID, finite pivot and axes, 0–1 controls, and at most 12 pins');
    ids.add(id);
    const back=normal(facing), right=back && normal(cross(up,back));
    if (!right) throw new RangeError('Multiprojection facing and up must form a camera basis');
    const pinIds=new Set();
    const locked=Array.from(pins,pin=>{
      record(pin,['id','point','track'],'multiprojection pin');
      if (!name(pin.id) || pinIds.has(pin.id) || (pin.point===undefined)===(pin.track===undefined))
        throw new TypeError('Multiprojection pins need distinct IDs and either a point or a track');
      pinIds.add(pin.id);
      if (pin.point!==undefined) {
        if (!point(pin.point)) throw new TypeError('Multiprojection pin points need finite XYZ');
        return pin;
      }
      if (!Array.isArray(pin.track) || !pin.track.length || pin.track.length>128)
        throw new RangeError('Multiprojection pin tracks need 1–128 samples');
      let last=-Infinity;
      for (const sample of pin.track) {
        record(sample,['time','point'],'multiprojection pin sample');
        if (!point(sample.point) || !Number.isFinite(sample.time) || sample.time<=last)
          throw new RangeError('Multiprojection pin samples need finite XYZ and increasing times');
        last=sample.time;
      }
      return pin;
    });
    return {id,select:Selectors.prepare(select),pivot,back,right,up:cross(back,right),flatten,strength,pins:locked};
  });
}

function coefficientSpace(rows) {
  const basis=[];
  // Two passes keep nearly redundant pins from amplifying residual error.
  for (const row of rows) {
    const starting=normal(row);
    if (!starting) continue;
    let q=starting;
    for (let pass=0;pass<2;pass++) for (const prior of basis) {
      const projection=dot(q,prior);
      q=q.map((n,i)=>n-projection*prior[i]);
    }
    const axis=normal(q);
    if (axis) basis.push(axis);
  }
  return basis;
}

function solve(rule,camera,{ortho,near,w,h,focal,time}) {
  const {pivot,id,strength,pins}=rule;
  const masterBack=camera.back.map(n=>-n), origin=sub(pivot,camera.eye);
  const distance=dot(origin,masterBack), nominal=ortho ? 1 : distance;
  const z=ortho ? [0,0,0] : masterBack;
  const at=[dot(origin,camera.right)/nominal,dot(origin,camera.up)/nominal];
  const base=[camera.right.map((n,i)=>n-at[0]*z[i]),camera.up.map((n,i)=>n-at[1]*z[i]),z];
  const status={id,status:'active',triangles:0,rank:0,pins:[]};
  function onMaster(p) {
    const d=sub(p,pivot), depth=nominal+dot(z,d);
    if (depth<=0) return null;
    return [dot(base[0],d)/depth,dot(base[1],d)/depth];
  }
  const locks=pins.map(pin=>({id:pin.id,point:pinAt(pin,time)}));
  if (distance<near || locks.some(pin=>dot(sub(pin.point,camera.eye),masterBack)<near)) {
    status.status='pin-outside-near-plane';
    return {rule,status};
  }
  const rows=[];
  const zeros=[0,0,0];
  for (const pin of locks) {
    const d=sub(pin.point,pivot), [u,v]=onMaster(pin.point);
    rows.push([...d,...zeros,...(ortho ? zeros : d.map(n=>-u*n))],
      [...zeros,...d,...(ortho ? zeros : d.map(n=>-v*n))]);
  }
  const axes=coefficientSpace(rows);
  const desired=[rule.right,rule.up,ortho ? zeros : rule.back.map(n=>-(1-rule.flatten)*n)].flat();
  const source=base.flat();
  let delta=desired.map((n,i)=>(n-source[i])*strength);
  for (const axis of axes) {
    const projection=dot(delta,axis);
    delta=delta.map((n,i)=>n-projection*axis[i]);
  }
  const values=source.map((n,i)=>n+delta[i]);
  const u=values.slice(0,3),v=values.slice(3,6),d=values.slice(6);
  const project=(x,y,z)=>{
    const q=[x-pivot[0],y-pivot[1],z-pivot[2]];
    const denominator=nominal+dot(d,q);
    return {x:dot(u,q)+at[0]*denominator,y:dot(v,q)+at[1]*denominator,w:denominator};
  };
  const screen=(x,y)=>[w*.5+focal*x,h*.5-focal*y];
  status.rank=axes.length;
  status.pins=locks.map(pin=>{
    const a=onMaster(pin.point), b=project(...pin.point);
    const master=screen(a[0]+at[0],a[1]+at[1]);
    if (!(b.w>Math.max(near*.25,1e-4)) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      status.status='local-projection-crosses-camera';
      return {id:pin.id,master,local:null,error:null};
    }
    const local=screen(b.x/b.w,b.y/b.w);
    return {id:pin.id,master,local,error:Math.hypot(...sub(master,local))};
  });
  if (Math.hypot(...delta)<1e-8) status.status=strength ? 'pins-lock-projection' : 'disabled';
  return {rule,status,project};
}

function frame(plan,layers,view) {
  if (!plan) return null;
  const camera=CameraLens.fromView(view.V);
  const rules=plan.map(rule=>solve(rule,camera,view)), chartsByLayer=new Map();
  for (const layer of [layers].flat()) {
    if (!layer?.surfaceCharts?.length || layer.brickField || layer.depthOnly) continue;
    const charts=new Map();
    for (const chart of layer.surfaceCharts) {
      const {objectId:object,materialId:material,partId:part}=chart;
      const selected=rules.find(entry=>Selectors.matches(entry.rule.select,{object,entity:object,material,part}));
      if (!selected || selected.status.status!=='active') continue;
      charts.set(chart,selected);
      selected.status.triangles+=(chart.end-chart.first)/3;
      for (let i=chart.first;i<chart.end;i++) {
        const j=i*5, p=selected.project(layer.vertices[j],layer.vertices[j+1],layer.vertices[j+2]);
        if (!(p.w>Math.max(view.near*.25,1e-4)) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          selected.status.status='local-projection-crosses-camera';
          break;
        }
      }
    }
    if (charts.size) chartsByLayer.set(layer,charts);
  }
  for (const item of rules) if (item.status.status==='active' && !item.status.triangles) item.status.status='no-matching-mesh';
  return {
    project(layer,chart) {
      const item=chartsByLayer.get(layer)?.get(chart);
      return item?.status.status==='active' ? item.project : undefined;
    },
    report:{rules:rules.map(item=>item.status)}
  };
}

module.exports={prepare,frame};
