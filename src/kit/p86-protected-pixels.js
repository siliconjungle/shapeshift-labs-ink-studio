/* Retained art-pixel marks resolved against the visible scene and a shot-wide pixel budget. */
(function (K) {
  const number = (value,min,max) => Number.isFinite(value) && value>=min && value<=max;
  const tuple = (value,n,test) => Array.isArray(value) && value.length===n && Array.from(value).every(test);
  const id = value => typeof value==='string' && value.trim().length>0 && value.length<=128;
  const record = value => value && Object.getPrototypeOf(value)===Object.prototype;
  const check = (valid,message) => { if(!valid) throw new TypeError('Protected pixels: '+message); };
  const keys = (value,allowed) => record(value) && Object.keys(value).every(key=>allowed.includes(key));
  const maxCandidates=16384, meshAnchors=new WeakMap();

  function anchor(value) {
    if(tuple(value,3,n=>number(n,-1e8,1e8)))return {point:value.slice()};
    if(keys(value,['splat']) && Number.isSafeInteger(value.splat) && value.splat>=0)return {row:value.splat};
    check(keys(value,['mesh','uv','triangle','offset']) && id(value.mesh) && tuple(value.uv,2,n=>number(n,0,1)) &&
      (value.triangle===undefined || Number.isSafeInteger(value.triangle) && value.triangle>=0) &&
      number(value.offset??0,-1,1),'use XYZ, a splat row, or a mesh ID and UV');
    return {...value,uv:value.uv.slice()};
  }

  function prepare(definition, override, { scenePalette, paletteRoles } = {}) {
    if (override===false || (definition===undefined || definition===false) && (override===undefined || override===true)) return null;
    const base=definition===true || definition===false || definition===undefined ? {} : definition;
    const patch=override===undefined || override===true ? {} : override;
    check(keys(base,['budget','marks','priorities']) && keys(patch,['budget','marks','priorities']),
      'use an object with budget, marks and priorities');
    const { budget=32, marks=[] }={...base,...patch};
    check(record(base.priorities??{}) && record(patch.priorities??{}),'priorities need a map');
    const priorities={...base.priorities,...patch.priorities};
    check(Number.isSafeInteger(budget) && number(budget,0,4096),'budget must be 0–4096 art pixels');
    check(Array.isArray(marks) && marks.length<=256,'expected up to 256 marks');
    const names=new Set();
    const rows=Array.from(marks, row=>{
      check(keys(row,['id','color','at','path','stamp','priority','size','maxPixels','bias','active']) &&
        id(row.id) && !names.has(row.id),'marks need distinct nonempty IDs');
      names.add(row.id);
      const {at,path,stamp,priority=0,size=0,maxPixels=1.25,bias=.012,active}=row;
      check((at!==undefined)!==(path!==undefined) && (path===undefined ||
        Array.isArray(path) && number(path.length,2,128) && stamp===undefined),'use one anchor or a path of 2–128 anchors');
      check(number(priority,-1e6,1e6) && number(size,0,1e5) && number(maxPixels,.25,12) && number(bias,0,.25) &&
        (active===undefined || tuple(active,2,Number.isFinite) && active[1]>active[0]),'invalid priority, size, bias or active interval');
      let offsets=[[0,0]];
      if(stamp!==undefined){
        const width=stamp?.[0]?.length;
        check(Array.isArray(stamp) && number(stamp.length,1,9) && number(width,1,9) &&
          Array.from(stamp).every(line=>typeof line==='string' && line.length===width && /^[.#]+$/.test(line)),
          'stamps need 1–9 rows and columns using . and #');
        offsets=stamp.flatMap((line,y)=>Array.from(line, (cell,x)=>cell==='#' ?
          [x-Math.floor(width/2),y-Math.floor(stamp.length/2)] : null).filter(Boolean));
        check(offsets.length,'stamp needs a filled pixel');
      }
      check(row.color!==undefined,'each mark needs a palette color');
      const ink=K.pixelStamps.image({width:1,height:1,slots:[0],palette:[row.color]}, {scenePalette,paletteRoles});
      return { id:row.id, priority:Object.hasOwn(priorities,row.id)?priorities[row.id]:priority, active:active?.slice(),
        anchors:at!==undefined?[anchor(at)]:Array.from(path,anchor), isPath:path!==undefined,
        size,maxPixels,bias, offsets, rgb:Array.from(ink.rgba.subarray(0,3)) };
    });
    for(const [name,value] of Object.entries(priorities))
      check(names.has(name) && number(value,-1e6,1e6),'priority overrides must name authored marks');
    rows.sort((a,b)=>b.priority-a.priority || (a.id<b.id?-1:1));
    return rows.length ? {budget,rows} : null;
  }

  // Clip the projected segment before traversing pixels. Perspective depth stays reciprocal.
  function segmentClip(a,b,w,h) {
    let first=0,last=1;
    for(const [axis,limit] of [[0,w-1e-7],[1,h-1e-7]]){
      const delta=b[axis]-a[axis];
      if(Math.abs(delta)<1e-12){
        if(a[axis]<0 || a[axis]>limit)return;
        continue;
      }
      const u=-a[axis]/delta,v=(limit-a[axis])/delta;
      first=Math.max(first,Math.min(u,v));last=Math.min(last,Math.max(u,v));
    }
    if(first<=last)return [first,last];
  }

  function project(plan,world,camera, {w,h,time=0,clip,positions}={}) {
    const view=DrawingPrimitives.projector(camera,w,h);
    const meshes=new Map(K.sceneMeshes.list(world).map(mesh=>[mesh.id,mesh]));
    let splats;
    function sample(source) {
      if(source.point)return {point:source.point};
      if(source.row!==undefined){
        const i=source.row;
        if(i>=world.count)return;
        splats??=positions??K.splatFrames.create(world,time,K.M);
        const hit=splats(i);
        if(hit.opacity()>0)return {point:hit.position(),normal:hit.normal};
        return;
      }
      const mesh=meshes.get(source.mesh);
      if(!mesh || source.triangle>=mesh.triangles)return;
      let anchors=meshAnchors.get(mesh);
      if(!anchors)meshAnchors.set(mesh,anchors=new Map());
      const chart=K.sceneMeshes.uvAnchors(mesh,K), key=source.uv.join(',')+'/'+(source.triangle??'');
      if(!anchors.has(key))anchors.set(key,chart.bind(source.uv,source.triangle));
      const binding=anchors.get(key), hit=binding&&chart.sample(binding);
      if(hit)return {point:K.V.mad(hit.p,hit.n,source.offset??0),normal:hit.n};
    }
    const coordinates=new Map(), rows=[];
    let traversed=0;
    const ray=clip && K.nativeCelPixels.plane(camera,w,h,[0,0,0],[0,0,1]);
    for(const mark of plan.rows){
      const candidates=new Map();
      let status='offscreen';
      if(mark.active && (time<mark.active[0] || time>=mark.active[1]))status='inactive';
      else {
        const samples=mark.anchors.map(sample);
        if(samples.some(hit=>!hit))status='missing-anchor';
        else {
          const sites=samples.map(hit=>view.toView(hit.point));
          const visible=sites.filter(view.visible);
          if(mark.size && visible.length && visible.some(site=>mark.size*view.pixelsPerUnit(site,[1,0])>mark.maxPixels))
            status='large';
          else if(plan.budget>0){
            function add(x,y,depth) {
              if(x<0 || y<0 || x>=w || y>=h || !Number.isFinite(depth) || clip && !clip(ray.point(x,y,depth)))return;
              if(++traversed>maxCandidates*16)throw new RangeError('Protected pixels exceeded the stroke sampling budget');
              const key=y*w+x;
              if(!coordinates.has(key) && coordinates.size>=maxCandidates)
                throw new RangeError('Protected pixels exceeded 16384 candidate art pixels');
              depth-=mark.bias;
              if(depth<(candidates.get(key)?.[2]??Infinity))candidates.set(key,[x,y,depth,...mark.rgb]);
              coordinates.set(key,[x,y]);
            }
            if(!mark.isPath && visible.length){
              const [x,y]=view.point(sites[0]).map(Math.floor), {normal}=samples[0];
              const back=[camera.view[2],camera.view[6],camera.view[10]];
              const plane=normal && Math.abs(K.V.dot(normal,back))>.18 && K.nativeCelPixels.plane(camera,w,h,sites[0],normal);
              for(const [dx,dy] of mark.offsets)
                add(x+dx,y+dy,plane ? plane.depthAt(x+dx,y+dy) : sites[0][2]);
            }
            if(mark.isPath)for(let j=1;j<sites.length;j++){
              const endpoints=view.line(sites[j-1],sites[j]);
              if(!endpoints)continue;
              const [a,b]=endpoints.map(view.point), span=segmentClip(a,b,w,h);
              if(!span)continue;
              const [first,last]=span, dx=b[0]-a[0],dy=b[1]-a[1],
                steps=Math.min(maxCandidates,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*(last-first)));
              const z0=endpoints[0][2],z1=endpoints[1][2];
              for(let step=0;step<=steps;step++){
                const u=first+(last-first)*(steps?step/steps:0);
                const depth=camera.ortho ? z0*(1-u)+z1*u : 1/((1-u)/z0+u/z1);
                add(Math.floor(a[0]+dx*u),Math.floor(a[1]+dy*u),depth);
              }
            }
            if(candidates.size)status='candidate';
          } else status='budget';
        }
      }
      rows.push({id:mark.id,priority:mark.priority,candidates,status});
    }
    return {budget:plan.budget,coordinates,rows};
  }

  function resolve(projected, depthAt) {
    const pixels=[], taken=new Set(), marks=[];
    for(const row of projected.rows){
      const { id, priority, candidates }=row;
      let status=row.status,cost=0,visible=0;
      if(candidates.size){
        const free=[];
        for(const [key,pixel] of candidates){
          const depth=depthAt(key);
          if(pixel[2]>(depth??Infinity)+.0001)continue;
          visible++;
          if(!taken.has(key))free.push([key,pixel]);
        }
        if(!visible)status='occluded';
        else if(!free.length)status='overlap';
        else if(free.length>projected.budget-pixels.length)status='budget';
        else {
          status='kept';cost=free.length;
          for(const [key,pixel] of free){ taken.add(key);pixels.push(pixel); }
        }
      }
      marks.push({id,priority,status,projected:candidates.size,visible,cost});
    }
    return {pixels,report:{budget:projected.budget,used:pixels.length,marks}};
  }
  K.protectedPixels=Object.freeze({prepare,project,resolve});
})(KIT);
