/* Painted, rooted shear fields shared by retained strokes and native sculpt warps. */
(function (K) {
  const P=K.procedural, {V,Q,clamp}=K, rad=Math.PI/180, turn=2*Math.PI;
  const format='ink-studio/painting-wave';
  const fields=(value, allowed)=>K.world.data.record(value) && Object.keys(value).every(key=>allowed.includes(key));
  const range=(n,lo,hi)=>Number.isFinite(n) && n>=lo && n<=hi;
  const tuple=(v,n)=>Array.isArray(v) && v.length===n && Array.from(v).every(x=>range(x,-10000,10000));
  const localId=id=>typeof id==='string' && /^[a-zA-Z0-9_-]{1,40}$/.test(id);
  const smooth=t=>t*t*(3-2*t);
  const mix=(a,b,t)=>a+(b-a)*t;

  function prepare(raw) {
    if (!fields(raw,['format','version','id','target','root','amplitude','frequency','base','strokes','spacing','time']) ||
        raw.format!==format || raw.version!==1 || !localId(raw.id))
      throw new TypeError('Use a version 1 named painting wave');
    const {root,target,amplitude=.18,frequency=1,base={},strokes=[],time}=raw;
    if (!fields(root,['at','axis','length','lock']) || !tuple(root.at,3) || !tuple(root.axis,3) || V.len(root.axis)<1e-6 ||
        !range(root.length,.001,100) || !range(root.lock??0,0,root.length-.0001) ||
        !range(amplitude,0,10) || !range(frequency,.01,120) || time!==undefined && !range(time,0,1e6))
      throw new RangeError('A painting wave needs a root, a nonzero axis, length, optional locked band, amplitude and frequency');
    const {at,length,lock=0}=root, axis=V.norm(root.axis), spacing=raw.spacing??Math.min(.08,length/20);
    if (!range(spacing,.00005,1) || !Array.isArray(strokes) || strokes.length>64)
      throw new RangeError('A wave supports up to 64 brush strokes and bounded guide sampling');
    if (!fields(target,['mode','solid','painting','marks']) || !['pigment','raised','geometry'].includes(target.mode) ||
        (target.mode==='geometry' ? !TargetSelectors.name(target.solid) || target.painting!==undefined || target.marks!==undefined :
          target.solid!==undefined || !localId(target.painting) || !Array.isArray(target.marks) ||
          !target.marks.length || target.marks.length>128 || !Array.from(target.marks).every(localId) ||
          new Set(target.marks).size!==target.marks.length))
      throw new TypeError('Select a geometry solid, or named pigment or raised marks in one painting');

    function controls(row) {
      let direction;
      if (row.direction!==undefined) {
        if (!tuple(row.direction,3)) throw new TypeError('Paint a finite XYZ sway direction');
        const side=V.mad(row.direction,axis,-V.dot(row.direction,axis));
        if (V.len(side)<1e-6) throw new RangeError('A sway direction needs a component across the root axis');
        direction=V.norm(side);
      }
      if (row.stiffness!==undefined && !range(row.stiffness,0,1) ||
          row.phase!==undefined && !range(row.phase,-360,360))
        throw new RangeError('Wave phase needs degrees from −360 to 360, and stiffness needs 0–1');
      return {direction,phase:row.phase===undefined?undefined:row.phase*rad,stiffness:row.stiffness};
    }
    if (!fields(base,['direction','phase','stiffness'])) throw new TypeError('Set base direction, phase or stiffness');
    const preset=controls(base);
    const baseDirection=preset.direction??V.perp(axis);
    const painted=Array.from(strokes,row=>{
      if (!fields(row,['points','radius','feather','opacity','direction','phase','stiffness']) ||
          !Array.isArray(row.points) || !row.points.length || row.points.length>128 ||
          !Array.from(row.points).every(n=>range(n,-10000,10000)) || !range(row.radius,.0001,100) ||
          !range(row.feather??.45,.02,1) || !range(row.opacity??1,0,1) ||
          !['direction','phase','stiffness'].some(key=>row[key]!==undefined))
        throw new TypeError('A wave brush needs axial points, radius and at least one painted channel');
      return {lo:Math.min(...row.points),hi:Math.max(...row.points),radius:row.radius,
        falloff:row.radius*(row.feather??.45),opacity:row.opacity??1,...controls(row)};
    });
    const height = p=>V.dot(V.sub(p,at),axis);
    function profile(h) {
      let {direction=baseDirection,phase=0,stiffness=0}=preset;
      for (const row of painted) {
        const distance=Math.max(row.lo-h,h-row.hi,0);
        if (distance>=row.radius || !row.opacity) continue;
        const weight=row.opacity*smooth(clamp((row.radius-distance)/row.falloff,0,1));
        if (row.direction) direction=V.lerp(direction,row.direction,weight);
        if (row.phase!==undefined) phase=mix(phase,row.phase,weight);
        if (row.stiffness!==undefined) stiffness=mix(stiffness,row.stiffness,weight);
      }
      return {direction,phase,stiffness};
    }
    // Each blended channel stays in the convex hull of its previous paint values.
    const directions=[baseDirection];
    let phaseMin=preset.phase??0, phaseMax=phaseMin, stiffMin=preset.stiffness??0, stiffMax=stiffMin;
    let slope=0;
    for (const row of painted) {
      if (!row.opacity) continue;
      let change=0;
      if (row.direction) {
        change+=Math.max(...directions.map(prior=>V.dist(prior,row.direction)));
        directions.push(row.direction);
      }
      if (row.phase!==undefined) {
        change+=Math.max(Math.abs(row.phase-phaseMin),Math.abs(row.phase-phaseMax));
        phaseMin=Math.min(phaseMin,row.phase);
        phaseMax=Math.max(phaseMax,row.phase);
      }
      if (row.stiffness!==undefined) {
        change+=Math.max(Math.abs(row.stiffness-stiffMin),Math.abs(row.stiffness-stiffMax));
        stiffMin=Math.min(stiffMin,row.stiffness);
        stiffMax=Math.max(stiffMax,row.stiffness);
      }
      slope+=1.5*row.opacity*change/row.falloff;
    }
    // The shear preserves height, so its inverse evaluates exactly the same axial samples.
    const gradient=amplitude*(1.5/(length-lock)+slope);
    const lip=(Math.hypot(2,gradient)+gradient)/2;
    const pad=axis.map(value=>amplitude*Math.sqrt(Math.max(0,1-value*value)));
    function frame(sampleTime=0) {
      const t=time??sampleTime;
      if (!Number.isFinite(t)) throw new RangeError('Wave time must be finite');
      const theta=turn*(t%(1/frequency))*frequency;
      function offset(h) {
        if (!amplitude || h<=lock) return [0,0,0];
        const {direction,phase,stiffness}=profile(h), envelope=smooth(clamp((h-lock)/(length-lock),0,1));
        return V.mul(direction,amplitude*envelope*(1-stiffness)*Math.sin(theta+phase));
      }
      const fwd=p=>V.add(p,offset(height(p))), inv=p=>V.sub(p,offset(height(p)));
      return {fwd,inv,lip,pad,offset,time:t};
    }

    return {id:raw.id,target,at,axis,length,lock,amplitude,frequency,spacing,time,height,profile,frame};
  }

  function scene(source,time) {
    const geometry=new Map(), paints=new Map(), reports=[];
    if (source.paintingWaves===undefined) return {geometry,paints,reports,animated:false};
    const configs=source.paintingWaves;
    if (!Array.isArray(configs) || configs.length>64) throw new TypeError('A scene supports up to 64 painting waves');
    if (!Array.isArray(source.solids)) throw new TypeError('Painting waves need native scene solids');
    const solids=new Map(source.solids.filter(s=>s?.id).map(s=>[s.id,s]));
    const placements=new Map(Array.isArray(source.paintings3d) ? source.paintings3d.filter(Boolean).map(row=>[row.id,row]) : []);
    const ids=new Set();
    let animated=false;
    for (const raw of configs) {
      const plan=prepare(raw), {id,target,length,lock,at,axis}=plan;
      if (ids.has(id)) throw new RangeError('Duplicate painting wave '+id);
      ids.add(id);
      const map=plan.frame(time), row={id,target,plan,map};
      if (target.mode==='geometry') {
        const solid=solids.get(target.solid);
        if (!solid || solid.hold || solid.ghost || solid.carve || solid.kind==='ground' || geometry.has(target.solid))
          throw new RangeError('A geometry wave needs a unique, bounded exterior sculpt '+target.solid);
        geometry.set(target.solid,row);
      } else {
        const placement=placements.get(target.painting);
        for (const mark of target.marks) {
          const key='paint.'+target.painting+'.'+mark;
          if (paints.has(key) || !Array.isArray(placement?.painting?.marks) || !placement.painting.marks.some(row=>row?.id===mark && row.enabled!==false))
            throw new RangeError('A painting wave needs a unique enabled mark '+key);
          paints.set(key,row);
        }
      }
      animated ||= plan.time===undefined && plan.amplitude>0;
      const samples=[0,lock,length*.25,length*.5,length*.75,length].sort((a,b)=>a-b);
      reports.push({id,target,time:map.time,root:{at,axis,length,lock},amplitude:plan.amplitude,frequency:plan.frequency,
        samples:[...new Set(samples)].map(height=>{
          const {direction,phase,stiffness}=plan.profile(height);
          return {height,direction,phase:phase/rad,stiffness,offset:map.offset(height)};
        })});
    }
    return {geometry,paints,reports,animated};
  }

  function stroke(shape, frame, {plan,map}) {
    if (!plan.amplitude) return shape;
    const graph=K.sceneGraph, inverse=graph.inverse(frame);
    const guide=P.shapeSweeps.guidePoses(shape.poses,shape.path);
    const placed=guide.map(row=>({...row,point:graph.point(frame,row.point)})), poses=[];
    let changed=false;
    function add(row) {
      const moved=map.fwd(row.point);
      changed ||= V.dist(moved,row.point)>1e-12;
      poses.push({...row,point:graph.point(inverse,moved)});
      if (poses.length>1024) throw new RangeError('Wave exceeds 1024 step poses. Increase spacing');
    }
    add(placed[0]);
    for (let i=1;i<placed.length;i++) {
      const a=placed[i-1],b=placed[i], steps=Math.max(1,Math.ceil(V.dist(a.point,b.point)/plan.spacing));
      if (poses.length+steps>1024) throw new RangeError('Wave exceeds 1024 step poses. Increase spacing');
      const lo=plan.height(a.point),hi=plan.height(b.point),delta=hi-lo;
      const boundary=(plan.lock-lo)/delta;
      const stepsAt=Array.from({length:steps},(_,j)=>(j+1)/steps);
      if (boundary>0 && boundary<1 && Math.abs(boundary*steps-Math.round(boundary*steps))>1e-8)
        stepsAt.push(boundary);
      stepsAt.sort((a,b)=>a-b);
      for (const t of stepsAt) {
        add({point:V.lerp(a.point,b.point,t),rotation:Q.slerp(a.rotation,b.rotation,t),pressure:mix(a.pressure,b.pressure,t)});
      }
    }
    return changed?{...shape,poses,path:'free'}:shape;
  }

  P.paintWave=Object.freeze({format,prepare,scene,stroke});
})(KIT);
