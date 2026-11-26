const { fields, localName, range, vector, rad } = require('./character-rig-assembly.js');
const { integer, pigment } = require('./wardrobe-cloth.js');

const zero=[0,0,0];
const pathPoints=(value,min,max)=>Array.isArray(value)&&range(value.length,min,max)&&value.every(row=>vector(row));

function attachments(plan, cloth, joints, K) {
  const {V,M}=K, {grooms=[],feathers=[]}=plan, used=new Set();
  if (!Array.isArray(grooms)||grooms.length>24||!Array.isArray(feathers)||feathers.length>24)
    throw new RangeError('Use bounded lists of grooms and feather rows');
  const reserve=id=>{
    if (!localName(id)||used.has(id)||cloth.names.has(id)) throw new RangeError('Duplicate or invalid wardrobe detail '+id);
    used.add(id);
  };

  function anchor(spec) {
    if (!fields(spec,['panel','uv','joint','point']) || spec.panel!==undefined&&
        (spec.joint!==undefined||spec.point!==undefined||!cloth.names.has(spec.panel)||!vector(spec.uv,2,0,1)) ||
        spec.panel===undefined&&(spec.uv!==undefined||!vector(spec.point??zero)||
          spec.joint!==undefined&&!joints.has(spec.joint))) throw new TypeError('Use a panel UV, joint point, or fixed point as a groom anchor');
    if (spec.panel===undefined) return (positions,rig,time)=>{
      const {joint,point=zero}=spec, origin=rig.point(joint,point,time);
      return {origin,point:p=>V.add(origin,rig.direction(joint,p,time)),direction:p=>rig.direction(joint,p,time)};
    };
    const panel=cloth.names.get(spec.panel), {nu,nv,start,side}=panel;
    const x=spec.uv[0]*(nu-1), y=spec.uv[1]*(nv-1), i=Math.min(nu-2,Math.floor(x)), j=Math.min(nv-2,Math.floor(y));
    const u=x-i,v=y-j, a=start+j*nu+i, b=a+1, c=a+nu, d=c+1;
    const weights=u+v<=1?[[a,1-u-v],[b,u],[c,v]]:[[b,1-v],[d,u+v-1],[c,1-u]];
    return positions=>{
      const at=i=>positions.slice(3*i,3*i+3);
      const origin=weights.reduce((q,[i,w])=>V.mad(q,at(i),w),zero);
      const edgeU=u+v<=1?V.sub(at(b),at(a)):V.sub(at(d),at(c));
      const edgeV=u+v<=1?V.sub(at(c),at(a)):V.sub(at(d),at(b));
      const up=V.norm(V.mul(V.cross(edgeU,edgeV),side),[0,0,1]);
      const tangent=V.norm(edgeU,V.perp(up)), across=V.cross(up,tangent);
      const direction=([p,q,r])=>V.add(V.add(V.mul(tangent,p),V.mul(across,q)),V.mul(up,r));
      return {origin,point:p=>V.add(origin,direction(p)),direction};
    };
  }

  let groomSpans=0, featherCount=0, featherTriangles=0;
  const bundles=grooms.map(row=>{
    if (!fields(row,['id','anchor','guide','up','seed','count','clumps','tightness','separation','radius','frizz','samples',
      'lengthVariation','colors'])||!pathPoints(row.guide,2,48)||
        row.up!==undefined&&(!vector(row.up)||V.len(row.up)<1e-7)) throw new TypeError('A groom needs a local XYZ guide');
    const {id,anchor:mount,guide,colors=['#c79671'],...settings}=row;
    reserve(id);
    if (!Array.isArray(colors)||!range(colors.length,1,16)||!colors.every(pigment))
      throw new TypeError('A groom needs a pigment palette');
    const frame=anchor(mount);
    const bundle=K.curveSplats.bundle({style:'clumped-hair',id,guide,seed:plan.seed??1,...settings});
    groomSpans+=bundle.strands.reduce((n,row)=>n+row.path.points.length-1,0);
    if (groomSpans>12000) throw new RangeError('Wardrobe grooms exceed the strand segment budget');
    return {bundle,frame,colors};
  });

  const rows=feathers.map(row=>{
    if (!fields(row,['id','joint','from','to','direction','normal','count','length','width','fan','curl','asymmetry',
      'samples','colors','action'])||row.joint!==undefined&&!joints.has(row.joint)||
        ![row.from,row.to,row.direction,row.normal].every(p=>vector(p))||
        V.len(row.direction)<1e-7||V.len(V.cross(V.norm(row.direction),row.normal))<1e-7)
      throw new TypeError('A feather row needs a placement span, direction and perpendicular reference');
    const {id,joint,from,to,count=8,length=[.38,.68],width=[.11,.12],fan=[0,45],
      curl=.12,asymmetry=.13,samples=10,colors=['#36596c','#6c9997','#e3a775'],action}=row;
    reserve(id);
    if (!integer(count,1,64)||!integer(samples,4,24)||!vector(length,2,.01,20)||!vector(width,2,.003,10)||
        !vector(fan,2,-180,180)||!range(curl,-1,1)||!range(asymmetry,-.75,.75)||
        !Array.isArray(colors)||colors.length!==3||!colors.every(pigment))
      throw new RangeError('Invalid shape, sampling or pigments in feather row '+id);
    featherCount+=count;
    featherTriangles+=4*samples*count;
    if (featherCount>256||featherTriangles>24576) throw new RangeError('Wardrobe feathers exceed their geometry budget');
    const tangent=V.norm(row.direction), normal=V.norm(V.sub(row.normal,V.mul(tangent,V.dot(row.normal,tangent))));
    let track, axis, stagger=0;
    if (action!==undefined) {
      if (!fields(action,['axis','stagger','keys'])||!vector(action.axis)||V.len(action.axis)<1e-7||
          !range(action.stagger??0,0,10)||!Array.isArray(action.keys)||!range(action.keys.length,1,128)||
          !action.keys.every(key=>fields(key,['time','value','ease'])&&range(key.time,0,60)&&range(key.value,-180,180)))
        throw new TypeError('Feather articulation needs a hinge axis and keyed angles');
      axis=V.norm(action.axis);
      track=K.anim.keyframeTrack.create({angle:'number'},action.keys.map(({time,value,ease})=>({time,value:{angle:value},ease})));
      stagger=action.stagger??0;
    }
    return {id,joint,from,to,count,length,width,fan,curl,asymmetry,samples,colors,tangent,normal,track,axis,stagger};
  });

  function plumes(row, rig, time) {
    const {id,joint,count,from,to,length,width,fan,curl,asymmetry,samples,colors,tangent,normal,track,axis,stagger}=row;
    return Array.from({length:count},(_,index)=>{
      const across=index/Math.max(1,count-1), root=rig.point(joint,V.lerp(from,to,across),time);
      const angle=track?.sample(time-across*stagger).angle??0;
      const splay=M.rot(normal,K.mix(...fan,across)*rad);
      const fold=track?M.rot(axis,angle*rad):M.id();
      const orient=p=>rig.direction(joint,M.app(fold,M.app(splay,p)),time);
      const T=orient(tangent), N=orient(normal), S=V.cross(N,T);
      const span=K.mix(...length,across), wide=K.mix(...width,across);
      const positions=[], uvs=[], indices=[], faceMaterials=[], shaft=[];
      for (let j=0;j<=samples;j++) {
        const t=j/samples, p=V.mad(V.mad(root,T,span*t),N,span*curl*t*t);
        const taper=.04+.96*Math.pow(Math.sin(Math.PI*(.02+.98*t)),.78)*(1-.28*t);
        const w=wide*taper*.5, cup=w*.19;
        shaft.push(p);
        positions.push(...V.mad(V.mad(p,S,-w*(1-asymmetry)),N,-cup),...p,
          ...V.mad(V.mad(p,S,w*(1+asymmetry)),N,-cup));
        uvs.push(0,t,.5,t,1,t);
        if (j) {
          const a=(j-1)*3,b=j*3;
          indices.push(a,a+1,b,b,a+1,b+1,a+1,a+2,b+1,b+1,a+2,b+2);
          faceMaterials.push(t>.79?2:0,t>.79?2:0,t>.79?2:1,t>.79?2:1);
        }
      }
      return {id:id+':'+(index+1),joint,root,angle,tip:shaft.at(-1),positions,uvs,indices,faceMaterials,colors,
        shaft:{points:shaft,width:Math.max(.004,wide*.055),color:colors[2]}};
    });
  }

  function sample(positions, rig, time) {
    return {
      grooms:bundles.map(({bundle,frame,colors})=>{
        const {origin,point,direction}=frame(positions,rig,time);
        const strands=bundle.strands.map(strand=>({...strand,path:{...strand.path,points:strand.path.points.map(point),
          ...(strand.path.up&&{up:direction(strand.path.up)})}}));
        return {id:bundle.id,origin,colors,plan:{...bundle,strands}};
      }),
      feathers:rows.flatMap(row=>plumes(row,rig,time))
    };
  }
  return {sample,summary:{grooms:bundles.map(({bundle})=>({id:bundle.id,strands:bundle.strands.length,
    clumps:new Set(bundle.strands.map(row=>row.clump)).size,seed:bundle.seed})),groomSpans,
    featherRows:rows.map(({id,joint,count})=>({id,joint,count})),feathers:featherCount,featherTriangles}};
}

module.exports={attachments};
