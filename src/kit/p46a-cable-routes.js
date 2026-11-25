/* Retained socket routes with bounded search, smooth pins and clearance evidence. */
(function (K) {
  const P=K.procedural, {V,M}=K, {freeze}=P.data;
  const format='ink-studio/socket-cable', eps=1e-8;
  const names=['x-','x+','y-','y+','z-','z+'];
  const zero=[0,0,0];
  const finite=n=>Number.isFinite(n)&&Math.abs(n)<=1e5;
  const bounded=(n,a,b)=>finite(n)&&n>=a&&n<=b;
  const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
  const vec=(v,n=3)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(finite);
  const unit=v=>vec(v,2)&&v.every(n=>bounded(n,0,1));
  const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,95}$/.test(s);
  const fields=(row,list)=>row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).every(key=>list.includes(key));
  const documents=new WeakSet();
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const need=(ok,message)=>{if(!ok)throw new RangeError('Socket cable: '+message);};
  const direction=v=>vec(v)&&V.len(v)>eps;
  const normalized=v=>V.mul(v,1/V.len(v));
  function socket(raw) {
    need(fields(raw,['node','socket','axis','lead','offset'])&&id(raw.node)&&id(raw.socket),'endpoints need named scene sockets');
    const {node,socket,axis=[0,0,1],lead=0,offset=zero}=raw;
    need(direction(axis)&&bounded(lead,0,10000)&&vec(offset),'invalid socket exit axis, lead or offset');
    return {node,socket,axis:axis.slice(),lead,offset:offset.slice()};
  }
  function create(raw) {
    if(documents.has(raw))return raw;
    need(fields(raw,['format','version','id','from','to','waypoints','obstacles','radius','clearance','bendRadius','slack',
      'length','gravity','spacing','maxTests'])&&raw.format===format&&raw.version===1&&id(raw.id),
      'expected a version 1 cable document');
    const {radius=.05,clearance=.04,bendRadius=.15,slack=0,length,gravity=[0,-1,0],spacing=.035,
      maxTests=320000}=raw;
    need(bounded(radius,.001,100)&&bounded(clearance,0,1e4)&&bounded(bendRadius,radius,1e4)&&
      bounded(spacing,.001,1)&&direction(gravity)&&bounded(slack,0,1e4)&&
      (length===undefined||raw.slack===undefined&&bounded(length,.001,1e5))&&integer(maxTests,1,2000000),
      'invalid gauge, slack, bend, sampling or work settings');
    const obstacles=raw.obstacles??[], ids=new Set();
    need(Array.isArray(obstacles)&&obstacles.length<=24,'use at most 24 obstacle boxes');
    const boxes=Array.from(obstacles,row=>{
      need(fields(row,['id','min','max'])&&id(row.id)&&!ids.has(row.id)&&vec(row.min)&&vec(row.max)&&
        row.min.every((v,k)=>row.max[k]-v>eps),'obstacle boxes need unique IDs and positive bounds');
      ids.add(row.id);
      return {id:row.id,min:row.min.slice(),max:row.max.slice()};
    });
    const input=raw.waypoints??[], pins=new Set();
    need(Array.isArray(input)&&input.length<=24,'use at most 24 ordered waypoints');
    const waypoints=Array.from(input,row=>{
      need(fields(row,['id','point','direction','contact'])&&id(row.id)&&!['from','to','lead-from','lead-to'].includes(row.id)&&
        !pins.has(row.id)&&(row.direction===undefined||direction(row.direction))&&
        (row.contact===undefined ? vec(row.point) : row.point===undefined),'waypoints need an ID and a point or contact');
      pins.add(row.id);
      const base={id:row.id,...(row.direction&&{direction:row.direction.slice()})};
      if(row.point)return {...base,point:row.point.slice()};
      const c=row.contact;
      need(fields(c,['obstacle','face','uv','reach'])&&ids.has(c.obstacle)&&names.includes(c.face)&&
        unit(c.uv)&&bounded(c.reach??Math.max(bendRadius*3,radius*6),radius,1e4),
        'contact needs an obstacle face, unit UV and positive local reach');
      return {...base,contact:{obstacle:c.obstacle,face:c.face,uv:c.uv.slice(),reach:c.reach??Math.max(bendRadius*3,radius*6)}};
    });
    const document=freeze({format,version:1,id:raw.id,from:socket(raw.from),to:socket(raw.to),
      waypoints,obstacles:boxes,radius,clearance,bendRadius,...(length===undefined?{slack}:{length}),
      gravity:gravity.slice(),spacing,maxTests});
    documents.add(document);
    return document;
  }

  function boxDistance(p,box) {
    const outside=p.map((v,k)=>Math.max(box.min[k]-v,v-box.max[k],0));
    if(outside.some(Boolean))return V.len(outside);
    return Math.max(...p.map((v,k)=>Math.max(box.min[k]-v,v-box.max[k])));
  }

  // The nearest point of a straight rendered chord to an AABB. Split at
  // slab crossings, then minimize the quadratic squared distance per interval.
  function closestBox(a,b,box) {
    const d=V.sub(b,a), cuts=[0,1];
    for(let k=0;k<3;k++)if(Math.abs(d[k])>eps)for(const c of [box.min[k],box.max[k]]){
      const t=(c-a[k])/d[k];
      if(t>0&&t<1)cuts.push(t);
    }
    cuts.sort((p,q)=>p-q);
    let closest=null;
    for(let i=1;i<cuts.length;i++){
      const lo=cuts[i-1],hi=cuts[i],mid=V.mad(a,d,(lo+hi)/2);
      let linear=0,square=0;
      for(let k=0;k<3;k++){
        const bound=clamp(mid[k],box.min[k],box.max[k]);
        if(bound!==mid[k]){
          linear+=d[k]*(a[k]-bound);
          square+=d[k]*d[k];
        }
      }
      const t=square ? clamp(-linear/square,lo,hi) : lo, point=V.mad(a,d,t);
      const distance=boxDistance(point,box);
      if(!closest||distance<closest.distance)closest={t,point,distance};
    }
    return closest;
  }

  function pinsFor(source,graph) {
    const read=ref=>{
      const frame=graph.frame({node:ref.node,socket:ref.socket});
      const point=K.sceneGraph.point(frame,ref.offset), axis=M.app(frame.matrix,ref.axis);
      need(vec(point)&&direction(axis),'socket frame exceeds the cable coordinate range');
      return {point,axis:normalized(axis)};
    };
    const from=read(source.from),to=read(source.to);
    const first={id:'from',point:from.point,direction:from.axis,kind:'socket'},
      last={id:'to',point:to.point,direction:V.mul(to.axis,-1),kind:'socket'};
    const pins=[first];
    if(source.from.lead) pins.push({id:'lead-from',point:V.mad(from.point,from.axis,source.from.lead),
      direction:from.axis,kind:'lead'});
    for(const row of source.waypoints) {
      if(!row.contact){pins.push({...row,kind:'pin'});continue;}
      const {contact}=row,box=source.obstacles.find(box=>box.id===contact.obstacle);
      const face=names.indexOf(contact.face),axis=face>>1,sign=face%2?1:-1,normal=[0,0,0];
      normal[axis]=sign;
      const across=[0,1,2].filter(k=>k!==axis),p=box.min.slice();
      p[axis]=(sign>0?box.max:box.min)[axis]+sign*source.radius;
      across.forEach((k,i)=>{p[k]+=(box.max[k]-box.min[k])*contact.uv[i];});
      pins.push({...row,point:p,normal,kind:'contact'});
    }
    if(source.to.lead) pins.push({id:'lead-to',point:V.mad(to.point,to.axis,source.to.lead),
      direction:last.direction,kind:'lead'});
    pins.push(last);
    need(pins.every(row=>vec(row.point)),'cable lead exceeds the coordinate range');
    return pins;
  }

  function tangents(points) {
    return points.map((row,i)=>{
      const lead=i>0&&normalized(V.sub(row.point,points[i-1].point));
      const tail=i+1<points.length&&normalized(V.sub(points[i+1].point,row.point));
      let chosen=row.direction??(lead&&tail?V.add(lead,tail):lead||tail);
      if(row.normal){
        if(row.direction&&Math.abs(V.dot(normalized(row.direction),row.normal))>1e-6) return null;
        chosen=V.mad(chosen,row.normal,-V.dot(chosen,row.normal));
      }
      return direction(chosen)?normalized(chosen):null;
    });
  }

  function controls(nodes,source,scale) {
    const directions=tangents(nodes);
    if(directions.includes(null))return null;
    return nodes.slice(1).map((tail,i)=>{
      const head=nodes[i],a=head.point,b=tail.point,chord=V.dist(a,b),axis=V.mul(V.sub(b,a),1/chord);
      const lead=head.id==='from'&&tail.id==='lead-from'||head.id==='lead-to'&&tail.id==='to';
      const start=V.mad(a,directions[i],chord*scale),end=V.mad(b,directions[i+1],-chord*scale);
      const down=V.mad(source.gravity,axis,-V.dot(source.gravity,axis));
      const sag=lead?zero:V.mul(V.len(down)>eps?normalized(down):V.perp(axis),chord);
      // Keep any extra sag away from the tangent neighbourhood of a support.
      const powerA=head.kind==='contact'?3:2, powerB=tail.kind==='contact'?3:2;
      return {a,b,start,end,sag,chord,to:tail.id,lead,powerA,powerB};
    });
  }

  function evaluate({a,b,start,end,sag,powerA:m,powerB:n},t,amplitude,derivative=false) {
    const s=1-t, scale=2**(m+n)*amplitude;
    if(!derivative) {
      if(t===0)return a;
      if(t===1)return b;
      const bulge=scale*t**m*s**n;
      return a.map((v,k)=>s*s*s*v+3*s*s*t*start[k]+3*s*t*t*end[k]+t*t*t*b[k]+bulge*sag[k]);
    }
    const d=scale*(m*t**(m-1)*s**n-n*t**m*s**(n-1));
    const dd=scale*(m*(m-1)*t**(m-2)*s**n-2*m*n*t**(m-1)*s**(n-1)+n*(n-1)*t**m*s**(n-2));
    const first=a.map((v,k)=>3*s*s*(start[k]-v)+6*s*t*(end[k]-start[k])+3*t*t*(b[k]-end[k])+d*sag[k]);
    const second=a.map((v,k)=>6*s*(end[k]-2*start[k]+v)+6*t*(b[k]-2*end[k]+start[k])+dd*sag[k]);
    const speed=V.len(first);
    if(speed<=eps)return 0;
    const cross=V.len(V.cross(first,second));
    return cross<=eps ? Infinity : speed**3/cross;
  }

  function fit(segments,source,budget) {
    const chord=segments.reduce((sum,row)=>sum+row.chord,0);
    const extra=source.length===undefined?source.slack:Math.max(0,source.length-chord);
    const counts=segments.map(row=>Math.max(8,Math.ceil((row.chord*1.35+extra*row.chord/chord)/source.spacing)));
    const count=counts.reduce((sum,n)=>sum+n,0);
    if(count>4096)return {failure:'sample-budget'};
    function sample(amplitude,keep=false) {
      const points=keep?[segments[0].a]:null, distances=keep?[0]:null, at=new Map();
      let length=0,minRadius=Infinity,bend=null,p=segments[0].a;
      for(const [i,seg] of segments.entries()){
        const n=counts[i];
        budget.spend(keep?4*n:n);
        for(let j=0;j<=n;j++){
          const t=j/n,q=evaluate(seg,t,amplitude);
          if(j){
            length+=V.dist(p,q);p=q;
            if(keep){points.push(q);distances.push(length);}
          }
        }
        if(keep){
          for(let j=0;j<=n*3;j++){
            const t=j/(n*3),radius=evaluate(seg,t,amplitude,true);
            if(radius<minRadius){minRadius=radius;bend={point:evaluate(seg,t,amplitude),radius,span:i,t};}
          }
          if(seg.to)at.set(seg.to,length);
        }
      }
      return {points,distances,length,minRadius,bend,at};
    }
    const base=sample(0).length,target=source.length??base+source.slack;
    if(target<base-1e-6)return {failure:'too-short',target,minimum:base};
    if(target-base<=1e-6)return {...sample(0,true),target,baseline:base};
    if(segments.every(row=>row.lead))return {failure:'no-free-span'};
    let lo=0,hi=.125;
    while(sample(hi).length<target){
      hi*=2;
      if(hi>32)return {failure:'slack-unreachable',target,minimum:base};
    }
    for(let i=0;i<26;i++){
      const mid=(lo+hi)/2;
      if(sample(mid).length<target)lo=mid;else hi=mid;
    }
    return {...sample((lo+hi)/2,true),target,baseline:base};
  }

  function search(pins,source,guard,budget) {
    const nodes=[pins[0]];
    for(const [index,a] of pins.slice(0,-1).entries()){
      const b=pins[index+1];
      if(V.dist(a.point,b.point)<=eps)return {failure:'coincident-pins',pins:[a.id,b.id]};
      const lead=a.id==='from'&&b.id==='lead-from'||a.id==='lead-to'&&b.id==='to';
      const allowances=new Set([a.contact?.obstacle,b.contact?.obstacle]);
      const envelopes=source.obstacles.map(box=>{
        const margin=source.radius+(allowances.has(box.id)?0:source.clearance+guard);
        return P.spatial.expand(box,margin);
      });
      const vertical=Math.hypot(a.point[0]-b.point[0],a.point[2]-b.point[2])<eps;
      const clearVertical=box=>[0,2].some(k=>a.point[k]<=box.min[k]+eps||a.point[k]>=box.max[k]-eps) ||
        Math.max(a.point[1],b.point[1])<=box.min[1]+eps || Math.min(a.point[1],b.point[1])>=box.max[1]-eps;
      if(lead || !envelopes.length || vertical&&envelopes.every(clearVertical)){
        nodes.push(b);continue;
      }
      const prisms=envelopes.map(({min,max})=>({
        ring:[[min[0],min[2]],[max[0],min[2]],[max[0],max[2]],[min[0],max[2]]],min:min[1],max:max[1]
      }));
      const found=P.routes.prismVisibility(a.point,b.point,prisms,{maxTests:budget.left(),maxGrade:1e6});
      budget.spend(found.work.tests);
      if(found.status!=='ok')return {failure:'search-'+found.status,pins:[a.id,b.id]};
      nodes.push(...found.points.slice(1,-1).map(point=>({point,kind:'guide'})),b);
    }
    if(nodes.length>256)return {failure:'guide-budget'};
    return {nodes};
  }

  function certify(result,source,pins,field,budget) {
    const tight=new Map(), contacts=new Map(), failures=[];
    const at=id=>id==='from'?0:result.at.get(id);
    for(const pin of pins)if(pin.contact) {
      const distance=at(pin.id);
      contacts.set(pin.id,{id:pin.id,obstacle:pin.contact.obstacle,face:pin.contact.face,point:pin.point,distance});
    }
    function wanted(id,station){
      let factor=1;
      for(const pin of pins)if(pin.contact?.obstacle===id){
        const t=clamp(Math.abs(station-at(pin.id))/pin.contact.reach,0,1);
        factor=Math.min(factor,t*t*(3-2*t));
      }
      return source.clearance*factor;
    }
    const {points,distances}=result;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],along=t=>distances[i-1]+t*(distances[i]-distances[i-1]);
      const bounds=P.spatial.expand(P.spatial.boxOf([a,b]),source.radius+source.clearance+source.spacing);
      for(const solid of field.query(bounds)){
        budget.spend(1);
        const closest=closestBox(a,b,solid.bounds);
        const measured=closest.distance-source.radius, gap=Math.abs(measured)<1e-10 ? 0 : measured;
        const evidence={obstacle:solid.id,gap,point:closest.point,distance:along(closest.t)};
        if(!tight.has(solid.id)||gap<tight.get(solid.id).gap)tight.set(solid.id,evidence);
        if(gap<-1e-7&&failures.length<16) failures.push({kind:'penetration',...evidence});
        for(const t of [0,.5,1,closest.t]){
          const p=V.lerp(a,b,t),gap=solid.distance(p)-source.radius,distance=along(t),required=wanted(solid.id,distance);
          if(gap+1e-7<required&&failures.length<16)
            failures.push({kind:'clearance',obstacle:solid.id,gap,required,point:p,distance});
        }
      }
    }
    return {failures,clearance:[...tight.values()],contacts:[...contacts.values()]};
  }

  function plan(input,{graph}={}) {
    const source=create(input), {maxTests}=source;
    const scene=typeof graph?.frame==='function'?graph:K.sceneGraph.create(graph);
    const badBudget=Symbol('cable budget');
    let used=0,last, attempts=0;
    const tried=new Set();
    const budget={left:()=>Math.max(1,maxTests-used),spend:n=>{used+=n;if(used>maxTests)throw badBudget;}};
    const report=(status,extras={})=>freeze({format:'ink-studio/socket-cable-plan',version:1,
      status,source:source.id,attempts,tests:Math.min(used,maxTests),...extras});
    let pins;
    try {pins=pinsFor(source,scene);}
    catch(error){return {source,report:report('unresolved',{reason:error.message})};}
    const field=P.clearance.field(source.obstacles.map(box=>({id:box.id,bounds:box,distance:p=>boxDistance(p,box)})));
    const pinReport=pins.map(({id,kind,point,direction})=>({id,kind,point,...(direction&&{direction})}));
    try {
      for(const guard of [0,source.bendRadius*.7,source.bendRadius*1.5,source.bendRadius*3]){
        const path=search(pins,source,guard,budget);
        if(path.failure){if(!last?.length)last=path;continue;}
        // A direct path can recur when a larger envelope adds no guides.
        const key=path.nodes.map(row=>row.point.join('/')).join(';');
        if(tried.has(key))continue;
        tried.add(key);
        for(const scale of [1/3,.43,.24]){
          attempts++;
          const segments=controls(path.nodes,source,scale);
          if(!segments){last={key,failure:'pin-tangent'};break;}
          const curve=fit(segments,source,budget);
          if(curve.failure){last={key,...curve};continue;}
          const audit=certify(curve,source,pins,field,budget);
          const bends=curve.minRadius+1e-7>=source.bendRadius;
          const evidence={targetLength:curve.target,length:curve.length,baselineLength:curve.baseline,
            slackUsed:Math.max(0,curve.length-curve.baseline),
            minBendRadius:Number.isFinite(curve.minRadius)?curve.minRadius:null,
            ...(curve.bend&&{tightestBend:curve.bend}),...audit};
          if(!bends||audit.failures.length){last={key,failure:bends?'clearance':'bend-radius',...evidence};continue;}
          const good=pinReport.map(pin=>({...pin,distance:pin.id==='from'?0:curve.at.get(pin.id)}));
          return {source,route:P.routes.polyline(curve.points),report:report('ok',{pins:good,guideCount:path.nodes.length-pins.length,...evidence})};
        }
      }
    }catch(error){
      if(error!==badBudget)throw error;
      return {source,report:report('budget',{pins:pinReport,failure:last?.failure??'work-budget'})};
    }
    const {key,...diagnostic}=last??{};
    const limited=['sample-budget','guide-budget','search-budget'].includes(diagnostic.failure);
    return {source,report:report(limited?'budget':'blocked',{pins:pinReport,...diagnostic})};
  }

  function measureView(frame,checks) {
    const {w,h,passes}=frame??{}, {objectId,objects,coverage}=passes??{};
    need(integer(w,1,1024)&&integer(h,1,1024)&&passes?.w===w&&passes?.h===h&&objectId?.length===w*h&&
      coverage?.length===w*h&&Array.isArray(objects)&&Array.isArray(checks)&&checks.length>0&&checks.length<=32&&checks.length*w*h<=8000000,
      'review needs native-grid object and coverage passes and 1–32 gap checks');
    const seen=new Set();
    const rows=Array.from(checks,row=>{
      need(fields(row,['id','between','rect','minPixels','coverage'])&&id(row.id)&&!seen.has(row.id)&&
        Array.isArray(row.between)&&row.between.length===2&&row.between[0]!==row.between[1]&&row.between.every(id),
        'gap checks need distinct IDs and two scene objects');
      seen.add(row.id);
      const rect=row.rect??[0,0,w,h], level=row.coverage??.5, minPixels=row.minPixels??1;
      need(Array.isArray(rect)&&rect.length===4&&rect.every(Number.isSafeInteger)&&rect[0]>=0&&rect[1]>=0&&
        rect[2]>0&&rect[3]>0&&rect[0]+rect[2]<=w&&rect[1]+rect[3]<=h&&bounded(level,0,1)&&bounded(minPixels,0,1024),
        'gap check rectangle or threshold is invalid');
      const [x,y,width,height]=rect, [a,b]=row.between.map(label=>objects.indexOf(label));
      const mask=new Uint8Array(width*height), indices=[];
      for(let j=0;j<height;j++)for(let i=0;i<width;i++){
        const cell=(y+j)*w+x+i,k=j*width+i;
        if(coverage[cell]<level)continue;
        if(objectId[cell]===a)indices.push(k);
        if(objectId[cell]===b)mask[k]=1;
      }
      const base={id:row.id,between:row.between,rect,minPixels};
      if(!indices.length||!mask.includes(1))return {...base,status:'missing',gap:null,
        missing:row.between.filter((_,i)=>i===0?!indices.length:!mask.includes(1))};
      const edt=P.geometry.distanceTransform(mask,{size:[width,height]});
      let closest=indices[0];
      for(const k of indices)if(edt.squared[k]<edt.squared[closest])closest=k;
      const pixel=k=>[x+k%width,y+Math.floor(k/width)],gap=Math.max(0,edt.distance[closest]-1);
      return {...base,status:gap+eps>=minPixels?'ok':'tight',gap,pixels:[pixel(closest),pixel(edt.nearest[closest])]};
    });
    return freeze({grid:[w,h],status:rows.every(row=>row.status==='ok')?'ok':'review',checks:rows});
  }

  P.cableRoutes=Object.freeze({format,create,plan,measureView});
})(KIT);
