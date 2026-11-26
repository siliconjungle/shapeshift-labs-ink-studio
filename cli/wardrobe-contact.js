/* One-sided vertex/triangle contacts between ordered layers. */
function layered(panels, {clearance, reach, cell}, {V}) {
  const layers = [...new Set(panels.map(row=>row.layer))].sort((a,b)=>a-b).map(layer=>panels.filter(row=>row.layer===layer));
  const read = (values,i)=>[values[i*3],values[i*3+1],values[i*3+2]];
  const bucket = p=>p.map(x=>Math.floor(x/cell));
  const key = p=>p.join(',');
  let tests=0, pushes=0, maxPush=0;

  function project(values, previous, inverseMass, apply) {
    const bins = new Map(), wide = [];
    let peak=0, potential=0;
    for (const [layer,rows] of layers.entries()) {
      if (layer) for (const panel of rows) for (let i=panel.start;i<panel.start+panel.points.length;i++) {
        const p = read(values,i), before = read(previous,i);
        const distance = V.dist(p,before);
        const pieces = Math.min(16,Math.max(1,Math.ceil(distance/cell)));
        const candidates = new Set(wide);
        for (let j=0;j<=pieces;j++) {
          const hits = bins.get(key(bucket(V.lerp(before,p,j/pieces))));
          if (hits) for (const triangle of hits) candidates.add(triangle);
        }
        let correction = 0, direction;
        for (const tri of candidates) {
          if (++tests>36000000) throw new RangeError('Garment run exceeds its layer collision work budget');
          const {a,e,f,n,uu,uv,vv,den,radius} = tri;
          const gap = clearance+radius+panel.thickness;
          const to = V.sub(p,a), z = V.dot(to,n), push = gap-z;
          if (push<=correction || push<=1e-7) continue;
          const from = V.sub(before,a), beforeZ = V.dot(from,n);
          if (z < -reach && beforeZ < gap) continue;
          const inside = q=>{
            const u = V.dot(q,e), v = V.dot(q,f);
            const b = (vv*u-uv*v)/den, c = (uu*v-uv*u)/den;
            return b>=-1e-7&&c>=-1e-7&&b+c<=1+1e-7;
          };
          if (!inside(to) && !(beforeZ>gap && z<gap && inside(V.lerp(from,to,(beforeZ-gap)/(beforeZ-z))))) continue;
          correction = push;
          direction = n;
        }
        if (!direction) continue;
        potential++;
        peak = Math.max(peak,correction);
        if (apply && inverseMass[i]) {
          values.set(V.mad(p,direction,correction),i*3);
          pushes++;
          maxPush=Math.max(maxPush,correction);
        }
      }
      if (layer===layers.length-1) break;
      for (const panel of rows) for (const face of panel.faces) {
        const [a,b,c] = face.map(i=>read(values,panel.start+i));
        const e=V.sub(b,a), f=V.sub(c,a), cross=V.cross(e,f), magnitude=V.len(cross);
        if (magnitude<1e-9) continue;
        const uu=V.dot(e,e), uv=V.dot(e,f), vv=V.dot(f,f), den=uu*vv-uv*uv;
        if (den<1e-18) continue;
        const radius=panel.thickness, tri={a,e,f,n:V.mul(cross,panel.side/magnitude),uu,uv,vv,den,radius};
        const extent=reach+clearance+radius+.16;
        const lo=bucket(a.map((x,i)=>Math.min(x,b[i],c[i])-extent));
        const hi=bucket(a.map((x,i)=>Math.max(x,b[i],c[i])+extent));
        if (hi.reduce((size,x,i)=>size*(x-lo[i]+1),1)>512) {
          wide.push(tri);
          continue;
        }
        for (let x=lo[0];x<=hi[0];x++) for (let y=lo[1];y<=hi[1];y++) for (let z=lo[2];z<=hi[2];z++){
          const k=key([x,y,z]);
          if (!bins.has(k)) bins.set(k,[]);
          bins.get(k).push(tri);
        }
      }
    }
    return {maxPenetration:peak,vertices:potential};
  }
  return {solve:(values,previous,masses)=>project(values,previous,masses,true),
    inspect:values=>project(values,values,null,false),counts:()=>({tests,pushes,maxPush})};
}

module.exports={layered};
