/* Retain surface coordinates, then rebuild finite curves from the posed root frames. */
const CurveGrowth = (() => {
  const K = KIT, {V} = K;
  const limit = 4096, axes = [0,1,2], tau = Math.PI*2;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const bounded = (n,lo,hi) => Number.isFinite(n) && n>=lo && n<=hi;
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && bounded(n,lo,hi);
  const vector = (value,size,test=Number.isFinite) => Array.isArray(value) && value.length===size && Array.from(value).every(test);
  const unitUV = value => vector(value,2,n=>bounded(n,0,1));
  const point = value => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length===3 && Array.from(value).every(n=>bounded(n,-1e5,1e5));
  const label = value => typeof value==='string' && value.length>0 && value.length<=128;
  function need(ok,message) {
    if (!ok) throw new RangeError('Surface strand growth: '+message);
  }
  const keys = (value,names) => record(value) && Object.keys(value).every(key=>names.includes(key));

  function frame(sample, fallback) {
    if (!sample) return null;
    const {p,n,bitangent}=sample;
    need(point(p) && point(n) && V.len(n)>1e-9,'a surface sample needs a finite position and nonzero normal');
    const normal=V.norm(n), along=sample.tangent ?? fallback ?? V.perp(normal);
    need(point(along) && (bitangent===undefined || point(bitangent)),'a surface frame needs finite tangent vectors');
    const tangent=V.norm(V.mad(along,normal,-V.dot(along,normal)),V.perp(normal));
    const across=V.cross(normal,tangent);
    return {p:Array.from(p),n:normal,tangent,bitangent:bitangent && V.dot(across,bitangent)<0 ? V.mul(across,-1) : across,
      ...(sample.triangle!==undefined && {triangle:sample.triangle,weights:sample.weights})};
  }

  function uvSurface({mesh,chart,intact}) {
    need((mesh!==undefined)!==(chart!==undefined),'a UV surface needs one mesh or chart');
    need(intact===undefined || typeof intact==='function','intact must be a UV mask function');
    const indexed=mesh===undefined ? undefined : K.sceneMeshes.uvAnchors(mesh,K);
    return {
      anchor(value) {
        const {uv,triangle}=Array.isArray(value) ? {uv:value} : value ?? {};
        need(unitUV(uv) && (triangle===undefined || indexed),'UV roots need normalized coordinates and an optional mesh triangle');
        return {uv:uv.slice(),binding:indexed?.bind(uv,triangle)};
      },
      context(context) {
        if (indexed) return {revision:indexed.revision(),context};
        const carrier=typeof chart==='function' ? chart(context) : chart;
        if (carrier==null) return {context};
        const sample=carrier.sample ?? carrier.samplePointNormal;
        need(typeof sample==='function','a UV chart needs a sampling method');
        return {carrier,sample:uv=>sample.call(carrier,uv),context};
      },
      changed(previous, next) { return !indexed || !!intact || previous.revision!==next.revision; },
      read(anchor,{carrier,sample,context}) {
        const {uv,binding}=anchor;
        if ((intact && !intact(uv,context)) || (carrier?.intact && !carrier.intact(uv))) return null;
        if (indexed) return binding ? frame(indexed.sample(binding)) : null;
        const value=sample?.(uv);
        if (!value || value.tangent!==undefined) return frame(value);
        // For charts that only publish position and normal, estimate the U direction.
        const u=uv[0], probe=[u<.9999 ? u+.0001 : u-.0001,uv[1]];
        const neighbor=sample(probe);
        return frame(value,point(neighbor?.p) && V.len(V.sub(neighbor.p,value.p))>1e-9 ?
          V.mul(V.sub(neighbor.p,value.p),Math.sign(probe[0]-u)) : undefined);
      }
    };
  }

  function sdfSurface({field,reach=.35,steps=32,minFacing=.35}) {
    const sparse=K.procedural.sparseBricks, spatial=K.procedural.spatial;
    need(field && bounded(reach,.001,100) && integer(steps,4,128) && bounded(minFacing,0,1),
      'an SDF surface needs a field, a bounded reach, and 4 to 128 search steps');
    return {
      anchor(value) {
        const {point:p,normal,tangent}=value ?? {};
        need(point(p) && point(normal) && V.len(normal)>1e-9 && (tangent===undefined || point(tangent)),
          'SDF roots need an XYZ seed point and nonzero outward normal');
        const axis=V.norm(normal);
        return {point:Array.from(p),normal:axis,tangent:tangent ? Array.from(tangent) : V.perp(axis),
          bounds:spatial.boxOf([V.mad(p,axis,-reach),V.mad(p,axis,reach)])};
      },
      context(context,previous) {
        const source=typeof field==='function' ? field(context) : field;
        const current=typeof source?.current==='function' ? source.current() : source;
        const bricks=current?.bricks ?? (sparse.isSnapshot(current) ? current : undefined);
        const surface=bricks ?? current?.trace ?? current;
        need(surface==null || typeof surface.distance==='function','an SDF field needs distance(x,y,z)');
        const dirty=bricks && current?.bounds===previous?.bounds && sparse.sharesBase(bricks,previous?.bricks) ?
          bricks.changesFrom(previous.bricks,{channel:'offset'}) : undefined;
        return {bricks,dirty,bounds:current?.bounds,read:surface && (p=>surface.distance(...p)),
          delta:Math.max(1e-5,Math.min(reach*.1,(bricks?.cell ?? .025)*.12))};
      },
      changed(previous,next,anchor) {
        return !next.dirty || next.dirty.some(box=>spatial.overlap(box,spatial.expand(anchor.bounds,next.delta)));
      },
      read(anchor,{read,bounds,delta}) {
        if (!read) return null;
        const {point:p,normal:axis,tangent}=anchor;
        const at=t=>V.mad(p,axis,t);
        function distance(point) {
          const value=read(point);
          need(Number.isFinite(value),'an SDF query must return a finite distance');
          return value;
        }
        let closest=Infinity, result, before=-reach, lowValue=distance(at(before));
        for (let i=1;i<=steps;i++) {
          const after=reach*(2*i/steps-1), highValue=distance(at(after));
          if (lowValue<=0 && highValue>=0 && (lowValue<0 || highValue>0)) {
            let low=before, high=after;
            for (let j=0;j<18;j++) {
              const mid=(low+high)*.5;
              if (distance(at(mid))<0) low=mid;
              else high=mid;
            }
            const t=lowValue===0 ? before : highValue===0 ? after : (low+high)*.5;
            const root=at(t);
            if (Math.abs(t)<closest && (!bounds || spatial.contains(bounds,root))) {
              const gradient=axes.map(k=>{
                const a=root.slice(), b=root.slice();
                a[k]+=delta;
                b[k]-=delta;
                return (distance(a)-distance(b))/(2*delta);
              });
              if (V.len(gradient)>1e-8 && V.dot(V.norm(gradient),axis)+1e-8>=minFacing) {
                closest=Math.abs(t);
                result=frame({p:root,n:gradient,tangent});
              }
            }
          }
          before=after;
          lowValue=highValue;
        }
        return result ?? null;
      }
    };
  }

  function scatterRoots(scatter, random) {
    if (scatter===undefined) return [];
    need(keys(scatter,['cells','min','max','jitter']),'scatter needs a UV grid');
    const {cells,min=[0,0],max=[1,1],jitter=.85}=scatter;
    need(vector(cells,2,n=>integer(n,1,limit)) && cells[0]*cells[1]<=limit &&
      unitUV(min) && unitUV(max) && min.every((n,i)=>n<max[i]) && bounded(jitter,0,1),'invalid scatter grid bounds or jitter');
    return Array.from({length:cells[0]*cells[1]},(_,i)=>{
      const grid=[i%cells[0],Math.floor(i/cells[0])], id='cell-'+grid.join('-');
      const uv=grid.map((n,k)=>min[k]+(max[k]-min[k])*(n+.5+jitter*(random.sample([id,k])-.5))/cells[k]);
      return {id,uv};
    });
  }

  function grow(builder,host,growth={},appearance={},initialContext={}) {
    need(keys(host,['kind','mesh','chart','intact','field','reach','steps','minFacing']) && ['uv','sdf'].includes(host.kind) &&
      (host.kind==='uv' ? host.field===undefined && host.reach===undefined && host.steps===undefined && host.minFacing===undefined :
        host.mesh===undefined && host.chart===undefined && host.intact===undefined),'expected a UV or SDF surface');
    need(keys(growth,['seed','roots','scatter','stitches','segments','length','lean','bend','offset']),'invalid growth settings');
    const {seed=0,roots=[],scatter,stitches=[],segments=7,length=.3,lean=.45,bend=.55,offset=0}=growth;
    const lengths=Array.isArray(length) ? length : [length,length];
    need((Number.isSafeInteger(seed) || label(seed)) && Array.isArray(roots) && Array.isArray(stitches) &&
      roots.length+stitches.length<=limit && (scatter===undefined || host.kind==='uv') &&
      integer(segments,2,32) && vector(lengths,2,n=>bounded(n,.0001,100)) && lengths[0]<=lengths[1] &&
      bounded(lean,-4,4) && bounded(bend,-4,4) && bounded(offset,-100,100),'invalid seed, size, or strand budget');
    const random=Randomness.create(seed).stream('surface-growth');
    const generated=scatterRoots(scatter,random);
    need(roots.length+stitches.length+generated.length<=limit &&
      (roots.length+stitches.length+generated.length)*segments<=K.curveSplats.segmentLimit,'surface growth exceeds the curve budget');
    const adapter=host.kind==='uv' ? uvSurface(host) : sdfSurface(host);
    let source=adapter.context(initialContext), updates, nextSamples;
    const specs=[], ids=new Set();
    let skipped=0;
    function append(id,attachments,{height,lift,heading=0,optional=false}) {
      need(label(id) && !ids.has(id),'strands need distinct IDs');
      ids.add(id);
      const anchors=attachments.map(value=>{
        const anchor=adapter.anchor(value);
        return {...anchor,live:adapter.read(anchor,source)};
      });
      if (anchors.some(anchor=>!anchor.live) && optional) { skipped++; return; }
      need(anchors.every(anchor=>anchor.live),'a strand root is outside its authored surface: '+id);
      if (anchors.length===2 && lift===0) need(V.dist(anchors[0].live.p,anchors[1].live.p)>1e-7,
        'a flat stitch needs distinct endpoints: '+id);
      specs.push({id,anchors,height,lift,heading});
    }
    for (const [index,value] of [...roots,...generated].entries()) {
      const root=Array.isArray(value) ? {uv:value} : value;
      need(keys(root,host.kind==='uv' ? ['id','uv','triangle','heading','length'] : ['id','point','normal','tangent','heading','length']),
        'invalid root coordinate or appearance');
      const id=root.id ?? 'root-'+index;
      need(label(id),'a root needs a stable ID');
      const height=root.length ?? lengths[0]+(lengths[1]-lengths[0])*random.sample([id,'length']);
      const heading=root.heading ?? tau*random.sample([id,'heading']);
      need(bounded(height,.0001,100) && bounded(heading,-1e6,1e6),'invalid root length or heading');
      append(id,[root],{height,heading,optional:index>=roots.length});
    }
    for (const [index,row] of stitches.entries()) {
      need(keys(row,['id','from','to','lift']),'a stitch needs two surface anchors and an optional lift');
      const {id='stitch-'+index,from,to,lift=.045}=row;
      need(bounded(lift,0,100),'invalid stitch lift');
      append(id,[from,to],{lift});
    }
    need(specs.length,'no growth roots land on the surface');
    const byId=new Map(specs.map(spec=>[spec.id,spec]));
    function strandPose(spec, sites) {
      const [a,b]=sites;
      const base=V.mad(a.p,a.n,offset);
      const tip=b && V.mad(b.p,b.n,offset);
      const points=Array.from({length:segments+1},(_,i)=>{
        const u=i/segments;
        if (b) {
          if (i===0) return base;
          if (i===segments) return tip;
          return V.mad(V.lerp(base,tip,u),V.norm(V.lerp(a.n,b.n,u),a.n),spec.lift*Math.sin(Math.PI*u));
        }
        const heading=spec.heading+bend*u;
        const direction=V.add(V.mul(a.tangent,Math.cos(heading)),V.mul(a.bitangent,Math.sin(heading)));
        return V.mad(V.mad(base,a.n,spec.height*u),direction,spec.height*lean*u*u);
      });
      return {points,up:a.tangent};
    }
    const threads=specs.map(spec=>({id:spec.id,path:strandPose(spec,spec.anchors.map(anchor=>anchor.live))}));
    const binding=K.curveSplats.bind(builder,{kind:'textile',plan:{threads}},rest=>{
      const sites=nextSamples.get(rest.id);
      return sites.every(Boolean) ? strandPose(byId.get(rest.id),sites) :
        {points:rest.points,active:Array(segments).fill(false)};
    },appearance);
    const rootCount=specs.reduce((count,row)=>count+row.anchors.length,0);
    updates={sampled:rootCount,reused:0,detached:0,reattached:0};
    function pose(world,context={}) {
      const sampled=adapter.context({world,...context},source), report={sampled:0,reused:0,detached:0,reattached:0};
      nextSamples=new Map(specs.map(spec=>[spec.id,spec.anchors.map(anchor=>{
        if (!adapter.changed(source,sampled,anchor)) { report.reused++; return anchor.live; }
        report.sampled++;
        const live=adapter.read(anchor,sampled);
        if (anchor.live && !live) report.detached++;
        if (!anchor.live && live) report.reattached++;
        return live;
      })]));
      const result=binding.pose(world,context);
      for (const spec of specs) spec.anchors.forEach((anchor,i)=>{anchor.live=nextSamples.get(spec.id)[i];});
      source=sampled;
      updates=report;
      return result;
    }
    function snapshot() {
      return {kind:host.kind,seed,skipped,updates:{...updates},strands:specs.map(({id,anchors})=>({
        id,attached:anchors.every(anchor=>anchor.live),roots:anchors.map(({uv,point,normal,live})=>({
          ...(uv ? {uv:uv.slice()} : {seedPoint:point.slice(),seedNormal:normal.slice()}),
          ...(live && {point:live.p.slice(),normal:live.n.slice(),
            ...(live.triangle!==undefined && {triangle:live.triangle,weights:live.weights.slice()})})
        }))
      }))};
    }
    return {...binding,pose,snapshot,post:(dt,time,stage,clock)=>pose(stage.W,{dt,time,stage,clock})};
  }

  return Object.freeze({grow,sdfSurface});
})();
