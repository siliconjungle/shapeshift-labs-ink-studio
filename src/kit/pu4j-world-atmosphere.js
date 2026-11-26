/* Checkpointed, budgeted combustion and cloud condensation on sparse cells. */
(function(K){
  const W=K.world,Q=W.query,P=K.procedural,{V}=K, G=atmosphereGrid3d;
  const {record,vector,id,check,own}=W.data,{freeze}=P.data;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const vec=(v,max=1000)=>vector(v)&&Array.from(v).every(n=>finite(n,-max,max));
  const order=([a],[b])=>a<b?-1:a>b?1:0;
  const zero=[0,0,0], scalars=['density','heat','fuel','vapor'];

  function stage(config,{world}){
    check(keys(config,['mode','grid','brickSize','initial','settings','sources','reaction'])&&
      ['combustion','cloud'].includes(config.mode),'Choose a sparse combustion or cloud stage');
    const {mode,grid,brickSize=4,settings:authored={},sources={},reaction={}}=config;
    check(keys(grid,['origin','spacing','size'])&&vec(grid.origin)&&vec(grid.spacing,12)&&
      grid.spacing.every(n=>n===grid.spacing[0]&&n>=.02)&&vector(grid.size)&&grid.size.every(n=>integer(n,4,1024))&&
      integer(brickSize,2,16),'Sparse atmosphere needs a uniform XYZ lattice and bounded bricks');
    const l=G.lattice(grid), cellVolume=l.width**3, bounds={min:grid.origin,max:grid.origin.map((n,i)=>n+grid.size[i]*l.width)};
    check(keys(authored,['ambient','wind','windGain','substeps','pressureIterations','buoyancy','densityWeight','drag',
      'temperatureDecay','densityDecay','prune','maxActive','maxWork','maxSpeed','closed','swirl','swirlScale']),
    'Unknown atmosphere numerics');
    const settings={ambient:293,wind:[0,0,0],windGain:1.5,substeps:2,pressureIterations:16,buoyancy:3.6,densityWeight:.16,
      drag:.16,temperatureDecay:.72,densityDecay:.20,prune:.00018,maxActive:30000,maxWork:12000000,
      maxSpeed:7,closed:false,swirl:.6,swirlScale:1.4,...authored};
    const {wind,windGain,substeps,pressureIterations,buoyancy,densityWeight,drag,temperatureDecay,densityDecay,
      prune,maxActive,maxWork,maxSpeed,closed,swirl,swirlScale}=settings;
    check(finite(settings.ambient,180,360)&&vec(wind,20)&&finite(windGain,0,25)&&integer(substeps,1,8)&&
      integer(pressureIterations,4,60)&&finite(buoyancy,0,50)&&finite(densityWeight,0,40)&&
      [drag,temperatureDecay,densityDecay].every(n=>finite(n,0,25))&&finite(prune,.000001,.05)&&
      integer(maxActive,8,140000)&&integer(maxWork,512,65000000)&&finite(maxSpeed,.1,30)&&typeof closed==='boolean'&&
      finite(swirl,0,20)&&finite(swirlScale,.05,40),'Invalid atmosphere solver bounds');
    const ambient=Math.fround(settings.ambient);
    let law;
    if(mode==='combustion'){
      check(keys(reaction,['ignition','ignitionBand','burnRate','heatYield','smokeYield']),'Unknown combustion settings');
      law={ignition:610,ignitionBand:100,burnRate:5.6,heatYield:1050,smokeYield:.82,...reaction};
      check(finite(law.ignition,ambient+5,1800)&&finite(law.ignitionBand,1,700)&&finite(law.burnRate,0,100)&&
        finite(law.heatYield,0,5000)&&finite(law.smokeYield,0,8),'Invalid combustion reaction');
    }else{
      check(keys(reaction,['saturation','heightCooling','temperatureSensitivity','condensationRate','evaporationRate','latentHeat']),
        'Unknown cloud reaction settings');
      law={saturation:.20,heightCooling:.48,temperatureSensitivity:.012,condensationRate:6,evaporationRate:1.6,latentHeat:14,...reaction};
      check(finite(law.saturation,.001,20)&&finite(law.heightCooling,0,12)&&finite(law.temperatureSensitivity,0,.15)&&
        finite(law.condensationRate,0,65)&&finite(law.evaporationRate,0,65)&&finite(law.latentHeat,0,600),
        'Invalid cloud saturation or phase response');
    }
    check(record(sources)&&Object.keys(sources).length<=24&&Object.keys(sources).every(id),'Atmosphere needs bounded named sources');
    const emitters=Object.entries(sources).sort(order).map(([name,row])=>{
      check(keys(row,['at','radii','start','end','rates','velocity','velocityGain','gain'])&&vec(row.at)&&
        vec(row.radii)&&row.radii.every(n=>finite(n,l.width*.55,l.width*25))&&
        row.at.every((n,i)=>n>=bounds.min[i]&&n<=bounds.max[i])&&
        finite(row.start??0,0,3600)&&finite(row.end??3600,row.start??0,3600)&&
        keys(row.rates,scalars)&&finite(row.gain??1,0,4)&&vec(row.velocity??zero,20)&&finite(row.velocityGain??9,0,45),
        'Invalid atmosphere source '+name);
      const {at,radii,velocity=zero,velocityGain=9,start=0,end=3600,gain=1}=row;
      const rates=scalars.map(key=>row.rates[key]??0);
      check(rates.every((n,i)=>i===1?finite(n,-2500,6000):finite(n,0,45)),'Atmosphere source rates exceed bounds');
      const lo=at.map((n,i)=>Math.max(0,Math.floor((n-radii[i]-grid.origin[i])/l.width))),
        hi=at.map((n,i)=>Math.min(grid.size[i]-1,Math.floor((n+radii[i]-grid.origin[i])/l.width))), cells=[];
      check(hi.reduce((product,n,i)=>product*(n-lo[i]+1),1)<=40000,'Atmosphere source footprint is too large');
      for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
        const point=l.world([x,y,z]), d=point.reduce((n,w,i)=>n+((w-at[i])/radii[i])**2,0);
        if(d<1)cells.push([l.index(x,y,z),(1-d)**1.35]);
      }
      check(cells.length>0,'Atmosphere source covers no cell centers: '+name);
      return {name,velocity,velocityGain,start,end,gain,rates,cells};
    });
    check(emitters.length||config.initial!==undefined,'Atmosphere needs at least one source or an initial volume');
    let initialMap=new Map();
    if(config.initial!==undefined){
      const initial=P.sparseVolume.create(config.initial);
      check(['size','origin','spacing'].every(key=>W.data.equal(initial.grid[key],grid[key]))&&
        Object.entries(initial.fields).every(([name,{background}])=>
          own(G.descriptors(ambient),name)&&W.data.equal(background,G.descriptors(ambient)[name].background)),
        'Initial volume must use the atmosphere grid and field backgrounds');
      initialMap=G.unpack(initial,l);
      check(initialMap.size<=maxActive,'Initial atmosphere exceeds its active-cell limit');
    }
    const initialVolume=G.pack(l,brickSize,ambient,initialMap,maxActive);
    const validSources=new Set(emitters.map(row=>row.name));
    const theta=2*Math.PI*P.data.hash('smoke-curl',world.seed)/4294967296;
    const cache=new WeakMap(), metadata=freeze({format:'ink-studio/sparse-atmosphere-preparation',version:1,
      mode,grid,brickSize,settings:{...settings,ambient},reaction:law,sourceCells:Object.fromEntries(emitters.map(row=>[row.name,row.cells.length]))});
    const isActive=row=>row.slice(0,4).some(Boolean);

    function statistics(map,volume){
      const total=G.sums(map), centroid=[0,0,0], aabb={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
      let densityPeak=0,temperaturePeak=ambient,temperatureMin=ambient,densityCells=0,maxVelocity=0;
      for(const [id,row] of map){
        const point=l.world(l.address(id));
        temperaturePeak=Math.max(temperaturePeak,ambient+row[1]);
        temperatureMin=Math.min(temperatureMin,ambient+row[1]);
        maxVelocity=Math.max(maxVelocity,Math.hypot(row[4],row[5],row[6]));
        if(!row[0])continue;
        densityCells++;densityPeak=Math.max(densityPeak,row[0]);
        for(let j=0;j<3;j++){
          centroid[j]+=point[j]*row[0];
          aabb.min[j]=Math.min(aabb.min[j],point[j]-l.width*.5);
          aabb.max[j]=Math.max(aabb.max[j],point[j]+l.width*.5);
        }
      }
      const active=map.size;
      return {logicalCells:l.count,activeCells:active,activeBricks:volume.bricks.length,densityCells,
        activeFraction:active/l.count,densityMass:total[0]*cellVolume,fuelMass:total[2]*cellVolume,vaporMass:total[3]*cellVolume,
        densityPeak,temperaturePeak,temperatureMin,maxVelocity,densityBounds:densityCells?aabb:null,
        densityCentroid:densityCells?V.mul(centroid,1/total[0]):null};
    }
    const zeroReport=()=>({pressure:{before:0,after:0,workspace:0},work:{used:0,budget:maxWork,counts:{}},
      speedLimited:0,reaction:{fuelBurned:0,smokeMade:0,condensed:0,evaporated:0},
      balance:Object.fromEntries(['density','fuel','vapor'].map(name=>[name,{added:0,converted:0,outflow:0,pruned:0,decay:0,error:0}]))});
    const initial=()=>freeze({time:0,volume:initialVolume,gains:Object.fromEntries(emitters.map(row=>[row.name,row.gain])),
      report:{...statistics(G.unpack(initialVolume,l),initialVolume),...zeroReport()}});

    function step(state,ctx){
      check(finite(ctx.dt,1/12000,.2),'Atmosphere requires a bounded physical step');
      const dt=ctx.dt/substeps, result=zeroReport(), {work,pressure}=result;
      const guard={
        consume(n,label){
          work.used+=n;work.counts[label]=(work.counts[label]??0)+n;
          check(work.used<=maxWork,'Atmosphere exceeded its per-tick work budget at '+label);
        },
        active(n){check(n<=maxActive,'Atmosphere exceeded its active-cell budget');}
      };
      const losses={outflow:[0,0,0,0],pruned:[0,0,0,0]}, added=[0,0,0,0];
      let map=G.unpack(state.volume,l), start=G.sums(map), burned=0, smoke=0, condensed=0, evaporated=0, decay=0;
      const cool=Math.exp(-temperatureDecay*dt), smokeFactor=Math.exp(-densityDecay*dt),
        push=-Math.expm1(-windGain*dt), loss=Math.exp(-drag*dt);
      for(let s=1;s<=substeps;s++){
        const time=ctx.time-(substeps-s)*dt;
        for(const e of emitters){
          const span=Math.max(0,Math.min(time,e.end)-Math.max(time-dt,e.start))*state.gains[e.name];
          if(!span)continue;
          guard.consume(e.cells.length*12,'sources');
          for(const [id,weight] of e.cells){
            let row=map.get(id);
            if(!row){
              guard.active(map.size+1);
              row=[0,0,0,0,...wind];map.set(id,row);
            }
            for(let k=0;k<4;k++){
              const n=e.rates[k]*span*weight;
              row[k]+=n;added[k]+=n;
            }
            const blend=-Math.expm1(-span*e.velocityGain*weight);
            for(let j=0;j<3;j++)row[j+4]=K.mix(row[j+4],e.velocity[j],blend);
          }
        }
        guard.consume(map.size*23,'reaction');
        for(const [id,row] of map){
          if(mode==='combustion'){
            const factor=Math.max(0,Math.min(1,(ambient+row[1]-law.ignition)/law.ignitionBand)),
              fuel=row[2]*(-Math.expm1(-law.burnRate*dt*factor)), dust=fuel*law.smokeYield;
            row[2]-=fuel;row[0]+=dust;row[1]+=fuel*law.heatYield;
            burned+=fuel;smoke+=dust;
          }else{
            const y=(l.address(id)[1]+.5)*l.width,
              exponent=Math.max(-8,Math.min(8,row[1]*law.temperatureSensitivity-y*law.heightCooling)),
              limit=law.saturation*Math.exp(exponent);
            if(row[3]>limit){
              const water=(row[3]-limit)*(-Math.expm1(-law.condensationRate*dt));
              row[3]-=water;row[0]+=water;row[1]+=water*law.latentHeat;condensed+=water;
            }else if(row[0]){
              const water=Math.min(row[0],limit-row[3])*(-Math.expm1(-law.evaporationRate*dt));
              row[3]+=water;row[0]-=water;row[1]-=water*law.latentHeat;evaporated+=water;
            }
          }
          row[1]=Math.max(120-ambient,Math.min(3400-ambient,row[1]*cool));
          decay+=row[0]*(1-smokeFactor);row[0]*=smokeFactor;
          if(!isActive(row)){map.delete(id);continue;}
          const p=l.world(l.address(id)), angle=theta+time*1.8,
            u=Math.sin(p[2]*swirlScale+angle), v=Math.cos(p[0]*swirlScale-angle),
            w=Math.sin(p[1]*swirlScale+angle*.6);
          for(const [k,turbulent] of [u-w,w-v,v-u].entries()){
            row[k+4]=K.mix(row[k+4],wind[k],push)*loss+turbulent*swirl*dt;
          }
          row[5]+=(buoyancy*row[1]/Math.max(80,ambient)-densityWeight*row[0])*dt;
          const speed=Math.hypot(row[4],row[5],row[6]);
          if(speed>maxSpeed)for(let k=4;k<7;k++)row[k]*=maxSpeed/speed;
        }
        const flow=G.pressure(map,l,settings,guard);
        pressure.before+=flow.before/substeps;pressure.after+=flow.after/substeps;
        pressure.workspace=Math.max(pressure.workspace,flow.cells);
        const moved=G.transport(map,l,flow,dt,settings,guard,losses);
        map=moved.cells;result.speedLimited+=moved.clipped;
      }
      guard.consume(map.size*9,'serialization');
      const volume=G.pack(l,brickSize,ambient,map,maxActive), packed=G.unpack(volume,l), end=G.sums(packed);
      result.reaction={fuelBurned:burned*cellVolume,smokeMade:smoke*cellVolume,condensed:condensed*cellVolume,evaporated:evaporated*cellVolume};
      const phase=[smoke+condensed-evaporated,0,-burned,evaporated-condensed];
      for(const k of [0,2,3]){
        const consumed=k===0?decay:0, expected=start[k]+added[k]+phase[k]-losses.outflow[k]-losses.pruned[k]-consumed;
        const measure={added:added[k],converted:phase[k],outflow:losses.outflow[k],pruned:losses.pruned[k],
          decay:consumed,error:end[k]-expected};
        result.balance[scalars[k]]=Object.fromEntries(Object.entries(measure).map(([name,n])=>[name,n*cellVolume]));
      }
      return freeze({...state,time:ctx.time,volume,report:{...statistics(packed,volume),...result}});
    }

    function validateState(state){
      const {time,volume,gains,report}=state??{};
      check(finite(time,0,1e6)&&record(gains)&&Object.keys(gains).length===emitters.length&&
        emitters.every(row=>finite(gains[row.name],0,4))&&report?.work?.budget===maxWork,
        'Invalid sparse atmosphere checkpoint');
      const doc=P.sparseVolume.create(volume);
      check(W.data.equal(doc.grid,grid)&&W.data.equal(doc.fields,G.descriptors(ambient))&&
        doc.brickSize===brickSize&&G.unpack(doc,l).size<=maxActive,'Invalid sparse atmosphere checkpoint volume');
    }
    const sampler=state=>{
      if(!cache.has(state))cache.set(state,P.sparseVolume.sampler(state.volume));
      return cache.get(state);
    };
    const exposed=name=>W.spatialFields.define({type:name==='velocity'?'vec3':'number',
      units:G.descriptors(ambient)[name].units,axes:'xyz',bounds},({state,point})=>Q.ok(sampler(state).sample(name,point)));
    return {initial,step,validateState,checkAction(action,args){
      check(action==='gain'&&keys(args,['source','gain'])&&validSources.has(args.source)&&finite(args.gain,0,4),
        'Atmosphere gain needs a named source and bounded value');
    }, actions:{gain:(state,{source,gain})=>({...state,gains:{...state.gains,[source]:gain}})},
      fields:{preparation:{type:'record',read:()=>Q.ok(metadata)},volume:{type:'record',read:({state})=>Q.ok(state.volume)},
        report:{type:'record',read:({state})=>Q.ok(state.report)},
        ...Object.fromEntries(Object.keys(G.descriptors(ambient)).map(name=>[name,exposed(name)]))}};
  }

  W.runtime.register('sparse-atmosphere',stage);
})(KIT);
