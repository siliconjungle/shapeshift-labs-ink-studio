const { fields, range, vector, rad }=require('./character-rig-assembly.js');
const { controlsAt,poseAt,timeline,getClip }=require('./character-motion.js');
const { solveMotion }=require('./character-rig-solve.js');

const zero=[0,0,0], up=[0,1,0];
const integer=(n,a,b)=>Number.isSafeInteger(n)&&range(n,a,b);
const at=(values,i)=>values.slice(i*3,i*3+3);
const clamp=n=>Math.max(0,Math.min(1,n));

function terrain(spec, asset, K) {
  if(!fields(spec,['plane','tile','outside','bounds'])||(spec.plane===undefined)===(spec.tile===undefined)||
      !range(spec.plane??0,-1e4,1e4)||!range(spec.outside??0,-1e4,1e4)||
      !vector(spec.bounds??[-8,8,-8,8],4)||spec.bounds&&
        (spec.bounds[0]>=spec.bounds[1]||spec.bounds[2]>=spec.bounds[3]))
    throw new TypeError('Use a crowd terrain plane or a baked tile');
  if(spec.tile===undefined){
    const {plane}=spec,[x0,x1,z0,z1]=spec.bounds??[-8,8,-8,8];
    return {height:()=>plane,points:[[x0,plane,z0],[x1,plane,z0],[x0,plane,z1],[x1,plane,z1]],
      faces:[[0,2,1],[1,2,3]]};
  }
  const tile=asset(spec.tile,'terrain');
  const mesh=K.procedural.terrainSet.mesh(tile), side=tile.tileCells+1;
  const [x0,,z0]=mesh.points[0], step=tile.cell, edges=side-1;
  function height(x,z) {
    const a=(x-x0)/step, b=(z-z0)/step;
    if(a<0||a>edges||b<0||b>edges)return spec.outside??0;
    const i=Math.min(edges-1,Math.floor(a)),j=Math.min(edges-1,Math.floor(b)),u=a-i,v=b-j,k=j*side+i;
    const [h0,h1,h2,h3]=[k,k+1,k+side,k+side+1].map(index=>tile.heights[index]);
    return u+v<=1?h0+(h1-h0)*u+(h2-h0)*v:h3+(h2-h3)*(1-u)+(h1-h3)*(1-v);
  }
  return {height,points:mesh.points,faces:mesh.faces};
}

