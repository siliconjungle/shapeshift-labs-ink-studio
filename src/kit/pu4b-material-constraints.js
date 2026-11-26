/* XPBD constraints for finite strain and user-authored point assemblies. */
(function (K) {
  const W=K.world, {V}=K, zero=[0,0,0];
  const lengthPresets={
    seam:{kind:'distance',compliance:8e-6},
    spring:{kind:'distance',compliance:.0008},
    cable:{kind:'tether',compliance:2e-5},
    spacer:{kind:'strut',compliance:4e-6},
    hinge:{kind:'angle',compliance:.00012},
    tendon:{kind:'fiber',compliance:2e-5,contraction:.28}
  };
  const materialPresets={
    silicone:{density:1.12,stretch:.00024,shear:.00048,bulk:.000004,stiffening:10,
      staticFriction:.98,dynamicFriction:.72,restitution:.38,compliance:0,color:'#67c9bd'},
    foam:{density:.32,stretch:.0014,shear:.0032,bulk:.008,stiffening:3,
      staticFriction:.78,dynamicFriction:.56,restitution:.12,compliance:0,color:'#dca36e'},
    elastomer:{density:1.25,stretch:.00006,shear:.00012,bulk:.000002,stiffening:18,
      staticFriction:1.15,dynamicFriction:.86,restitution:.52,compliance:0,color:'#d48278'},
    glass:{density:2.55,stretch:.000004,shear:.000004,bulk:.000001,stiffening:8,
      staticFriction:.25,dynamicFriction:.17,restitution:.8,compliance:0,color:'#e8e1b1'},
    stone:{density:2.65,stretch:.00002,shear:.00003,bulk:.000006,stiffening:7,
      staticFriction:.82,dynamicFriction:.63,restitution:.18,compliance:0,color:'#9d8b84'},
    grit:{density:1.8,stretch:.0001,shear:.0002,bulk:.00002,stiffening:4,
      staticFriction:1.1,dynamicFriction:.83,restitution:.18,compliance:0,color:'#e1aa6d'},
    polished:{density:2.4,stretch:.00001,shear:.00001,bulk:.000002,stiffening:6,
      staticFriction:.13,dynamicFriction:.08,restitution:.77,compliance:0,color:'#8eabb7'},
    felt:{density:.48,stretch:.0008,shear:.0013,bulk:.004,stiffening:3,
      staticFriction:1.22,dynamicFriction:.92,restitution:.06,compliance:0,color:'#917bab'}
  };
  const presets=K.procedural.data.freeze({materials:materialPresets,constraints:lengthPresets});
  const get=(flat,i)=>[flat[i*3],flat[i*3+1],flat[i*3+2]];
  const signed=([a,b,c,d])=>V.dot(V.sub(b,a),V.cross(V.sub(c,a),V.sub(d,a)));
  const trim=(n,a,b)=>Math.max(a,Math.min(b,n));
  const sq=x=>V.dot(x,x);

  function scalar(X,inv,ids,g,error,soft,lambda,min=-Infinity,max=Infinity) {
    const w=g.reduce((sum,v,j)=>sum+inv[ids[j]]*sq(v),0);
    if(w<1e-16)return lambda;
    const next=trim(lambda-(error+soft*lambda)/(w+soft),min,max), d=next-lambda;
    for(const [j,i] of ids.entries())if(inv[i])X.set(V.mad(get(X,i),g[j],inv[i]*d),i*3);
    return next;
  }

  function tetra(ids,rest,material) {
    const [a,b,c,d]=rest, u=V.sub(b,a), v=V.sub(c,a), w=V.sub(d,a), det=signed(rest);
    const reciprocal=[V.cross(v,w),V.cross(w,u),V.cross(u,v)].map(row=>V.mul(row,1/det));
    const coefficients=reciprocal.map(row=>row.slice());
    coefficients.unshift(V.mul(reciprocal.reduce(V.add,zero),-1));
    const volume=Math.abs(det)/6, links=[[0,1],[0,2],[1,2]];
    const softer=(base,error,h2)=>base/(volume*h2*(1+material.stiffening*error*error));
    function project(X,inv,h2,lambda){
      const F=axis=>{
        const p=get(X,ids[0]);
        return [1,2,3].reduce((sum,i)=>V.mad(sum,V.sub(get(X,ids[i]),p),coefficients[i][axis]),zero);
      };
      for(let i=0;i<3;i++){
        const f=F(i), error=(sq(f)-1)*.5, g=coefficients.map(row=>V.mul(f,row[i]));
        lambda[i]=scalar(X,inv,ids,g,error,softer(material.stretch,error,h2),lambda[i]);
      }
      for(const [k,[i,j]] of links.entries()){
        const u=F(i),v=F(j),error=V.dot(u,v),g=coefficients.map(row=>V.mad(V.mul(v,row[i]),u,row[j]));
        lambda[k+3]=scalar(X,inv,ids,g,error,softer(material.shear,error,h2),lambda[k+3]);
      }
      const [p,q,r,s]=ids.map(i=>get(X,i)), e=V.sub(q,p), f=V.sub(r,p), g=V.sub(s,p),
        gx=[V.cross(f,g),V.cross(g,e),V.cross(e,f)].map(row=>V.mul(row,1/det)),
        ratio=V.dot(e,gx[0]);
      gx.unshift(V.mul(gx.reduce(V.add,zero),-1));
      // A unilateral lower bound resists inversion separately from recoverable volume strain.
      const barrier=.12;
      if(ratio<barrier||lambda[7]>0)
        lambda[7]=scalar(X,inv,ids,gx,ratio-barrier,0,lambda[7],0);
      else lambda[6]=scalar(X,inv,ids,gx,ratio-1,softer(material.bulk,ratio-1,h2),lambda[6]);
    }
    return {ids,volume,ratio:X=>signed(ids.map(i=>get(X,i)))/det,project};
  }

  function link(ids,rest,profile) {
    const {kind,compliance,contraction=0}=profile;
    function angle(points){
      const [a,b,c]=points, u=V.sub(a,b),v=V.sub(c,b),lu=V.len(u),lv=V.len(v);
      if(Math.min(lu,lv)<1e-8)return null;
      const n=V.mul(u,1/lu),m=V.mul(v,1/lv),cos=trim(V.dot(n,m),-1,1),
        ga=V.mul(V.mad(m,n,-cos),1/lu),gc=V.mul(V.mad(n,m,-cos),1/lv);
      return {cos,g:[ga,V.mul(V.add(ga,gc),-1),gc]};
    }
    const restValue=kind==='angle'?angle(rest)?.cos:V.dist(...rest);
    W.data.check(restValue!==undefined&&(kind==='angle'||restValue>1e-7),'Degenerate material lab constraint');
    const target=profile.target??(kind==='angle'?Math.acos(restValue):restValue);
    function errorAt(points,value){
      if(kind==='angle'){
        const row=angle(points);
        return row&&{error:row.cos-Math.cos(target),g:row.g};
      }
      const d=V.sub(points[0],points[1]),length=V.len(d),normal=length>1e-9?V.mul(d,1/length):V.norm(V.sub(rest[0],rest[1]));
      return {error:length-target*(1-contraction*value),g:[normal,V.mul(normal,-1)]};
    }
    return {kind,target,compliance,contraction,project(X,inv,h2,lambda,drive){
      const ready=errorAt(ids.map(i=>get(X,i)),drive);
      if(!ready)return lambda;
      const low=kind==='strut'?0:-Infinity, high=kind==='tether'?0:Infinity;
      return scalar(X,inv,ids,ready.g,ready.error,compliance/h2,lambda,low,high);
    },error:(X,drive)=>{
      const row=errorAt(ids.map(i=>get(X,i)),drive);
      return row?kind==='tether'?Math.max(0,row.error):kind==='strut'?Math.min(0,row.error):row.error:null;
    }};
  }

  W.materialConstraints=Object.freeze({presets,signed,get,tetra,link});
})(KIT);
