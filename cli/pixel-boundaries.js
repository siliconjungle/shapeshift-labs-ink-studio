/* Joint native-grid raster decisions for visible surfaces and the light on them. */
const Selectors = require('../src/target-selectors.js');
const kinds = ['silhouette','overlap','seam','light'];
const channels = ['depth','objectId','materialId','partId','surfaceCoverage','normal','position',
  'objectPosition','splatId','protected','inkShadow','motion','coverage','emission','surfaceKind'];
const range = (n,low,high) => Number.isFinite(n) && n>=low && n<=high;
const text = id => typeof id==='string' && id.length>0 && id.length<=128;
const matches = (selector,target) => !selector || Selectors.matches(selector,target);

function prepare(definition,w,h) {
  if (!definition || Object.getPrototypeOf(definition)!==Object.prototype)
    throw new TypeError('Pixel boundaries need a shot settings object');
  const {types=kinds,targets=[],bands=[{id:'key',threshold:.42}],constraints=[],temporal=.38,spatial=.18,steps=4}=definition;
  if (Object.keys(definition).some(key=>!['types','targets','bands','constraints','temporal','spatial','steps'].includes(key)) ||
      !Array.isArray(types) || !types.length || types.some(type=>!kinds.includes(type)) ||
      !range(temporal,0,3) || !range(spatial,0,1) || !Number.isSafeInteger(steps) || !range(steps,1,12) ||
      !Array.isArray(targets) || targets.length>64 || !Array.isArray(bands) || bands.length>16 ||
      !Array.isArray(constraints) || constraints.length>16)
    throw new RangeError('Invalid pixel boundary types, weights or shot budget');
  const named = new Set();
  function unique(list,item) {
    if (!text(item?.id) || list.has(item.id)) throw new TypeError('Pixel boundary rules need distinct named IDs');
    list.add(item.id);
  }
  const light=bands.map(band=>{
    unique(named,band);
    const {id,select,channel='key',threshold=.5}=band;
    if (!['key','value'].includes(channel) || !range(threshold,0,1))
      throw new RangeError('A light band needs key or value and a threshold in 0–1');
    return {id,select:select && Selectors.prepare(select),channel,threshold};
  });
  const ids=new Set();
  const rules=constraints.map(rule=>{
    unique(ids,rule);
    const {id,kind,bounds=[0,0,w,h],frames=[0,95]}=rule;
    if (!Array.isArray(bounds) || bounds.length!==4 || !bounds.every(Number.isSafeInteger) ||
        bounds[0]<0 || bounds[1]<0 || bounds[2]<1 || bounds[3]<1 ||
        bounds[0]+bounds[2]>w || bounds[1]+bounds[3]>h || bounds[2]*bounds[3]>4096 ||
        !Array.isArray(frames) || frames.length!==2 || !frames.every(Number.isSafeInteger) ||
        frames[0]<0 || frames[1]<frames[0] || frames[1]>95)
      throw new RangeError('Constraint bounds need an in-grid x, y, width and height up to 4096 pixels');
    if (kind==='connected' && named.has(rule.band)) return {id,kind,bounds,frames,band:light.findIndex(item=>item.id===rule.band)+1};
    if (kind==='gap' && Array.isArray(rule.between) && rule.between.length===2)
      return {id,kind,bounds,frames,between:rule.between.map(Selectors.prepare)};
    throw new TypeError('Use a gap between two targets or a connected named light band');
  });
  return {types:new Set(types),targets:targets.map(Selectors.prepare),light,rules,temporal,spatial,steps};
}

function catalog(settings) {
  const ids=new Map(), entries=[{key:'background',target:{},band:0,selected:false}];
  function classify(lane,p) {
    const {passes,entries:byRow,key,value}=lane;
    if (!Number.isFinite(passes.depth[p])) return passes.coverage[p]>.055 ? -1 : 0;
    const object=passes.objects?.[passes.objectId[p]], material=passes.materials?.[passes.materialId[p]];
    const part=passes.parts?.[passes.partId[p]]?.part;
    const row=byRow[passes.splatId[p]-1];
    const target={...row,object:object ?? row?.object,material:material ?? row?.material,part:part ?? row?.part};
    const bandIndex=settings.light.findIndex(band=> matches(band.select,target) &&
      (band.channel==='key' ? key[p] : value[p])>=band.threshold);
    // Include a dim side for each named band's material without changing object ownership.
    const band=bandIndex+1;
    const signature=JSON.stringify([target.object ?? target.entity ?? null,target.material ?? null,target.part ?? null,band]);
    if (!ids.has(signature)) {
      ids.set(signature,entries.length);
      entries.push({target,band,selected:!settings.targets.length || settings.targets.some(rule=>matches(rule,target))});
    }
    return ids.get(signature);
  }
  function type(a,b) {
    if (a<0 || b<0 || a===b) return null;
    const x=entries[a], y=entries[b];
    if (!x.selected && !y.selected) return null;
    if (!a || !b) return 'silhouette';
    if (x.target.object!==y.target.object || x.target.part!==y.target.part) return 'overlap';
    if (x.target.material!==y.target.material) return 'seam';
    return x.band!==y.band ? 'light' : null;
  }
  return {classify,type,entries};
}

