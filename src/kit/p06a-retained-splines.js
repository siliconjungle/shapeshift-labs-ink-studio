/* Retained cubic splines and revision-scoped route attachment correspondence. */
(function (K) {
  const P = K.procedural, C = K.curve, { V, M, Q } = K;
  const { freeze, clone, hash } = P.data;
  const format = 'ink-studio/retained-splines';
  const documents = new WeakMap(), compiled = new WeakMap(), revisions = new WeakMap();
  const pointFields = ['position', 'inHandle', 'outHandle', 'radius', 'tilt'];
  const interval = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const unit = n => interval(n, 0, 1);
  const id = value => typeof value === 'string' && /^[\w][\w./-]{0,127}$/.test(value);
  const vector = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(n => interval(n, -1e5, 1e5));
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, names) => record(value) && Object.keys(value).every(name => names.includes(name));
  const mix = (a,b,t) => a + (b-a)*t;
  const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
  function need(ok, message) {
    if (!ok) throw new RangeError('Retained splines: ' + message);
  }

  function point(row) {
    need(fields(row, ['id', ...pointFields]) && id(row.id), 'invalid control point or ID');
    const { position, inHandle = [0,0,0], outHandle = [0,0,0], radius = .08, tilt = 0 } = row;
    need([position, inHandle, outHandle].every(vector) && [inHandle,outHandle].every(v=>vector(V.add(position,v))) &&
      interval(radius,1e-6,100) && interval(tilt,-64*Math.PI,64*Math.PI), 'invalid position, handle, radius or tilt on '+row.id);
    return {id:row.id,position:position.slice(),inHandle:inHandle.slice(),outHandle:outHandle.slice(),radius,tilt};
  }

  function create(source) {
    if (documents.has(source)) return source;
    need(fields(source,['format','version','id','splines','attachments']) && source.format===format &&
      source.version===1 && id(source.id) && Array.isArray(source.splines) &&
      source.splines.length>=1 && source.splines.length<=64, 'expected a version 1 document with 1–64 splines');
    const bySpline = new Map(), bySegment = new Map(), pointIds = new Set();
    const splines = Array.from(source.splines, row => {
      need(fields(row,['id','closed','up','points','segments']) && id(row.id) && !bySpline.has(row.id),
        'spline IDs must be distinct');
      const {closed=false,up=[0,1,0]} = row;
      need(typeof closed==='boolean' && vector(up) && V.len(up)>1e-8 && Array.isArray(row.points) &&
        row.points.length>=(closed ? 3 : 2) && row.points.length<=513 && Array.isArray(row.segments) &&
        row.segments.length===row.points.length-(closed ? 0 : 1), 'spline needs ordered points, connecting segments and a nonzero up vector');
      const points = Array.from(row.points, raw => {
        const p = point(raw);
        need(!pointIds.has(p.id), 'duplicate control point '+p.id);
        pointIds.add(p.id);
        return p;
      });
      const segments = Array.from(row.segments,(seg,i)=>{
        const a=points[i], b=points[(i+1)%points.length];
        need(fields(seg,['id','from','to']) && id(seg.id) && !bySegment.has(seg.id) &&
          seg.from===a.id && seg.to===b.id, 'segments need distinct IDs and consecutive control points');
        need(V.dist(a.position,b.position)>1e-8 || V.len(a.outHandle)>1e-8 || V.len(b.inHandle)>1e-8,
          'collapsed segment '+seg.id);
        bySegment.set(seg.id,row.id);
        return {id:seg.id,from:seg.from,to:seg.to};
      });
      const spline={id:row.id,closed,up:up.slice(),points,segments};
      bySpline.set(row.id,spline);
      return spline;
    });
    need(bySegment.size<=512, 'document exceeds the 512 segment budget');
    const input=source.attachments ?? [], attachmentIds=new Set();
    need(Array.isArray(input) && input.length<=4096, 'document exceeds the attachment budget');
    const attachments=Array.from(input,row=>{
      need(fields(row,['id','spline','segment','t']) && id(row.id) && !attachmentIds.has(row.id) &&
        id(row.spline) && bySegment.get(row.segment)===row.spline && unit(row.t), 'invalid or duplicate route attachment');
      attachmentIds.add(row.id);
      return {id:row.id,spline:row.spline,segment:row.segment,t:row.t};
    });
    const document=freeze({format,version:1,id:source.id,splines,attachments});
    documents.set(document,{bySpline,bySegment});
    return document;
  }

  function revision(source) {
    const doc=create(source);
    if (!revisions.has(doc)) {
      const serialized=JSON.stringify(doc);
      revisions.set(doc,[serialized.length,hash(serialized),hash(serialized,0x9e3779b9)].map(n=>n.toString(36)).join('-'));
    }
    return revisions.get(doc);
  }

  function controlNet(a,b) {
    return [a.position,V.add(a.position,a.outHandle),V.add(b.position,b.inHandle),b.position];
  }

  function cubic(net,t) {
    const [a,b,c,d]=net, u=1-t;
    return a.map((v,k)=>u**3*v+3*u*u*t*b[k]+3*u*t*t*c[k]+t**3*d[k]);
  }

  function bracket(values,n) {
    let lo=0, hi=values.length-1;
    while (hi-lo>1) {
      const mid=(lo+hi)>>1;
      if (values[mid]<=n) lo=mid;
      else hi=mid;
    }
    return lo;
  }

  function splinePath(doc,spline) {
    if (compiled.has(spline)) return compiled.get(spline);
    const knots=[], parameters=[], starts=[0], sections=new Map(), sectionsInOrder=[];
    const n=spline.segments.length, maxSegments=Math.min(128,Math.floor(4096/n));
    for (const [i,{id:key}] of spline.segments.entries()) {
      const a=spline.points[i], b=spline.points[(i+1)%spline.points.length], net=controlNet(a,b);
      const sampled=C.adaptive(t=>cubic(net,t),{closed:false,minSegments:8,maxSegments,tolerance:.0005});
      const lengths=[0];
      for (let j=1;j<sampled.points.length;j++) lengths.push(lengths.at(-1)+V.dist(sampled.points[j-1],sampled.points[j]));
      const section={key,a,b,net,lengths,parameters:sampled.parameters,start:starts.at(-1),length:lengths.at(-1),
        limited:sampled.sampling.limited};
      starts.push(section.start+section.length);
      sections.set(key,section);
      sectionsInOrder.push(section);
      knots.push(...sampled.points.slice(i ? 1 : 0));
      parameters.push(...sampled.parameters.slice(i ? 1 : 0).map(t=>(i+t)/n));
    }
    const rail=C.path(knots,{closed:spline.closed,up:spline.up});
    need(rail.points.length===parameters.length,'retained samples collapsed at a spline boundary');
    const total=starts.at(-1);
    let path;
    function sampleAddress(key,t) {
      const row=sections.get(key);
      need(row && unit(t), 'unknown segment or invalid cubic parameter');
      const i=bracket(row.parameters,t);
      const fraction=(t-row.parameters[i])/(row.parameters[i+1]-row.parameters[i]);
      const distance=row.start+mix(row.lengths[i],row.lengths[i+1],fraction);
      return {spline:spline.id,segment:key,t,station:clamp(distance/total,0,1),p:cubic(row.net,t),
        radius:mix(row.a.radius,row.b.radius,t),tilt:mix(row.a.tilt,row.b.tilt,t)};
    }
    function locateDistance(distance) {
      need(Number.isFinite(distance),'distance must be finite');
      const d=clamp(distance,0,total), row=sectionsInOrder[bracket(starts,d)];
      const local=clamp(d-row.start,0,row.length), i=bracket(row.lengths,local);
      const t=mix(row.parameters[i],row.parameters[i+1],(local-row.lengths[i])/(row.lengths[i+1]-row.lengths[i]));
      return {row,t};
    }
    function locate(station) {
      need(unit(station),'a route station must be between zero and one');
      const {row,t}=locateDistance(station*total);
      return sampleAddress(row.key,t);
    }
    function profileAt(distance) {
      need(Number.isFinite(distance),'distance must be finite');
      const wrapped=spline.closed ? ((distance%rail.length)+rail.length)%rail.length : distance;
      return locateDistance(wrapped/rail.length*total);
    }
    path=freeze({
      ...rail,id:spline.id,kind:'retained-spline',up:spline.up,parameters,
      breaks:Array.from({length:n+1},(_,i)=>i/n),
      sampling:{mode:'adaptive',segments:knots.length-1,limited:sectionsInOrder.some(row=>row.limited)},
      evaluate(u) {
        need(Number.isFinite(u),'parameter must be finite');
        const x=clamp(u,0,1)*n, i=Math.min(n-1,Math.floor(x));
        return cubic(sectionsInOrder[i].net,x-i);
      },
      closest(p) { return C.closest(path,p); },
      curvature(distance,options) { return C.curvature(path,distance,options); },
      sections:sectionsInOrder.map(({key,length,limited})=>({key,length,limited})),
      locate,anchor:sampleAddress,
      radiusAt(distance) {
        const {row,t}=profileAt(distance);
        return mix(row.a.radius,row.b.radius,t);
      },
      frame(distance) {
        const f=rail.frame(distance), {row,t}=profileAt(distance), tilt=mix(row.a.tilt,row.b.tilt,t);
        if (!tilt) return {...f,tilt};
        const N=V.add(V.mul(f.N,Math.cos(tilt)),V.mul(f.B,Math.sin(tilt)));
        const B=V.cross(f.T,N), matrix=M.cols(f.T,N,B);
        return {...f,N,B,matrix,rotation:Q.fromMatrix(matrix),tilt};
      },
      snapshot() {
        return clone({ ...doc,splines:[spline],attachments:doc.attachments.filter(row=>row.spline===spline.id) });
      }
    });
    compiled.set(spline,path);
    return path;
  }

  function compile(source,splineId) {
    const doc=create(source), {bySpline}=documents.get(doc);
    const spline=bySpline.get(splineId ?? (doc.splines.length===1 ? doc.splines[0].id : undefined));
    need(spline,'choose an existing spline ID');
    return splinePath(doc,spline);
  }

  function attached(doc,rows) {
    return rows.map(({id,spline,segment,t})=>({id,...compile(doc,spline).anchor(segment,t)}));
  }

  function inspect(source) {
    const doc=create(source);
    return { id:doc.id,revision:revision(doc),splines:doc.splines.map(spline=>{
      const {sections,length}=compile(doc,spline.id);
      return {...spline,sections,length};
    }),attachments:attached(doc,doc.attachments) };
  }

  function divide(splines,op) {
    const {segment,t,point:newPoint,rightSegment,newSpline,newStart}=op;
    need(fields(op,['op','segment','t','point','rightSegment','newSpline','newStart']) &&
      interval(t,1e-6,1-1e-6) && id(newPoint) && id(rightSegment) &&
      (newSpline===undefined ? newStart===undefined : id(newSpline)&&id(newStart)), 'invalid split request');
    const index=splines.findIndex(spline=>spline.segments.some(row=>row.id===segment));
    need(index>=0, 'unknown segment '+segment);
    const spline=splines[index], points=spline.points.slice(), segments=spline.segments.slice();
    need(!newSpline || !spline.closed,'open a closed spline at a knot before separating it');
    const i=segments.findIndex(row=>row.id===segment), j=(i+1)%points.length, a=points[i], b=points[j];
    const [p0,p1,p2,p3]=controlNet(a,b);
    const q0=V.lerp(p0,p1,t), q1=V.lerp(p1,p2,t), q2=V.lerp(p2,p3,t);
    const r0=V.lerp(q0,q1,t), r1=V.lerp(q1,q2,t), position=V.lerp(r0,r1,t);
    points[i]={...a,outHandle:V.sub(q0,p0)};
    points[j]={...b,inHandle:V.sub(q2,p3)};
    const middle={id:newPoint,position,inHandle:V.sub(r0,position),outHandle:V.sub(r1,position),
      radius:mix(a.radius,b.radius,t),tilt:mix(a.tilt,b.tilt,t)};
    points.splice(i+1,0,middle);
    segments.splice(i,1,{id:segment,from:a.id,to:newPoint},{id:rightSegment,from:newPoint,to:b.id});
    const next={...spline,points,segments};
    splines.splice(index,1,next);
    if (newSpline) cut(splines,{op:'cut',point:newPoint,newSpline,newStart});
    const from=[{id:a.id,weight:1-t},{id:b.id,weight:t}];
    const controls=[{id:newPoint,from},...(newStart?[{id:newStart,from}]:[])];
    return { mappings:[{from:segment,to:segment,fromRange:[0,t]},{from:segment,to:rightSegment,fromRange:[t,1]}],
      detail:{segment,point:newPoint,rightSegment,controls,...(newSpline && {newSpline,newStart})} };
  }

  function cut(splines,op) {
    const {point:idAt,newSpline,newStart}=op;
    need(fields(op,['op','point','newSpline','newStart']) && id(idAt) && id(newStart),'invalid cut request');
    const index=splines.findIndex(spline=>spline.points.some(row=>row.id===idAt));
    need(index>=0,'unknown control point '+idAt);
    const spline=splines[index], {points,segments}=spline, i=points.findIndex(row=>row.id===idAt);
    if (spline.closed) {
      need(newSpline===undefined,'cutting a loop keeps the original spline ID');
      const chain=[...segments.slice(i),...segments.slice(0,i)];
      chain[chain.length-1]={...chain.at(-1),to:newStart};
      splines[index]={...spline,closed:false,points:[...points.slice(i),...points.slice(0,i),{...points[i],id:newStart}],
        segments:chain};
    } else {
      need(i>0 && i<points.length-1 && id(newSpline),'cutting an open spline needs an interior point and a new spline ID');
      const right=segments.slice(i);
      right[0]={...right[0],from:newStart};
      splines.splice(index,1,{...spline,points:points.slice(0,i+1),segments:segments.slice(0,i)},
        {...spline,id:newSpline,points:[{...points[i],id:newStart},...points.slice(i+1)],segments:right});
    }
    return {mappings:[],detail:{point:idAt,newStart,controls:[{id:newStart,from:[{id:idAt,weight:1}]}],...(newSpline && {newSpline})}};
  }

  function directed(spline,reverse) {
    if (!reverse) return {points:spline.points.slice(),segments:spline.segments.slice()};
    return {
      points:spline.points.slice().reverse().map(p=>({...p,inHandle:p.outHandle,outHandle:p.inHandle,tilt:-p.tilt})),
      segments:spline.segments.slice().reverse().map(s=>({...s,from:s.to,to:s.from}))
    };
  }

  function join(doc,splines,op) {
    const {first,second,firstEnd,secondEnd,tolerance=1e-8,bridge}=op;
    need(fields(op,['op','first','second','firstEnd','secondEnd','tolerance','bridge']) &&
      first!==second && (bridge===undefined || id(bridge)),'invalid join request');
    const index=splines.findIndex(row=>row.id===first), other=splines.findIndex(row=>row.id===second);
    const a=splines[index], b=splines[other];
    need(a && b && !a.closed && !b.closed,'join needs two distinct open splines');
    const info=spline=>({start:spline.points[0].position,end:spline.points.at(-1).position,length:compile(doc,spline.id).length});
    const match=P.chainJoins.plan(info(a),info(b),{firstEnd,secondEnd,tolerance});
    need(match,'join endpoints are outside the requested tolerance');
    const {reverseFirst,reverseSecond}=match, left=directed(a,reverseFirst), right=directed(b,reverseSecond);
    const end=left.points.at(-1), start=right.points[0], gap=V.dist(end.position,start.position);
    let weld;
    if (bridge) left.segments.push({id:bridge,from:end.id,to:start.id});
    else {
      left.points[left.points.length-1]={...end,outHandle:start.outHandle};
      right.points.shift();
      right.segments[0]={...right.segments[0],from:end.id};
      weld={retainedPoint:end.id,removedPoint:start.id,positionDelta:gap,
        radiusDelta:end.radius-start.radius,tiltDelta:end.tilt-start.tilt};
    }
    splines[index]={...a,points:[...left.points,...right.points],segments:[...left.segments,...right.segments]};
    splines.splice(other,1);
    const mappings=[...(reverseFirst ? a.segments : []),...(reverseSecond ? b.segments : [])]
      .map(({id})=>({from:id,to:id,toRange:[1,0]}));
    return {mappings,detail:{first,second,reverseFirst,reverseSecond,gap,...(bridge ? {bridge} : {weld})}};
  }

  function setPoint(splines,op) {
    const {op:_kind,point:target,...patch}=op;
    need(fields(patch,pointFields) && Object.keys(patch).length>0,'set-point requires position, handles, radius or tilt');
    const index=splines.findIndex(spline=>spline.points.some(row=>row.id===target));
    need(index>=0,'unknown control point '+target);
    const spline=splines[index];
    splines[index]={...spline,points:spline.points.map(p=>p.id===target ? point({...p,...patch}) : p)};
    return {mappings:[],detail:{point:target,fields:Object.keys(patch).sort()}};
  }

  function sections(doc) {
    return doc.splines.flatMap(row=>compile(doc,row.id).sections);
  }

  function plan(source,request) {
    const before=create(source), inputRevision=revision(before);
    need(fields(request,['revision','operations']) && Array.isArray(request.operations) &&
      request.operations.length>0 && request.operations.length<=32,'expected 1–32 edit operations');
    need(request.revision===undefined || request.revision===inputRevision,'edit was authored against a different revision');
    let document=before;
    const operations=[], transforms=[];
    for (const op of request.operations) {
      need(record(op),'invalid edit operation');
      const splines=document.splines.slice();
      let result;
      if (op.op==='split') result=divide(splines,op);
      else if (op.op==='cut') result=cut(splines,op);
      else if (op.op==='join') result=join(document,splines,op);
      else if (op.op==='set-point') result=setPoint(splines,op);
      else throw new RangeError('Retained splines: unknown operation '+op.op);
      const draft=create({...document,splines,attachments:[]});
      const route=P.routeStations.remap(sections(document),sections(draft),result.mappings);
      const bySegment=documents.get(draft).bySegment;
      const move=(segment,t)=>{
        const dest=route.address(segment,t);
        need(dest,'edit lost the station on segment '+segment);
        return {spline:bySegment.get(dest.key),segment:dest.key,t:dest.t};
      };
      transforms.push(move);
      document=create({...draft,attachments:document.attachments.map(row=>({id:row.id,...move(row.segment,row.t)}))});
      operations.push({op:op.op,...result.detail,mappings:result.mappings});
    }
    function mapStation(spline,station) {
      let anchor=compile(before,spline).locate(station);
      for (const move of transforms) anchor=move(anchor.segment,anchor.t);
      return compile(document,anchor.spline).anchor(anchor.segment,anchor.t);
    }
    const output=attached(document,document.attachments);
    const attachments=attached(before,before.attachments).map((prior,i)=>({
      id:prior.id,before:prior,after:output[i],positionDelta:V.dist(prior.p,output[i].p)
    }));
    return {document,report:freeze({revision:inputRevision,outputRevision:revision(document),operations,attachments}),mapStation};
  }

  C.retained=Object.freeze({format,create,compile,inspect,revision,plan});
})(KIT);
