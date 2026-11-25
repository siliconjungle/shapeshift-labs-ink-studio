// Native pixel editing on the captured surface cells of a rigid prop.
const format='ink-studio/object-texel-edit';
const channels=['pigment','normal','roughness','metalness','emission'];
const brushKeys=['ids','face','points','tip','values','scope'];
const commands={select:['seed','at','mode'],protect:['ids','locked'],brush:brushKeys,preview:brushKeys,undo:[],redo:[]};
const order=ids=>[...ids].sort((a,b)=>a-b);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype &&
  Object.keys(row).every(key=>keys.includes(key));
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const rgb=(bytes,i)=>bytes[i]*65536+bytes[i+1]*256+bytes[i+2];

function material(bake,id) {
  return {pigment:rgb(bake.rgba,id*4),normal:Array.from(bake.normal.subarray(id*4,id*4+3),n=>(n-128)/127),
    roughness:bake.roughness[id]/255,metalness:bake.metalness[id]/255,emission:rgb(bake.emission,id*3)};
}

function adjacent(bake) {
  const {points,triangles,triangleCells}=bake, neighbors=new Map(), lines=new Map();
  if (!triangleCells.length) return neighbors;
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for (let i=0;i<points.length;i++) {
    const k=i%3;
    min[k]=Math.min(min[k],points[i]); max[k]=Math.max(max[k],points[i]);
  }
  const extent=Math.max(...max.map((n,i)=>n-min[i]));
  const point=i=>[0,1,2].map(k=>(points[i*3+k]-min[k])/extent);
  const dot=(a,b)=>a.reduce((n,value,i)=>n+value*b[i],0);
  const connect=(a,b)=>{
    if (!neighbors.has(a)) neighbors.set(a,new Set());
    neighbors.get(a).add(b);
  };
  for (let f=0;f<triangleCells.length;f++) {
    const id=triangleCells[f];
    const corners=[0,1,2].map(i=>point(triangles[f*3+i]));
    for (let i=0;i<3;i++) {
      const a=corners[i],b=corners[(i+1)%3], delta=b.map((n,k)=>n-a[k]);
      const length=Math.hypot(...delta);
      if (length<=1e-8) continue;
      const unit=delta.map(n=>n/length), sign=Math.sign(unit.find(n=>Math.abs(n)>1e-7));
      const dir=unit.map(n=>n*sign), along=dot(a,dir), perpendicular=a.map((n,k)=>n-along*dir[k]);
      const key=[...dir,...perpendicular].map(n=>Math.round(n*1e7)).join(',');
      if (!lines.has(key)) lines.set(key,[]);
      lines.get(key).push({id,lo:sign>0?along:along-length,hi:sign>0?along+length:along});
    }
  }
  let checks=0;
  // Clipping can split one side of a common edge into several segments.
  // Follow positive-length overlap on the same line, including at cube seams.
  for (const spans of lines.values()) {
    if (spans.length<2) continue;
    spans.sort((a,b)=>a.lo-b.lo || a.hi-b.hi || a.id-b.id);
    let active=[];
    for (const span of spans) {
      active=active.filter(row=>row.hi-span.lo>1e-8);
      if ((checks+=active.length)>4000000) throw new RangeError('Object texel cluster exceeds the shared-edge budget');
      for (const other of active) if (span.id!==other.id) {
        connect(span.id,other.id); connect(other.id,span.id);
      }
      active.push(span);
    }
  }
  return neighbors;
}

function bindingKey(K,bake) {
  const {hash}=K.procedural.data;
  const shape=[bake.width,bake.height,bake.resolution,bake.points,bake.triangles,bake.cells,Array.from(bake.triangleCells)];
  let revision=JSON.stringify(shape);
  for (const name of ['rgba','normal','roughness','metalness','emission'])
    revision+=';'+Array.from(bake[name]).join(',');
  return [revision.length,hash(revision),hash(revision,0x9e3779b9)].map(n=>n.toString(36)).join('-');
}

