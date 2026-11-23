/* One part-local projector and timeline, with bindings to native receivers. */
(function (K) {
  const {V}=K, {sceneMeshes:meshes,sceneGraph:hierarchy}=K;
  const format='ink-studio/surface-decals';
  const kinds=['paint','lettering','scuff','relief'], representations=['mesh','sdf','splats'];
  const record=value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const fields=(value,allowed)=>record(value) && Object.keys(value).every(key=>allowed.includes(key));
  const range=(n,lo,hi)=>Number.isFinite(n) && n>=lo && n<=hi;
  const vector=(v,n,test=Number.isFinite)=>Array.isArray(v) && v.length===n && Array.from(v).every(test);
  const label=value=>TargetSelectors.name(value) && value.length<=128;
  const key=({object,part})=>JSON.stringify([object,part??null]);
  const matches=({object,part},row)=>row.object===object && (part===undefined || row.part===part);
  const clamp=value=>Math.max(0,Math.min(1,value));
  const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  function need(value,message) {
    if (!value) throw new TypeError('Surface decals: '+message);
  }
  function target(row) {
    need(record(row) && label(row.object) && (row.part===undefined || label(row.part)),
      'a receiver needs a stable object ID and optional part ID');
    return {object:row.object,...(row.part!==undefined && {part:row.part})};
  }

  function decal(row) {
    need(fields(row,['id','kind','anchor','image','lifetime','grid','opacity','relief']) &&
      label(row.id) && kinds.includes(row.kind??'paint'),'expected a decal ID and a supported kind');
    const {id,kind='paint',anchor:a,image,lifetime={},grid=[12,12],opacity=1,relief}=row;
    need(fields(a,['object','part','node','socket','at','normal','up','size','depth','bias','maxStep']),
      'an anchor needs a part-local projector');
    const {at,normal,up=[0,1,0],size,depth=.12,bias=.002}=a;
    const maxStep=a.maxStep??Math.max(size?.[0]??1,size?.[1]??1)*.25;
    need(vector(at,3,n=>range(n,-1e6,1e6)) && vector(normal,3,n=>range(n,-1e6,1e6)) &&
      vector(up,3,n=>range(n,-1e6,1e6)) && V.len(normal)>1e-7 && V.len(V.cross(normal,up))>1e-7 &&
      vector(size,2,n=>range(n,.001,1000)) && range(depth,.001,100) && range(bias,0,depth) &&
      range(maxStep,.0001,2000),'invalid projector axes, size, depth, bias or maxStep');
    const attachment=a.node===undefined ? null : hierarchy.reference({node:a.node,...(a.socket!==undefined && {socket:a.socket})});
    need(a.socket===undefined || attachment,'a socket needs an anchor node');
    const receiver=target(a), n=V.norm(normal), right=V.norm(V.cross(up,n)), vertical=V.cross(n,right);
    const {width,height,pixels}=image??{};
    const raster=(value,channels)=>Array.isArray(value) && value.length===width*height*channels &&
      Array.from(value).every(n=>Number.isInteger(n) && range(n,0,255));
    need(fields(image,['width','height','pixels']) &&
      [width,height].every(n=>Number.isSafeInteger(n)&&range(n,1,256)) && raster(pixels,4),
      'an image needs top-down RGBA8 pixels up to 256 by 256');
    need(fields(lifetime,['start','end','fadeIn','fadeOut']),'invalid lifetime fields');
    const {start=0,end,fadeIn=0,fadeOut=0}=lifetime;
    need(Number.isFinite(start) && fadeIn>=0 && Number.isFinite(fadeIn) && fadeOut>=0 && Number.isFinite(fadeOut) &&
      (end===undefined ? fadeOut===0 : Number.isFinite(end) && end>start && fadeIn+fadeOut<=end-start),
      'a lifetime needs valid start, optional end and fades in seconds');
    need(vector(grid,2,n=>Number.isInteger(n)&&range(n,1,64)) && range(opacity,0,1),'invalid decal grid or opacity');
    need(kind==='relief' ? fields(relief,['height','heights']) && range(relief.height,0,depth) &&
      (relief.heights===undefined || raster(relief.heights,1)) : relief===undefined,
      'only relief decals accept a height and optional matching grayscale heights');
    return {id,kind,anchor:{...receiver,...attachment,at:at.slice(),normal:n,up:vertical,size:size.slice(),depth,bias,maxStep},
      image:{width,height,pixels:pixels.slice()},lifetime:{start,...(end!==undefined && {end}),fadeIn,fadeOut},
      grid:grid.slice(),opacity,...(relief && {relief:{height:relief.height,...(relief.heights && {heights:relief.heights.slice()})}})};
  }

  function create(input) {
    need(fields(input,['format','version','decals']) && input.format===format && input.version===1 &&
      Array.isArray(input.decals) && input.decals.length<=64,'expected a version 1 decal document with up to 64 decals');
    const decals=Array.from(input.decals,decal);
    need(new Set(decals.map(row=>row.id)).size===decals.length &&
      decals.reduce((n,row)=>n+row.image.width*row.image.height,0)<=2**20 &&
      decals.reduce((n,row)=>n+row.grid[0]*row.grid[1],0)<=32768,
      'decal IDs must be unique and fit the image and projection budgets');
    return K.procedural.data.freeze({format,version:1,decals});
  }

  function bind(world,input,{receivers,graph=world?.sceneGraph}={}) {
    need(world && !world.surfaceDecals && Array.isArray(receivers) && receivers.length<=192,
      'bind needs a world with no existing binding and a receiver list');
    const document=create(input), groups=new Map();
    for (const row of receivers) {
      const id=key(target(row)), kind=row.representation;
      const common=['object','part','representation'];
      need(representations.includes(kind) && fields(row,common.concat('bias',kind==='mesh'?['mesh']:
        kind==='sdf'?['field']:['source'])),'invalid receiver representation or fields');
      need(row.bias===undefined || range(row.bias,0,1),'receiver bias needs a distance between zero and one');
      if (kind==='mesh') {
        meshes.revision(row.mesh);
        need(matches(row,{object:row.mesh.objectId,part:row.mesh.partId}),'mesh IDs must match the decal receiver');
      }
      if (kind==='sdf') need(row.field && ['function','object'].includes(typeof row.field),'an SDF receiver needs a field');
      const source=row.source??world;
      if (kind==='splats') need(source.data instanceof Float32Array,'a splat receiver needs a baked rest source');
      const group=groups.get(id)??{active:kind,sources:new Map()};
      need(!group.sources.has(kind),'duplicate receiver representation');
      group.sources.set(kind,{...row,source});
      groups.set(id,group);
    }

    const entries=document.decals.map(spec=>{
      const a=spec.anchor, group=groups.get(key(a));
      need(group,'no receiver for '+spec.id);
      if (a.node!==undefined) {
        need(graph,'a node anchor needs a scene graph');
        graph.frame({node:a.node,...(a.socket&&{socket:a.socket})});
      }
      return buildEntry(spec,group);
    });

    function use(object,part,representation) {
      const group=groups.get(key(target({object,part})));
      need(group?.sources.has(representation) || group && representation===false,'unknown decal receiver');
      group.active=representation;
    }

    function invalidate(object,part,representation) {
      const receiver=groups.get(key(target({object,part})))?.sources.get(representation);
      need(receiver,'unknown decal receiver');
      receiver.picker=undefined;
      for (const entry of entries) entry.projections.delete(receiver);
    }

    function sample(time,{meshes:showMeshes=true}={}) {
      need(Number.isFinite(time),'sample time must be finite');
      const layers=[], report=[];
      for (const entry of entries) {
        const {spec,group}=entry, {anchor:a,lifetime:l}=spec;
        const alive=time>=l.start && (l.end===undefined || time<l.end);
        const alpha=Number(alive)*spec.opacity*(l.fadeIn ? clamp((time-l.start)/l.fadeIn):1)*
          (l.fadeOut ? clamp((l.end-time)/l.fadeOut):1);
        const source=group.sources.get(group.active);
        const node=a.node===undefined ? undefined : graph.has(a.node) &&
          (a.socket===undefined || graph.node(a.node).sockets.includes(a.socket)) &&
          graph.frame({node:a.node,...(a.socket&&{socket:a.socket})});
        const visible=alpha>0 && source && (showMeshes!==false || group.active!=='mesh') &&
          (a.node===undefined || node?.visible);
        if (visible) {
          project(entry,source,node);
          if (entry.triangles) {
            updateInk(entry,alpha);
            layers.push(entry.atlas);
          }
        }
        report.push({id:spec.id,kind:spec.kind,...target(a),representation:group.active||null,opacity:alpha,
          triangles:visible ? entry.triangles : 0});
      }
      return {layers,report};
    }

    const api=Object.freeze({document,use,invalidate,sample,
      dispose(){if(world.surfaceDecals===api)delete world.surfaceDecals;}});
    world.surfaceDecals=api;
    return api;
  }

  function buildEntry(spec,group) {
    const {anchor:a,image,grid}=spec, right=V.cross(a.up,a.normal);
    const geometry=TexturedSurface.grid({segments:grid,flip:true,point:(u,v)=>
      V.mad(V.mad(a.at,right,(u-.5)*a.size[0]),a.up,(.5-v)*a.size[1])});
    const {width,height}=image;
    const builder=SpriteSurface.make(width,height), region=builder.reserve(width,height);
    builder.meshRegion({...geometry,restPoints:geometry.points},region,{
      id:spec.id,objectId:a.object,partId:a.part,materialId:'decal:'+spec.id
    });
    const atlas=builder.finish();
    atlas.frontOnly=true;
    atlas.surfaceMotionKey='surface-decal:'+JSON.stringify([a.object,a.part,spec.id]);
    const silhouette=spec.relief && (spec.relief.heights ?? image.pixels.filter((_n,i)=>i%4===3));
    function lift(u,v) {
      if (!silhouette) return 0;
      const x=u*(width-1), y=v*(height-1), i=Math.floor(x), j=Math.floor(y);
      const read=(dx,dy)=>silhouette[Math.min(height-1,j+dy)*width+Math.min(width-1,i+dx)];
      const s=x-i,t=y-j;
      return spec.relief.height*((read(0,0)*(1-s)+read(1,0)*s)*(1-t)+(read(0,1)*(1-s)+read(1,1)*s)*t)/255;
    }
    const sites=Array.from({length:geometry.points.length/3},(_,i)=>({
      point:Array.from(geometry.points.subarray(i*3,i*3+3)),
      lift:lift(geometry.uvs[i*2],geometry.uvs[i*2+1])
    }));
    return {spec,group,atlas,geometry,sites,projections:new Map(),triangles:0};
  }

  function updateInk(entry,opacity) {
    const level=Math.round(opacity*64);
    if (entry.level===level) return;
    const {pixels,width,height}=entry.spec.image, rgba=Uint8Array.from(pixels);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const i=(y*width+x)*4+3, threshold=(bayer[y%4*4+x%4]+.5)/16;
      rgba[i]=pixels[i]*level/(255*64)>=threshold ? 255:0;
    }
    SpriteSurface.update(entry.atlas,{x:0,y:0,width,height},{w:width,h:height,rgba});
    entry.level=level;
  }

  function splatPicker(receiver) {
    if (receiver.picker) return receiver.picker;
    const source=receiver.source, tags=TargetSelectors.index(source), rowMask=new Uint8Array(source.count);
    for (let i=0;i<rowMask.length;i++) rowMask[i]=Number(matches(receiver,tags.row(i)));
    const rest={...source,data:source.rest??source.data,anim:undefined};
    return receiver.picker=K.procedural.contributions.create(rest,{rowMask,time:0,sampleWithdrawal:0,cutaway:false});
  }

  function project(entry,receiver,node) {
    const {anchor:a}=entry.spec, kind=receiver.representation;
    const field=kind==='sdf' ? (typeof receiver.field==='function'?receiver.field():receiver.field) : undefined;
    const surface=typeof field?.current==='function' ? field.current() : field;
    let projection=entry.projections.get(receiver);
    if (!projection || projection.surface!==surface) {
      const normal=a.normal, direction=V.mul(normal,-1);
      const adapter=surface ? CurveGrowth.sdfSurface({field:surface,reach:a.depth,minFacing:.25}) : undefined;
      const context=adapter?.context({});
      const meshProject=kind==='mesh' && meshes.projector(receiver.mesh,a,K);
      const picker=kind==='splats' && splatPicker(receiver);
      const rows=entry.sites.map(({point})=>{
        const origin=V.mad(point,normal,a.depth), ray={origin,direction,maxDistance:a.depth*2};
        if (kind==='mesh') {
          const hit=meshProject(point);
          return hit && {p:hit.point,n:hit.normal,hit};
        }
        if (kind==='sdf') return adapter ? adapter.read(adapter.anchor({point,normal}),context) : null;
        const normals=receiver.source.renderMetadata?.normals;
        function outward(i) {
          const vector=normals && normals.subarray(i*3,i*3+3);
          return vector && V.len(vector)>.5 ? V.norm(vector) : normal;
        }
        const hit=picker.ray({...ray,meshes:false,brickMeshes:false,water:false,threshold:.12,
          accept:row=>row.kind==='splat' && row.alpha>=.12 && V.dot(normal,outward(row.index))>.25}).dominant;
        return hit && {p:hit.point,n:outward(hit.index)};
      });
      projection={surface,rows,depth:rows.map(hit=>hit && V.dot(hit.p,normal))};
      entry.projections.set(receiver,projection);
    }
    const revision=kind==='mesh' ? meshes.revision(receiver.mesh) : node?.version;
    if (entry.current===projection && entry.revision===revision) return;
    const points=projection.rows.map((row,i)=>{
      if (!row) return null;
      const posed=row.hit ? meshes.sampleProjection(receiver.mesh,row.hit,K) : row;
      if (!posed) return null;
      const p=V.mad(posed.p,posed.n,a.bias+(receiver.bias??0)+entry.sites[i].lift);
      return node && !row.hit ? hierarchy.point(node,p) : p;
    });
    const {triangles}=entry.geometry, vertices=entry.atlas.vertices;
    let count=0;
    for (let i=0;i<triangles.length;i+=3) {
      const triangle=triangles.subarray(i,i+3);
      const depths=Array.from(triangle,index=>projection.depth[index]);
      const keep=triangle.every(index=>points[index]) && Math.max(...depths)-Math.min(...depths)<=a.maxStep;
      if (keep) count++;
      for (let j=0;j<3;j++) vertices.set(keep ? points[triangle[j]]:[0,0,0],(i+j)*5);
    }
    SpriteSurface.markGeometryDirty(entry.atlas);
    entry.triangles=count;
    entry.current=projection;
    entry.revision=revision;
  }

  K.surfaceDecals=Object.freeze({format,create,bind});
})(KIT);