function candidates(native,detail,settings,labels) {
  const {w,h}=native, fineW=detail.w, size=w*h;
  if (fineW!==2*w || detail.h!==2*h) throw new RangeError('Pixel boundary evidence needs an exact two by two grid');
  const high=Int32Array.from({length:fineW*detail.h},(_,i)=>labels.classify(detail,i));
  const state=Int32Array.from({length:size},(_,i)=>labels.classify(native,i));
  const cells=new Map(), counts=Object.fromEntries(kinds.map(kind=>[kind,0]));
  for (let p=0;p<size;p++) {
    const center=state[p];
    if (center<0 || native.passes.protected[p] || native.excluded[p]) continue;
    const corner=2*(Math.floor(p/w)*fineW+p%w);
    const quad=[corner,corner+1,corner+fineW,corner+fineW+1];
    if (quad.some(q=>high[q]<0 || detail.excluded[q])) continue;
    const scores=new Map();
    for (const q of quad) {
      const id=high[q], score=scores.get(id);
      if (score) score.count++;
      else scores.set(id,{id,donor:q,count:1});
    }
    const available=[...scores.values()].filter(item=>item.id!==center &&
      settings.types.has(labels.type(center,item.id)));
    for (const kind of new Set(available.map(item=>labels.type(center,item.id)))) counts[kind]++;
    if (!available.length) continue;
    const options=[{id:center,donor:-1,cost:1-(scores.get(center)?.count ?? 0)/4}];
    for (const item of available) options.push({...item,cost:1-item.count/4+.035});
    const anchor=quad.find(q=>high[q]>0 && detail.passes.motionValid?.[q]);
    const motion=anchor===undefined ? null : detail.passes.motion.subarray(2*anchor,2*anchor+2);
    const cell={p,options,choice:0,rules:[],motion};
    cells.set(p,cell);
  }
  return {w,h,native,detail,high,state,cells,counts};
}

function adjacent(p,w,h) {
  const x=p%w,y=Math.floor(p/w), out=[];
  if (x) out.push(p-1);
  if (x+1<w) out.push(p+1);
  if (y) out.push(p-w);
  if (y+1<h) out.push(p+w);
  return out;
}

function connect(previous,current) {
  const used=new Set();
  for (const cell of current.cells.values()) {
    const {p,motion,options}=cell, {w,h}=current;
    if (!motion) continue;
    const x=p%w-motion[0]/2, y=Math.floor(p/w)-motion[1]/2;
    let best=null,distance=2;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const u=Math.round(x)+dx,v=Math.round(y)+dy;
      if (u<0 || u>=w || v<0 || v>=h) continue;
      const candidate=previous.cells.get(v*w+u);
      if (!candidate || used.has(candidate) ||
          options.filter(option=>candidate.options.some(other=>other.id===option.id)).length<2) continue;
      const d=Math.hypot(u-x,v-y);
      if (d<distance) { best=candidate;distance=d; }
    }
    if (best) {
      used.add(best);
      cell.previous=best;
      best.next=cell;
    }
  }
}

function measurements(grid,w,[x,y,width,height],membership) {
  const mask=new Uint8Array(width*height), count=[0,0,0];
  for (let row=0,i=0;row<height;row++) for (let col=0;col<width;col++,i++) {
    mask[i]=membership[grid[(y+row)*w+x+col]] ?? 0;
    count[mask[i]]++;
  }
  return {mask,count,width,height};
}

function measure(grid,w,bounds,rule) {
  const {mask,count,width,height}=measurements(grid,w,bounds,rule.membership);
  if (rule.kind==='gap') {
    let contacts=0;
    for (let p=0;p<mask.length;p++) if (mask[p]===1) {
      for (const q of adjacent(p,width,height)) if (mask[q]===2) contacts++;
    }
    return {visible:count[1]>0 && count[2]>0,present:Number(count[1]>0)+2*Number(count[2]>0),
      violations:contacts+Number(!count[1])+Number(!count[2])};
  }
  let islands=0;
  for (let p=0;p<mask.length;p++) if (mask[p]) {
    const queue=[p];
    mask[p]=0;
    islands++;
    for (let i=0;i<queue.length;i++) for (const q of adjacent(queue[i],width,height)) if (mask[q]) {
      mask[q]=0;
      queue.push(q);
    }
  }
  return {visible:count[1]>0,present:Number(count[1]>0),violations:Math.abs(islands-1)};
}

