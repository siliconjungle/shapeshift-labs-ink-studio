const Geometry = require('./material-preview-geometry.js');
const { dot,along,sub,cross,length,unit,scale,radians } = require('./physical-reference-math.js');

function transform({position,rotation,scale:size}) {
  const [a,b,c]=rotation.map(radians), [sx,sy,sz]=[a,b,c].map(Math.sin), [cx,cy,cz]=[a,b,c].map(Math.cos);
  function rotate([x,y,z]) {
    const y1=cx*y-sx*z, z1=sx*y+cx*z, x2=cy*x+sy*z1;
    return [cz*x2-sz*y1,sz*x2+cz*y1,-sy*x+cy*z1];
  }
  return {
    position:p=>along(position,rotate(p.map((n,i)=>n*size[i])),1),
    normal:n=>unit(rotate(n.map((v,i)=>v/size[i])))
  };
}

function triangle(a,b,c,uvs,normals,material,object) {
  const e1=sub(b,a),e2=sub(c,a),n=cross(e1,e2), doubleArea=length(n);
  if(doubleArea<1e-10) return null;
  const min=a.map((v,i)=>Math.min(v,b[i],c[i])-1e-9), max=a.map((v,i)=>Math.max(v,b[i],c[i])+1e-9);
  const ng=scale(n,1/doubleArea), center=a.map((v,i)=>(v+b[i]+c[i])/3);
  const [du1,dv1]=uvs[1].map((v,i)=>v-uvs[0][i]), [du2,dv2]=uvs[2].map((v,i)=>v-uvs[0][i]);
  const determinant=du1*dv2-du2*dv1;
  const tangent=Math.abs(determinant)>1e-12?scale(along(scale(e1,dv2),e2,-dv1),1/determinant):null;
  const bitangent=tangent && scale(along(scale(e2,du1),e1,-du2),1/determinant);
  return {a,e1,e2,uvs,normals,ng,tangent,bitangent,center,min,max,area:doubleArea*.5,material,object};
}

function construct(rows,materials,toolkit,onFile,identity) {
  const triangles=[];
  for(const row of rows) {
    const raw=Geometry.load({...row,slot:'default',uvGrid:[1,1]},toolkit,onFile);
    const move=transform(row), points=raw.points.map(move.position);
    if(points.length>360000 || points.some(p=>p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e5)))
      throw new RangeError('Physical reference mesh exceeds its bounded coordinate or vertex budget');
    const normals=raw.normals?.map(move.normal);
    const start=triangles.length;
    for(const face of raw.faces) {
      const material=materials.get(row.slots?.[face.slot]??row.material);
      if(!material) throw new RangeError('Missing material binding for '+row.id+' slot '+face.slot);
      const at=face.corners;
      for(let i=1;i+1<at.length;i++) {
        const corners=[at[0],at[i],at[i+1]];
        const uvs=corners.map(c=>raw.flipV?[c.uv[0],1-c.uv[1]]:c.uv);
        if(uvs.some(uv=>uv.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)))
          throw new RangeError('Physical reference mesh has invalid UV coordinates');
        const ns=corners.map(c=>c.n?move.normal(c.n):normals?.[c.point]);
        const t=triangle(...corners.map(c=>points[c.point]),uvs,ns,material,row.id);
        if(t) triangles.push(t);
        if(triangles.length>150000) throw new RangeError('Physical reference supports up to 150,000 triangles');
      }
    }
    if(triangles.length===start) throw new RangeError('No traceable triangle in '+row.id);
    identity.update(JSON.stringify(triangles.slice(start).map(t=>[t.a,t.e1,t.e2,t.uvs,t.normals,t.material.id,t.object])));
  }
  return triangles;
}

