/* Reproject the exact depth owner through its previous camera and geometry. */
const {cameraPoint}=require('./part-motion.js');

function project(camera,point,w,h) {
  const [u,v,depth]=point;
  if (!Number.isFinite(depth)||depth<camera.near) return null;
  const units=(camera.ortho?1:depth)/camera.focal, x=w*.5+u/units, y=h*.5-v/units;
  return x>=0&&x<w&&y>=0&&y<h ? {x,y,depth,units} : null;
}

function meshPoint(triangle,weights,camera,w,h) {
  const {points,step}=triangle;
  const at=[0,0,0];
  for (let i=0;i<3;i++) {
    const point=cameraPoint(camera.view,...points[i]);
    const distance=camera.ortho?1:point[2];
    if (step&&distance>0) {
      const scale=camera.focal/distance;
      for(let k=0;k<2;k++) {
        const center=(k?h:w)*.5, sign=k?-1:1;
        point[k]=sign*(Math.floor((center+sign*point[k]*scale)/step+.5)*step-center)/scale;
      }
    }
    for (let k=0;k<3;k++) at[k]+=weights[i]*point[k];
  }
  return at;
}

function capture(w,h,input,depth,hits,selected) {
  const size=w*h, {camera,time,source,reset}=input;
  const previous=input.previous;
  const prior=!reset&&previous?.source===source&&previous.w===w&&previous.h===h&&
    previous.camera.ortho===camera.ortho&&previous.time<=time ? previous : null;
  const vectors=selected.has('surfaceMotion')&&new Float32Array(size*2);
  const valid=(vectors||selected.has('surfaceMotionValid'))&&new Uint8Array(size);
  const snapshot={w,h,time,source,camera,keys:[null],ids:new Uint32Array(size),depth,meshes:new Map()};
  const keys=new Map();
  for (const [bottom,hit] of hits ?? []) {
    const mesh=hit.mesh, key=mesh?.key ?? (hit.sdf ? hit.row.part.key : null);
    if (!key) continue;
    const x=bottom%w,y=h-1-Math.floor(bottom/w), p=y*w+x;
    if (!keys.has(key)) {
      keys.set(key,snapshot.keys.length);
      snapshot.keys.push(key);
    }
    snapshot.ids[p]=keys.get(key);
    if (mesh) {
      if (!snapshot.meshes.has(key)) snapshot.meshes.set(key,new Map());
      snapshot.meshes.get(key).set(mesh.triangle,mesh);
    }
    if (!prior||!valid) continue;
    const old=mesh && prior.meshes.get(key)?.get(mesh.triangle);
    if (mesh&&!old) continue;
    let before;
    if (old?.localProjection) {
      const point=[0,1,2].map(k=>hit.weights.reduce((sum,weight,i)=>sum+weight*old.points[i][k],0));
      const local=old.localProjection(...point), [, , depth]=cameraPoint(prior.camera.view,...point);
      const units=local.w/prior.camera.focal;
      const x=w*.5+local.x/units,y=h*.5-local.y/units;
      if (depth>=prior.camera.near && units>0 && x>=0 && x<w && y>=0 && y<h)
        before={x,y,depth,units};
    } else {
      const point=mesh ? meshPoint(old,hit.weights,prior.camera,w,h) : cameraPoint(prior.camera.view,...hit.position);
      before=project(prior.camera,point,w,h);
    }
    if (!before) continue;
    const q=Math.floor(before.y)*w+Math.floor(before.x);
    if (prior.keys[prior.ids[q]]!==key || Math.abs(prior.depth[q]-before.depth)>Math.max(.0001,before.units*1.25)) continue;
    valid[p]=255;
    if (vectors) {
      vectors[p*2]=x+.5-before.x;
      vectors[p*2+1]=y+.5-before.y;
    }
  }
  return {snapshot,vectors,valid};
}

module.exports={capture};
