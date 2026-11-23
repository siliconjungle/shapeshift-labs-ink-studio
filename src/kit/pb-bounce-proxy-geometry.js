/* Static mesh and signed-distance contributions on the same rays as diffuse splats. */
(function(K){
  const {V,procedural:{spatial,attributes}}=K;
  const linear=ColorSpace.prepare('srgb','srgb-linear'), black=[0,0,0];
  const rgb=hex=>linear([hex>>16,hex>>8&255,hex&255].map(n=>n/255));

  function geometry(world,settings,data,selection,bakedColor) {
    if(!settings.geometry) return;
    const {meshes,sdfs,steps,epsilon,light}=settings.geometry;
    const accepts=target=>ShadowArt.allows(settings.cast,target);
    const meshSources=new Map();
    for(const list of [world.meshes,world.splatDepthProxies?.meshes])
      for(const mesh of list??[]) if(!meshSources.has(mesh.id)) meshSources.set(mesh.id,mesh);
    const meshRays=meshes.map(({id,mode})=>{
      const mesh=meshSources.get(id);
      if(!mesh) throw new RangeError('Unknown bounce mesh proxy '+id);
      const trace=K.sceneMeshes.rayQuery(mesh,K), colors=new Map();
      return ray=>{
        const hit=trace(ray,row=>accepts(row.target));
        if(!hit)return;
        if(mode==='occlude')return {...hit,bounceRGB:black};
        if(!colors.has(hit.pigment))colors.set(hit.pigment,rgb(hit.pigment));
        return {...hit,bounceRGB:colors.get(hit.pigment)};
      };
    });

    const sdfModes=new Map(sdfs.map(row=>[row.object,row])), found=new Set();
    const sdfSources=[];
    if(sdfModes.size) {
      const targets=TargetSelectors.index(world);
      for(const field of AreaLights.staticSources(world,data)){
        const owners=new Map();
        for(const [owner,ranges] of field.rows){
          let style, points=[], indices=[];
          for(const [start,end,saved] of ranges) for(let i=start;i<end;i++){
            const target=targets.row(i), rule=sdfModes.get(target.object??owner.renderOwner);
            if(!rule) continue;
            found.add(rule.object);
            if(!selection.eligible[i])continue;
            style=rule;
            if(rule.mode==='reflect' && !rule.color){
              const at=(i-start)*3;
              points.push(Array.from(saved.subarray(at,at+3)));
              indices.push(i);
            }
            // The exact field replaces this object's baked Gaussian coverage.
            selection.eligible[i]=0;
          }
          if(!style) continue;
          const fixed=style.mode==='occlude'?black:style.color ? rgb(parseInt(style.color.slice(1),16)) : null;
          const nearest=fixed?null:attributes.nearest({points,entities:indices,read:i=>indices[i]});
          owners.set(owner,point=>fixed??bakedColor(nearest.sample(point).values));
        }
        if(owners.size)sdfSources.push({field,owners});
      }
      for(const {object} of sdfs) if(!found.has(object))
        throw new RangeError('Unknown retained static SDF bounce proxy '+object);
    }
    function sdfRay({origin,direction,maxDistance}, {field,owners}) {
      const {distance,bounds,locate}=field;
      const rayTime=spatial.rayBox(bounds,origin,direction,maxDistance);
      if(rayTime===null)return;
      const far=Math.min(maxDistance,...direction.map((d,i)=>
        Math.abs(d)<1e-8?Infinity:((d>0?bounds.max:bounds.min)[i]-origin[i])/d));
      let t=Math.max(epsilon,rayTime);
      for(let step=0;step<steps && t<=far;step++){
        const point=V.mad(origin,direction,t), magnitude=Math.abs(distance(...point));
        if(!Number.isFinite(magnitude))break;
        if(magnitude>epsilon){t+=magnitude*.72;continue;}
        if(!field.accepts || field.accepts(...point)){
          const {owner,body}=locate(...point), pigment=owners.get(owner)??owners.get(body);
          if(pigment){
            const bounceRGB=pigment(point);
            const normal=light && bounceRGB.some(Boolean) && V.norm(point.map((_,axis)=>{
              const low=point.slice(), high=point.slice();
              low[axis]-=epsilon;
              high[axis]+=epsilon;
              return distance(...high)-distance(...low);
            }));
            return {kind:'sdf',index:-1,point,distance:t,alpha:1,solid:true,bounceRGB,...(normal&&{normal})};
          }
        }
        t+=epsilon*4;
      }
    }
    return ray=>{
      const hits=[];
      for(const trace of meshRays){
        const hit=trace(ray);
        if(hit)hits.push(hit);
      }
      for(const source of sdfSources){
        const hit=sdfRay(ray,source);
        if(hit)hits.push(hit);
      }
      return hits;
    };
  }
  K.bounceProxyGeometry=geometry;
})(KIT);
