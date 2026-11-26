/* Native replayable volume liquid with moving walls, spray, and ocean output. */
(function(K){
  const W=K.world,Q=W.query,P=K.procedural,{V}=K, A=liquidAssets3d;
  const {check,id,record,vector}=W.data,{freeze}=P.data;
  const zero=[0,0,0], epsilon=1e-7;
  const finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const vec=(p,n=3,bound=1000)=>vector(p,n)&&Array.from(p).every(n=>finite(n,-bound,bound));
  const keys=(o,allowed)=>record(o)&&Object.keys(o).every(k=>allowed.includes(k));
  const order=([a],[b])=>a<b?-1:a>b?1:0;
  const speedLimit=(v,max)=>{const s=V.len(v);return s>max?V.mul(v,max/s):v;};
  const within=(p,min,max)=>p.every((n,i)=>n>=min[i]&&n<=max[i]);

  function liquid(config,env){
    check(keys(config,['grid','fill','colliders','settings','surface','secondary','ocean']),
      'Unknown liquid volume configuration');
    const {grid:raw,fill,colliders={},settings={},surface={},secondary={}}=config;
    check(keys(raw,['shape','cell','origin'])&&vec(raw.shape)&&raw.shape.every(n=>integer(n,4,64))&&
      raw.shape.reduce((a,b)=>a*b,1)<=14000&&finite(raw.cell,.02,8)&&vec(raw.origin??zero),
      'Liquid volume requires a bounded uniform XYZ grid');
    const {shape,cell,origin:min=zero}=raw, max=min.map((n,i)=>n+shape[i]*cell),
      domain={min,max,cell,toGrid:p=>p.map((n,i)=>(n-min[i])/cell),toWorld:p=>p.map((n,i)=>min[i]+n*cell)};
    check(keys(settings,['particlesPerAxis','substeps','pressureIterations','flip','gravity','maxSpeed','maxWork','maxParticles']),
      'Invalid liquid volume numerics');
    const solver={particlesPerAxis:2,substeps:3,pressureIterations:22,flip:.83,gravity:[0,-9.81,0],
      maxSpeed:8,maxWork:7000000,maxParticles:12000,...settings},
      {particlesPerAxis,substeps,pressureIterations,flip,gravity,maxSpeed,maxWork,maxParticles}=solver;
    check(integer(particlesPerAxis,1,3)&&integer(substeps,1,8)&&integer(pressureIterations,4,80)&&
      finite(flip,0,1)&&vec(gravity,3,50)&&finite(maxSpeed,.1,40)&&integer(maxWork,10000,35000000)&&
      integer(maxParticles,1,22500),'Invalid liquid transfer, pressure, or work bounds');
    check(keys(surface,['radius','iso','resolution','maxCells']),'Invalid liquid extraction options');
    const skin=cell*.055, mesh={radius:1.43,iso:.53,resolution:cell*.8,maxCells:140000,...surface};
    check(finite(mesh.radius,1.05,1.5)&&finite(mesh.iso,.15,1.6)&&finite(mesh.resolution,cell*.36,cell*2)&&
      integer(mesh.maxCells,400,350000),'Invalid liquid extraction radius or lattice budget');
    check(keys(secondary,['maxCount','perTick','impact','rise','sprayLife','foamLife']),'Invalid secondary particle settings');
    const fx={maxCount:480,perTick:14,impact:.55,rise:.9,sprayLife:.55,foamLife:1.1,...secondary};
    check(integer(fx.maxCount,0,1600)&&integer(fx.perTick,0,80)&&finite(fx.impact,.02,40)&&finite(fx.rise,.1,40)&&
      finite(fx.sprayLife,.05,3)&&finite(fx.foamLife,.05,6),'Invalid spray and foam budgets or lifetimes');
    const ocean=A.spectrum(config.ocean,domain,env.world.seed);
    check(record(colliders)&&Object.keys(colliders).length<=8,'Liquid allows up to eight moving colliders');
    const bodies=Object.entries(colliders).sort(order).map(([name,row])=>A.collider(name,row,cell,id)),
      bodyIds=new Set(bodies.map(row=>row.name)), target=Object.fromEntries(bodies.map(row=>[row.name,{position:row.position,turn:row.turn}]));
    const safePose=(body,p)=>vec(p.position)&&finite(p.turn,-Math.PI*2,Math.PI*2)&&
      body.dimensions(body.pose(p.position,p.turn)).every((n,i)=>p.position[i]-n>=min[i]+skin*.9&&p.position[i]+n<=max[i]-skin*.9);
    for(const body of bodies)check(safePose(body,target[body.name]),'Liquid collider must remain inside the tank: '+body.name);
    const prepared=liquidGrid3d.create(shape,cell), {cells}=prepared, perCell=particlesPerAxis**3;
    check(Array.isArray(fill)&&fill.length>=1&&fill.length<=16,'Liquid needs bounded fill boxes');
    const regions=fill.map(row=>{
      check(keys(row,['min','max','velocity','followOcean'])&&vec(row.min)&&vec(row.max)&&
        within(row.min,min,max)&&within(row.max,min,max)&&row.min.every((n,i)=>row.max[i]>n)&&
        vec(row.velocity??zero,3,maxSpeed)&&typeof (row.followOcean??false)==='boolean'&&(!row.followOcean||ocean),
        'A liquid fill must fit the grid or follow an authored ocean');
      return row;
    });
    const initialPoses=bodies.map(body=>body.pose(body.position,body.turn)), frame0=ocean?.frame(0);
    const markers=[];
    for(const [i,coordinate] of cells.centers.entries())for(let slot=0;slot<perCell;slot++){
      const p=coordinate.map((n,j)=>{
        const sub=Math.floor(slot/particlesPerAxis**j)%particlesPerAxis;
        return n+(sub+.5+(P.data.hash('fill/'+i+'/'+slot+'/'+j,env.world.seed)/4294967296-.5)*.26)/particlesPerAxis;
      }), world=domain.toWorld(p);
      const region=regions.find(row=>within(world,row.min,row.max)&&(!row.followOcean||world[1]<=ocean.height(frame0,world[0],world[2])));
      if(!region||bodies.some((body,b)=>body.distance(world,initialPoses[b])<skin))continue;
      const v=region.followOcean?V.add(ocean.orbital(0,world),region.velocity??zero):region.velocity??zero;
      markers.push([...p,...speedLimit(v,maxSpeed)]);
      check(markers.length<=maxParticles,'Liquid fill exceeds its primary particle budget');
    }
    check(markers.length>0,'Liquid fill contains no open marker sites');
    const count=markers.length, faceCount=prepared.axes.reduce((n,row)=>n+row.count,0);
    const work=substeps*(cells.count*(20+pressureIterations*6+bodies.length)+
      faceCount*(43+((ocean?.sponge??0)>0?ocean.modes.length*2:0))+
      count*(126+bodies.length*22)+fx.maxCount*(25+bodies.length*12));
    check(work<=maxWork,'Liquid solve exceeds its per-tick work estimate');
    const focus=ocean?.focus??null, initialReport={markers:count,volume:count*cell**3/perCell,work:{estimated:work,budget:maxWork},
      pressure:{before:0,after:0,maxBefore:0,maxAfter:0,wetCells:0},contacts:{},spray:0,foam:0,emitted:0,speedLimited:0,
      clearance:markers.reduce((gap,row)=>Math.min(gap,...bodies.map((b,i)=>b.distance(domain.toWorld(row.slice(0,3)),initialPoses[i]))),Infinity)};
    if(!Number.isFinite(initialReport.clearance))initialReport.clearance=null;
    const metadata=freeze({format:'ink-studio/liquid-volume-preparation',version:1,grid:{shape,cell,origin:min,bounds:{min,max}},
      settings:solver,surface:mesh,secondary:fx,markers:count,colliders,ocean:ocean?{bounds:ocean.bounds,level:ocean.level,
        samples:ocean.samples,modes:ocean.modes,near:ocean.near,far:ocean.far,edge:ocean.edge,sponge:ocean.sponge}:null});
    const initial=()=>freeze({time:0,markers,tracers:[],next:0,targets:target,previous:target,focus,report:initialReport});
    const isoCache=new WeakMap(), surfaceCache=new WeakMap(), oceanCache=new WeakMap();
    function density(state){
      if(!isoCache.has(state))isoCache.set(state,prepared.density(state.markers,mesh.radius,perCell));
      return isoCache.get(state);
    }
    const readPoses=state=>bodies.map(body=>{
      const p=state.targets[body.name];return body.pose(p.position,p.turn);
    });
    function readSurface(state){
      if(!surfaceCache.has(state))surfaceCache.set(state,freeze(A.extract(density(state),domain,bodies,readPoses(state),mesh)));
      return surfaceCache.get(state);
    }
    function readOcean(state){
      if(!oceanCache.has(state))oceanCache.set(state,freeze(A.oceanPatch(ocean,density(state),cells,domain,mesh,state.time,state.focus)));
      return oceanCache.get(state);
    }
    function checkAction(action,args){
      if(action==='focus'){
        check(ocean&&keys(args,['at'])&&vec(args.at,2)&&within(args.at,ocean.bounds.min,ocean.bounds.max),
          'Liquid focus needs an XZ point in its ocean chart');
        return;
      }
      check(action==='move'&&keys(args,['collider','position','turn'])&&bodyIds.has(args.collider)&&
        vec(args.position)&&finite(args.turn??0,-Math.PI*2,Math.PI*2),'Invalid liquid collider motion');
      const body=bodies.find(body=>body.name===args.collider);
      check(within(args.position,min,max)&&(args.turn===undefined||safePose(body,{position:args.position,turn:args.turn})),
        'Moved collider must remain inside the liquid tank');
    }

    function step(state,ctx){
      check(finite(ctx.dt,1/12000,.125),'Liquid needs a bounded physical step');
      const h=ctx.dt/substeps, courant=cell*.47/h, limit=Math.min(maxSpeed,courant), radius=skin/cell, stats={...initialReport,
        pressure:{before:0,after:0,maxBefore:0,maxAfter:0,wetCells:0},contacts:Object.fromEntries(bodies.map(row=>[row.name,{count:0,impact:0}])),
        speedLimited:0,emitted:0};
      let water=state.markers, tracers=state.tracers, next=state.next, clearance=Infinity;
      const speeds=bodies.map(body=>{
        const start=state.previous[body.name], end=state.targets[body.name], velocity=V.mul(V.sub(end.position,start.position),1/ctx.dt),
          spin=(end.turn-start.turn)/ctx.dt;
        check(V.len(velocity)+Math.abs(spin)*body.reach<=courant+epsilon,'Liquid collider exceeds its substep travel budget: '+body.name);
        return {start,end,velocity,spin};
      });
      function poses(t){
        return speeds.map(({start,end,velocity,spin},i)=>{
          const p=bodies[i].pose(V.lerp(start.position,end.position,t),K.mix(start.turn,end.turn,t),velocity,spin);
          const extent=bodies[i].dimensions(p);
          check(extent.every((n,j)=>p.position[j]-n>=min[j]+skin*.9&&p.position[j]+n<=max[j]-skin*.9),
            'Liquid collider sweep leaves the tank: '+bodies[i].name);
          return p;
        });
      }
      function inside(p,v){
        p=p.slice();v=v.slice();
        for(let i=0;i<3;i++){
          if(p[i]<=radius){p[i]=radius;if(v[i]<0)v[i]=0;}
          if(p[i]>=shape[i]-radius){p[i]=shape[i]-radius;if(v[i]>0)v[i]=0;}
        }
        return {point:p,speed:v};
      }
      function move(p,to,speed,start,end){
        if(!bodies.length)return {...inside(to,speed),hit:null};
        const before=domain.toWorld(p);
        let point=domain.toWorld(to), hit=null;
        for(const [i,body] of bodies.entries()){
          const impact=body.collide(before,point,speed,start[i],end[i],skin);
          if(!impact)continue;
          if(!hit||impact.impact>hit.impact)hit={...impact,name:body.name};
          point=impact.point;speed=impact.speed;
        }
        // Correct residual overlaps after neighboring obstacles and tank bounds.
        let out=inside(domain.toGrid(point),speed);
        point=domain.toWorld(out.point);
        for(let pass=0;pass<2;pass++)for(const [i,body] of bodies.entries()){
          if(body.distance(point,end[i])>=skin*.5)continue;
          const corrected=body.collide(point,point,out.speed,end[i],end[i],skin);
          if(corrected){
            out=inside(domain.toGrid(corrected.point),corrected.speed);
            point=domain.toWorld(out.point);
          }
        }
        const gap=Math.min(...bodies.map((body,i)=>body.distance(point,end[i])));
        check(gap>=-skin*.025,'Liquid marker trapped inside intersecting boundaries');
        return {...out,hit,gap};
      }

      for(let s=1;s<=substeps;s++){
        const start=poses((s-1)/substeps), end=poses(s/substeps), time=ctx.time-(substeps-s)*h;
        const obstacle=(x,y,z)=>{
          const p=domain.toWorld([x,y,z]);
          return bodies.findIndex((body,i)=>body.distance(p,end[i])<0);
        };
        const wallVelocity=(i,grid,k)=>bodies[i].velocity(domain.toWorld(grid),end[i])[k];
        const orbitalCache=new Map(), wave=(ocean?.sponge??0)>0?(p,k,n)=>{
          const inset=Math.min(p[0],shape[0]-p[0],p[2],shape[2]-p[2])*cell,
            gain=ocean.sponge*A.smooth(1-inset/ocean.edge)*Math.min(1,h*24);
          if(gain<=0)return n;
          const key=p.join('/');
          if(!orbitalCache.has(key))orbitalCache.set(key,ocean.orbital(time,domain.toWorld(p)));
          return K.mix(n,orbitalCache.get(key)[k],gain);
        }:null;
        const flow=prepared.transfer(water,obstacle,wallVelocity,h,solver,wave);
        const {before,after,wetCells}=flow.diagnostics, d=stats.pressure;
        d.before+=before/substeps;d.after+=after/substeps;
        d.maxBefore=Math.max(d.maxBefore,before);d.maxAfter=Math.max(d.maxAfter,after);d.wetCells=wetCells;
        clearance=Infinity;
        const proposals=[], limitNew=Math.floor(s*fx.perTick/substeps)-Math.floor((s-1)*fx.perTick/substeps);
        water=water.map((row,i)=>{
          const raw=flow.update(row,row.slice(3));
          if(V.len(raw)>limit)stats.speedLimited++;
          const v=speedLimit(raw,limit), p=row.slice(0,3);
          const mid=V.mad(p,speedLimit(flow.flow(p),limit),h/(2*cell)),
            particleVelocity=speedLimit(flow.flow(mid).map((n,j)=>K.mix(n,v[j],.12)),limit);
          const moved=move(p,V.mad(p,particleVelocity,h/cell),v,start,end);
          clearance=Math.min(clearance,moved.gap??Infinity);
          const strike=moved.hit;
          if(strike){
            const row=stats.contacts[strike.name];
            row.count++;row.impact=Math.max(row.impact,strike.impact);
          }
          if(limitNew&&tracers.length<fx.maxCount){
            const [x,y,z]=moved.point;
            if(strike&&strike.impact>=fx.impact||v[1]>fx.rise&&!flow.wetAt(x,y+.72,z)){
              const r=ctx.random('liquid/'+s+'/'+i);
              if(r<.34)proposals.push({point:moved.point,speed:moved.speed,r,score:(strike?.impact??v[1])+.25*r,i});
            }
          }
          return [...moved.point,...speedLimit(moved.speed,limit)];
        });
        tracers=tracers.flatMap(row=>{
          const age=row.age+h;
          if(age>=row.life)return [];
          const p=row.point, v=row.kind==='spray'?V.mul(V.mad(row.speed,gravity,h),Math.exp(-.7*h)):
            V.mul(flow.flow(p),.67);
          const to=V.mad(p,speedLimit(v,limit),h/cell);
          if(!within(to,zero,shape))return [];
          const landed=row.kind==='spray'&&age>.065&&v[1]<0&&flow.wetAt(...to);
          if(row.kind==='foam'){
            if(!flow.wetAt(to[0],to[1]-.75,to[2])&&!flow.wetAt(...to)&&age>.10)return [];
            if(flow.wetAt(to[0],to[1]+.55,to[2]))to[1]=Math.min(shape[1]-radius,to[1]+.33);
          }
          if(bodies.some((body,i)=>body.distance(domain.toWorld(to),end[i])<0))return [];
          return [{...row,point:to,speed:v,age,...(landed&&{kind:'foam',age:0,life:fx.foamLife})}];
        });
        proposals.sort((a,b)=>b.score-a.score||a.i-b.i);
        for(const p of proposals.slice(0,Math.min(limitNew,fx.maxCount-tracers.length))){
          const kind=p.r<.25?'spray':'foam', up=kind==='spray'?.56+p.r*1.1:.04;
          tracers.push({id:next++,kind,point:p.point.slice(),speed:V.mad(p.speed,[0,1,0],up),
            age:0,life:(kind==='spray'?fx.sprayLife:fx.foamLife)*(.72+p.r)});
          stats.emitted++;
        }
      }
      stats.spray=tracers.filter(row=>row.kind==='spray').length;stats.foam=tracers.length-stats.spray;
      stats.clearance=Number.isFinite(clearance)?clearance:null;
      return freeze({...state,time:ctx.time,markers:water,tracers,next,previous:state.targets,report:stats});
    }

    function validateState(state){
      const {time,markers,tracers,next,targets,previous,focus,report}=state??{};
      const targetTable=table=>record(table)&&Object.keys(table).length===bodies.length&&
        bodies.every(body=>record(table[body.name])&&safePose(body,table[body.name]));
      check(finite(time,0,1e6)&&Array.isArray(markers)&&markers.length===count&&markers.every(row=>
        vec(row,6,100)&&row.slice(0,3).every((n,i)=>n>0&&n<shape[i])&&V.len(row.slice(3))<=maxSpeed+1e-6)&&
        integer(next,0,Number.MAX_SAFE_INTEGER)&&Array.isArray(tracers)&&tracers.length<=fx.maxCount&&tracers.every(row=>
          record(row)&&integer(row.id,0,next-1)&&['spray','foam'].includes(row.kind)&&vec(row.point)&&within(row.point,zero,shape)&&
          vec(row.speed)&&finite(row.life,.001,6)&&finite(row.age,0,row.life))&&new Set(tracers.map(row=>row.id)).size===tracers.length&&
        targetTable(targets)&&targetTable(previous)&&(ocean?vec(focus,2)&&within(focus,ocean.bounds.min,ocean.bounds.max):focus===null)&&
        report?.markers===count&&report.work?.estimated===work,'Invalid liquid volume checkpoint');
    }

    const primary=state=>state.markers.map((row,id)=>({id,position:domain.toWorld(row.slice(0,3)),velocity:row.slice(3)})),
      secondaryPoints=state=>state.tracers.map(({id,point,speed,kind,age,life})=>({id,position:domain.toWorld(point),velocity:speed,kind,age,life}));
    const field=state=>({format:'ink-studio/grid-field',version:1,shape,components:1,origin:min.map(n=>n+cell*.5),
      spacing:[cell,cell,cell],unit:'normalized-marker-density',frame:'world',data:Array.from(density(state).data)});
    return {initial,step,validateState,checkAction,actions:{
      move:(state,{collider,position,turn})=>{
        const p={position,turn:turn??state.targets[collider].turn}, body=bodies.find(row=>row.name===collider);
        check(safePose(body,p),'Moved collider must remain inside the liquid tank');
        return {...state,targets:{...state.targets,[collider]:p}};
      },
      focus:(state,{at})=>({...state,focus:at})
    },*poseEntities(){yield* bodyIds;},
    pose:(state,name)=>state&&bodyIds.has(name)?{position:state.targets[name].position,rotation:K.M.rot([0,1,0],state.targets[name].turn)}:null,
    fields:{
      preparation:{type:'record',read:()=>Q.ok(metadata)},
      report:{type:'record',read:({state})=>Q.ok(state.report)},
      colliders:{type:'record',read:({state})=>Q.ok(state.targets)},
      particles:{type:'records',read:({state})=>Q.ok(primary(state))},
      secondary:{type:'records',read:({state})=>Q.ok(secondaryPoints(state))},
      density:{type:'record',read:({state})=>Q.ok(field(state))},
      'density-at':W.spatialFields.define({type:'number',units:'normalized-marker-density',axes:'xyz',bounds:{min,max}},
        ({state,point})=>Q.ok(density(state).sample(...domain.toGrid(point)))),
      surface:{type:'record',read:({state})=>Q.ok(readSurface(state))},
      ocean:{type:'record',read:({state})=>ocean?Q.ok(readOcean(state)):Q.missing('No ocean chart configured')}
    }};
  }
  W.runtime.register('liquid-3d',liquid);
})(KIT);
