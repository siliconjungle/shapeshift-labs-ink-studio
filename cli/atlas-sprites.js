const Atlas = require('../src/atlas-sprites.js');
const SpriteBudget = require('../src/sprite-scanline-budget.js');
const { dot,basis,vector }=Atlas;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const combine=(axes,v)=>axes.right.map((n,i)=>n*v[0]+axes.up[i]*v[1]+axes.normal[i]*v[2]);
const local=(axes,v)=>[dot(v,axes.right),dot(v,axes.up),dot(v,axes.normal)];
function unit(v) {
  const length=Math.hypot(...v);
  return length>1e-6 ? v.map(n=>n/length) : undefined;
}
function heading(v) {
  return [Math.atan2(v[0],v[2]),Math.atan2(v[1],Math.hypot(v[0],v[2]))];
}

function rasterize(placements, settings) {
  const {eye,V,W,H,focal,ortho,near,rayAt,time:sceneTime,interfaceTime,override,sun,visibility,clip,objectDither,
    subject,captureIds,shutterTime,reconstructed,spriteLOD,budgets,budgetTime,budgetFrame,impostorBlend,artScale=1}=settings;
  const layers = new Map();
  if (budgets !== undefined && budgets !== false) {
    if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets))
      throw new TypeError('Sprite atlas budgets need a record by layer name');
    for (const [name, options] of Object.entries(budgets)) {
      if (!name.trim()) throw new TypeError('Sprite atlas budget layers need a name');
      if (options !== false) layers.set(name, { budget: SpriteBudget.prepare(options), entries: [] });
    }
  }
  if (!placements.length && !layers.size) return [];
  const deferred = layers.size ? [] : null;
  const artHeight = Math.ceil(H / artScale);
  const artRow = y => Math.floor((H - 1 - y) / artScale);
  if (override!==undefined&&!['card','impostor','scenery'].includes(override))
    throw new RangeError('Sprite atlas mode must be card, impostor or scenery');
  Atlas.viewBlend(impostorBlend);
  const results=[];
  const viewForward=[V[2],V[6],V[10]];
  const project=point=>{
    const [x,y,z]=point;
    const depth=-(V[2]*x+V[6]*y+V[10]*z+V[14]);
    const scale=ortho?focal:focal/depth;
    return [W*.5+scale*(V[0]*x+V[4]*y+V[8]*z+V[12]),
      H*.5+scale*(V[1]*x+V[5]*y+V[9]*z+V[13]),depth];
  };
  const frameView = { project(point) {
    const [x, y, depth] = project(point);
    return [x, H - y, depth];
  } };
  const effectColor=[0,0,0];
  function fragmentAt(ray, hit) {
    const z=hit*ray.axial;
    if (z<near) return null;
    const position=ray.origin.map((n,i)=>n+hit*ray.direction[i]);
    return clip&&!clip(position)?null:{z,position};
  }
  const sample={ color:[0,0,0],normal:[0,0,0],emission:[0,0,0] };
  for (const [placementIndex, placement] of placements.entries()) {
    const layer = layers.get(placement.budgetLayer);
    const budgetIndex = layer?.entries.length;
    const entry = layer && { id: placement.budgetId ?? String(placementIndex), priority: placement.budgetPriority,
      top: artHeight, bottom: artHeight };
    if (entry) layer.entries.push(entry);
    const lod=reconstructed?.get(placement);
    const time = lod ? sceneTime :
      placement.clock === 'interface' ? interfaceTime ?? sceneTime : shutterTime?.(placement) ?? sceneTime;
    const {atlas,opacity}=placement, mode=lod?'impostor':override??placement.mode;
    const protection=subject?.({object:placement.objectId,entity:placement.objectId,material:placement.materialId});
    const ids = (captureIds || lod?.part !== undefined) &&
      { objectId:placement.objectId, materialId:placement.materialId, partId:lod?.part };
    if (!opacity || placement.visibleAt && !placement.visibleAt(time)) continue;
    const at=lod?.at??(typeof placement.at==='function'?vector(placement.at(time),'Sprite atlas anchor'):placement.at);
    const fixed=mode==='scenery';
    const exact=placement.nativePixels && mode==='card';
    if (fixed&&!atlas.sceneryPlanes) throw new TypeError('Scenery mode needs a painted scenery atlas');
    const anchorScreen=fixed?null:project(at);
    const direction=ortho||exact?viewForward:unit(eye.map((n,i)=>n-at[i]));
    if (!direction||(!fixed&&anchorScreen[2]<near)) continue;
    const rotation=basis(placement.yaw,0);
    const frame=lod?undefined:typeof placement.frame==='function'?placement.frame(time,frameView):placement.frame??placement.frameAt?.(time);
    const localDirection=local(rotation,direction);
    const authored=lod?.view??atlas.select(frame,mode,localDirection);
    const pixelsPerTexel=authored.unitsPerPixel*placement.scale*focal/(artScale*(ortho||fixed?1:anchorScreen[2]));
    const reprojection=lod ? lod.reprojection : mode==='impostor' && Atlas.reproject(placement,authored,localDirection,{
      blend:impostorBlend, distance:ortho ? Infinity : Math.hypot(...eye.map((n,i)=>n-at[i])), pixelsPerTexel, time });
    const tile=reprojection?.view ?? authored;
    const effect=reprojection?null:atlas.effect?.(authored), fringe=reprojection?null:atlas.fringe?.(authored,time),
      transition=reprojection?null:atlas.transition?.(authored,time);
    const normalAxes=basis(authored.yaw+placement.yaw,authored.pitch);
    const axes=lod?.axes??(reprojection ? basis(reprojection.report.yaw+placement.yaw,reprojection.report.pitch) :
      fixed?normalAxes:basis(...heading(direction)));
    const units=tile.unitsPerPixel*placement.scale;
    const mip=!reprojection&&!fixed&&!exact&&!transition&&atlas.cutoutImage?.(tile,
      lod?.cutoutLevel??atlas.cutoutLevel(tile,pixelsPerTexel));
    const {x:tileX,y:tileY,width,height}=tile.rect, px=tile.pivot.x,py=tile.pivot.y;
    // Round the card origin once. Every texel then gets one integer art-pixel address.
    const offset=exact&&placement.pixelOffset?placement.pixelOffset(time):null;
    const originPixel=exact?Atlas.nativeOrigin(tile,anchorScreen[0],H-anchorScreen[1]):null;
    const rasterX=exact?originPixel[0]+(offset?.[0]??0):0;
    const rasterY=exact?H-originPixel[1]-height-(offset?.[1]??0):0;
    const planes=fixed&&placement.depth?atlas.sceneryPlanes:[{depth:0}];
    for (const {id,depth,bounds} of planes) {
      const anchor=depth?at.map((n,i)=>n-depth*placement.scale*axes.normal[i]):at;
      const u0=bounds?Math.max(0,bounds[0]-tileX):0, u1=bounds?Math.min(width,bounds[2]-tileX):width;
      const v0=bounds?Math.max(0,bounds[1]-tileY):0, v1=bounds?Math.min(height,bounds[3]-tileY):height;
      if (u1<=u0||v1<=v0) continue;
      const [f0,g0,f1,g1]=fringe?.bounds??[u0,v0,u1,v1];
      const [t0,s0,t1,s1]=transition?.bounds??[u0,v0,u1,v1];
      const x0=Math.min(u0,f0,t0),y0=Math.min(v0,g0,s0),x1=Math.max(u1,f1,t1),y1=Math.max(v1,g1,s1);
      let left=rasterX+x0, right=rasterX+x1, bottom=rasterY+height-y1, top=rasterY+height-y0;
      if (!exact) {
        const corners=[];
        for (const y of [py-y1,py-y0]) for (const x of [x0-px,x1-px])
          corners.push(project(anchor.map((n,i)=>n+units*(x*axes.right[i]+y*axes.up[i]))));
        if (fixed&&corners.every(c=>c[2]<near)) continue;
        const clipped=corners.some(c=>c[2]<near);
        left=clipped?0:Math.floor(Math.min(...corners.map(c=>c[0])));
        right=clipped?W:Math.ceil(Math.max(...corners.map(c=>c[0])));
        bottom=clipped?0:Math.floor(Math.min(...corners.map(c=>c[1])));
        top=clipped?H:Math.ceil(Math.max(...corners.map(c=>c[1])));
      }
      left=clamp(left,0,W); right=clamp(right,0,W);
      bottom=clamp(bottom,0,H); top=clamp(top,0,H);
      if (left>=right || bottom>=top) continue;
      if (entry) {
        const y0 = artRow(top-1), y1 = artRow(bottom)+1;
        entry.bottom = entry.top === artHeight ? y1 : Math.max(entry.bottom, y1);
        entry.top = Math.min(entry.top, y0);
      }
      function draw() {
        for (let y=bottom;y<top;y++) {
          if (layer && !layer.plan.allows(budgetIndex, artRow(y))) continue;
          for (let x=left;x<right;x++) {
            if(lod&&!spriteLOD.sprite(lod,x,y))continue;
            const ray=rayAt(x+.5,y+.5), facing=-dot(ray.direction,axes.normal);
            if (facing<=1e-7) continue;
            const origin=ray.origin.map((n,i)=>n-anchor[i]), plane=dot(origin,axes.normal)/facing;
            const uAt=exact?x-rasterX+.5:px+(dot(origin,axes.right)+plane*dot(ray.direction,axes.right))/units;
            const vAt=exact?height-1-(y-rasterY)+.5:py-(dot(origin,axes.up)+plane*dot(ray.direction,axes.up))/units;
            const u=Math.floor(uAt), v=Math.floor(vAt);
            const inside=u>=u0&&u<u1&&v>=v0&&v<v1;
            const strands=fringe?.at(u,v);
            if (!inside&&!strands&&!transition) continue;
            const p=y*W+x;
            const body=reprojection ? Atlas.sampleReprojected(reprojection,uAt,vAt,placement,sample) :
              mip?inside&&atlas.cutoutSample(tile,mip,uAt,vAt,placement,sample):
              (inside||transition)&&atlas.sample(tile,u,v,placement,sample,id,transition);
            if (body && (!lod || spriteLOD.alpha(sample.alpha,lod,x,y))) {
              const hit=fragmentAt(ray,fixed?plane:plane+placement.scale*sample.depth/facing);
              if (hit) {
                const {position}=hit;
                let normal;
                if (sample.hasNormal) {
                  if (mode==='card') {
                    const inView=atlas.normalSpace==='view'?sample.normal:local(tile.basis,sample.normal);
                    normal=unit(combine(axes,inView));
                  } else normal=unit(combine(!reprojection&&atlas.normalSpace==='view'?normalAxes:rotation,sample.normal));
                }
                const gain=sun&&normal&&placement.lighting ?
                  sun.ambient+sun.intensity*Math.max(0,dot(normal,sun.direction))*(visibility?.(position,normal)??1) : 1;
                const emission=sample.hasEmission?sample.emission.slice():null;
                const color=sample.color.map((value,c)=>{
                  const glow=emission?.[c]??0;
                  if (atlas.emissionMode==='add') return clamp(value*gain+glow,0,1);
                  return gain===1 ? value : clamp(Math.max(0,value-glow)*gain+glow,0,1);
                });
                results.push({p,...hit,...ids,alpha:lod?1:sample.alpha*opacity,color,normal,emission,protection,swatches:atlas.swatches,
                  objectPosition:local(rotation,position.map((n,i)=>(n-at[i])/placement.scale)), objectScale:placement.scale,
                  ...(objectDither && mode==='card' && { patternPosition:[(uAt-px)*tile.unitsPerPixel,(py-vAt)*tile.unitsPerPixel,0] })});
              }
            }
            const alpha=inside&&effect?.sample(u,v,effectColor);
            if (alpha&&(!lod||spriteLOD.alpha(alpha,lod,x,y))) {
              const hit=fragmentAt(ray,plane+(placement.depth?placement.scale*effect.depth/facing:0));
              if (hit) results.push({p,...hit,...ids,alpha:lod?1:alpha*opacity,color:effectColor.slice(),protection,effect:true});
            }
            if (strands) for (const strand of strands) {
              if (lod&&!spriteLOD.alpha(strand.alpha,lod,x,y)) continue;
              const hit=fragmentAt(ray,plane+(placement.depth?placement.scale*strand.depth/facing:0));
              if (hit) results.push({p,...hit,...ids,alpha:lod?1:strand.alpha*opacity,color:strand.color,protection,effect:true,
                emission:placement.emission&&strand.emission?strand.color.map(n=>n*strand.emission):null});
            }
          }
        }
      }
      if (deferred) deferred.push(draw);
      else draw();
    }
  }
  if (deferred) {
    for (const [name, layer] of layers) {
      layer.plan = SpriteBudget.evaluate(layer.entries, {height: artHeight, budget: layer.budget, time: budgetTime ?? sceneTime});
      budgetFrame?.({layer: name, ...layer.plan.report});
    }
    for (const draw of deferred) draw();
  }
  return results.sort((a,b)=>b.z-a.z);
}
module.exports = { rasterize };
