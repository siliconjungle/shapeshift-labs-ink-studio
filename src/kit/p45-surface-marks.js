/* Bake rest-space paint from solid edges, measured contacts and overhead cover. */
(function (K) {
  const { V } = K, { slab } = SceneOptics, { prepare, matches } = TargetSelectors;
  const up = [0,1,0], down = [0,-1,0], epsilon = .0015;
  const between = (n,lo,hi) => Number.isFinite(n) && n>=lo && n<=hi;
  const record = value => value && [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const point = value => Array.isArray(value) && value.length===3 && Array.from(value).every(n=>between(n,-1e7,1e7));
  function axis(value,label) {
    if (!point(value) || V.len(value)<1e-8) throw new TypeError(label+' needs a nonzero XYZ vector');
    return V.norm(value);
  }
  function bounds(value) {
    if (!record(value) || !point(value.min) || !point(value.max) || value.min.some((n,i)=>n>=value.max[i]))
      throw new RangeError('Surface marks need ordered XYZ bounds');
    return value;
  }
  const contains = (box,p) => p.every((n,i)=>n>=box.min[i]-epsilon && n<=box.max[i]+epsilon);
  const targetMatches = (selector,hit) => hit && (!selector || matches(selector,hit.target));

  function tracer(sources, budget) {
    let work = 0;
    function spend(probes=1) {
      work+=probes;
      if (work > budget) throw new RangeError('Surface marks exceed their geometry probe budget');
    }
    return function cast(origin,direction,reach) {
      let best = null;
      for (const source of sources) {
        spend();
        const { bounds:{min,max}, distance, locate, accepts } = source;
        const range = [0,best?.distance ?? reach];
        if (min.some((n,i)=>!slab(range,origin[i],direction[i],n,max[i]))) continue;
        let t = range[0];
        const p = [0,0,0];
        for (let j=0; j<128 && t<=range[1]; j++) {
          for (let i=0;i<3;i++) p[i]=origin[i]+t*direction[i];
          spend();
          const d = distance(...p);
          if (!Number.isFinite(d)) break;
          if (Math.abs(d)>epsilon) {
            t+=Math.abs(d)*.72;
            continue;
          }
          if (!accepts || accepts(...p)) {
            spend(7);
            const [x,y,z]=p, { owner,body }=locate(x,y,z);
            const solid=owner ?? body;
            const gradient=[
              distance(x+epsilon,y,z)-distance(x-epsilon,y,z),
              distance(x,y+epsilon,z)-distance(x,y-epsilon,z),
              distance(x,y,z+epsilon)-distance(x,y,z-epsilon)
            ];
            const magnitude=V.len(gradient);
            if (solid && magnitude>1e-9 && Number.isFinite(magnitude)) {
              const target={object:solid.renderOwner,entity:solid.renderOwner,material:solid.mat.materialId,
                surface:solid.mat.surfaceId ?? solid.mat.surface?.id,
                ...(solid.tag && {tags:[solid.tag]}),...solid.renderTarget};
              best={point:p,normal:V.mul(gradient,1/magnitude),target,distance:t};
              break;
            }
          }
          t+=8*epsilon;
        }
      }
      return best;
    };
  }

  // Extents of a world-space box measured in the scan's local axes.
  function interval(box,axis) {
    const center=V.dot(V.lerp(box.min,box.max,.5),axis);
    const span=V.dot(V.sub(box.max,box.min),axis.map(Math.abs))*.5;
    return [center-span,center+span];
  }
  function sweep([lo,hi],step) {
    const count=Math.ceil((hi-lo)/step);
    if (count>16384) throw new RangeError('Surface mark sweep exceeds its sample budget');
    return Array.from({length:count},(_,i)=>lo+(i+.5)*(hi-lo)/count);
  }
  const projected = (p,n,reach,cast) => cast(V.mad(p,n,reach),V.mul(n,-1),2*reach);
  function patch(hit,heading,length,width,amount,grain,step,cast,select,random,write) {
    const {point:p,normal:n}=hit;
    const u=V.norm(V.mad(heading,n,-V.dot(heading,n)),V.perp(n)), v=V.cross(n,u);
    const phase=random()*Math.PI*2, reach=step*1.8;
    for (const a of sweep([-length*.5,length*.5],step)) for (const b of sweep([-width*.5,width*.5],step)) {
      const x=2*a/length, y=2*b/width;
      const radius=Math.hypot(x,y), rim=1-grain*(.14+.12*Math.cos(Math.atan2(y,x)*5+phase));
      if (radius>rim || random()<grain*radius*.30) continue;
      const sample=projected(V.mad(V.mad(p,u,a),v,b),n,reach,cast);
      if (targetMatches(select,sample) && V.dot(n,sample.normal)>.62)
        write(sample,amount*K.clamp((rim-radius)*3+.22,0,1),random);
    }
  }

  function scuffs(layer,cast,select,step,random,write) {
    const { contacts, length=.36, width=.16, reach=.15, loadReference=1 }=layer;
    if (!Array.isArray(contacts) || contacts.length>4096 ||
        ![length,width,reach].every(n=>between(n,.005,10)) || !between(loadReference,1e-6,1e9))
      throw new RangeError('Scuffs need up to 4096 contacts and bounded length, width, reach and load reference');
    const ids=new Set();
    for (const contact of contacts) {
      if (!record(contact) || !point(contact.point)) throw new TypeError('A scuff contact needs a finite XYZ point');
      const {normal=up,heading,weight,load,id,material}=contact;
      const n=axis(normal,'Contact normal');
      if (heading !== undefined && !point(heading)) throw new TypeError('Contact heading needs a finite XYZ vector');
      const direction=heading && V.len(heading)>1e-8 ? V.norm(heading) : V.perp(n);
      if (!between(weight ?? 1,0,1e12) || !between(load ?? 1,0,1e12) ||
          (id !== undefined && (typeof id!=='string' || !id.length)))
        throw new RangeError('Scuff contact weight, load or ID is out of range');
      const force=(weight ?? 1)*(load==null ? 1 : load/loadReference);
      if (id !== undefined && ids.has(id)) continue;
      if (id !== undefined) ids.add(id);
      if (!force) continue;
      const hit=projected(contact.point,n,reach,cast);
      if (targetMatches(select,hit) && V.dot(n,hit.normal)>.62 && (material==null || material===hit.target.material)) {
        patch(hit,direction,length,width,Math.min(1,force),.75,step,cast,select,random,(sample,amount,rng)=>{
          if (material==null || material===sample.target.material) write(sample,amount,rng);
        });
      }
    }
  }

  function drips(layer,cast,select,step,random,write) {
    const box=bounds(layer.bounds);
    const { direction=[0,0,1], edge, interval:spacing=.32, length=1, width=.12, reach=.70,
      minDrop=.16, startDrop=.32, density=.86 }=layer;
    if (![spacing,length,width,reach,minDrop,startDrop].every(n=>between(n,.005,50)) || !between(density,0,1))
      throw new RangeError('Drips need bounded dimensions and density');
    const supplied=axis(direction,'Drip direction');
    if (Math.abs(supplied[1])>1e-8) throw new RangeError('Drip direction must be horizontal');
    const outward=V.norm([supplied[0],0,supplied[2]]), sideways=V.cross(up,outward);
    const edgeSelect=edge===undefined ? null : prepare(edge);
    const across=sweep(interval(box,sideways),spacing), depth=sweep(interval(box,outward),Math.min(spacing,.12));
    if (across.length*depth.length>65536) throw new RangeError('Drip edge scan exceeds its sample budget');
    const y=box.max[1]+8*epsilon, travel=y-box.min[1]+epsilon;
    function top(a,b) {
      const origin=V.mad(V.mad([0,y,0],sideways,a),outward,b);
      const hit=cast(origin,down,travel);
      return hit && contains(box,hit.point) ? hit : null;
    }
    for (const column of across) {
      const a=column+(random()-.5)*spacing*.46;
      let previous=null;
      for (let i=0;i<depth.length;i++) {
        const current=top(a,depth[i]);
        if (targetMatches(edgeSelect,previous) && previous.normal[1]>.25 &&
            (!current || previous.point[1]-current.point[1]>=minDrop) && random()<density) {
          let low=depth[i-1], high=depth[i], lip=previous;
          // Approach the detected drop from the top side instead of planting on a scan-cell center.
          for (let refine=0;refine<5;refine++) {
            const mid=(low+high)*.5, sample=top(a,mid);
            if (targetMatches(edgeSelect,sample) && sample.point[1]>previous.point[1]-minDrop*.5) {
              lip=sample;
              low=mid;
            } else high=mid;
          }
          const run=length*(.48+.52*random()), breadth=width*(.64+.54*random());
          const bend=(random()-.5)*breadth*.60;
          let last=null;
          for (let d=step*.7; d<=run; d+=step) {
            const taper=1-.82*d/run, center=V.mad(V.mad(lip.point,down,d),sideways,bend*Math.sin(d*9));
            const origin=V.mad(center,outward,Math.min(reach*.28,.14));
            const hit=cast(origin,V.mul(outward,-1),reach);
            if (!targetMatches(select,hit) || V.dot(hit.normal,outward)<.40 ||
                (last && V.dist(last.point,hit.point)>step*2.2)) {
              if (last || d>=startDrop) break;
              continue;
            }
            if (!last && d>startDrop) break;
            last=hit;
            const weight=.38+.62*taper, radius=breadth*.5*taper;
            write(hit,weight,random);
            for (const offset of sweep([-radius,radius],step)) {
              if (Math.abs(offset)<step*.38) continue;
              const side=cast(V.mad(origin,sideways,offset),V.mul(outward,-1),reach);
              if (targetMatches(select,side) && V.dot(side.normal,hit.normal)>.65 &&
                  V.dist(side.point,hit.point)<=Math.abs(offset)+step)
                write(side,weight*(1-.62*Math.abs(offset)/radius),random);
            }
          }
        }
        previous=current;
      }
    }
  }

  function lichen(layer,cast,select,step,random,write) {
    const box=bounds(layer.bounds);
    const { direction=[0,0,1], interval:spacing=.42, radius=.16, shelterReach=1.8,
      minShelter=2/3,density=.65 }=layer;
    if (![spacing,radius,shelterReach].every(n=>between(n,.005,50)) ||
        !between(density,0,1) || !between(minShelter,1/3,1))
      throw new RangeError('Lichen needs bounded spacing, radius, shelter reach, threshold and density');
    const outward=axis(direction,'Lichen direction'), u=V.perp(outward), v=V.cross(outward,u);
    const [lo,hi]=interval(box,outward), across=sweep(interval(box,u),spacing), vertical=sweep(interval(box,v),spacing);
    if (across.length*vertical.length>65536) throw new RangeError('Lichen scan exceeds its sample budget');
    const start=V.mul(outward,hi+8*epsilon);
    function sheltered(hit) {
      const outside=V.mad(hit.point,hit.normal,epsilon*8);
      let blocked=0;
      for (const offset of [-.42,0,.42]) {
        const sky=V.norm(V.mad(V.mad(up,u,offset),hit.normal,.28));
        if (cast(outside,sky,shelterReach)) blocked++;
      }
      return blocked/3>=minShelter;
    }
    for (const x of across) for (const y of vertical) {
      if (random()>=density) continue;
      const origin=V.mad(V.mad(start,u,x+(random()-.5)*spacing*.94),v,y+(random()-.5)*spacing*.94);
      const hit=cast(origin,V.mul(outward,-1),hi-lo+9*epsilon);
      if (!targetMatches(select,hit) || !contains(box,hit.point) || V.dot(hit.normal,outward)<.40 || !sheltered(hit)) continue;
      const size=2*radius*(.42+.58*random());
      patch(hit,u,size,size*(.72+.36*random()),.95,.93,step,cast,select,random,(sample,weight,rng)=>{
        if (contains(box,sample.point) && sheltered(sample)) write(sample,weight,rng);
      });
    }
  }

  const modes={ drips, scuffs, lichen };
  const fields={
    drips:['bounds','direction','edge','interval','length','width','reach','minDrop','startDrop','density'],
    scuffs:['contacts','length','width','reach','loadReference'],
    lichen:['bounds','direction','interval','radius','shelterReach','minShelter','density']
  };
  function bake(world,recipe) {
    if (!record(recipe) || Object.keys(recipe).some(key=>!['version','seed','maxWork','maxSamples','layers'].includes(key)))
      throw new TypeError('Expected a surface mark recipe');
    const {version=1,seed=1,maxWork=1400000,maxSamples=12000,layers}=recipe;
    if (version!==1 || !Number.isSafeInteger(seed) || !Number.isSafeInteger(maxWork) || !between(maxWork,1,8000000) ||
        !Number.isSafeInteger(maxSamples) || !between(maxSamples,1,64000) || !Array.isArray(layers) || !between(layers.length,1,32))
      throw new RangeError('Surface mark recipe needs version 1, a seed, work limits and 1–32 layers');
    const sources=world?.renderSdfs;
    if (!Array.isArray(sources) || !between(sources.length,1,64) || !world.pal?.length)
      throw new TypeError('Surface marks need a scene with retained solid SDF geometry and a palette');
    const cast=tracer(sources,maxWork), streams=Randomness.create(seed), ids=new Set();
    let placed=0;
    return {layers:Array.from(layers,layer=>{
      if (!record(layer) || !PaintCorrections.idOK(layer.id) || !Object.hasOwn(modes,layer.kind) || ids.has(layer.id) ||
          Object.keys(layer).some(key=>!['id','kind','select','color','spacing','opacity','region',...fields[layer.kind]].includes(key)))
        throw new TypeError('Invalid or duplicate surface mark layer');
      const {id,kind,opacity,region,spacing=1/(world.detail || 12)}=layer;
      ids.add(id);
      const colors=Array.isArray(layer.color) ? layer.color : [layer.color];
      if (!between(colors.length,1,8) ||
          !Array.from(colors).every(index=>Number.isSafeInteger(index) && between(index,0,world.pal.length-1)) ||
          !between(spacing,.005,5))
        throw new RangeError('Surface marks need valid palette slots and positive sample spacing');
      const style=PaintCorrections.layer({id,type:'surface',opacity,region});
      const select=layer.select===undefined ? null : prepare(layer.select);
      const samples=new Map(), random=streams.stream(id).next;
      function write({point:p,normal:n},weight,rng) {
        const key=p.map(v=>Math.round(v/(spacing*.50))).concat(n.map(v=>Math.round(v*2))).join('/');
        const old=samples.get(key);
        if (old && old[7]>=weight) return;
        if (!old && ++placed>maxSamples) throw new RangeError('Surface marks exceed their paint sample budget');
        const slot=colors[Math.floor(rng()*colors.length)];
        samples.set(key,[...p,...n,slot,weight]);
      }
      modes[kind](layer,cast,select,spacing,random,write);
      return { ...style,decals:[...samples.values()] };
    })};
  }
  K.surfaceMarks=Object.freeze({bake});
})(KIT);
