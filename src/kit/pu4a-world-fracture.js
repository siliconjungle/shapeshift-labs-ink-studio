/* Progressive seam failure and continuous handoff to native rigid assemblies. */
(function (K) {
  const W=K.world, Q=W.query, P=K.procedural, {V,M}=K;
  const {check,record,own,vector}=W.data, {freeze}=P.data;
  const zero=[0,0,0], identity=M.id();
  const finite=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const limited=(n,limit)=>Math.max(-limit,Math.min(limit,n));
  const weightSum=(rows,fn)=>rows.reduce((sum,name)=>sum+fn(name),0);
  const pointAt=(body,point)=>V.add(body.position,M.app(body.rotation,point));
  const speedAt=(body,point)=>V.add(body.velocity,V.cross(body.angular,V.sub(point,body.position)));
  const asBody=(id,pose,collider,mass,fixed,material,look)=>({
    id, entity:id, origin:id, ...pose, collider, half:W.colliders.local(collider).half, mass, fixed, material, look
  });

  function materialFailure(config,env) {
    check(keys(config,['plan','ground','gravity','drag','contactIterations','motionRate','skin']),
      'Unknown material failure configuration');
    const prepared=P.fracture.prepare(config.plan), {cells,bonds,materials}=prepared, names=Object.keys(cells);
    const {ground=prepared.bounds.min[1]-2,gravity=[0,-9.81,0],drag=.08,contactIterations=12,
      motionRate=8,skin=.001}=config;
    check(finite(ground,-1000,prepared.bounds.min[1]+1e-8) && vector(gravity) &&
      gravity.every(n=>finite(n,-100,100)) && finite(drag,0,20) && finite(motionRate,.05,30) && finite(skin,.00001,.05),
      'Invalid material failure motion or collision settings');
    const mechanics=W.mechanics.create({continuous:true,ground,gravity,drag,contactIterations},env);
    const empty=mechanics.initial({world:env.world}), byName=new Map(bonds.map(row=>[row.id,row]));
    const cellColliders=Object.fromEntries(names.map(name=>{
      const hull=cells[name].hull;
      return [name,{...hull,vertices:hull.vertices.map(point=>V.mul(point,1-skin))}];
    }));
    const rank=new Map(names.map((name,i)=>[name,i]));
    const nativeName=(members,tick)=>'island.'+rank.get(members[0])+'.'+tick;
    const heldName=name=>'held.'+rank.get(name);

    function summarize(members,property,get) {
      const mass=weightSum(members,name=>cells[name].mass);
      return members.reduce((sum,name)=>V.mad(sum,get(name)[property],cells[name].mass/mass),zero);
    }

    function angularTerms(members,poses,center) {
      const inertia=Array(9).fill(0);
      let momentum=zero;
      for(const name of members){
        const {mass,inertia:local}=cells[name], {position,rotation,velocity,angular}=poses[name];
        const tensor=M.mul(rotation,M.mul(local,M.tr(rotation))), offset=V.sub(position,center), r2=V.dot(offset,offset);
        for(let i=0;i<3;i++)for(let j=0;j<3;j++)
          inertia[i*3+j]+=tensor[i*3+j]+mass*((i===j?r2:0)-offset[i]*offset[j]);
        momentum=V.add(momentum,V.add(M.app(tensor,angular),V.cross(offset,V.mul(velocity,mass))));
      }
      return {inertia,momentum};
    }

    function topology(history) {
      const adjacency=new Map(names.map(name=>[name,[]])), components=[];
      for(const bond of bonds){
        if(history[bond.id].broken)continue;
        adjacency.get(bond.a).push({name:bond.b,bond,sign:1});
        adjacency.get(bond.b).push({name:bond.a,bond,sign:-1});
      }
      const seen=new Set();
      for(const name of names){
        if(seen.has(name))continue;
        const members=[name];
        seen.add(name);
        for(const cell of members)for(const link of adjacency.get(cell)){
          if(seen.has(link.name))continue;
          seen.add(link.name);
          members.push(link.name);
        }
        members.sort((a,b)=>rank.get(a)-rank.get(b));
        components.push({members,anchors:members.filter(name=>cells[name].anchored)});
      }
      return {components,adjacency};
    }

    function rigidIsland(id,members,poses,parent) {
      const get=name=>poses[name], position=summarize(members,'position',get);
      const rotation=parent?.body.rotation??poses[members[0]].rotation, inv=M.tr(rotation);
      const velocity=parent?speedAt(parent.body,position):summarize(members,'velocity',get);
      let angular=parent?.body.angular;
      if(!angular){
        const {inertia,momentum}=angularTerms(members,poses,position), scale=Math.max(...inertia.map(Math.abs));
        const normalized=inertia.map(n=>n/scale);
        angular=M.det(normalized)>1e-13?M.app(M.inv(normalized),V.mul(momentum,1/scale)):summarize(members,'angular',get);
      }
      const local=members.map(name=>{
        const p=poses[name];
        return {name,position:M.app(inv,V.sub(p.position,position)),rotation:M.mul(inv,p.rotation)};
      });
      const parts=local.map(({name,position,rotation})=>{
        const hull=cellColliders[name];
        return {...hull,vertices:hull.vertices.map(p=>V.add(position,M.app(rotation,p)))};
      });
      const material=cells[members[0]].material, mass=weightSum(members,name=>cells[name].mass);
      return {id,members,local,body:asBody(id,{position,rotation,velocity,angular},{kind:'compound',parts},mass,false,
        material,materials[material].look), parent:parent?.id??null};
    }

    function islandPoses(island,poses) {
      const {body}=island;
      for(const part of island.local){
        const position=pointAt(body,part.position);
        poses[part.name]={position,rotation:M.mul(body.rotation,part.rotation),
          velocity:speedAt(body,position),angular:body.angular};
      }
    }

    function initial(){
      const history=Object.fromEntries(bonds.map(({id,law})=>[id,{law,damage:0,plastic:0,bend:0,extension:0,broken:false}]));
      const poses=Object.fromEntries(names.map(name=>[name,{position:cells[name].center,rotation:identity,velocity:zero,angular:zero}]));
      const islands={};
      for(const {members,anchors} of topology(history).components){
        if(anchors.length)continue;
        const id=nativeName(members,0);
        islands[id]=rigidIsland(id,members,poses);
      }
      return freeze({history,poses,islands,loads:{},contacts:[],impactLimited:false,events:[]});
    }

    function checkAction(action,args){
      check(action==='load' && keys(args,['bond','tension','shear','bend']) && byName.has(args.bond) &&
        [args.tension??0,args.shear??0,args.bend??0].every(n=>finite(n,-1e6,1e6)),
        'A fracture load needs a known seam and bounded tension, shear and bend');
    }
    const setLoad=(state,{bond,tension=0,shear=0,bend=0})=>{
      const loads={...state.loads};
      if(tension||shear||bend)loads[bond]={tension,shear,bend};
      else delete loads[bond];
      return {...state,loads};
    };

    function advance(bond,before,loads,ctx) {
      if(before.broken)return {after:before,fractures:false,yields:false};
      const row=materials[bond.material], scale=bond.area*bond.strength, dt=ctx.dt;
      const tension=(loads?.tension??0)/(row.tensile*scale), shear=(loads?.shear??0)/(row.shear*scale),
        bend=(loads?.bend??0)/(row.flexural*scale);
      const effort=Math.max(Math.max(0,tension),Math.abs(shear),Math.abs(bend));
      const over=n=>Math.max(0,Math.abs(n)-row.yield);
      const damage=Math.min(1,before.damage+dt*row.damageRate*over(effort)/(1-row.yield));
      let plastic=before.plastic, bendTarget=0, extensionTarget=0;
      if(row.law==='ductile'){
        plastic=limited(plastic+dt*row.plasticRate*Math.sign(bend)*over(bend),row.maxBend);
        bendTarget=limited(plastic+row.elastic*bend,row.maxBend);
      }else if(row.law==='fibrous'){
        plastic=Math.min(row.maxStretch,plastic+dt*row.plasticRate*over(Math.max(0,tension)));
        extensionTarget=Math.min(row.maxStretch,plastic+row.elastic*Math.max(0,tension));
      }
      const blend=-Math.expm1(-motionRate*dt), broken=damage>=1;
      const after={law:row.law,damage,plastic,bend:before.bend+(bendTarget-before.bend)*blend,
        extension:before.extension+(extensionTarget-before.extension)*blend,broken};
      return {after,fractures:broken,yields:before.plastic===0&&plastic!==0};
    }

    function heldPoses(before,components,adjacency,history,dt,poses) {
      const targets={}, blend=-Math.expm1(-motionRate*dt);
      function visit(from,link){
        const {name,bond,sign}=link, parent=targets[from], current=history[bond.id], previous=before[name];
        const pivot=pointAt(parent,V.sub(bond.point,cells[from].center));
        const targetRotation=M.mul(parent.rotation,M.rot(bond.axis,sign*current.bend));
        const length=V.dist(cells[bond.a].center,cells[bond.b].center);
        const rest=V.sub(cells[name].center,bond.point);
        const targetPosition=V.mad(V.add(pivot,M.app(targetRotation,rest)),M.app(parent.rotation,bond.normal),
          sign*length*current.extension);
        targets[name]={position:targetPosition,rotation:targetRotation};
        // A cracked cycle can change the support path, so ease into the new pose as well as the load.
        const position=V.lerp(previous.position,targetPosition,blend);
        const turn=M.axisAngle(M.mul(targetRotation,M.tr(previous.rotation)));
        const rotation=M.mul(M.rot(turn.axis,turn.angle*blend),previous.rotation);
        poses[name]={position,rotation,velocity:V.mul(V.sub(position,previous.position),1/dt),
          angular:V.mul(turn.axis,turn.angle*blend/dt)};
      }
      for(const {anchors} of components){
        const queue=anchors.slice(), seen=new Set(anchors);
        for(const name of anchors)targets[name]=poses[name]={position:cells[name].center,rotation:identity,velocity:zero,angular:zero};
        for(const from of queue)for(const link of adjacency.get(from)){
          if(seen.has(link.name))continue;
          seen.add(link.name);
          visit(from,link);
          queue.push(link.name);
        }
      }
    }

    function handoff(prior,history,poses,ctx,emit) {
      const parents=new Map(Object.values(prior).flatMap(island=>island.members.map(name=>[name,island])));
      const islands={}, nextPoses={...poses};
      for(const {members,anchors} of topology(history).components){
        if(anchors.length)continue;
        const parent=parents.get(members[0]);
        if(parent?.members.length===members.length){
          islands[parent.id]=parent;
          continue;
        }
        const id=nativeName(members,ctx.tick), island=rigidIsland(id,members,poses,parent);
        islands[id]=island;
        islandPoses(island,nextPoses);
        let positionError=0, rotationError=0, velocityChange=0, linearError=zero;
        for(const name of members){
          positionError=Math.max(positionError,V.dist(nextPoses[name].position,poses[name].position));
          rotationError=Math.max(rotationError,...nextPoses[name].rotation.map((n,i)=>Math.abs(n-poses[name].rotation[i])));
          const change=V.sub(nextPoses[name].velocity,poses[name].velocity);
          velocityChange=Math.max(velocityChange,V.len(change));
          linearError=V.mad(linearError,change,cells[name].mass);
        }
        const center=island.body.position;
        const angularMomentumError=V.dist(angularTerms(members,poses,center).momentum,angularTerms(members,nextPoses,center).momentum);
        emit('fracture-handoff',{island:id,parent:island.parent,members,position:center,
          velocity:island.body.velocity,angular:island.body.angular,mass:island.body.mass,positionError,rotationError,velocityChange,
          linearMomentumError:V.len(linearError),angularMomentumError});
      }
      return {islands,poses:nextPoses};
    }

    function step(state,ctx) {
      const external=ctx.input.loads??[];
      check(Array.isArray(external)&&external.length<=256,'Fracture load stream exceeds its budget');
      let commanded=state;
      for(const row of external){
        checkAction('load',row);
        commanded=setLoad(commanded,row);
      }
      const {loads}=commanded, events=[], positions={...state.poses};
      const emit=(kind,data)=>{
        const event={kind,...data};
        events.push(event);
        ctx.emit(kind,data);
      };
      const {components,adjacency}=topology(state.history);
      const history=Object.fromEntries(bonds.map(bond=>{
        const {after,fractures,yields}=advance(bond,state.history[bond.id],loads[bond.id],ctx);
        if(yields)emit('fracture-yield',{bond:bond.id,law:bond.law,plastic:after.plastic});
        if(fractures){
          const kind={brittle:'fracture-crack',ductile:'fracture-break',fibrous:'fracture-tear'}[bond.law];
          emit(kind,{bond:bond.id,pieces:[bond.a,bond.b],law:bond.law,damage:after.damage});
        }
        return [bond.id,after];
      }));
      // Apply the latest flex to the pre-break topology so release starts at its deformed pose.
      heldPoses(state.poses,components,adjacency,history,ctx.dt,positions);
      const active=Object.values(state.islands), bodies={};
      for(const {members,anchors} of components)if(anchors.length)for(const name of members){
        const cell=cells[name];
        bodies[heldName(name)]=asBody(heldName(name),positions[name],cellColliders[name],cell.mass,true,cell.material,materials[cell.material].look);
      }
      for(const island of active)bodies[island.id]=island.body;
      const physics=active.length?mechanics.step({...empty,bodies},ctx):empty, prior={};
      for(const island of active){
        prior[island.id]={...island,body:physics.bodies[island.id]};
        islandPoses(prior[island.id],positions);
      }
      const {islands,poses}=handoff(prior,history,positions,ctx,emit);
      const coverage=new Map(active.map(({id,members})=>[id,members]));
      for(const name of names)coverage.set(heldName(name),[name]);
      const contacts=physics.impacts.map(hit=>({...hit,pieces:[coverage.get(hit.a)?.[hit.parts[0]]??null,
        hit.b===null?null:coverage.get(hit.b)?.[hit.parts[1]]??null]}));
      return freeze({history,poses,islands,loads,contacts,impactLimited:physics.impactLimited,events});
    }

    function validateState(state) {
      const {history,poses,islands,loads,contacts,impactLimited,events}=state??{};
      const isPose=row=>record(row)&&['position','velocity','angular'].every(key=>vector(row[key]))&&vector(row.rotation,9);
      check(record(history)&&Object.keys(history).length===bonds.length&&bonds.every(({id,law,material})=>{
        const row=history[id], profile=materials[material];
        return record(row)&&row.law===law&&finite(row.damage,0,1)&&row.broken===(row.damage===1)&&
          finite(row.bend,-profile.maxBend,profile.maxBend)&&finite(row.extension,0,profile.maxStretch)&&
          finite(row.plastic,law==='ductile'?-profile.maxBend:0,law==='fibrous'?profile.maxStretch:profile.maxBend);
      })&&record(poses)&&Object.keys(poses).length===names.length&&names.every(name=>isPose(poses[name]))&&
        record(islands)&&record(loads)&&Array.isArray(contacts)&&contacts.length<=64&&typeof impactLimited==='boolean'&&
        Array.isArray(events)&&events.length<=bonds.length*2+names.length,'Invalid material failure checkpoint');
      for(const [bond,load] of Object.entries(loads))checkAction('load',{...load,bond});
      const free=topology(history).components.filter(row=>!row.anchors.length).map(row=>row.members);
      check(Object.keys(islands).length===free.length,'Saved fracture islands do not match the remaining constraints');
      const unique=new Set();
      for(const [id,island] of Object.entries(islands)){
        const {body,local,members,parent}=island;
        check(island.id===id&&W.data.id(id)&&(parent===null||W.data.id(parent))&&Array.isArray(members)&&
          free.some(row=>W.data.equal(row,members))&&!unique.has(members[0])&&isPose(body)&&!body.fixed&&
          body.id===id&&body.mass===weightSum(members,name=>cells[name].mass)&&Array.isArray(local)&&local.length===members.length&&
          local.every((row,i)=>row.name===members[i]&&vector(row.position)&&vector(row.rotation,9)),
          'Invalid fracture island checkpoint');
        const expected={kind:'compound',parts:local.map(({name,position,rotation})=>{
          const hull=cellColliders[name];
          return {...hull,vertices:hull.vertices.map(p=>V.add(position,M.app(rotation,p)))};
        })};
        check(W.data.equal(body.collider,expected),'Invalid saved fracture island geometry');
        unique.add(members[0]);
      }
      mechanics.validateState({...empty,bodies:Object.fromEntries(Object.entries(islands).map(([id,row])=>[id,row.body]))});
    }

    const getIslands=state=>new Map(Object.values(state.islands).flatMap(({id,members})=>members.map(name=>[name,id])));
    const pieces=state=>{
      const islands=getIslands(state);
      return Object.fromEntries(names.map(name=>{
        const {material,group,anchored,mass}=cells[name];
        return [name,{...state.poses[name],material,group,anchored,mass,island:islands.get(name)??null}];
      }));
    };
    const bodyCache=new WeakMap();
    function pieceBodies(state){
      if(!bodyCache.has(state)){
        const bodies=Object.fromEntries(Object.entries(pieces(state)).map(([name,row])=>{
          const {island,material,mass,group,anchored,...pose}=row;
          return [name,asBody(name,pose,cells[name].hull,mass,island===null,material,materials[material].look)];
        }));
        bodyCache.set(state,freeze(bodies));
      }
      return bodyCache.get(state);
    }
    return {initial,step,validateState,checkAction,inputs:{loads:'event'},outputs:{failure:'event'},
      output:state=>({failure:state.events}),
      actions:{load:setLoad},
      *poseEntities(state){if(state)yield* names;},
      pose:(state,name)=>state&&own(cells,name)?pieceBodies(state)[name]:null,
      fields:{
        preparation:{type:'record',read:()=>Q.ok(prepared)},
        pieces:{type:'record',read:({state})=>Q.ok(pieces(state))},
        bodies:{type:'record',read:({state})=>Q.ok(pieceBodies(state))},
        islands:{type:'record',read:({state})=>Q.ok(state.islands)},
        constraints:{type:'records',read:({state})=>Q.ok(bonds.map(bond=>({...bond,...state.history[bond.id],
          load:state.loads[bond.id]??{tension:0,shear:0,bend:0}})))},
        contacts:{type:'records',read:({state})=>Q.ok(state.contacts)},
        'contact-limited':{type:'boolean',read:({state})=>Q.ok(state.impactLimited)}
      }};
  }

  W.runtime.register('material-failure',materialFailure);
})(KIT);
