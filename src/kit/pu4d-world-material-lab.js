/* Bounded native world adapter for nonlinear solids, grains, and measured contacts. */
(function(K){
  const W=K.world, Q=W.query, {V}=K, {check,record,id,own,vector}=W.data, {freeze}=K.procedural.data;
  const {presets,signed,get,tetra,link}=W.materialConstraints, Contact=W.materialContact;
  const zero=[0,0,0], finite=(n,lo,hi)=>Number.isFinite(n)&&n>=lo&&n<=hi;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const vec=(p,limit=100)=>vector(p)&&Array.from(p).every(n=>finite(n,-limit,limit));
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const byKey=([a],[b])=>a<b?-1:a>b?1:0;
  const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  function table(value,max,name){
    check(record(value)&&Object.keys(value).length<=max&&Object.keys(value).every(id),'Invalid '+name+' table');
    return Object.entries(value).sort(byKey);
  }

  function coefficients(row,maxCompliance=.1){
    return finite(row.staticFriction,0,4)&&finite(row.dynamicFriction,0,row.staticFriction)&&
      finite(row.restitution,0,1)&&finite(row.compliance,0,maxCompliance);
  }

  function profiles(raw){
    const result=new Map(Object.entries(presets.materials));
    for(const [name,source] of table(raw,24,'material lab material')){
      check(keys(source,['preset','density','stretch','shear','bulk','stiffening','staticFriction','dynamicFriction',
        'restitution','compliance','color']),'Invalid material lab profile '+name);
      const {preset=name,...overrides}=source;
      check(id(preset)&&own(presets.materials,preset),'Choose a native contact material preset for '+name);
      const row={...presets.materials[preset],...overrides};
      check(coefficients(row)&&finite(row.density,.01,1000)&&[row.stretch,row.shear,row.bulk].every(n=>finite(n,0,.1))&&
        finite(row.stiffening,0,100)&&typeof row.color==='string'&&/^#[a-f0-9]{6}$/i.test(row.color),
        'Invalid elastic or contact coefficients for '+name);
      result.set(name,row);
    }
    return result;
  }

  function prepare(config){
    check(keys(config,['materials','points','cells','blocks','grains','constraints','surfaces','pairs','settings']),
      'Unknown material lab configuration');
    const materials=profiles(config.materials??{}), nodes=[], indices=new Map(), cells=[], cellsById=new Set(), cellSets=new Set();
    const profile=name=>{
      check(id(name)&&materials.has(name),'Unknown material lab material '+name);
      return materials.get(name);
    };
    function point(name,row,kind){
      check(id(name)&&!indices.has(name)&&nodes.length<512&&
        keys(row,['at','velocity','radius','material','mass','pin','group'])&&vec(row.at)&&vec(row.velocity??zero,60)&&
        finite(row.radius??.04,kind==='grain'?.004:0,3)&&(row.mass===undefined||finite(row.mass,1e-8,1e4))&&
        typeof (row.pin??false)==='boolean'&&(row.group===undefined||id(row.group)), 'Invalid or duplicate material point '+name);
      const {at,material,velocity=zero,radius=.04,mass,pin=false,group=null}=row;
      profile(material);
      const i=nodes.length;
      indices.set(name,i);
      nodes.push({id:name,at,velocity,radius,material,mass,pin,group,kind,cellMass:0});
      return i;
    }
    function cell(name,nodeIds,material,group){
      check(id(name)&&!cellsById.has(name)&&cells.length<768&&id(group)&&Array.isArray(nodeIds)&&nodeIds.length===4&&
        new Set(nodeIds).size===4&&nodeIds.every(id=>indices.has(id)),'Invalid or duplicate tetrahedron '+name);
      const corners=nodeIds.map(id=>indices.get(id)), points=corners.map(i=>nodes[i]), rest=points.map(row=>row.at);
      check(points.every(row=>row.kind==='soft'&&(row.group===null||row.group===group))&&Math.abs(signed(rest))>=1e-9,
        'Tetrahedra need nonzero volume and soft points in a shared group');
      const fingerprint=corners.slice().sort((a,b)=>a-b).join('/');
      check(!cellSets.has(fingerprint),'Duplicate material lab tetrahedron');
      cellSets.add(fingerprint);
      const properties=profile(material), kernel=tetra(corners,rest,properties);
      for(const row of points){
        row.cellMass+=kernel.volume*properties.density/4;
        row.group=group;
      }
      cellsById.add(name);
      cells.push({id:name,material,group,nodes:nodeIds,kernel});
    }

    for(const [name,row] of table(config.points??{},512,'soft point'))point(name,row,'soft');
    for(const [name,row] of table(config.cells??{},768,'tetrahedron')){
      check(keys(row,['nodes','material','group']),'Invalid tetrahedron '+name);
      cell(name,row.nodes,row.material,row.group??'solid');
    }
    for(const [name,row] of table(config.blocks??{},16,'soft block')){
      check(keys(row,['at','size','divisions','material','radius','pinBase','velocity'])&&vec(row.at)&&
        vec(row.size,30)&&row.size.every(n=>n>=.05)&&vector(row.divisions)&&Array.from(row.divisions).every(n=>integer(n,1,8))&&
        typeof (row.pinBase??false)==='boolean','Invalid soft block '+name);
      const dims=row.divisions, spacing=row.size.map((n,i)=>n/dims[i]), radius=row.radius??Math.min(...spacing)*.14;
      const nameAt=address=>name+'.'+address.join('.');
      for(let z=0;z<=dims[2];z++)for(let y=0;y<=dims[1];y++)for(let x=0;x<=dims[0];x++){
        const address=[x,y,z], at=address.map((n,i)=>row.at[i]+n*spacing[i]);
        point(nameAt(address),{at,material:row.material,group:name,radius,
          pin:!!row.pinBase&&!y,...(row.velocity!==undefined&&{velocity:row.velocity})},'soft');
      }
      for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
        const start=[x,y,z];
        for(const [i,order] of permutations.entries()){
          const middle=start.slice(), next=start.slice();
          middle[order[0]]++;
          next[order[0]]++;next[order[1]]++;
          const corners=[start,middle,next,start.map(n=>n+1)].map(nameAt);
          cell(nameAt(start)+'.t'+i,corners,row.material,name);
        }
      }
    }
    for(const [name,row] of table(config.grains??{},512,'grain'))point(name,row,'grain');
    check(nodes.length>0,'A material lab needs at least one soft point or grain');
    for(const row of nodes){
      const density=profile(row.material).density, sphere=row.kind==='grain'?4*Math.PI*row.radius**3/3:0;
      row.mass=row.mass??(row.cellMass||density*(sphere||.01));
      check(finite(row.mass,1e-8,1e4),'Material mass exceeds its finite bounds for '+row.id);
      delete row.cellMass;
    }

    const links=table(config.constraints??{},512,'point constraint').map(([name,row])=>{
      check(keys(row,['preset','kind','points','target','compliance','contraction','activation']),
        'Invalid point constraint '+name);
      const {preset,points,activation=0,...overrides}=row;
      check(preset===undefined||id(preset)&&own(presets.constraints,preset),'Unknown constraint preset '+preset);
      const spec={...presets.constraints[preset],...overrides};
      const {kind,compliance=0,contraction=0,target}=spec;
      check(['distance','tether','strut','angle','fiber'].includes(kind)&&finite(compliance,0,.1)&&
        finite(contraction,0,.85)&&finite(activation,0,1)&&(kind==='fiber'||contraction===0&&activation===0)&&
        (target===undefined||finite(target,kind==='angle'?0:1e-7,kind==='angle'?Math.PI:200))&&
        Array.isArray(points)&&points.length===(kind==='angle'?3:2)&&new Set(points).size===points.length&&
        points.every(id=>indices.has(id)), 'Invalid constraint points or coefficients for '+name);
      return {id:name,points,activation,kernel:link(points.map(id=>indices.get(id)),points.map(id=>nodes[indices.get(id)].at),
        {...spec,compliance})};
    });
    const surfaces=table(config.surfaces??{},24,'material surface').map(([name,row])=>{
      check(keys(row,['material','at','shape'])&&!indices.has(name)&&vec(row.at??zero)&&record(row.shape)&&
        ['plane','box','sphere','convex'].includes(row.shape.kind),'Invalid or ambiguous material surface '+name);
      const {material,at=zero,shape}=row;
      profile(material);
      if(shape.kind==='plane')
        check(keys(shape,['kind','normal','offset','half','u'])&&vec(shape.normal)&&V.len(shape.normal)>1e-8&&
          finite(shape.offset??0,-100,100)&&(shape.half===undefined||vector(shape.half,2)&&shape.half.every(n=>finite(n,.01,100)))&&
          (shape.u===undefined||shape.half!==undefined&&vec(shape.u)&&V.len(V.cross(shape.u,shape.normal))>1e-8),
          'Invalid contact plane '+name);
      if(shape.kind==='sphere')
        check(keys(shape,['kind','radius'])&&finite(shape.radius,.005,20),'Invalid contact sphere '+name);
      const collider=shape.kind==='sphere'?{kind:'capsule',a:zero,b:zero,radius:shape.radius}:shape;
      return {id:name,material,at,shape,form:Contact.shape(collider)};
    });

    const used=[...new Set([...nodes,...surfaces].map(row=>row.material))].sort(), pairs=new Map();
    return {nodes,indices,cells,links,surfaces,materials,used,pairs};
  }

  function materialLab(config,env){
    const prepared=prepare(config), {nodes,indices,cells,links,surfaces,materials,used,pairs}=prepared;
    const rawPairs=config.pairs??{};
    check(record(rawPairs)&&Object.keys(rawPairs).length<=128,'Invalid material pair overrides');
    const allowed=new Set();
    for(const [i,a] of used.entries())for(let j=i;j<used.length;j++){
      const b=used[j], name=Contact.pairKey(a,b), row=own(rawPairs,name)?rawPairs[name]:{};
      allowed.add(name);
      check(keys(row,['staticFriction','dynamicFriction','restitution','compliance']),'Invalid material pair '+name);
      const mixed=Contact.mix(materials.get(a),materials.get(b),row);
      check(coefficients(mixed,.2),'Invalid mixed contact coefficients for '+name);
      pairs.set(name,freeze(mixed));
    }
    check(Object.keys(rawPairs).every(name=>allowed.has(name)),'An override needs a sorted pair of used materials');
    const raw=config.settings??{};
    check(keys(raw,['substeps','passes','contactPasses','maxWork','maxContactSamples','gravity','damping','bounceSpeed','speedLimit']),
      'Unknown native material solver setting');
    const settings={substeps:5,passes:3,contactPasses:2,maxWork:600000,maxContactSamples:128,
      gravity:[0,-9.81,0],damping:.35,bounceSpeed:.5,speedLimit:18,...raw};
    const {substeps,passes,contactPasses,maxWork,maxContactSamples,gravity,damping,bounceSpeed,speedLimit}=settings;
    check(integer(substeps,1,12)&&integer(passes,1,8)&&integer(contactPasses,1,6)&&integer(maxWork,1,5000000)&&
      integer(maxContactSamples,0,256)&&vec(gravity,60)&&finite(damping,0,40)&&finite(bounceSpeed,0,10)&&
      finite(speedLimit,.1,60),'Invalid material solver budgets or rates');
    const coupled=cells.length+links.length>0;
    const fixedWork=substeps*(nodes.length+(coupled?passes*(cells.length*8+links.length+nodes.length):0));
    check(fixedWork<=maxWork,'Material lab constraints exceed the per-tick work budget');
    const pinIds=nodes.filter(row=>row.pin).map(row=>row.id), surfaceIds=surfaces.map(row=>row.id);
    const fiberIds=links.filter(row=>row.kernel.kind==='fiber').map(row=>row.id);
    const pinsByName=new Set(pinIds), surfacesByName=new Set(surfaceIds), fibersByName=new Set(fiberIds);
    const contacts=Contact.start(nodes,surfaces,settings,pairs);
    const addresses=rows=>Object.fromEntries(rows.map(({id,at})=>[id,at]));
    const preparations=freeze({format:'ink-studio/material-lab-preparation',version:1,settings,
      materials:Object.fromEntries(used.map(name=>[name,materials.get(name)])),pairs:Object.fromEntries(pairs),
      points:nodes.map(row=>({...row})),cells:cells.map(({kernel,...row})=>({...row,volume:kernel.volume})),
      surfaces:surfaces.map(({form,...row})=>row),constraints:links.map(({kernel,...row})=>{
        const {kind,target,compliance,contraction}=kernel;
        return {...row,kind,target,compliance,contraction};
      })});
    const activation=(drives,c)=>c.kernel.kind==='fiber'?drives[c.id]:0;
    const moving=(values,ids)=>record(values)&&Object.keys(values).length===ids.length&&ids.every(name=>vec(values[name]));
    let current;
    const softLambda=cells.map(()=>new Float64Array(8)), linkLambda=new Float64Array(links.length);
    const simulator=K.xpbd.sim({gravity,damp:damping,substeps,fixedStep:true,substepPins:true,
      projectBatch(X,P,mass,ts){
        const {h,targets,drives,consume,measurement}=current, h2=h*h;
        consume(nodes.length,'points');
        linkLambda.fill(0);
        for(const row of softLambda)row.fill(0);
        const u=Math.max(0,Math.min(1,(ts-current.start)/current.dt));
        const pose=surfaces.map(({id})=>{
          const before=current.surfaceStart[id], after=targets[id];
          return {position:V.lerp(before,after,u),bVelocity:V.mul(V.sub(after,before),1/current.dt)};
        });
        const contact=measurement.begin(X,P,mass,h,ts,pose,speedLimit);
        if(coupled)for(let pass=0;pass<passes;pass++){
          consume(nodes.length,'points');
          const before=X.slice(0,nodes.length*3);
          consume(cells.length*8,'strain');
          for(const [i,{kernel}] of cells.entries())kernel.project(X,mass,h2,softLambda[i]);
          consume(links.length,'constraints');
          for(const [i,row] of links.entries())
            linkLambda[i]=row.kernel.project(X,mass,h2,linkLambda[i],activation(drives,row));
          contact.elastic(before);
          contact.project();
        }
        contact.project(contactPasses);
        contact.finish();
      }});
    for(const [i,row] of nodes.entries()){
      simulator.point(row.at,row.pin?0:1/row.mass,0);
      if(row.pin)simulator.pin(i,time=>{
        const u=Math.max(0,Math.min(1,(time-current.start)/current.dt));
        return V.lerp(current.pinStart[row.id],current.pins[row.id],u);
      });
    }

    function initial(){
      const anchors=addresses(nodes.filter(row=>row.pin)), surfacesAt=addresses(surfaces);
      const velocities=nodes.flatMap(row=>row.pin?zero:row.velocity);
      return freeze({motion:{positions:Array.from(Float32Array.from(nodes.flatMap(row=>row.at))),
        velocities:Array.from(Float32Array.from(velocities)),broken:[]},
        anchors,previousAnchors:anchors,surfaces:surfacesAt,previousSurfaces:surfacesAt,
        drives:Object.fromEntries(links.filter(row=>fibersByName.has(row.id)).map(row=>[row.id,row.activation])),
        contact:contacts.session(()=>{}).report(),work:{used:0,budget:maxWork,counts:{}}});
    }

    function checkAction(action,args){
      check(
        action==='anchor'&&keys(args,['point','at'])&&pinsByName.has(args.point)&&vec(args.at) ||
        action==='move-surface'&&keys(args,['surface','at'])&&surfacesByName.has(args.surface)&&vec(args.at) ||
        action==='drive'&&keys(args,['constraint','activation'])&&fibersByName.has(args.constraint)&&finite(args.activation,0,1) ||
        action==='impulse'&&keys(args,['point','impulse'])&&indices.has(args.point)&&!pinsByName.has(args.point)&&vec(args.impulse,1000),
        'Invalid material lab '+action+' action');
    }
    function step(state,ctx){
      check(finite(ctx.dt,1/10000,.125),'Material lab tick needs a bounded physical interval');
      const counts={}, work={used:0,budget:maxWork,counts};
      const consume=(n,key)=>{
        work.used+=n;
        counts[key]=(counts[key]??0)+n;
        check(work.used<=maxWork,'Material lab exceeded its per-tick work budget at '+key);
      };
      for(const [previous,next,ids] of [[state.previousAnchors,state.anchors,pinIds],[state.previousSurfaces,state.surfaces,surfaceIds]])
        check(ids.every(name=>V.dist(previous[name],next[name])<=speedLimit*ctx.dt+1e-10),
          'Material lab kinematic move exceeds the configured speed limit');
      const measurement=contacts.session(consume);
      current={h:ctx.dt/substeps,dt:ctx.dt,start:ctx.time-ctx.dt,pinStart:state.previousAnchors,pins:state.anchors,
        surfaceStart:state.previousSurfaces,targets:state.surfaces,drives:state.drives,consume,measurement};
      simulator.restoreMotion(state.motion);
      simulator.step(ctx.dt,ctx.time);
      const motion=simulator.motion();
      check(motion.positions.every(n=>finite(n,-10000,10000))&&motion.velocities.every(n=>finite(n,-10000,10000)),
        'Material lab motion exceeded its numeric domain');
      return freeze({...state,motion,contact:measurement.report(),work,previousAnchors:state.anchors,
        previousSurfaces:state.surfaces});
    }
    function validateState(state){
      const motion=state?.motion, packed=values=>Array.isArray(values)&&values.length===nodes.length*3&&
        values.every(n=>finite(n,-10000,10000));
      check(packed(motion?.positions)&&packed(motion?.velocities)&&Array.isArray(motion.broken)&&!motion.broken.length&&
        moving(state.anchors,pinIds)&&moving(state.previousAnchors,pinIds)&&moving(state.surfaces,surfaceIds)&&
        moving(state.previousSurfaces,surfaceIds)&&record(state.drives)&&Object.keys(state.drives).length===fiberIds.length&&
        fiberIds.every(name=>finite(state.drives[name],0,1))&&state.work?.budget===maxWork&&integer(state.work.used,0,maxWork)&&
        Array.isArray(state.contact?.samples)&&state.contact.samples.length<=maxContactSamples&&record(state.contact.pairs),
        'Invalid material lab checkpoint');
    }

    const pose=(state,i)=>({position:get(state.motion.positions,i),velocity:get(state.motion.velocities,i)});
    const readNodes=(state,kind)=>nodes.flatMap((row,i)=>kind===undefined||row.kind===kind?
      [{id:row.id,group:row.group,material:row.material,radius:row.radius,kind:row.kind,mass:row.mass,pin:row.pin,...pose(state,i)}]:[]);
    const readStrain=state=>{
      const groups=Object.create(null);
      for(const {group,kernel} of cells){
        const value=kernel.ratio(state.motion.positions), target=groups[group]??={restVolume:0,signedVolume:0,min:Infinity,max:-Infinity,inverted:0,cells:0};
        target.restVolume+=kernel.volume;
        target.signedVolume+=value*kernel.volume;
        target.min=Math.min(target.min,value);target.max=Math.max(target.max,value);
        target.inverted+=Number(value<=0);target.cells++;
      }
      return Object.fromEntries(Object.entries(groups).map(([name,row])=>[name,{...row,ratio:row.signedVolume/row.restVolume}]));
    };
    return {initial,step,checkAction,validateState,
      actions:{
        anchor:(state,{point,at})=>({...state,anchors:{...state.anchors,[point]:at}}),
        'move-surface':(state,{surface,at})=>({...state,surfaces:{...state.surfaces,[surface]:at}}),
        drive:(state,{constraint,activation})=>({...state,drives:{...state.drives,[constraint]:activation}}),
        impulse:(state,{point,impulse})=>{
          const i=indices.get(point), velocities=state.motion.velocities.slice();
          const velocity=V.mad(get(velocities,i),impulse,1/nodes[i].mass);
          const bounded=V.len(velocity)>speedLimit?V.mul(V.norm(velocity),speedLimit):velocity;
          bounded.forEach((value,k)=>{velocities[i*3+k]=value;});
          return {...state,motion:{...state.motion,velocities}};
        }
      },
      outputs:{'contact-samples':'event'},output:state=>({'contact-samples':state.contact.samples}),
      *poseEntities(state){if(state)yield* indices.keys();},
      pose:(state,name)=>state&&indices.has(name)?pose(state,indices.get(name)):null,
      fields:{
        preparation:{type:'record',read:()=>Q.ok(preparations)},
        points:{type:'records',read:({state})=>Q.ok(readNodes(state))},
        grains:{type:'records',read:({state})=>Q.ok(readNodes(state,'grain'))},
        strain:{type:'record',read:({state})=>Q.ok(readStrain(state))},
        constraints:{type:'records',read:({state})=>Q.ok(links.map(row=>{
          const value=activation(state.drives,row);
          return {id:row.id,kind:row.kernel.kind,activation:value,error:row.kernel.error(state.motion.positions,value)};
        }))},
        contacts:{type:'records',read:({state})=>Q.ok(state.contact.samples)},
        'contact-report':{type:'record',read:({state})=>{
          const {samples,...report}=state.contact;
          return Q.ok(report);
        }},
        surfaces:{type:'record',read:({state})=>Q.ok(state.surfaces)},
        work:{type:'record',read:({state})=>Q.ok(state.work)}
      }};
  }

  W.runtime.register('material-lab',materialLab);
})(KIT);
