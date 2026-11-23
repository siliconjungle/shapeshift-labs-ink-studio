/* Fixed-tick impulses and translated, pixel-aligned kinematic mask colliders. */
(function (K) {
  const P = K.procedural;
  const {obstacles,int,range,vector,clamp,disc}=P.rasterSimSupport;

  function impulses(entries, {dt,maxTicks}, bodies, materials) {
    if (!Array.isArray(entries) || entries.length>256) throw new RangeError('Expected up to 256 MPM impulses');
    const ticks=new Map();
    let maxCount=0;
    for (const {tick,time,body,material,at,radius,deltaVelocity} of entries) {
      if ((tick===undefined)===(time===undefined) || time!==undefined && !range(time,0,maxTicks*dt) ||
          body!==undefined && !int(body,0,bodies-1) || material!==undefined && !int(material,0,materials-1) ||
          (at===undefined)!==(radius===undefined) || at!==undefined && (!vector(at,2) || !range(radius,.01,2048)) ||
          !vector(deltaVelocity,2) || !deltaVelocity.every(n=>range(n,-1000,1000)))
        throw new RangeError('Invalid timed MPM impulse');
      const when=tick ?? 1+Math.ceil(time/dt-1e-8);
      if (!int(when,1,maxTicks)) throw new RangeError('MPM impulse lies outside its fixed clock');
      const rows=ticks.get(when) ?? [];
      rows.push({body,material,at,radius,deltaVelocity});
      ticks.set(when,rows);
      maxCount=Math.max(maxCount,rows.length);
    }
    return {ticks,maxCount,weight:(entry,x,y)=>entry.at ? disc(entry,x,y) : 1};
  }

  function movingMasks(options,dims,stepSize,maxSpeed) {
    const {width,height}=dims, {closed,open:staticOpen}=obstacles(options,dims);
    const {colliders=[]}=options;
    if (!Array.isArray(colliders) || colliders.length>8) throw new RangeError('Expected up to 8 moving MPM masks');
    const stamps=[], ids=new Set();
    let area=0;
    for (const {id,mask,at,keys,maskChannel='alpha',maskThreshold=128} of colliders) {
      if (typeof id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id) ||
          !int(mask?.width,1,1024) || !int(mask?.height,1,1024) || !range(maskThreshold,0,255) ||
          at!==undefined && !vector(at,2) || keys!==undefined && (at!==undefined || !Array.isArray(keys) || !int(keys.length,1,256)))
        throw new RangeError('Invalid MPM moving mask or position track');
      ids.add(id);
      area+=mask.width*mask.height;
      if (area>65536) throw new RangeError('MPM moving masks exceed the source pixel budget');
      const {data}=P.raster.channel(mask,{channel:maskChannel}), solid=[];
      for (let y=0,i=0;y<mask.height;y++) for (let x=0;x<mask.width;x++,i++)
        if (data[i]>=maskThreshold) solid.push(x,y);
      const rows=(keys ?? [{time:0,at:at ?? [0,0]}]).map((key,i,entries)=>{
        if (!range(key?.time,0,1200) || !vector(key?.at,2) || i && key.time<=entries[i-1].time)
          throw new RangeError('MPM mask keys need increasing seconds and XY positions');
        if (i) {
          const prior=entries[i-1];
          const speed=Math.hypot(key.at[0]-prior.at[0],key.at[1]-prior.at[1])/(key.time-prior.time);
          if (speed>maxSpeed+1e-8 || speed*stepSize>.5+1e-8)
            throw new RangeError('MPM mask moves too far per substep. Slow the track or increase substeps.');
        }
        return {time:key.time,ease:'linear',value:{at:key.at}};
      });
      stamps.push({id,solid,track:K.anim.keyframeTrack.create({at:'vector'},rows),
        x:undefined,y:undefined,vx:0,vy:0});
    }
    if (!stamps.length) return {open:staticOpen,staticOpen,closed,stamps,area,update:()=>false};

    const owner=new Uint8Array(width*height), occupied=closed.slice();
    const inside=(x,y)=>x>=0 && x<width && y>=0 && y<height;
    const index=(x,y)=>Math.floor(y)*width+Math.floor(x);
    const open=(x,y)=>inside(x,y) && !occupied[index(x,y)];
    const stampAt=(x,y)=>inside(x,y) ? stamps[owner[index(x,y)]-1] : undefined;
    const velocity=(x,y,axis)=>{
      const wall=stampAt(x,y);
      return wall ? (axis===0 ? wall.vx : wall.vy) : 0;
    };
    function update(time,prior=time) {
      let changed=false;
      for (const stamp of stamps) {
        const {at:[x,y]}=stamp.track.sample(time);
        const [u,v]=time===prior ? [x,y] : stamp.track.sample(prior).at;
        stamp.vx=time===prior ? 0 : (x-u)/(time-prior);
        stamp.vy=time===prior ? 0 : (y-v)/(time-prior);
        const ix=Math.round(x), iy=Math.round(y);
        if (ix===stamp.x && iy===stamp.y) continue;
        stamp.x=ix; stamp.y=iy; changed=true;
      }
      if (!changed) return false;
      owner.fill(0);
      occupied.set(closed);
      for (const [i,stamp] of stamps.entries()) {
        for (let k=0;k<stamp.solid.length;k+=2) {
          const x=stamp.x+stamp.solid[k], y=stamp.y+stamp.solid[k+1];
          if (!inside(x,y)) continue;
          const p=y*width+x;
          if (occupied[p]) continue;
          occupied[p]=1; owner[p]=i+1;
        }
      }
      return true;
    }
    function escape(x,y) {
      const wall=stampAt(x,y), cx=Math.floor(x), cy=Math.floor(y);
      let best, cost=Infinity, advance=-Infinity;
      for (let r=1;r<=8;r++) {
        for (let j=-r;j<=r;j++) for (let i=-r;i<=r;i++) {
          if (Math.max(Math.abs(i),Math.abs(j))!==r || !open(cx+i+.5,cy+j+.5)) continue;
          const tx=cx+i+.5, ty=cy+j+.5, dx=tx-x, dy=ty-y;
          const distance=dx*dx+dy*dy, progress=dx*wall.vx+dy*wall.vy;
          if (distance>cost+1e-9 || Math.abs(distance-cost)<=1e-9 && progress<=advance) continue;
          best=[tx,ty]; cost=distance; advance=progress;
        }
        if (best && cost<(r+.5)**2) break;
      }
      if (!best) throw new RangeError('MPM moving mask trapped a point without clearance within 8 pixels');
      const length=Math.sqrt(cost);
      return {point:best,nx:(best[0]-x)/length,ny:(best[1]-y)/length,vx:wall.vx,vy:wall.vy};
    }
    const transit={maxSpeed,rebound(v,x,y,axis,bounce){
      const wall=velocity(x,y,axis);
      return clamp(wall-(v-wall)*bounce,-maxSpeed,maxSpeed);
    }};
    return {open,staticOpen,closed:occupied,stamps,area,update,velocity,escape,transit};
  }

  Object.assign(P.rasterSimSupport,{mpmImpulses:impulses,mpmMasks:movingMasks});
})(KIT);
