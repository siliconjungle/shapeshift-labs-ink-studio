/* Bounded orthographic projection of material-local signed shapes. Y is height, X/Z form the texture plane. */
const SplatterGeometry = ({ V,M,planar,volume }) => {
  const up=[0,1,0], PI=Math.PI, TAU=2*PI;
  const clamp=n=>Math.max(0,Math.min(1,n));
  function library(shapes,volumes,settings,time) {
    if (!Array.isArray(shapes)||!Array.isArray(volumes)||shapes.length+volumes.length>32)
      throw new RangeError('Shape Splatter needs at most 32 planar shapes and bounded fields');
    if(!shapes.length&&!volumes.length) shapes=[{type:'disc',radius:.44}];
    const {extrusion,rounding}=settings;
    const flat=Array.from(shapes,source=>{
      const {distance}=planar(source), half=[.5,extrusion/2,.5];
      return {kind:'planar',half,read(x,y,z){
        const edge=Math.max(distance(x+.5,z+.5),Math.abs(x)-.5,Math.abs(z)-.5)+rounding;
        const cap=Math.abs(y)-half[1]+rounding;
        return Math.hypot(Math.max(0,edge),Math.max(0,cap))+Math.min(0,Math.max(edge,cap))-rounding;
      }};
    });
    return [...flat,...Array.from(volumes,source=>{
      const {box,read}=volume(source,time);
      const extent=box.max.map((n,i)=>n-box.min[i]), size=Math.max(...extent);
      if (!Number.isFinite(size)||size<1e-8||size>1e7||extent.some(n=>n<size*1e-8))
        throw new RangeError('Shape Splatter field has invalid bounds');
      const center=box.min.map((n,i)=>n+extent[i]/2), half=extent.map(n=>n/(2*size));
      return {kind:'volume',half,read:(x,y,z)=>read(x*size+center[0],y*size+center[1],z*size+center[2])/size};
    })];
  }
  function pose(shape,base,scale,angles,slope,align,epsilon) {
    const [x,y,z]=angles.map(n=>n%360*PI/180);
    const axisX=[1,0,0], axisZ=[0,0,1];
    const spin=M.mul(M.rot(axisZ,z),M.mul(M.rot(up,y),M.rot(axisX,x)));
    const tilt=M.rot(V.norm(V.cross(up,slope),axisX),Math.acos(Math.max(-1,Math.min(1,slope[1])))*align);
    const matrix=M.mul(tilt,spin);
    const inverse=M.tr(matrix).map((n,i)=>n/scale[Math.floor(i/3)]);
    const center=V.add(base,M.app(matrix,[0,shape.half[1]*scale[1],0]));
    const box=shape.half.map(n=>n+epsilon*2);
    const extent=[0,1,2].map(j=>box.reduce((sum,n,i)=>sum+Math.abs(matrix[j*3+i])*n*scale[i],0));
    const direction=[inverse[1],inverse[4],inverse[7]], length=V.len(direction);
    return {shape,center,box,extent,inverse,direction,length};
  }
  function local(target,x,z,height) {
    const {inverse}=target.asset, {cx,cz,asset:{center}}=target;
    return M.app(inverse,[x-cx,height-center[1],z-cz]);
  }
  function trace(target,x,z,floor,settings) {
    const {asset,cx,cz}=target, {center,extent,inverse,direction,box,length,shape:{read}}=asset;
    if (Math.abs(x-cx)>extent[0]||Math.abs(z-cz)>extent[2]||center[1]+extent[1]<floor)
      return -Infinity;
    const p=M.app(inverse,[x-cx,0,z-cz]), {epsilon,steps,safety}=settings;
    let lo=Math.max(-extent[1],floor-center[1]), hi=extent[1];
    for(let axis=0;axis<3;axis++){
      const d=direction[axis], q=p[axis], b=box[axis];
      if(Math.abs(d)<1e-12) { if(Math.abs(q)>b) return -Infinity; continue; }
      const a=(-b-q)/d,f=(b-q)/d;
      lo=Math.max(lo,Math.min(a,f));hi=Math.min(hi,Math.max(a,f));
    }
    const dx=direction[0],dy=direction[1],dz=direction[2];
    for(let i=0,t=hi;i<steps&&t>=lo;i++){
      const distance=read(p[0]+dx*t,p[1]+dy*t,p[2]+dz*t);
      if (!Number.isFinite(distance)) throw new RangeError('Shape Splatter requires finite signed distance samples');
      if (distance<=epsilon) return center[1]+t;
      t-=Math.max(epsilon,distance*safety)/length;
    }
    return -Infinity;
  }
  function normal(asset,q,epsilon) {
    const {shape:{read},inverse}=asset, [x,y,z]=q, e=epsilon*2;
    const gradient=[read(x+e,y,z)-read(x-e,y,z),read(x,y+e,z)-read(x,y-e,z),read(x,y,z+e)-read(x,y,z-e)];
    if(!gradient.every(Number.isFinite)) throw new RangeError('Shape Splatter needs a finite signed-field gradient');
    return V.norm(M.app(M.tr(inverse),gradient),up);
  }
  function uv(shape,q,settings) {
    const {mode,scale,offset,angle,address}=settings, [x,y,z]=q;
    const [hx,hy,hz]=shape.half;
    let u=.5+x/(2*hx), v=.5+z/(2*hz);
    if(mode!=='planar'){
      u=.5+Math.atan2(z,x)/TAU;
      v=mode==='cylindrical'?.5-y/(2*hy):.5-Math.asin(Math.max(-1,Math.min(1,y/(Math.hypot(x,y,z)||1))))/PI;
    }
    const a=angle%360*PI/180,c=Math.cos(a),s=Math.sin(a),dx=u-.5,dy=v-.5;
    const out=[(.5+c*dx-s*dy)*scale[0]+offset[0],(.5+s*dx+c*dy)*scale[1]+offset[1]];
    if(address==='wrap') return out.map(n=>n-Math.floor(n));
    return address==='clamp'?out.map(clamp):out;
  }
  return {library,pose,trace,local,normal,uv};
};
