/* Retained mark advection shared by standalone flow and paint tracks. */
(function (K) {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const number = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const vector = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(x => number(x, -10000, 10000));
  const epsilon = 1e-9;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const axes = [0, 1];
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value);

  function prepare(raw, asset, placement, mask) {
    const map = K.flowMap.open(asset), { bounds } = map, min = bounds.slice(0,2), max = bounds.slice(2);
    const width = max.map((n,i) => n-min[i]), cell = Math.min(width[0]/map.width,width[1]/map.height);
    const { marks, chart = {}, speed = 1, step = 1/60, spacing = cell/2, wrap = [false,false],
      seam = 'split', edge = 'stop', obstructions = [] } = raw;
    if (!Array.isArray(marks) || !marks.length || marks.length > 128 || !Array.from(marks).every(id) ||
        new Set(marks).size !== marks.length || !fields(chart,['origin','u','v']) || !number(speed,0,100) ||
        !number(step,1/1000,1/12) || !number(spacing,.00001,100) || !Array.isArray(wrap) ||
        wrap.length !== 2 || !Array.from(wrap).every(row => typeof row === 'boolean') ||
        !['split','stop'].includes(seam) || !['stop','lose'].includes(edge) ||
        !Array.isArray(obstructions) || obstructions.length > 64)
      throw new TypeError('Paint flow needs selected marks, a chart, bounded speed and steps, and explicit edge policies');
    const { origin = [0,0,0], u = [1,0,0], v = [0,1,0] } = chart, { V, Q, sceneGraph:graph } = K;
    if (![origin,u,v].every(row=>vector(row,3)) || Math.abs(V.len(u)-1)>1e-6 || Math.abs(V.len(v)-1)>1e-6 ||
        Math.abs(V.dot(u,v))>1e-6) throw new RangeError('A paint flow chart needs XYZ origin and perpendicular unit axes');
    const normal = V.norm(V.cross(u,v)), authored = new Map(placement.painting.marks.map(mark=>[mark.id,mark]));
    const blockers = [], names = new Set();
    for (const row of obstructions) {
      if (!fields(row,['id','rect','mode']) || !id(row.id) || names.has(row.id) || !vector(row.rect,4) ||
          !['stop','slide','lose'].includes(row.mode) || !axes.every(i=>row.rect[i]>=min[i] &&
            row.rect[i+2]<=max[i] && row.rect[i+2]-row.rect[i]>epsilon*4))
        throw new RangeError('Obstructions need a unique ID, in-chart rectangle, and stop, slide, or lose mode');
      names.add(row.id);
      blockers.push(row);
    }
    const moveWrap = wrap.map(value=>value&&seam==='split');
    const tileOf = (value,i) => Math.floor((value-min[i])/width[i]);
    const closed = (uv,i) => clamp(uv[i],min[i],max[i]);
    const folded = (uv,i) => uv[i]-tileOf(uv[i],i)*width[i];
    const within = (uv,i) => uv[i]>=min[i] && uv[i]<=max[i];
    const strict = (p,rect) => axes.every(i=>p[i]>rect[i]+epsilon && p[i]<rect[i+2]-epsilon);
    const lerp = (a,b,t) => a.map((n,i)=>mix(n,b[i],t));
    const velocity = uv => map.sample(wrap[0]?uv[0]:closed(uv,0),
      wrap[1]?uv[1]:closed(uv,1), [0,0], wrap).map(n=>n*speed);

    let limitSpeed = 0;
    for (let i=0;i<asset.vectors.length;i+=2) limitSpeed=Math.max(limitSpeed,Math.hypot(asset.vectors[i],asset.vectors[i+1]));
    const dt = Math.min(step, limitSpeed*speed ? cell/(2*limitSpeed*speed) : Infinity);

    // Keep lifted coordinates so a segment crossing the same seam never joins distant chart edges.
    function pieces(a,b) {
      const cuts = [0,1];
      for (const i of axes) {
        if (!moveWrap[i] || Math.abs(b[i]-a[i])<=epsilon) continue;
        const first = tileOf(Math.min(a[i],b[i]),i), last = tileOf(Math.max(a[i],b[i]),i);
        if (last-first>64) throw new RangeError('A painted segment crosses too many chart seams');
        for (let j=first+1;j<=last;j++) {
          const t=(min[i]+j*width[i]-a[i])/(b[i]-a[i]);
          if (t>epsilon && t<1-epsilon) cuts.push(t);
        }
      }
      cuts.sort((x,y)=>x-y);
      return cuts.slice(1).flatMap((hi,i)=>{
        const lo=cuts[i];
        if (hi-lo<=epsilon) return [];
        const mid=(hi+lo)/2, tile=axes.map(k=>moveWrap[k]?tileOf(mix(a[k],b[k],mid),k):0);
        return [{lo,hi,tile,shift:tile.map((v,k)=>v*width[k])}];
      });
    }

    function intersection(a,b,rect) {
      let lo=0, hi=1, axis, sign;
      for (const i of axes) {
        const delta=b[i]-a[i];
        if (Math.abs(delta)<=epsilon) {
          if (a[i]<=rect[i]+epsilon || a[i]>=rect[i+2]-epsilon) return;
          continue;
        }
        const first=(rect[i]-a[i])/delta, second=(rect[i+2]-a[i])/delta;
        const enter=Math.min(first,second);
        if (enter>=lo-epsilon) { lo=Math.max(lo,enter); axis=i; sign=delta>0?-1:1; }
        hi=Math.min(hi,Math.max(first,second));
        if (hi-lo<=epsilon) return;
      }
      return {lo,hi,axis,sign};
    }

    function hit(a,b) {
      let best;
      for (const i of axes) if (!moveWrap[i] && !within(b,i)) {
        const t=clamp(((b[i]<min[i]?min[i]:max[i])-a[i])/(b[i]-a[i]),0,1);
        if (!best || t<best.t) best={t, status:wrap[i]?'seam':edge, axis:i};
      }
      if (!blockers.length) return best;
      for (const {lo,hi,shift} of pieces(a,b)) {
        if (best && lo>best.t) break;
        const start=lerp(a,b,lo).map((n,i)=>n-shift[i]), end=lerp(a,b,hi).map((n,i)=>n-shift[i]);
        for (const blocker of blockers) {
          const contact=intersection(start,end,blocker.rect);
          if (!contact) continue;
          const t=mix(lo,hi,contact.lo);
          if (!best || t<best.t)
            best={t,status:blocker.mode,blocker:blocker.id,axis:contact.axis,sign:contact.sign};
        }
      }
      return best;
    }

    const sources = marks.map(key => {
      const mark = authored.get(key);
      if (!mark || mark.enabled===false) throw new RangeError('Unknown or disabled paint flow mark ' + key);
      const frame=graph.transform(mark.transform), inv=graph.inverse(frame);
      const guide=K.procedural.shapeSweeps.guidePoses(mark.poses,mark.path).map(pose=>{
        const p=V.sub(graph.point(frame,pose.point),origin);
        return {...pose, uv:[V.dot(p,u),V.dot(p,v)], z:V.dot(p,normal)};
      });
      const stations=[];
      function insert(row) {
        const original=row.uv, uv=axes.map(i=>moveWrap[i]?original[i]:closed(original,i));
        const exited=axes.some(i=>!wrap[i] && !within(original,i));
        const atSeam=axes.some(i=>wrap[i] && !moveWrap[i] && !within(original,i));
        const block=blockers.find(({rect})=>strict(uv.map((n,i)=>moveWrap[i]?folded(uv,i):n),rect));
        const point=V.mad(V.mad(V.mad(origin,u,original[0]),v,original[1]),normal,row.z);
        const gain=mask?.(mark,point)??1;
        stations.push({...row, uv, gain, changed:exited || uv.some((n,i)=>n!==original[i]),
          lost:exited&&edge==='lose'||block?.mode==='lose', stopped:exited&&edge==='stop'||atSeam||Boolean(block),
          collisions:block?1:0, obstacles:block?[block.id]:[], edges:exited?1:0, seams:atSeam?1:0, wraps:0});
        if (stations.length>1024) throw new RangeError('A flowed mark exceeds 1024 sampled poses. Increase spacing');
      }
      insert(guide[0]);
      for (let i=1;i<guide.length;i++) {
        const a=guide[i-1],b=guide[i], n=Math.max(1,Math.ceil(Math.hypot(b.uv[0]-a.uv[0],b.uv[1]-a.uv[1])/spacing));
        for (let j=1;j<=n;j++) {
          const t=j/n;
          insert({uv:lerp(a.uv,b.uv,t),z:mix(a.z,b.z,t),pressure:mix(a.pressure,b.pressure,t),
            rotation:Q.slerp(a.rotation,b.rotation,t)});
        }
      }
      return {mark,inv,stations};
    });
    const count=sources.reduce((n,row)=>n+row.stations.length,0);
    if (count>4096) throw new RangeError('Paint flow exceeds 4096 starting stations. Increase spacing or select fewer marks');

    function advance(stations, duration) {
      return stations.map(row=>{
        if (row.stopped || row.lost || !speed || !row.gain) return row;
        const a=row.uv, first=velocity(a), mid=a.map((n,i)=>n+first[i]*duration*row.gain/2), v=velocity(mid);
        if (v.every(n=>!n)) return row;
        const end=a.map((n,i)=>n+v[i]*duration*row.gain), blocker=hit(a,end);
        let uv=blocker?lerp(a,end,blocker.t):end, contact=blocker;
        if (blocker?.status==='slide' && blocker.axis!==undefined) {
          const axis=blocker.axis;
          uv[axis]+=blocker.sign*epsilon*2;
          const along=uv.map((n,i)=>i===axis?n:end[i]), next=hit(uv,along);
          uv=next?lerp(uv,along,next.t):along;
          contact=next??blocker;
        }
        const wraps=axes.reduce((n,i)=>n+(moveWrap[i]?Math.abs(tileOf(uv[i],i)-tileOf(a[i],i)):0),0);
        return {...row,uv,changed:true,wraps:row.wraps+wraps,
          lost:contact?.status==='lose',stopped:contact?.status==='stop'||contact?.status==='seam',
          collisions:row.collisions+Number(Boolean(blocker?.blocker))+Number(Boolean(contact!==blocker&&contact?.blocker)),
          obstacles:blocker?.blocker||contact?.blocker
            ? [...new Set([...row.obstacles,blocker?.blocker,contact?.blocker].filter(Boolean))] : row.obstacles,
          edges:row.edges+Number(Boolean(contact&&!contact.blocker&&contact.status!=='seam')),
          seams:row.seams+Number(contact?.status==='seam')};
      });
    }

    function framePoses({mark,inv}, stations) {
      const runs = [];
      function pose(a,b,t,shift) {
        const [x,y]=lerp(a.uv,b.uv,t).map((n,i)=>n-shift[i]);
        const p=V.mad(V.mad(V.mad(origin,u,x),v,y),normal,mix(a.z,b.z,t));
        return {point:graph.point(inv,p),pressure:mix(a.pressure,b.pressure,t),rotation:Q.slerp(a.rotation,b.rotation,t)};
      }
      if (stations.length===1) {
        const [row]=stations, tile=axes.map(i=>moveWrap[i]?tileOf(row.uv[i],i):0), shift=tile.map((n,i)=>n*width[i]);
        if (!row.lost && !blockers.some(({rect})=>strict(row.uv.map((n,i)=>n-shift[i]),rect)))
          runs.push({start:0,end:0,tile,poses:[pose(row,row,0,shift)]});
      }
      for (let i=1;i<stations.length;i++) {
        const a=stations[i-1],b=stations[i];
        if (a.lost&&b.lost) continue;
        for (const {lo,hi,tile,shift} of pieces(a.uv,b.uv)) {
          const p=lerp(a.uv,b.uv,lo).map((n,k)=>n-shift[k]), q=lerp(a.uv,b.uv,hi).map((n,k)=>n-shift[k]);
          const hits=blockers.flatMap(({rect})=>intersection(p,q,rect)??[]).sort((a,b)=>a.lo-b.lo);
          let first=0;
          for (const hit of [...hits,{lo:1,hi:1}]) {
            if (hit.lo-first>epsilon) {
              const from=mix(lo,hi,first), to=mix(lo,hi,hit.lo), end=i-1+to;
              const prior=runs.at(-1);
              if (prior && prior.tile.every((v,k)=>v===tile[k]) && Math.abs(i-1+from-prior.end)<=epsilon) {
                prior.poses.push(pose(a,b,to,shift));
                prior.end=end;
              } else runs.push({start:i-1+from,end,tile,poses:[pose(a,b,from,shift),pose(a,b,to,shift)]});
            }
            first=Math.max(first,hit.hi);
          }
        }
      }
      if (!runs.length) return [];
      if (runs.length===1 && !stations.some(row=>row.changed||row.lost) &&
          runs[0].tile.every(v=>!v) && runs[0].start===0 && runs[0].end===stations.length-1) return [mark];
      const ordinals = new Map();
      return runs.map(({poses,start,tile},i)=>{
        if (poses.length>1024) throw new RangeError('A flowed fragment exceeds 1024 poses. Increase spacing');
        const anchor=Math.floor(start+epsilon)+'/'+tile.join(','), ordinal=ordinals.get(anchor)??0;
        ordinals.set(anchor,ordinal+1);
        const key=i===0 ? mark.id : 'flow-' + K.procedural.data.hash(mark.id+'/'+anchor+'/'+ordinal).toString(16);
        return {...mark,id:key,path:'free',poses};
      });
    }

    const initial=sources.map(row=>row.stations);
    let ordinal=0, state=initial;
    function sample(time) {
      if (!number(time,0,60)) throw new RangeError('Paint flow sample time must be 0–60 seconds');
      const target=Math.floor(time/dt+epsilon);
      if (target*count*(1+blockers.length)>8e6) throw new RangeError('Paint flow exceeds its integration budget. Reduce time, speed, or stations');
      if (target<ordinal) { ordinal=0; state=initial; }
      while (ordinal<target) { state=state.map(rows=>advance(rows,dt)); ordinal++; }
      const remainder=time-target*dt;
      const sampled=remainder>epsilon?state.map(rows=>advance(rows,remainder)):state;
      const results=new Map(), report=[];
      for (const [i,source] of sources.entries()) {
        const rows=sampled[i], fragments=mask&&rows.every(row=>!row.gain)?[source.mark]:framePoses(source,rows);
        results.set(source.mark.id,fragments);
        const sum=key=>rows.reduce((n,row)=>n+row[key],0);
        report.push({id:source.mark.id,stations:rows.length,lost:rows.filter(row=>row.lost).length,
          wraps:sum('wraps'),seams:sum('seams'),edgeContacts:sum('edges'),collisions:sum('collisions'),
          obstructions:[...new Set(rows.flatMap(row=>row.obstacles))],
          fragments:fragments.map(row=>row.id)});
      }
      const output=placement.painting.marks.flatMap(mark=>results.get(mark.id)??[mark]);
      if (output.length>256 || new Set(output.map(mark=>mark.id)).size!==output.length)
        throw new RangeError('Flowed fragments exceed 256 marks or collide with an authored mark ID');
      return {marks:output,report};
    }
    return {sample,dt,bounds,wrap,seam,edge};
  }

  K.procedural.paintFlow = Object.freeze({ prepare, fields });
})(KIT);