function templateMotion(rig,catalog,settings,K) {
  const {feet=[],rootAllowance=[.18,.46,.18],ragdoll={}}=settings;
  if(!Array.isArray(feet)||feet.length>8||!vector(rootAllowance,3,0,3)||
      !fields(ragdoll,['gravity','damping','friction','radius','substeps','bend'])||
      !vector(ragdoll.gravity??[0,-9.8,0],3,-100,100)||!range(ragdoll.damping??2.2,0,40)||
      !range(ragdoll.friction??.42,0,1)||!range(ragdoll.radius??.075,.005,1)||
      !integer(ragdoll.substeps??8,1,12)||!range(ragdoll.bend??.002,0,1))
    throw new RangeError('Invalid crowd contact or ragdoll settings');
  const named=new Set();
  for(const f of feet){
    if(!fields(f,['joint','offset','always','tolerance','weight'])||!rig.indices.has(f.joint)||named.has(f.joint)||
        !vector(f.offset??zero)||f.always!==undefined&&typeof f.always!=='boolean'||
        !range(f.tolerance??.025,.001,1)||!range(f.weight??4,.01,100))
      throw new TypeError('Crowd contact feet need distinct joints and bounded settings');
    named.add(f.joint);
  }
  const clips=new Map([...catalog.clips.values()].map(clip=>[clip.name,{clip,contacts:timeline(catalog,clip).contacts}]));
  function animator(actor,fps,ground){
    const dt=1/fps,{M,V}=K, {yaw=0,velocity=zero,at:start}=actor;
    const rotation=M.rot(up,yaw*rad), inverse=M.tr(rotation), plants=new Map();
    const events=[{frame:0,clip:actor.clip,phase:actor.phase??0,loop:actor.loop??true,blend:0},...(actor.transitions??[])];
    let event=0, previous, fall;
    const age=(s,frame)=> (frame-s.frame)*dt+(s.phase??0);
    function clipPose(s,frame){
      const {clip,contacts}=clips.get(s.clip);
      const source=age(s,frame), time=(s.loop??true)?source%clip.duration:Math.min(clip.duration,source);
      const controls=controlsAt(catalog,clip,time);
      return {controls,active:new Set(contacts.filter(row=>time>=row.start&&time<=row.end).map(row=>row.joint)),time};
    }
    function playback(frame){
      while(events[event+1]?.frame<=frame)event++;
      const current=events[event], incoming=clipPose(current,frame);
      const progress=current.blend?clamp((frame-current.frame)/current.blend):1;
      const weight=progress*progress*(3-2*progress);
      const outgoing=weight<1?clipPose(events[event-1],frame):null;
      const controls=incoming.controls;
      if(outgoing){
        for(const name of new Set([...controls.keys(),...outgoing.controls.keys()])){
          const a=outgoing.controls.get(name),b=controls.get(name);
          controls.set(name,(a??b).map((_,i)=>K.mix(a?.[i]??0,b?.[i]??0,weight)));
        }
      }
      const time=frame*dt;
      const origin=V.mad(start,velocity,time);
      origin[1]+=ground.height(origin[0],origin[2]);
      const unposed=poseAt(rig,controls,[],time,zero,K);
      const active=outgoing&&weight<.5?outgoing.active:incoming.active;
      const point=(pose,joint,offset)=>V.add(pose.joints[joint].position,M.app(pose.joints[joint].matrix,offset));
      const toWorld=p=>V.add(M.app(rotation,p),origin);
      const local=p=>M.app(inverse,V.sub(p,origin));
      const goals=[], locks=[];
      for(const [i,{joint,offset=zero,always=false,tolerance=.025,weight=4}] of feet.entries()){
        const raw=toWorld(point(unposed,joint,offset)), planted=always||active.has(joint);
        if(!planted)plants.delete(joint);
        else if(!plants.has(joint))plants.set(joint,[raw[0],raw[2]]);
        const [x,z]=plants.get(joint)??[raw[0],raw[2]], y=ground.height(x,z);
        if(!planted&&raw[1]>=y-.003)continue;
        const goal=[x,y,z];
        goals.push({id:'foot-'+i,joint,offset,at:local(goal),tolerance,weight});
        locks.push({joint,offset,planted,target:goal,tolerance,raw});
      }
      const pose=goals.length?solveMotion(rig,goals,{angles:unposed.angles,root:unposed.rootTranslation},rootAllowance,K):unposed;
      const contacts=locks.map(({joint,offset,target,raw,...rest})=>{
        const actual=toWorld(point(pose,joint,offset)), error=V.dist(actual,target);
        return {joint,target,actual,raw,error,...rest,passed:error<=rest.tolerance};
      });
      const points=rig.joints.flatMap(joint=>toWorld(pose.joints[joint.id].position));
      const matrices=rig.joints.flatMap(joint=>{
        const local=pose.joints[joint.id].matrix;
        return [...M.mul(rotation,local),...toWorld(local.slice(9))];
      });
      return {mode:'clip',clip:current.clip,from:outgoing?events[event-1].clip:null,phase:incoming.time,blend:weight,
        points,matrices,angles:pose.angles,contacts};
    }

    function collapse(handoff,frame){
      const {gravity=[0,-9.8,0],damping=2.2,friction=.42,radius=.075,substeps=8,bend=.002}=ragdoll;
      const sim=K.xpbd.sim({gravity,damp:damping,substeps,fixedStep:true,project(i,p,prior){
        if(p[1]>=ground.height(p[0],p[2])+radius)return;
        const x=K.mix(p[0],prior[0],friction),z=K.mix(p[2],prior[2],friction);
        return [x,ground.height(x,z)+radius,z];
      }});
      const impulse=actor.ragdoll.velocity??zero, hit=actor.ragdoll.joint;
      const inherited=handoff.points.map((p,i)=>previous?(p-previous.points[i])/dt:0);
      const velocity=inherited.map((v,i)=>v+(hit===undefined||rig.joints[Math.floor(i/3)].id===hit?impulse[i%3]:0));
      for(const [i,j] of rig.joints.entries())sim.point(at(handoff.points,i),j.parent<0?.55:1,radius);
      for(const [i,j] of rig.joints.entries()){
        const p=j.parent;
        if(p<0)continue;
        sim.link(i,p,0,0,undefined,j.length);
        const grand=rig.joints[p].parent;
        if(grand>=0&&bend>0)sim.link(i,grand,bend);
      }
      sim.restoreMotion({...sim.motion(),velocities:velocity});
      const child=rig.joints.map((_,i)=>rig.joints.map((j,k)=>[j,k]).filter(([j])=>j.parent===i)
        .sort(([a],[b])=>b.length-a.length)[0]?.[1]);
      const axis=(points,i)=>{
        const next=child[i], p=rig.joints[i].parent;
        if(next!==undefined)return V.norm(V.sub(at(points,next),at(points,i)),up);
        return p>=0?V.norm(V.sub(at(points,i),at(points,p)),up):up;
      };
      let directions=rig.joints.map((_,i)=>axis(handoff.points,i));
      let rotations=rig.joints.map((_,i)=>handoff.matrices.slice(i*12,i*12+9));
      function swing(a,b){
        const turn=V.cross(a,b),sin=V.len(turn),cos=V.dot(a,b);
        if(sin<1e-8)return cos>=0?M.id():M.rot(V.perp(a),Math.PI);
        return M.rot(V.mul(turn,1/sin),Math.atan2(sin,cos));
      }
      return {step(index){
        sim.step(dt,index*dt);
        const points=Array.from(sim.X.subarray(0,rig.joints.length*3));
        const next=rig.joints.map((_,i)=>axis(points,i));
        rotations=rotations.map((r,i)=>M.mul(swing(directions[i],next[i]),r));
        directions=next;
        const matrices=rig.joints.flatMap((j,i)=>[...rotations[i],...V.sub(at(points,i),M.app(rotations[i],j.at))]);
        const contacts=rig.joints.flatMap(({id},i)=>{
          const p=at(points,i),floor=ground.height(p[0],p[2])+radius;
          return p[1]<=floor+.003?[{joint:id,actual:p,target:[p[0],floor,p[2]],error:Math.max(0,floor-p[1]),passed:p[1]>=floor-.003}]:[];
        });
        const boneDrift=Math.max(0,...rig.joints.flatMap((j,i)=>j.parent<0?[]:
          [Math.abs(V.dist(at(points,i),at(points,j.parent))-j.length)]));
        return {mode:'ragdoll',clip:handoff.clip,points,matrices,angles:handoff.angles,contacts,boneDrift};
      },handoff:{frame,inheritedSpeed:Math.max(...rig.joints.map((_,i)=>V.len(at(inherited,i)))),
        launchSpeed:Math.max(...rig.joints.map((_,i)=>V.len(at(velocity,i))))}};
    }

    return {step(frame){
      if(fall)return fall.step(frame);
      const pose=playback(frame);
      if(actor.ragdoll?.frame===frame){
        fall=collapse(pose,frame);
        return {...pose,mode:'ragdoll',handoff:{...fall.handoff,snap:0}};
      }
      previous=pose;
      return pose;
    }};
  }
  function validate(actor,frames) {
    if(!clips.has(actor.clip)||!range(actor.phase??0,0,600)||actor.loop!==undefined&&typeof actor.loop!=='boolean'||
        !vector(actor.at)||!vector(actor.velocity??zero,3,-50,50)||!range(actor.yaw??0,-3600,3600)||
        !Array.isArray(actor.transitions??[])||(actor.transitions??[]).length>24)
      throw new TypeError('Crowd actor needs an existing clip, placement and bounded motion');
    let previousEnd=0;
    for(const t of actor.transitions??[]){
      if(!fields(t,['frame','clip','phase','blend','loop'])||!integer(t.frame,Math.max(1,previousEnd+1),frames-1)||
          !clips.has(t.clip)||!range(t.phase??0,0,600)||!integer(t.blend??0,0,frames-t.frame-1)||
          t.loop!==undefined&&typeof t.loop!=='boolean')
        throw new RangeError('Crowd transitions need ordered non-overlapping frame intervals and known clips');
      previousEnd=t.frame+(t.blend??0);
    }
    if(actor.ragdoll!==undefined&&(!fields(actor.ragdoll,['frame','joint','velocity'])||
        !integer(actor.ragdoll.frame,1,frames-1)||actor.ragdoll.joint!==undefined&&!rig.indices.has(actor.ragdoll.joint)||
        !vector(actor.ragdoll.velocity??zero,3,-60,60)||actor.transitions?.some(t=>t.frame>actor.ragdoll.frame)))
      throw new TypeError('Invalid ragdoll handoff on '+actor.id);
  }
  return {animator,validate};
}

module.exports={terrain,templateMotion,integer};
