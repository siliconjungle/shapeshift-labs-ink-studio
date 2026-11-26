const path = require('node:path');
const PNG = require('./png.js');

const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function inspect(target, manifest, directory, settings, {V}) {
  const {entry,pages}=target, pageFor=new Map(), byFace=new Map();
  const rasters=manifest.meshes.map(row=>Object.fromEntries(['coverage','pigment','normal'].map(name=>
    [name,PNG.raster(path.join(directory,row.maps[name].file))])));
  pages.forEach((page,index)=>page.faces.forEach(face=>pageFor.set(face,index)));
  entry.triangles.forEach((row,i)=>{
    if(!byFace.has(row.face))byFace.set(row.face,[]);
    byFace.get(row.face).push({index:i,corners:row.corners});
  });

  function bind(side) {
    const index=pageFor.get(side.face), page=pages[index], [a,b]=side.corners;
    const tri=byFace.get(side.face).find(row=>row.corners.includes(a)&&row.corners.includes(b));
    if(!tri)return null;
    const ids=[a,b,tri.corners.find(id=>id!==a&&id!==b)], model=entry.model;
    const order=ids.map(id=>tri.corners.indexOf(id));
    const positions=model.faces[tri.index].map(id=>model.points[id]);
    const [p,q,r]=order.map(i=>positions[i]), normal=V.norm(V.cross(V.sub(positions[1],positions[0]),V.sub(positions[2],positions[0])));
    const n=order.map(i=>model.cornerNormals?.[tri.index]?.[i] ?? normal);
    const points=order.map(i=>page.toUV(entry.destination[tri.index][i]));
    const [u,v,w]=points, ab=V.sub(q,p), ac=V.sub(r,p);
    const bx=v[0]-u[0], by=v[1]-u[1], cx=w[0]-u[0], cy=w[1]-u[1], det=bx*cy-cx*by;
    if(Math.abs(det)<=1e-14)return null;
    const tangent=V.mul(V.sub(V.mul(ab,cy),V.mul(ac,by)),1/det);
    const bitangent=V.mul(V.sub(V.mul(ac,bx),V.mul(ab,cx)),1/det);
    return {page,rasters:rasters[index],n,points,tangent,bitangent};
  }

  function tap(side,t) {
    const {page,rasters,n,points:[a,b,c],tangent,bitangent}=side, size=page.size;
    const edge=[0,1].map(axis=>a[axis]+(b[axis]-a[axis])*t);
    const span=Math.hypot((c[0]-edge[0])*size,(c[1]-edge[1])*size);
    const mix=Math.min(.38,1.2/Math.max(span,1e-8));
    const uv=edge.map((value,k)=>value+(c[k]-value)*mix);
    const at=uv.map(x=>clamp(Math.floor(x*size),0,size-1)), offset=(at[0]+at[1]*size)*4;
    if(!rasters.coverage.data[offset])return null;
    const weights=[(1-t)*(1-mix),t*(1-mix),mix];
    const normal=V.norm([0,1,2].map(k=>n.reduce((v,row,i)=>v+row[k]*weights[i],0)));
    const tx=V.norm(V.mad(tangent,normal,-V.dot(tangent,normal)),V.perp(normal));
    const cross=V.cross(normal,tx), ty=V.mul(cross,V.dot(cross,bitangent)<0?-1:1);
    const packed=Array.from(rasters.normal.data.slice(offset,offset+3),v=>v/127.5-1);
    const world=V.norm(V.add(V.mul(tx,packed[0]),V.add(V.mul(ty,packed[1]),V.mul(normal,packed[2]))));
    return {at,color:Array.from(rasters.pigment.data.slice(offset,offset+3)),world};
  }

  const seams=[];
  let checks=0, flagged=0, sampled=0, missing=0;
  for(const edge of entry.chart.edges) {
    if(edge.kind==='continuous'||edge.sides.length<2)continue;
    if(++checks>24000)throw new RangeError('Registered seam diagnostic exceeds its edge budget');
    const faces=edge.sides.map(side=>side.face);
    if(edge.sides.length!==2) {
      flagged++;
      seams.push({id:edge.id,kind:edge.kind,faces,reasons:['non-manifold']});
      continue;
    }
    const a=bind(edge.sides[0]), b=bind(edge.sides[1]);
    let count=0, misses=0,maxColorDelta=0,maxNormalDegrees=0;
    const examples=[];
    for(let j=0;j<settings.samples;j++) {
      const t=(j+.5)/settings.samples, x=a&&tap(a,t), y=b&&tap(b,t);
      if(!x||!y){misses++;continue;}
      const delta=Math.max(...x.color.map((n,k)=>Math.abs(n-y.color[k])));
      const angle=Math.acos(clamp(V.dot(x.world,y.world),-1,1))*180/Math.PI;
      count++;
      maxColorDelta=Math.max(maxColorDelta,delta);
      maxNormalDegrees=Math.max(maxNormalDegrees,angle);
      examples.push({t,texels:[{tile:a.page.at,at:x.at},{tile:b.page.at,at:y.at}],colorDelta:delta,normalDegrees:angle});
    }
    const reasons=[];
    if(misses)reasons.push('missing-coverage');
    if(maxColorDelta>settings.maxColorDelta)reasons.push('pigment-jump');
    if(maxNormalDegrees>settings.maxNormalDegrees)reasons.push('normal-angle');
    flagged+=Number(reasons.length>0);
    sampled+=count;
    missing+=misses;
    seams.push({id:edge.id,kind:edge.kind,faces,count,missing:misses,maxColorDelta:count?maxColorDelta:null,
      maxNormalDegrees:count?maxNormalDegrees:null,reasons,examples:examples.sort((a,b)=>
        b.colorDelta-a.colorDelta||b.normalDegrees-a.normalDegrees||a.t-b.t).slice(0,2)});
  }
  return {settings,edges:checks,flagged,sampled,missing,seams};
}

module.exports = { inspect };