function hierarchy(triangles) {
  function node(items) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const t of items) for(let c=0;c<3;c++) {
      min[c]=Math.min(min[c],t.min[c]); max[c]=Math.max(max[c],t.max[c]);
    }
    if(items.length<=6) return {min,max,items};
    const axis=max.reduce((best,end,i)=>end-min[i]>max[best]-min[best]?i:best,0);
    items.sort((a,b)=>a.center[axis]-b.center[axis]);
    const split=items.length>>1;
    return {min,max,left:node(items.slice(0,split)),right:node(items.slice(split))};
  }
  return node(triangles.slice());
}

function bounds(node,origin,inverse,near,far) {
  for(let c=0;c<3;c++) {
    if(!Number.isFinite(inverse[c])) {
      if(origin[c]<node.min[c]||origin[c]>node.max[c]) return Infinity;
      continue;
    }
    const a=(node.min[c]-origin[c])*inverse[c], b=(node.max[c]-origin[c])*inverse[c];
    near=Math.max(near,Math.min(a,b)); far=Math.min(far,Math.max(a,b));
    if(far<near) return Infinity;
  }
  return near;
}

function coordinates(t,u,v) {
  const [a,b,c]=t.uvs;
  return [a[0]+(b[0]-a[0])*u+(c[0]-a[0])*v,a[1]+(b[1]-a[1])*u+(c[1]-a[1])*v];
}

function intersection(t,o,d,near,far) {
  const p=cross(d,t.e2), det=dot(t.e1,p);
  if(Math.abs(det)<1e-12) return null;
  const s=sub(o,t.a), u=dot(s,p)/det;
  if(u<0||u>1) return null;
  const q=cross(s,t.e1), v=dot(d,q)/det;
  if(v<0||u+v>1) return null;
  const distance=dot(t.e2,q)/det;
  if(distance<=near||distance>=far) return null;
  const uv=coordinates(t,u,v);
  if(!t.material.visible(uv)) return null;
  return {t,distance,u,v,uv};
}

function traceGeometry(triangles) {
  const root=hierarchy(triangles);
  function intersect(origin,direction,near=0,far=Infinity,any=false) {
    const inverse=direction.map(value=>1/value);
    const first=bounds(root,origin,inverse,near,far);
    if(first===Infinity) return null;
    let closest=null;
    const stack=[root], ranges=[first];
    while(stack.length) {
      const at=stack.pop(), entry=ranges.pop();
      if(entry>=far) continue;
      if(at.items) {
        for(const t of at.items) {
          const hit=intersection(t,origin,direction,near,far);
          if(!hit) continue;
          if(any) return hit;
          closest=hit; far=hit.distance;
        }
      } else {
        const l=bounds(at.left,origin,inverse,near,far),r=bounds(at.right,origin,inverse,near,far);
        const order=l<=r?[[at.right,r],[at.left,l]]:[[at.left,l],[at.right,r]];
        for(const [child,distance] of order) if(distance<far) { stack.push(child);ranges.push(distance); }
      }
    }
    return closest;
  }
  return {intersect};
}

function surface(hit,origin,direction) {
  const {t,u,v,uv,distance}=hit, front=dot(t.ng,direction)<0, sign=front?1:-1;
  const m=t.material.at(uv);
  const base=t.normals.every(n=>n?.some(Boolean)) ?
    unit(along(along(scale(t.normals[0],1-u-v),t.normals[1],u),t.normals[2],v)):t.ng;
  const ng=scale(t.ng,sign);
  let n=scale(base,(dot(base,t.ng)<0?-1:1)*sign);
  if(dot(n,direction)>=0) n=ng;
  if(m.normal&&t.tangent) {
    const x=unit(along(t.tangent,n,-dot(t.tangent,n))), perp=cross(n,x);
    const y=scale(perp,dot(perp,t.bitangent)<0?1:-1); // Normal green points opposite the top-down V axis.
    const mapped=unit(along(along(scale(n,m.normal[2]),x,m.normal[0]),y,m.normal[1]));
    if(dot(mapped,ng)>.001 && dot(mapped,direction)<-.001) n=mapped;
  }
  return {...hit,m,n,ng,front,point:along(origin,direction,distance)};
}

module.exports = { construct, traceGeometry, surface, coordinates };