export function createEditor(base,{KIT:K,session,historyLimit=session?.historyLimit??32}={},core) {
  if (!K?.authoring?.document || !K.sceneMeshes?.objectTexelFrame || !int(historyLimit,1,128))
    throw new TypeError('Object texel editing needs Ink KIT and a history limit from 1 to 128');
  const binding=bindingKey(K,base);
  const initial={format:'ink-studio/authoring',version:1,id:'object-texels',seed:1,nextId:1,
    entities:{},styles:{},environment:{binding,selection:[],protected:order(core.protected),edits:[]}};
  const doc=K.authoring.document(initial,{historyLimit});
  function checkIds(ids) {
    if (!Array.isArray(ids) || ids.length>base.cells.length || new Set(ids).size!==ids.length ||
        !Array.from(ids).every(id=>int(id,0,base.cells.length-1)&&base.cells[id]))
      throw new RangeError('Choose distinct occupied object texel cell IDs');
    return ids;
  }
  if (session!==undefined) doc.restoreSession(session,snapshot=>{
    const env=snapshot.environment;
    if (snapshot.id!==initial.id || !fields(env,['binding','selection','protected','edits']) ||
        env.binding!==binding || !Array.isArray(env.edits) || Object.keys(snapshot.entities).length ||
        Object.keys(snapshot.styles).length) throw new RangeError('Object texel session does not match this bake revision');
    for (const ids of [env.selection,env.protected,env.edits.map(row=>row?.id)]) checkIds(ids);
    for (const {id,...sample} of env.edits) core.validate(sample);
  });
  const env=()=>doc.snapshot().environment;
  const status=()=>({binding,revision:doc.revision(),selection:env().selection,protected:env().protected,
    editedCells:env().edits.length,history:doc.history()});
  let graph,snapshot,cached;
  function bake() {
    const state=env();
    if (state!==snapshot) {
      cached=core.edit(state.edits,state.protected);
      snapshot=state;
    }
    return cached;
  }
  const address=(face,x,y)=>((face/3|0)*base.resolution+y)*base.width+(face%3)*base.resolution+x;
  const facePoint=point=>Array.isArray(point)&&point.length===2&&Array.from(point).every(n=>int(n,0,base.resolution-1));
  const commit=(label,patch)=>doc.transact(label,()=>doc.setEnvironment(patch));

  function select({seed,at,mode='pigment'}={}) {
    if ((seed===undefined)===(at===undefined) || !['pigment','surface'].includes(mode) ||
        at!==undefined && (!Array.isArray(at)||at.length!==3||!int(at[0],0,5)||!facePoint(at.slice(1))))
      throw new TypeError('Select an object texel cluster by cell ID or [face,x,y]');
    const id=seed ?? address(...at), cells=checkIds([id]), visited=new Set(cells), image=bake();
    const pigment=rgb(image.rgba,id*4);
    graph??=adjacent(base);
    for (let i=0;i<cells.length;i++) for (const next of graph.get(cells[i]) ?? []) {
      if (visited.has(next) || mode==='pigment' && rgb(image.rgba,next*4)!==pigment) continue;
      visited.add(next);
      cells.push(next);
    }
    const selection=order(visited);
    commit('Select texel cluster',{selection});
    return {seed:id,mode,selection};
  }

  function protect({ids=env().selection,locked=true}={}) {
    if (typeof locked!=='boolean') throw new TypeError('Use a boolean protection setting');
    const cells=new Set(env().protected);
    for(const id of checkIds(ids)) locked ? cells.add(id) : cells.delete(id);
    const protectedIds=order(cells);
    commit(locked?'Protect texels':'Unlock texels',{protected:protectedIds});
    return {protected:protectedIds};
  }

  function brushPlan({ids,face,points,tip,values={},scope='selection'}={}) {
    if (!fields(values,channels) || !['selection','all'].includes(scope) ||
        ids!==undefined&&(face!==undefined||points!==undefined||tip!==undefined) ||
        face===undefined&&(points!==undefined||tip!==undefined) || !tip&&!Object.keys(values).length)
      throw new TypeError('Paint object texels with channel values, optional face stroke and native brush tip');
    core.validate(values);
    if (ArrayBuffer.isView(values.normal)) values={...values,normal:Array.from(values.normal)};
    const touched=new Map();
    if (face===undefined) for (const id of checkIds(ids ?? env().selection)) touched.set(id,values);
    else {
      if (!int(face,0,5)||!Array.isArray(points)||!points.length||points.length>4096||!Array.from(points).every(facePoint))
        throw new RangeError('A texel brush path needs native points on one capture face');
      const brush=tip && K.pixelBrushes.validate(tip), r=base.resolution;
      K.pixelBrushes.stroke(r,r,brush?K.pixelBrushes.footprint(brush):[[0,0,0]],points,(p,slot)=>{
        const id=address(face,p%r,p/r|0);
        const swatch=brush&&(brush.settings.swatch.mode==='tint'?brush.settings.swatch:brush.palette[slot]);
        const paint=swatch ? {pigment:Number.parseInt(swatch.color.slice(1),16),...values} : values;
        touched.set(id,paint);
      });
    }
    const selection=scope==='selection' && new Set(env().selection), locked=new Set(env().protected);
    const current=bake(), pending=[], skipped=[];
    for (const id of order(touched.keys())) {
      const reason=!base.cells[id]?'empty':locked.has(id)?'protected':selection && !selection.has(id)?'outside-selection':null;
      if (reason) skipped.push({id,reason});
      else pending.push({id,...touched.get(id)});
    }
    // Use the same byte encoding as the per-cell API for previews and commits.
    const beforeEdits=new Map(env().edits.map(row=>[row.id,row])), edits=new Map(beforeEdits);
    for(const row of pending) edits.set(row.id,{...edits.get(row.id),...row});
    const proposed=core.edit([...edits.values()],[]);
    const changed=[];
    for(const row of pending) {
      const before=material(current,row.id), after=material(proposed,row.id);
      if (!same(before,after)) changed.push({id:row.id,before,after});
      else if (beforeEdits.has(row.id)) edits.set(row.id,beforeEdits.get(row.id));
      else edits.delete(row.id);
    }
    return {receipt:{format,version:1,binding,revision:doc.revision(),changed,skipped},
      edits:order(edits.keys()).map(id=>edits.get(id))};
  }

  function watch(mesh,frame) {
    const {w,h,cellAt}=K.sceneMeshes.objectTexelFrame(mesh,frame,base);
    const visible=new Map(), selection=new Set(env().selection), locks=new Set(env().protected), mask=new Uint8Array(w*h);
    for (let p=0;p<cellAt.length;p++) {
      const id=cellAt[p];
      if (id<0) continue;
      visible.set(id,(visible.get(id) ?? 0)+1);
      if (selection.has(id)) mask[p]=locks.has(id)?2:1;
    }
    return {w,h,cellAt,mask,visible:order(visible.keys()).map(id=>({id,pixels:visible.get(id)})),
      hidden:env().selection.filter(id=>!visible.has(id))};
  }

  function execute(command) {
    if (!Object.hasOwn(commands,command?.op) || !fields(command,['op','revision',...commands[command.op]]))
      throw new TypeError('Use an object texel select, protect, brush, preview, undo or redo command');
    if (command.revision!==undefined && command.revision!==doc.revision())
      throw new RangeError('Object texel command was authored against a different edit revision');
    const {op,...input}=command;
    if (op==='select') return select(input);
    if (op==='protect') return protect(input);
    if (op==='undo'||op==='redo') return {changed:doc[op](),...status()};
    const plan=brushPlan(input);
    if (op==='brush' && plan.receipt.changed.length) commit('Brush object texels',{edits:plan.edits});
    return {...plan.receipt,outputRevision:doc.revision()};
  }
  return Object.freeze({status,bake,watch,execute,apply:mesh=>K.sceneMeshes.updateObjectTexels(mesh,bake()),
    exportSession:()=>doc.exportSession(),onSessionChange:listener=>doc.onSessionChange(listener)});
}
