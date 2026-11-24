// Compact signed-field edits shared by retained sculpt modifiers and sparse brick fields.
(function(K) {
  const { V } = K, P = K.procedural;
  const modes = Object.freeze(['grab','flatten','scrape','crease','pinch']);
  const controls = Object.freeze(['size','strength','delta','depth','mirror','angle']);
  const fields = (value, names) => value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).every(key=>names.includes(key));
  const between = (n,min,max) => Number.isFinite(n) && n>=min && n<=max;
  const vector = p => Array.isArray(p) && p.length===3 && Array.from(p).every(n=>between(n,-1e6,1e6));
  const clamp = (n,limit) => Math.max(-limit,Math.min(limit,n));

  function sizeOf(size) {
    if (!fields(size,['unit','radius']) || !['world','pixels'].includes(size.unit) ||
        !between(size.radius,...(size.unit==='world' ? [.005,20] : [.5,64])))
      throw new RangeError('Freeform brush size needs a radius of .005–20 world units or .5–64 art pixels');
    return { unit:size.unit,radius:size.radius };
  }

  function radius(size, worldPerPixel) {
    const authored=sizeOf(size);
    if (authored.unit==='world') return authored.radius;
    if (!between(worldPerPixel,1e-8,1e4)) throw new RangeError('A pixel-sized stamp needs a world scale at the surface');
    return authored.radius*worldPerPixel;
  }

  function checkIntensity(mode,strength,depth) {
    if (!modes.includes(mode) || !between(strength,.01,1) ||
        depth!==undefined && (!['scrape','crease'].includes(mode) || !between(depth,.001,20)))
      throw new RangeError('Freeform brushes need a supported mode, strength .01–1, and optional scrape or crease depth');
  }

  function mirrorOf(mirror) {
    if (!fields(mirror,['axis','at']) || !['x','y','z'].includes(mirror.axis) || !between(mirror.at ?? 0,-1e6,1e6))
      throw new TypeError('A freeform mirror needs a solid-space x, y or z plane');
    return {axis:mirror.axis,at:mirror.at ?? 0};
  }

  function settings(mode, raw) {
    if (!fields(raw,controls)) throw new TypeError('Invalid freeform brush controls');
    const { size,strength=1,delta,depth,mirror,angle }=raw;
    checkIntensity(mode,strength,depth);
    if (mode==='grab' ? !vector(delta) || !between(V.len(delta),1e-6,20) : delta!==undefined)
      throw new TypeError('Grab needs a nonzero XYZ displacement in world units');
    if (angle!==undefined && (!['crease','pinch'].includes(mode) || !between(angle,-360,360)))
      throw new RangeError('Crease and pinch allow a tangent angle from −360 to 360 degrees');
    return { size:sizeOf(size),strength,...(delta && {delta:delta.slice()}),...(depth!==undefined && {depth}),
      ...(angle!==undefined && {angle}),...(mirror!=null && {mirror:mirrorOf(mirror)}) };
  }

  // The axes are the captured tangent, bitangent and outward normal expressed
  // in rest coordinates per unit of captured world travel. A mirror flips one row.
  function stamp(raw,mode) {
    if (!fields(raw,['origin','axes','radius','drag']) || !vector(raw.origin) ||
        !Array.isArray(raw.axes) || raw.axes.length!==3 || !Array.from(raw.axes).every(vector) ||
        !between(raw.radius,1e-8,10000))
      throw new TypeError('A freeform stamp needs a rest-space origin, three axes and a positive resolved radius');
    const origin=raw.origin.slice(), axes=raw.axes.map(row=>row.slice()), radius=raw.radius;
    const drag=raw.drag;
    if (mode==='grab' ? !vector(drag) || !between(V.len(drag),1e-6,radius*.45+1e-9) : drag!==undefined)
      throw new RangeError('Grab displacement must be at most 45% of the resolved brush radius');
    const [a,b,c]=axes, cofactors=[V.cross(b,c),V.cross(c,a),V.cross(a,b)], determinant=V.dot(a,cofactors[0]);
    if (Math.abs(determinant)<1e-7 || Math.abs(determinant)<1e-5*V.len(a)*V.len(b)*V.len(c))
      throw new RangeError('A freeform stamp needs an invertible local frame');
    const inverse=cofactors.map(row=>V.mul(row,1/determinant));
    const extent=origin.map((_,i)=>Math.hypot(a[i],b[i],c[i])*radius);
    const bounds={min:V.sub(origin,extent),max:V.add(origin,extent)};
    return { origin,axes,inverse,radius,bounds,normalScale:1/V.len(inverse[2]),
      ...(drag && { displacement:axes.reduce((sum,axis,i)=>V.mad(sum,axis,drag[i]),[0,0,0]) }) };
  }

  function reflect(row, mirror) {
    const {axis,at}=mirrorOf(mirror), index='xyz'.indexOf(axis), origin=row.origin.slice();
    origin[index]=2*at-origin[index];
    return { ...row,origin,axes:row.axes.map(axis=>axis.map((n,i)=>i===index ? -n : n)) };
  }

  const intersects=(a,b)=>a.min.every((n,i)=>n<=b.max[i] && b.min[i]<=a.max[i]);
  const merge=(a,b)=>({ min:a.min.map((n,i)=>Math.min(n,b.min[i])),max:a.max.map((n,i)=>Math.max(n,b.max[i])) });
  function disjointBounds(stamps) {
    const regions=[];
    for (const {bounds} of stamps) {
      let joined=bounds;
      for (let i=regions.length-1;i>=0;i--) if (intersects(regions[i],joined)) {
        joined=merge(regions[i],joined);
        regions.splice(i,1);
        i=regions.length;
      }
      regions.push(joined);
    }
    return regions;
  }

  function prepare({ mode,strength=1,depth,stamps:raw }={}) {
    checkIntensity(mode,strength,depth);
    if (!Array.isArray(raw) || !raw.length || raw.length>64) throw new RangeError('Use 1–64 resolved freeform stamps');
    const stamps=Array.from(raw,row=>stamp(row,mode)), regions=disjointBounds(stamps), bounds=regions.reduce(merge);
    const warp=mode==='grab' || mode==='pinch';
    const contains=(box,x,y,z)=>x>=box.min[0] && x<=box.max[0] &&
      y>=box.min[1] && y<=box.max[1] && z>=box.min[2] && z<=box.max[2];

    // The strongest weight controls the total influence. Overlapping dabs blend
    // directions rather than applying the edit multiple times at the mirror seam.
    function influence(x,y,z,base) {
      let sum=0, strongest=0, u=0, v=0, w=0;
      for (const row of stamps) {
        if (!contains(row.bounds,x,y,z)) continue;
        const delta=[x-row.origin[0],y-row.origin[1],z-row.origin[2]];
        const q=row.inverse.map(axis=>V.dot(axis,delta));
        const remaining=1-V.dot(q,q)/(row.radius*row.radius);
        if (remaining<=0) continue;
        const weight=remaining*remaining;
        sum+=weight;
        strongest=Math.max(strongest,weight);
        if (warp) {
          const shift=row.displacement ?? V.mul(row.axes[1],-q[1]*.82);
          u+=shift[0]*weight; v+=shift[1]*weight; w+=shift[2]*weight;
        } else {
          const travel=Math.min(depth ?? row.radius*.22,row.radius*.4);
          const plane=(q[2]+(mode==='scrape' ? travel : 0))*row.normalScale;
          const difference=clamp(plane-base,row.radius*row.normalScale*.45);
          const rail=Math.max(0,1-Math.abs(q[1])/(row.radius*.29));
          const offset=mode==='crease' ? travel*row.normalScale*rail*rail :
            mode==='scrape' ? Math.max(0,difference) : difference;
          u+=offset*weight;
        }
      }
      const amount=strongest*strength;
      if (!amount) return null;
      return { amount,factor:amount/sum,u,v,w };
    }

    function pull(point) {
      const hit=influence(...point,0);
      return hit ? [point[0]-hit.u*hit.factor,point[1]-hit.v*hit.factor,point[2]-hit.w*hit.factor] : point;
    }
    function field(base, conservative=false) {
      return (x,y,z)=>{
        const previous=warp ? undefined : base(x,y,z);
        const hit=influence(x,y,z,previous);
        if (!hit) return warp ? base(x,y,z) : previous;
        const {amount,factor,u,v,w}=hit;
        const next=warp ? base(x-u*factor,y-v*factor,z-w*factor) : previous+u*factor;
        return conservative ? next/(1+amount*(mode==='crease' ? 2.8 : 1.1)) : next;
      };
    }
    return { stamps,regions,bounds,field,pull:warp ? pull : undefined };
  }

  function solid(S,base,program,options) {
    const {min,max}=program.bounds, reach=Math.max(base.br,V.dist(base.bc,V.lerp(min,max,.5))+V.dist(min,max)*.5);
    const sd=program.field((x,y,z)=>S.psd(base,x,y,z),true);
    const mat=program.pull ? S.mapSurfaceState(base.mat,program.pull) : base.mat;
    const sourceLocal=program.pull ? point=>base.sourceLocal(program.pull(point)) : base.sourceLocal;
    const geometryBounds=base.geometryBounds && merge(program.bounds,base.geometryBounds);
    return S.add({bc:base.bc,br:reach,sd,sourceLocal,geometryBounds,sample(visit) {
      const original=base.res;
      base.res=this.res;
      try { base.sample(visit); }
      finally { base.res=original; }
      // Distribute additional seeds over each touched tangent plane. The ordinary
      // sculpt bake projects them onto the new field along its local gradient.
      let samples=0;
      for (const {origin,axes,radius} of program.stamps) {
        const resolution=Math.max(this.res, radius/24);
        const nx=Math.max(1,Math.ceil(radius*V.len(axes[0])/resolution));
        const ny=Math.max(1,Math.ceil(radius*V.len(axes[1])/resolution));
        if ((samples+=(nx*2+1)*(ny*2+1))>1500000) throw new RangeError('Freeform sculpt exceeds its surface sample budget');
        for (let y=-ny;y<=ny;y++) for (let x=-nx;x<=nx;x++) {
          const u=x/nx,v=y/ny;
          if (u*u+v*v>=1) continue;
          visit(...V.mad(V.mad(origin,axes[0],u*radius),axes[1],v*radius));
        }
      }
    }},mat,{...options,reach:Math.max(.04,base.reach),res:base.res});
  }

  P.freeformSculpt=Object.freeze({modes,controls,settings,radius,reflect,prepare,solid});
})(KIT);