function bindRules(frame,settings,entries,index) {
  return settings.rules.filter(rule=>index>=rule.frames[0] && index<=rule.frames[1]).map(rule=>{
    const [x,y,w,h]=rule.bounds;
    const membership=entries.map(entry=>rule.kind==='gap' ?
      rule.between.findIndex(selector=>matches(selector,entry.target))+1 : Number(entry.band===rule.band));
    const state={...rule,membership};
    const proof=measure(frame.high,frame.w*2,rule.bounds.map(n=>2*n),state);
    state.status=!proof.visible ? 'hidden' : proof.violations ? 'unsupported' : 'active';
    state.current=measure(frame.state,frame.w,rule.bounds,state);
    state.before=state.current.violations;
    if (state.status==='active') for (let v=y;v<y+h;v++) for (let u=x;u<x+w;u++) {
      const cell=frame.cells.get(v*frame.w+u);
      if (cell?.options.some(option=>membership[option.id])) cell.rules.push(state);
    }
    return state;
  });
}

function edgeCost(frame,cell,option,settings) {
  const {w,h,state}=frame, {p}=cell, {id}=option;
  let cost=option.cost;
  for (const q of adjacent(p,w,h)) if (state[q]>=0 && state[q]!==id) cost+=settings.spatial;
  // This is the cost of each adjoining 2x2 checkerboard at a detached corner.
  const x=p%w,y=Math.floor(p/w);
  for (const dx of [-1,1]) for (const dy of [-1,1]) {
    if (x+dx<0 || x+dx>=w || y+dy<0 || y+dy>=h) continue;
    const horizontal=state[p+dx], vertical=state[p+dy*w], diagonal=state[p+dx+dy*w];
    if (id>=0 && horizontal>=0 && id===diagonal && horizontal===vertical && id!==horizontal)
      cost+=settings.spatial*1.5;
  }
  return cost;
}

const better = (violations,cost,best) => !best || violations<best.violations ||
  violations===best.violations && cost<best.cost-1e-7;

function optimizeTrack(track,settings) {
  const solution=[];
  for (const [index,cell] of track.entries()) {
    const {frame,p,options,rules,choice}=cell;
    const previous=solution[index-1];
    const costs=new Array(options.length);
    // Visit the current choice first so equal candidates need no edit.
    for (const i of [choice,...options.keys()].filter((n,k)=>k===0 || n!==choice)) {
      const option=options[i];
      frame.state[p]=option.id;
      const values=rules.map(rule=>i===choice ? rule.current : measure(frame.state,frame.w,rule.bounds,rule));
      if (values.some(({violations,present},k)=>violations>rules[k].current.violations ||
          (present & rules[k].current.present)!==rules[k].current.present)) continue;
      const violations=values.reduce((sum,value)=>sum+value.violations,0), cost=edgeCost(frame,cell,option,settings);
      if (!previous) costs[i]={violations,cost,values};
      else for (let j=0;j<previous.length;j++) {
        const prior=previous[j];
        if (!prior) continue;
        const total=cost+prior.cost+(option.id===track[index-1].options[j].id ? 0 : settings.temporal);
        const tally=violations+prior.violations;
        if (better(tally,total,costs[i])) costs[i]={violations:tally,cost:total,values,previous:j};
      }
    }
    frame.state[p]=options[choice].id;
    solution.push(costs);
  }
  const tail=solution.at(-1);
  let best=track.at(-1).choice, changed=0;
  for (const [i,option] of tail.entries())
    if (option && better(option.violations,option.cost,tail[best])) best=i;
  for (let i=track.length-1;i>=0;i--) {
    const cell=track[i], option=solution[i][best];
    if (best!==cell.choice) changed++;
    cell.choice=best;
    cell.frame.state[cell.p]=cell.options[best].id;
    for (const [j,rule] of cell.rules.entries()) rule.current=option.values[j];
    best=option.previous;
  }
  return changed;
}

function optimize(frames,settings) {
  const tracks=[];
  for (const frame of frames) for (const cell of frame.cells.values()) {
    cell.frame=frame;
    if (cell.previous) continue;
    const track=[];
    for (let step=cell;step;step=step.next) track.push(step);
    tracks.push(track);
  }
  for (let pass=0;pass<settings.steps;pass++) {
    let changed=0;
    for (const track of tracks) changed+=optimizeTrack(track,settings);
    if (!changed) break;
    tracks.reverse();
  }
}

function solve(input,settings) {
  const labels=catalog(settings), frames=input.map(({native,detail})=>candidates(native,detail,settings,labels));
  function switches() {
    let count=0;
    for (const frame of frames) for (const cell of frame.cells.values())
      if (cell.previous && cell.options[cell.choice].id!==cell.previous.options[cell.previous.choice].id) count++;
    return count;
  }
  for (const [i,frame] of frames.entries()) {
    if (i) connect(frames[i-1],frame);
    frame.rules=bindRules(frame,settings,labels.entries,i);
  }
  const before=switches();
  optimize(frames,settings);
  return {
    frames:frames.map(frame=>({
      edits:[...frame.cells.values()].filter(cell=>cell.choice).map(cell=>[cell.p,cell.options[cell.choice].donor]),
      kinds:frame.counts,
      constraints:frame.rules.map(rule=>({id:rule.id,status:rule.status,before:rule.before,after:rule.current.violations}))
    })),
    transitions:{before,after:switches()}
  };
}

module.exports={channels,prepare,solve};
