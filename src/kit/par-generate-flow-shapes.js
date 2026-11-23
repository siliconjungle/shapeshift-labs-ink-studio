/* Seeded Voronoi boundary distances and shaped, advecting emission plumes. */
(function (K) {
  const P = K.procedural;
  const { dimensions, vector, range, integer, clock, raster, unit, wrap, color } = P.generatorSupport;
  const tau = Math.PI * 2;

  function hash(x, y, seed) {
    let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x27d4eb2d);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  }

  function cellEdges({ spacing = 16, jitter = .68, seed = 0, ...options } = {}) {
    const { width, height } = dimensions(options);
    if (width * height > 262144 || !range(spacing, 2, 512) || !range(jitter, 0, .95) || !Number.isSafeInteger(seed))
      throw new RangeError('Cell edges need a bounded grid, spacing and jitter');
    const countsX = Math.ceil(width / spacing) + 6, countsY = Math.ceil(height / spacing) + 6;
    const sites = Array.from({length:countsX * countsY}, (_, i) => {
      const x = i % countsX - 3, y = Math.floor(i / countsX) - 3;
      return [(x + .5 + (hash(x, y, seed) - .5) * jitter) * spacing,
        (y + .5 + (hash(x, y, seed + 13) - .5) * jitter) * spacing];
    });
    const edge = new Float32Array(width * height), center = edge.slice(), index = new Float64Array(width * height);
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
      const i = Math.floor(x / spacing) + 3, j = Math.floor(y / spacing) + 3;
      const px = x + .5, py = y + .5;
      let first = -1, nearest = Infinity;
      for (let v = j - 2; v <= j + 2; v++) for (let u = i - 2; u <= i + 2; u++) {
        const k = v * countsX + u, [sx, sy] = sites[k];
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < nearest) { nearest = d; first = k; }
      }
      const [ax, ay] = sites[first];
      let seam = Infinity;
      for (let v = j - 3; v <= j + 3; v++) for (let u = i - 3; u <= i + 3; u++) {
        const k = v * countsX + u;
        if (k === first) continue;
        const [sx, sy] = sites[k];
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        seam = Math.min(seam, (d - nearest) / (2 * Math.hypot(ax - sx, ay - sy)));
      }
      edge[p] = seam; center[p] = Math.sqrt(nearest); index[p] = Math.floor(first / countsX) * 8192 + first % countsX;
    }
    return {value:raster(width,height,edge), center:raster(width,height,center), index:raster(width,height,index)};
  }

  function flowPlume({ start, end, widths = [7, 17, 12, 0], period = 2, time = 0, seed = 0,
    turbulence = .28, bands = 0, bandDepth = .22, taper = .3,
    palette = ['#382c55','#96516e','#e77a68','#ffbf85','#fff3cf'],
    ...options } = {}) {
    const { width, height } = dimensions(options);
    start ??= [width * .26, height * .5];
    end ??= [width * .90, height * .5];
    clock(time,seed);
    if (!vector(start,2) || !vector(end,2) || !Array.isArray(widths) || !integer(widths.length,2,32) ||
        !widths.every(w=>range(w,0,512)) || !widths.some(w=>w>0) ||
        !range(period,.02,120) || !range(turbulence,0,2) || !integer(bands,0,32) ||
        !range(bandDepth,0,1) || !range(taper,0,1) || !Array.isArray(palette) || !integer(palette.length,2,32))
      throw new RangeError('Invalid directed plume path, width profile, palette or clock');
    const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
    if (!Number.isFinite(length) || length<.001) throw new RangeError('Plume endpoints need a finite, nonzero separation');
    const c=dx/length,s=dy/length,phase=wrap(time,period)/period*tau,offset=hash(2,9,seed)*tau;
    const inks=palette.map(swatch=>{const n=parseInt(color(swatch).slice(1),16);return [n>>16,n>>8&255,n&255];});
    const data=new Uint8Array(width*height*4),heat=new Float32Array(width*height),coverage=heat.slice();
    for (let y=0,p=0;y<height;y++) for (let x=0;x<width;x++,p++) {
      const u=x+.5-start[0],v=y+.5-start[1], station=(c*u+s*v)/length;
      if(station<0||station>=1)continue;
      const index=station*(widths.length-1),i=Math.floor(index);
      const profile=K.mix(widths[i],widths[i+1],index-i);
      const plume=station*9-phase*2+offset;
      const twist=(Math.sin(plume)+.52*Math.sin(plume*2+phase)+.19*Math.cos(plume*6+phase*4))*profile*turbulence;
      const across=(-s*u+c*v-twist)/Math.max(.01,profile);
      const churn=Math.sin(plume*3+across*9)+.44*Math.sin(plume*8-across*14+phase*2);
      const diamond=bands ? 1-bandDepth * (.5-.5*Math.cos(station*bands*tau)) : 1;
      const edge=1-Math.abs(across)/diamond+churn*turbulence*.28;
      if(edge<=0)continue;
      const tail=1-Math.max(0,(station-1+taper)/Math.max(.001,taper))**2;
      coverage[p]=unit(edge*4)*tail;
      heat[p]=unit(edge*.88+(1-station)*.23+churn*.060);
      const j=p*4,rgb=inks[Math.min(inks.length-1,Math.floor(heat[p]*inks.length))];
      data.set(rgb,j);
      data[j+3]=Math.round(coverage[p]*255);
    }
    return {value:raster(width,height,data,4), heat:raster(width,height,heat), coverage:raster(width,height,coverage)};
  }

  Object.assign(P.generator,{cellEdges,flowPlume});
})(KIT);
