// Each preview consumes the same exported velocity grid through a native Ink solver.
function flowPreviews(K, build, canvases) {
  const dt = 1/30, area = [-3,-2,3,2], [u0,v0,u1,v1] = area;
  const W = 144, H = 96;
  const xAt = u => (u-u0)/(u1-u0)*W;
  const yAt = v => (v-v0)/(v1-v0)*H;
  const clamp = (value,low,high) => Math.max(low,Math.min(high,value));
  const mix = (a,b,f) => a + (b-a)*f;
  const image = document.createElement('canvas');
  const imageContext = image.getContext('2d');
  for (const canvas of Object.values(canvases)) { canvas.width = W; canvas.height = H; }

  function texture(ctx, width, height, data) {
    if (image.width !== width || image.height !== height) { image.width = width; image.height = height; }
    imageContext.putImageData(new ImageData(data,width,height),0,0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image,0,0,W,H);
  }

  const rock = (u,v) => (u/.55)**2 + ((v-.05)/.47)**2 < 1;
  function water(map) {
    const width = 48, height = 32;
    const solver = K.procedural.motion.shallowWater({ width,height,origin:[u0,v0],cell:[6/width,4/height],
      initial:() => .34, mask:(u,v) => !rock(u,v) });
    const flow = map.planar({ bounds:area,scale:.76 });
    const ctx = canvases.water.getContext('2d'), color = new Uint8ClampedArray(width*height*4);
    const grains = Array.from({ length:108 },(_,i) => [
      -2.8+(i%13)*.43, -1.85+((i*47)%101)/101*3.7, .35+(i%5)*.11
    ]);
    let state = solver.snapshot();
    return tick => {
      if (tick) state = solver.step(dt,{ flow,flowDrag:5,friction:.18 });
      for (let i=0; i<state.depth.length; i++) {
        const depth = state.depth[i], speed = Math.hypot(state.vx[i],state.vz[i]);
        const ripple = Math.sin(i%width*.81 + Math.floor(i/width)*.43 - tick*.10*speed);
        const shade = clamp(Math.round((depth*2.2 + speed*.16 + (ripple > .63 ? .23 : 0))*5)/5,0,1);
        const tint = depth ? [mix(12,35,shade),mix(42,104,shade),mix(60,124,shade)] : [53,61,55];
        color.set([...tint,255],4*i);
      }
      texture(ctx,width,height,color);
      for (const [i,grain] of grains.entries()) {
        let [u,v,alpha] = grain;
        const velocity = state.sample(u,v)?.velocity;
        if (tick && velocity) { u += velocity[0]*dt; v += velocity[1]*dt; }
        if (!velocity || u <= u0 || u >= u1 || v <= v0 || v >= v1 || rock(u,v)) {
          u = -2.78; v = -1.84+((i*31+tick)%100)*.0368;
        }
        grain[0] = u; grain[1] = v;
        ctx.fillStyle = 'rgba(191,240,207,'+alpha+')';
        const x = Math.round(xAt(u)), y = Math.round(yAt(v));
        ctx.fillRect(x,y,i%3 ? 2 : 3,1);
      }
    };
  }

  function smoke(map) {
    const raster = K.procedural.rasterSimulation, width = 48, height = 32;
    const simulator = raster.session(raster.define('smoke',{
      width,height,flowMap:map.asset(),flowScale:5.8,flowDrag:6.5,
      buoyancy:5,pressureIterations:8,diffusion:.045,dissipation:.22,
      emitters:[{ at:[5,22],radius:4.3,density:4,velocity:[11,-7] },
        { at:[8,13],radius:3.2,density:3.6,velocity:[13,-2] }],
      palette:['#533d58','#8e6269','#bc8177','#e6ad8e','#f8d3a2']
    },{ dt,maxTicks:241 }));
    const ctx = canvases.smoke.getContext('2d');
    return tick => {
      const { value } = simulator.seekTick(tick);
      ctx.fillStyle = '#262132';
      ctx.fillRect(0,0,W,H);
      texture(ctx,width,height,new Uint8ClampedArray(value.data));
    };
  }

  function cloth(map) {
    const wind = map.world({ bounds:area,scale:2.3 });
    const sim = K.xpbd.sim({ gravity:[0,-3.3,0],wind,substeps:4,iterations:4,damp:.48 });
    const cols = 12, rows = 8;
    for (let y=0; y<rows; y++) for (let x=0; x<cols; x++) {
      const id = sim.point([-2.1+x*.22,1.5-y*.23,-.22+x*.034],x ? 13 : 0);
      sim.drag(id, x ? .50 : 0);
      if (x) sim.link(id,id-1,.00004);
      if (y) sim.link(id,id-cols,.00004);
      if (x && y) {
        sim.link(id,id-cols-1,.00035);
        sim.link(id-1,id-cols,.00035);
        sim.face(id-cols-1,id-cols,id-1,2);
        sim.face(id-1,id-cols,id,2);
      }
    }
    const ctx = canvases.cloth.getContext('2d');
    const point = i => {
      const [x,y,z] = sim.X.subarray(i*3,i*3+3);
      return [Math.round(W*.54 + x*22 + z*10),Math.round(H*.75-y*34+z*8)];
    };
    const shades = ['#253a3e','#365854','#5d8470','#8da982','#d2ca96'];
    return tick => {
      if (tick) sim.step(dt,tick*dt);
      ctx.fillStyle = '#192a31'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#21383f'; ctx.fillRect(0,80,W,16);
      const [poleX,poleY] = point(0);
      ctx.fillStyle = '#9e8873'; ctx.fillRect(poleX-2,poleY-5,2,87-poleY);
      for (let y=rows-2; y>=0; y--) for (let x=0; x<cols-1; x++) {
        const id = y*cols+x;
        const p = [id,id+1,id+cols+1,id+cols].map(point);
        const z0 = sim.X[id*3+2], z1 = sim.X[(id+1)*3+2];
        const band = x === 0 || y === 0 || y === rows-2 ? 3 : y === 3 || y === 4 ? 4 :
          clamp(Math.round(2-(z1-z0)*5),0,3);
        ctx.fillStyle = shades[band];
        ctx.beginPath(); ctx.moveTo(...p[0]); p.slice(1).forEach(at => ctx.lineTo(...at));
        ctx.closePath(); ctx.fill(); ctx.strokeStyle = shades[band]; ctx.stroke();
      }
    };
  }

  function debris(map) {
    const b = build(17,[0x312b26,0xd2a66b],{ initialCapacity:128 });
    const count = 28;
    for (let i=0; i<count; i++) b.iso(-2.62+(i%7)*.18,.6+(i%5)*.17,-1.33+((i*19)%27)*.098,.055,b.P[1],1);
    const st = K.stage(b.finish({}));
    const wind = map.world({ bounds:area,scale:.67,outside:'none' });
    const system = K.debris(st,{ gravity:1.9,wind,windDrag:3.2 });
    for (let i=0; i<count; i++) system.spawn([i],{ v:[.16,.4+(i%4)*.17,0],w:[1.1,i%6,0],keep:true,life:15 });
    const ctx = canvases.debris.getContext('2d');
    return tick => {
      if (tick) system.update(dt,tick*dt);
      ctx.fillStyle = '#322e29'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#3a352e';
      for (let y=8; y<H; y+=11) for (let x=(y%7); x<W; x+=9) ctx.fillRect(x,y,2,1);
      const parts = system.chunks.slice().sort((a,b) => a.c[2]-b.c[2]);
      for (const [i,chunk] of parts.entries()) {
        const [x,height,z] = chunk.c, u = Math.round(xAt(x)), v = Math.round(yAt(z));
        ctx.fillStyle = '#24251f'; ctx.fillRect(u-1,v,5,2);
        const y = Math.round(v-height*12);
        ctx.fillStyle = ['#f5cb82','#c48259','#a46c58'][i%3];
        ctx.fillRect(u-1,y,4,2);
        ctx.fillStyle = '#f0ac73'; ctx.fillRect(u,y-1,2,1);
      }
    };
  }

  let original, step = [], tick = 0;
  function reset(map) {
    original = map;
    step = [water(map),smoke(map),cloth(map),debris(map)];
    tick = 0;
    step.forEach(draw => draw(tick));
  }
  function advance() {
    if (tick === 160) reset(original);
    else {
      tick++;
      step.forEach(draw => draw(tick));
    }
    return tick*dt;
  }
  return { reset,advance };
}
