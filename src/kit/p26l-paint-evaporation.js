/* Seekable particles released from retained paint coverage. */
(function (K) {
  const P=K.procedural, {V,clamp}=K, format='ink-studio/paint-evaporation';
  const fields=(row,keys)=>K.world.data.record(row) && Object.keys(row).every(key=>keys.includes(key));
  const range=(n,lo,hi)=>Number.isFinite(n) && n>=lo && n<=hi;
  const vec=(v,lo=-10000,hi=10000)=>Array.isArray(v) && v.length===3 && Array.from(v).every(n=>range(n,lo,hi));
  const name=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const limit=4096;
  const particleKeys=['source','point','normal','color','emission','glow','birth','material'];

  function prepare(raw, baked=false) {
    if (!fields(raw,['format','version','id','painting','marks','region','start','end','life','spacing','size','velocity','spread','fade','seed',
        ...(baked?['particles','captureTime']:[])]) || raw.format!==format || raw.version!==1 || !name(raw.id) || !name(raw.painting) ||
        !Array.isArray(raw.marks) || !raw.marks.length || raw.marks.length>128 || !Array.from(raw.marks).every(name) ||
        new Set(raw.marks).size!==raw.marks.length)
      throw new TypeError('Use a version 1 paint evaporation plan with a painting and unique mark IDs');
    const {id,painting,marks,region,start=0,end=start,life=1.5,spacing=.075,size=.026,velocity=[0,.8,0],
      spread=.32,fade=.45,seed=0}=raw;
    if (!fields(region,['points','radius','direction']) || !Array.isArray(region.points) || !region.points.length ||
        region.points.length>32 || !Array.from(region.points).every(p=>vec(p)) || !range(region.radius,.001,100) ||
        region.direction!==undefined && (!vec(region.direction) || V.len(region.direction)<1e-6))
      throw new RangeError('Paint a region with up to 32 XYZ brush points, a radius, and optional release direction');
    if (!range(start,0,1e4) || !range(end,start,1e4) || !range(life,.001,60) || !range(spacing,.005,10) ||
        !range(size,.001,2) || !vec(velocity,-100,100) || !range(spread,0,10) || !range(fade,0,1) || !Number.isSafeInteger(seed))
      throw new RangeError('Set bounded release times, lifetime, particle spacing, size, velocity, spread, fade and integer seed');
    const {points,radius}=region, axis=V.norm(region.direction??[0,1,0]), heights=points.map(point=>V.dot(point,axis));
    const first=Math.min(...heights)-radius, width=Math.max(...heights)+radius-first;
    const segments=points.slice(1).map((point,i)=>{
      const delta=V.sub(point,points[i]);
      return {a:points[i],delta,length:V.dot(delta,delta)};
    });
    function distance(point) {
      let nearest=V.dist(point,points[0]);
      for (const {a,delta,length} of segments) {
        const t=length?clamp(V.dot(V.sub(point,a),delta)/length,0,1):0;
        nearest=Math.min(nearest,V.dist(point,V.mad(a,delta,t)));
      }
      return nearest-radius;
    }
    const duration=end-start, birth=point=>start+duration*clamp((V.dot(point,axis)-first)/width,0,1);
    function removedAt(time) {
      if (time<start) return undefined;
      if (time>=end) return distance;
      const height=first+width*(time-start)/duration;
      return point=>Math.max(V.dot(point,axis)-height,distance(point));
    }
    const sources=new Set(marks.map(mark=>'paint.'+painting+'.'+mark));
    if (baked) {
      if (!range(raw.captureTime,0,1e4) || !Array.isArray(raw.particles) || !raw.particles.length || raw.particles.length>limit ||
          !Array.from(raw.particles).every(row=>fields(row,particleKeys) && sources.has(row.source) && vec(row.point) &&
            vec(row.normal,-1,1) && vec(row.color,0,1) && vec(row.emission,0,64) && typeof row.glow==='boolean' &&
            range(row.birth,start,end) && Math.abs(birth(row.point)-row.birth)<1e-7 && distance(row.point)<=1e-7 &&
            (row.material===undefined || typeof row.material==='string' && row.material.length<=128)))
        throw new TypeError('A baked particle layer needs valid source samples inside its painted region');
    }
    const key=time=>time<start?null:time>=end?end:time;
    return {id,sources,start,end,life,spacing,size,velocity,spread,fade,seed,birth,distance,removedAt,key};
  }

  function capture(plan) {
    const config=prepare(plan), cells=new Map(), {spacing,sources}=config;
    const sample=({source,point,index,normal,finish,emission,glow,material})=>{
      if (!sources.has(source) || config.distance(point)>0) return;
      const cell=point.map(n=>Math.floor(n/spacing)), key=source+'/'+cell.join('/');
      const error=point.reduce((d,value,i)=>d+(value/spacing-cell[i]-.5)**2,0);
      const previous=cells.get(key);
      if (previous && previous.error<=error) return;
      if (!previous && cells.size>=limit) throw new RangeError('Evaporation exceeds 4096 particles. Increase spacing.');
      cells.set(key,{source,point,index,normal,finish,emission,glow,material,error});
    };
    function finish(world,captureTime) {
      if (!cells.size) throw new RangeError('No sampled paint covers this region. Check the region and enabled marks.');
      const found=new Set(Array.from(cells.values(),row=>row.source));
      for (const id of sources) if (!found.has(id)) throw new RangeError('No paint sampled in this region for '+id);
      return {...plan,captureTime,particles:Array.from(cells.values(), ({source,point,index,normal,finish,emission,glow,material})=>{
        const packed=world.data[index*16+7];
        const rgb=[packed&255,(packed>>>8)&255,(packed>>>16)&255].map(n=>n/255);
        return {source,point,normal,color:finish?PaintFinish.display(finish,rgb):rgb,emission:emission??[0,0,0],
          glow:Boolean(glow),birth:config.birth(point),...(typeof material==='string' && {material})};
      })};
    }
    return {sources,sample,finish};
  }

  function scene(source,time=0) {
    const targets=new Map(), layers=[];
    if (source.paintEvaporations===undefined) return {targets,layers};
    if (!Array.isArray(source.paintEvaporations) || source.paintEvaporations.length>32)
      throw new TypeError('A scene supports up to 32 paint evaporation layers');
    const ids=new Set();
    let total=0;
    for (const row of source.paintEvaporations) {
      const plan=prepare(row,true);
      if (ids.has(plan.id)) throw new RangeError('Duplicate paint evaporation layer '+plan.id);
      ids.add(plan.id);
      const placement=source.paintings3d?.find(entry=>entry.id===row.painting);
      for (const mark of row.marks) {
        const authored=placement?.painting?.marks?.find(entry=>entry.id===mark), id='paint.'+row.painting+'.'+mark;
        if (!authored || authored.enabled===false || targets.has(id))
          throw new RangeError('Evaporation needs an enabled paint mark used by one layer: '+id);
        const relief=authored.relief??placement.painting.presets?.[authored.preset]?.relief;
        if (relief?.mode==='volume' && relief.height<0) throw new RangeError('Evaporation needs additive or surface paint: '+id);
        targets.set(id,plan.removedAt(time));
      }
      total+=row.particles.length;
      if (total>limit) throw new RangeError('A scene supports up to 4096 baked paint particles');
      layers.push({plan,particles:row.particles,captureTime:row.captureTime});
    }
    return {targets,layers};
  }

  function reserve(B,layers) {
    return layers.map(({plan,particles})=>{
      const identity=i=>'paint-particles/'+plan.id+'/'+i;
      const pool=K.pool(B,particles.length,i=>({em:particles[i].glow,splatId:identity(i)}));
      const rows=particles.map((row,i)=>{
        const slot=pool.first+i, id=identity(i);
        const color=row.color.map(n=>Math.round(clamp(n,0,1)*255));
        const rgb=color[0]+color[1]*256+color[2]*65536;
        const rand=K.grow.dice(P.data.hash(id,plan.seed));
        const velocity=plan.velocity.map(n=>n+(2*rand()-1)*plan.spread);
        const point=V.mad(row.point,row.normal,plan.size*.45);
        const size=plan.size*(.7+.6*rand());
        B.describeSplats?.(slot,slot+1,{object:id,material:row.material,
          target:{entity:row.source,surface:plan.id,castsShadow:false}});
        if (row.emission.some(Boolean))
          B.describePaintFinish?.(slot,slot+1,[8,1,1,1,0,0,0,0,0,0,...row.emission]);
        return {slot,point,velocity,size,rgb,birth:row.birth};
      });
      return {pool,plan,rows};
    });
  }

  function bind(stage,layers) {
    const update=(_dt,t)=>{
      const time=t+(stage.t0??0);
      for (const {pool,plan,rows} of layers) {
        for (const row of rows) {
          const age=time-row.birth;
          if (age<0 || age>=plan.life) {
            pool.hide(stage,row.slot);
            continue;
          }
          const u=age/plan.life, alpha=plan.fade?Math.min(1,(1-u)/plan.fade):1;
          const point=V.mad(row.point,row.velocity,age);
          pool.put(stage,row.slot,...point,row.size,row.rgb,3*alpha);
        }
      }
    };
    stage.add({update});
    update(0,0);
  }

  P.paintEvaporation=Object.freeze({format,prepare,capture,scene,reserve,bind});
})(KIT);
