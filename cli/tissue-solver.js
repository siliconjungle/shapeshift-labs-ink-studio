const { fields, record, range, vector, localName }=require('./character-rig-assembly.js');
const integer=(n,a,b)=>Number.isSafeInteger(n)&&range(n,a,b);
const zero=[0,0,0];
const at=(values,i)=>[values[i*3],values[i*3+1],values[i*3+2]];
const clamp=n=>Math.max(0,Math.min(1,n));

function prepare(source, rig, K) {
  const {V,M}=K;
  if (!fields(source,['format','version','id','nodes','cells','muscles','skin','edgeCompliance','volumeCompliance','damping','gravity','substeps','volumePasses'])||
      source.format!=='ink-studio/tissue-model'||source.version!==1||!localName(source.id)||
      !record(source.nodes)||!integer(Object.keys(source.nodes).length,4,192)||
      !Array.isArray(source.cells)||!integer(source.cells.length,1,384)||
      !Array.isArray(source.muscles??[])||(source.muscles??[]).length>96)
    throw new TypeError('Expected a version 1 tissue model with bounded nodes, cells and muscles');
  const {skin={},edgeCompliance=8e-5,volumeCompliance=2e-6,damping=5,gravity=zero,substeps=6,volumePasses=2}=source;
  if (!fields(skin,['gain','maxOffset'])||!range(skin.gain??1,0,4)||!range(skin.maxOffset??.5,.001,10)||
      !range(edgeCompliance,0,1)||!range(volumeCompliance,0,1)||!range(damping,0,60)||
      !vector(gravity,3,-50,50)||!integer(substeps,1,12)||!integer(volumePasses,1,6)) throw new RangeError('Invalid tissue solver or skin settings');
  const nodes=Object.entries(source.nodes).map(([id,row])=>{
    if (!localName(id)||!fields(row,['at','weights','pin','mass','follow'])||!vector(row.at)||
        !record(row.weights)||!integer(Object.keys(row.weights).length,1,4)||
        row.pin!==undefined&&typeof row.pin!=='boolean'||!range(row.mass??1,.001,100)||
        !range(row.follow??.005,0,1)) throw new TypeError('Invalid tissue node '+id);
    const raw=Object.entries(row.weights), total=raw.reduce((n,[,weight])=>n+weight,0);
    if (!(total>0)||raw.some(([joint,w])=>!rig.indices.has(joint)||!range(w,0,1e5)))
      throw new RangeError('Tissue driver weights need named joints and positive total weight');
    return {id,rest:row.at,weights:raw.map(([joint,w])=>[rig.indices.get(joint),w/total]),
      pin:row.pin??false,mass:row.mass??1,follow:row.follow??.005};
  });
  const indices=new Map(nodes.map(({id},i)=>[id,i])), edges=new Map();
  const key=(a,b)=>Math.min(a,b)+':'+Math.max(a,b);
  const determinant=(a,b,c)=>V.dot(a,V.cross(b,c));
  const signed=([a,b,c,d])=>determinant(V.sub(b,a),V.sub(c,a),V.sub(d,a));
  const cellKeys=new Set();
  const cells=source.cells.map(row=>{
    if (!fields(row,['nodes','compliance'])||!Array.isArray(row.nodes)||row.nodes.length!==4||
        new Set(row.nodes).size!==4||!row.nodes.every(id=>indices.has(id))||
        !range(row.compliance??volumeCompliance,0,1)) throw new TypeError('Tissue cells need four named nodes');
    const corners=row.nodes.map(id=>indices.get(id)), cellKey=corners.slice().sort((a,b)=>a-b).join(',');
    if(cellKeys.has(cellKey))throw new RangeError('Duplicate tissue cell');
    cellKeys.add(cellKey);
    const rest=corners.map(i=>nodes[i].rest), volume=signed(rest);
    if(Math.abs(volume)<1e-8)throw new RangeError('Collapsed rest tissue cell');
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)edges.set(key(corners[i],corners[j]),[corners[i],corners[j]]);
    const [a,b,c,d]=rest,e=V.sub(b,a),f=V.sub(c,a),g=V.sub(d,a);
    const inverse=[V.cross(f,g),V.cross(g,e),V.cross(e,f)].map(p=>V.mul(p,1/volume));
    return {corners,volume,compliance:row.compliance??volumeCompliance,anchor:a,inverse};
  });
  const ids=new Set(), fibers=new Set();
  const muscles=(source.muscles??[]).map(row=>{
    if (!fields(row,['id','from','to','contraction','compliance','activation','driver'])||!localName(row.id)||ids.has(row.id)||
        row.from===row.to||!indices.has(row.from)||!indices.has(row.to)||
        !range(row.contraction??.26,0,.65)||!range(row.compliance??.00002,0,1)||
        !range(row.activation??0,0,1)||row.driver!==undefined&&row.activation!==undefined)
      throw new TypeError('Invalid contractile tissue fiber');
    ids.add(row.id);
    const a=indices.get(row.from),b=indices.get(row.to),length=V.dist(nodes[a].rest,nodes[b].rest), edge=key(a,b);
    if(length<1e-5||fibers.has(edge))throw new RangeError('Tissue fibers need distinct nonzero segments');
    fibers.add(edge);
    let activation=()=>row.activation??0;
    if(row.driver!==undefined){
      const d=row.driver,joint=rig.joints[rig.indices.get(d?.joint)];
      if(!fields(d,['joint','axis','range'])||!joint||!integer(d.axis,0,joint.dofs.length-1)||
          !vector(d.range,2,-180,180)||d.range[0]===d.range[1])
        throw new RangeError('A muscle driver needs a joint control and distinct activation bounds');
      activation=controls=>clamp(((controls[d.joint]?.[d.axis]??0)-d.range[0])/(d.range[1]-d.range[0]));
    }
    return {id:row.id,a,b,length,contraction:row.contraction??.26,compliance:row.compliance??.00002,activation};
  });

  function base(matrices,node){
    return node.weights.reduce((p,[index,w])=>{
      const m=matrices.slice(index*12,index*12+12);
      return V.mad(p,V.add(M.app(m,node.rest),m.slice(9)),w);
    },zero);
  }

  function open(pose,dt) {
    let targets=nodes.map(node=>base(pose.matrices,node)), last=targets, current=muscles.map(fiber=>fiber.activation(pose.angles));
    let previous=current, intervalStart=0;
    const h=dt/substeps;
    const delta=time=>clamp((time-intervalStart)/dt);
    const sim=K.xpbd.sim({gravity,damp:damping,substeps,fixedStep:true,substepPins:true,
      projectBatch(X,_,mass){
        for(let pass=0;pass<volumePasses;pass++)for(const cell of cells){
          const [a,b,c,d]=cell.corners.map(i=>at(X,i)),e=V.sub(b,a),f=V.sub(c,a),g=V.sub(d,a);
          const gradients=[V.cross(f,g),V.cross(g,e),V.cross(e,f)].map(v=>V.mul(v,1/cell.volume));
          gradients.unshift(V.mul(gradients.reduce(V.add,zero),-1));
          const error=determinant(e,f,g)/cell.volume-1;
          const denominator=cell.compliance/(h*h)+gradients.reduce((n,v,i)=>n+mass[cell.corners[i]]*V.dot(v,v),0);
          if(denominator<1e-12)continue;
          for(const [i,index] of cell.corners.entries())X.set(V.mad(at(X,index),gradients[i],-mass[index]*error/denominator),index*3);
        }
      }});
    for(const [i,node] of nodes.entries()){
      sim.point(node.rest,node.pin?0:1/node.mass,0);
      const goal=time=>V.lerp(last[i],targets[i],delta(time));
      if(node.pin)sim.pin(i,goal);
      else sim.tie(i,goal,node.follow);
    }
    for(const [id,[a,b]] of edges)if(!fibers.has(id))sim.link(a,b,edgeCompliance);
    muscles.forEach(({a,b,length,contraction,compliance},i)=>
      sim.link(a,b,compliance,0,undefined,time=>length*(1-contraction*K.mix(previous[i],current[i],delta(time)))));
    sim.resetPose(targets.flat());
    function capture(){
      const ratios=cells.map(cell=>signed(cell.corners.map(i=>at(sim.X,i)))/cell.volume);
      const offsets=targets.flatMap((p,i)=>V.sub(at(sim.X,i),p));
      if(!offsets.every(Number.isFinite)||!ratios.every(Number.isFinite))throw new RangeError('Tissue exceeded its finite solver bounds');
      return {offsets,volume:{min:Math.min(...ratios),max:Math.max(...ratios),inverted:ratios.filter(n=>n<=0).length},
        muscles:muscles.map(({id,a,b,length},i)=>({id,activation:current[i],length:V.dist(at(sim.X,a),at(sim.X,b)),rest:length}))};
    }
    return {capture,step(pose,time){
      intervalStart=time-dt;
      last=targets; targets=nodes.map(node=>base(pose.matrices,node));
      previous=current; current=muscles.map(fiber=>fiber.activation(pose.angles));
      sim.step(dt,time);
      return capture();
    }};
  }

  function bind(positions){
    if(positions.length/3*cells.length>4000000)throw new RangeError('Tissue skin binding exceeds its point and cell budget');
    const bindings=Array.from({length:positions.length/3},(_,i)=>{
      const p=at(positions,i);
      for(const cell of cells){
        const q=V.sub(p,cell.anchor), weights=cell.inverse.map(row=>V.dot(q,row));
        weights.unshift(1-weights.reduce((n,w)=>n+w,0));
        if(weights.every(w=>w>=-1e-6&&w<=1+1e-6))
          return {corners:cell.corners,weights};
      }
      return null;
    });
    const count=bindings.filter(Boolean).length, gain=skin.gain??1, cap=skin.maxOffset??.5;
    return {count,apply(pos,offsets){
      if(!offsets)return {positions:pos,maxOffset:0};
      let maxOffset=0;
      for(const [i,binding] of bindings.entries()){
        if(!binding)continue;
        const move=binding.corners.reduce((p,node,j)=>V.mad(p,at(offsets,node),binding.weights[j]),zero);
        const length=V.len(move)*gain, applied=Math.min(length,cap);
        if(length>1e-10)pos.set(V.mad(at(pos,i),move,gain*applied/length),i*3);
        maxOffset=Math.max(maxOffset,applied);
      }
      return {positions:pos,maxOffset};
    }};
  }
  return {open,bind,nodes:nodes.length,cells:cells.length,muscles:muscles.length};
}

module.exports={prepare};
