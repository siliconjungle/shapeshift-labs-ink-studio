/* Shared sphere and authored surface contact for soft nodes and loose grains. */
const materialLabContact = (function(K){
  const W=K.world, {V,M}=K, {get}=materialLabConstraints;
  const zero=[0,0,0], up=[0,1,0], identity=M.id(), eps=1e-7;
  const pairKey=(a,b)=>a<b?a+'/'+b:b+'/'+a;

  function mix(a,b,override){
    return {
      staticFriction:Math.sqrt(a.staticFriction*b.staticFriction),
      dynamicFriction:Math.sqrt(a.dynamicFriction*b.dynamicFriction),
      restitution:Math.min(a.restitution,b.restitution),
      compliance:a.compliance+b.compliance,
      ...override
    };
  }

  function shape(source){
    if(source.kind==='plane'){
      const normal=V.norm(source.normal), offset=source.offset??0, along=source.u??V.perp(normal);
      const u=V.norm(V.mad(along,normal,-V.dot(along,normal))), v=V.cross(normal,u);
      return {normal,distance:p=>V.dot(normal,p)-offset, contains:(p,radius)=>!source.half||
        Math.abs(V.dot(p,u))<=source.half[0]+radius&&Math.abs(V.dot(p,v))<=source.half[1]+radius};
    }
    const half=W.colliders.local(source).half;
    const body={position:zero,rotation:identity,collider:source,half};
    return {body,distance:p=>W.colliders.distance(body,p)};
  }

  function start(nodes,surfaces,settings,pairs){
    const colliding=nodes.flatMap((row,i)=>row.radius>0?[i]:[]);
    const spacing=Math.max(.01,...colliding.map(i=>nodes[i].radius*2));
    const neighbors=[];
    for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)neighbors.push([x,y,z]);
    const address=p=>p.map(n=>Math.floor(n/spacing));
    const key=p=>p.join('/');
    const skin=1e-6;

    function session(consume){
      const samples=[], summaries={};
      let solveCount=0, omitted=0, speedLimited=0, maxPenetration=0;
      function answer(row,h,time,remaining){
        const {source,target,pair,normal,point,depth,normalImpulse,tangentImpulse,impulse,slip,approach,mode,basis}=row;
        const summary=summaries[pair]??={
          pair,coefficients:pairs.get(pair),count:0,normalImpulse:0,tangentImpulse:0,
          slipBefore:0,slipAfter:0,peakPenetration:0,stuck:0,sliding:0
        };
        summary.count++;
        summary.normalImpulse+=normalImpulse;
        summary.tangentImpulse+=tangentImpulse;
        summary.slipBefore+=V.len(slip);
        summary.slipAfter+=remaining;
        summary.peakPenetration=Math.max(summary.peakPenetration,depth);
        if(mode==='stick')summary.stuck++;
        if(mode==='slide')summary.sliding++;
        if(samples.length>=settings.maxContactSamples){
          omitted++;
          return;
        }
        const kind=approach>settings.bounceSpeed?'impact':mode==='slide'?'scrape':'impact';
        const sample=W.contactSamples.sample({kind,source:source.id,target:target.id,point,normal,slip,impulse,
          interval:h,pointBasis:basis,forceBasis:'step-average'},{time});
        samples.push({...sample,pair,contact:source.id+'/'+target.id,sourceMaterial:source.material,targetMaterial:target.material,
          penetration:depth,normalImpulse,tangentImpulse,slipBefore:V.len(slip),slipAfter:remaining,approach,mode});
      }

      function begin(X,P,inv,h,time,pose,speedLimit){
        const active=new Map(), velocity=nodes.map((_,i)=>V.mul(V.sub(get(X,i),get(P,i)),1/h));
        function contact(i,j,other,bVelocity,normal,point,depth,basis){
          const wi=inv[i],wj=j===null?0:inv[j], total=wi+wj;
          if(total<=0)return;
          solveCount++;
          depth=Math.max(0,depth);
          maxPenetration=Math.max(depth,maxPenetration);
          const source=nodes[i], pair=pairKey(source.material,other.material), c=pairs.get(pair);
          const denominator=total+c.compliance/(h*h);
          if(depth>0&&wi)X.set(V.mad(get(X,i),normal,depth*wi/denominator),i*3);
          if(depth>0&&wj)X.set(V.mad(get(X,j),normal,-depth*wj/denominator),j*3);
          const relative=V.sub(velocity[i],bVelocity), vn=V.dot(relative,normal);
          if(vn>=-eps)return; // overlap projection alone carries no velocity impulse
          const approach=-vn, contactId=source.id+'/'+other.id;
          const prior=active.get(contactId), bounce=approach>settings.bounceSpeed&&!prior?c.restitution:0;
          const jn=(1+bounce)*approach/denominator, slip=V.mad(relative,normal,-vn), speed=V.len(slip),
            required=speed/total, stick=required<=c.staticFriction*jn,
            jt=speed>eps?V.mul(slip,-Math.min(required,stick?required:c.dynamicFriction*jn)/speed):zero;
          const impulse=V.add(V.mul(normal,jn),jt);
          if(wi)velocity[i]=V.mad(velocity[i],impulse,wi);
          if(wj)velocity[j]=V.mad(velocity[j],impulse,-wj);
          const mode=speed<=eps?'normal':stick?'stick':'slide';
          if(prior){
            prior.impulse=V.add(prior.impulse,impulse);
            prior.normalImpulse+=jn;
            prior.tangentImpulse+=V.len(jt);
            prior.depth=Math.max(prior.depth,depth);
            if(mode==='slide'||prior.mode==='normal')prior.mode=mode;
          }else active.set(contactId,{i,j,bVelocity,source,target:other,pair,normal,point,depth,normalImpulse:jn,
            tangentImpulse:V.len(jt),impulse,slip,approach,mode,basis});
        }

        function elastic(before) {
          for(const [i,v] of velocity.entries())if(inv[i])
            velocity[i]=V.mad(v,V.sub(get(X,i),get(before,i)),1/h);
        }
        function project(passes=1) {
          for(let pass=0;pass<passes;pass++){
            for(const i of colliding)if(inv[i])for(const [j,surface] of surfaces.entries()){
              consume(1,'surfaceChecks');
              const p=get(X,i), {position,bVelocity}=pose[j], local=V.sub(p,position);
              const {distance:sdf,contains}=surface.form, radius=nodes[i].radius;
              if(contains&&!contains(local,radius))continue;
              const d=sdf(local);
              if(d>radius+skin)continue;
              let normal=surface.form.normal;
              if(!normal){
                consume(6,'surfaceChecks');
                const axis=local.map((n,k)=>{
                  const plus=local.slice(),minus=local.slice();
                  plus[k]=n+1e-5;minus[k]=n-1e-5;
                  return sdf(plus)-sdf(minus);
                });
                normal=V.len(axis)>1e-10?V.norm(axis):up;
              }
              contact(i,null,surface,bVelocity,normal,V.mad(p,normal,-d),radius-d,surface.form.normal?'ground':'surface');
            }
            const grid=new Map();
            for(const i of colliding){
              const at=key(address(get(X,i)));
              if(!grid.has(at))grid.set(at,[]);
              grid.get(at).push(i);
            }
            for(const i of colliding){
              const source=nodes[i], at=address(get(X,i));
              consume(27,'neighborCells');
              for(const n of neighbors){
                const candidates=grid.get(key(V.add(at,n)));
                if(!candidates)continue;
                for(const j of candidates){
                  if(j<=i)continue;
                  consume(1,'pairChecks');
                  const other=nodes[j];
                  if(!inv[i]&&!inv[j]||source.group!==null&&source.group===other.group)continue;
                  const p=get(X,i),q=get(X,j),delta=V.sub(p,q),distance=V.len(delta), radius=source.radius+other.radius;
                  if(distance>radius+skin)continue;
                  const diff=V.sub(velocity[i],velocity[j]);
                  const normal=distance>eps?V.mul(delta,1/distance):V.len(diff)>eps?V.mul(V.norm(diff),-1):[(i+j)%2?1:-1,0,0];
                  contact(i,j,other,velocity[j],normal,V.mad(q,normal,other.radius),radius-distance,'overlap');
                }
              }
            }
          }
        }
        function finish(){
          for(const row of active.values()){
            const relative=V.sub(velocity[row.i],row.j===null?row.bVelocity:velocity[row.j]);
            const remaining=V.len(V.mad(relative,row.normal,-V.dot(relative,row.normal)));
            answer(row,h,time,remaining);
          }
          // Separate overlap correction from velocity impulses before XPBD reconstructs velocity.
          for(const [i,v] of velocity.entries())if(inv[i]){
            const speed=V.len(v), rate=speed>speedLimit?speedLimit/speed:1;
            if(rate<1)speedLimited++;
            P.set(V.mad(get(X,i),v,-h*rate),i*3);
          }
        }
        return {elastic,project,finish};
      }

      function report(){
        return {samples,pairs:Object.fromEntries(Object.entries(summaries).sort(([a],[b])=>a<b?-1:a>b?1:0)),
          solves:solveCount,recorded:samples.length,omitted,speedLimited,maxPenetration};
      }
      return {begin,report};
    }
    return {session};
  }
  return Object.freeze({pairKey,mix,shape,start});
})(KIT);
