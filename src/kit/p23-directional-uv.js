/* Select registered tile clips in an authored mesh or module's local frame. */
(function (K) {
  const A = K.authoring, { V, M } = K;
  const compass = Object.freeze(['n','ne','e','se','s','sw','w','nw']);
  const headings = compass.map((direction,index) => ({ direction, yaw:index*Math.PI/4 }));
  const fields = (row, keys) => K.world.data.record(row) && Object.keys(row).every(key => keys.includes(key));
  const keysOfRule = ['version','tileset','atlasSize','faces','directions','clips','default','facing'];
  const name = value => typeof value === 'string' && !!value.trim();
  const key = ({ x,y,width,height }) => JSON.stringify([x,y,width,height]);
  const rect = ({x,y,width,height}) => ({x,y,width,height});

  function definitions(rule, image) {
    const { id, own, record } = K.world.data;
    if (!fields(rule,keysOfRule) || rule.version !== 1 || !A.tilesets.validId(rule.tileset) ||
        !Array.isArray(rule.atlasSize) || rule.atlasSize.length !== 2 ||
        !rule.atlasSize.every(n=>Number.isSafeInteger(n) && n>0) ||
        !Array.isArray(rule.faces) || !rule.faces.length || !Array.from(rule.faces).every(name) ||
        new Set(rule.faces).size !== rule.faces.length || !record(rule.directions) ||
        !record(rule.clips) || !Object.keys(rule.directions).length ||
        Object.keys(rule.directions).some(direction=>!compass.includes(direction)) ||
        !Object.entries(rule.directions).every(([,clip])=>id(clip) && own(rule.clips,clip)) ||
        Object.keys(rule.clips).some(clip=>!Object.values(rule.directions).includes(clip)) ||
        rule.default !== undefined && !own(rule.directions,rule.default) ||
        rule.facing !== undefined && !['direction','position'].includes(rule.facing))
      throw new TypeError('Use a version 1 directional UV rule with named faces, sheet size, and up to eight compass directions bound to clips');
    if (image.width !== rule.atlasSize[0] || image.height !== rule.atlasSize[1])
      throw new RangeError('Directional UV sheet dimensions changed. Review the clip rectangles.');
    const clips = new Map();
    for (const [id, clip] of Object.entries(rule.clips)) {
      if (!fields(clip,['yaw','playback','frames']) ||
          clip.yaw !== undefined && (!Number.isFinite(clip.yaw) || Math.abs(clip.yaw)>1e6) ||
          !Array.isArray(clip.frames) || !clip.frames.length || clip.frames.length>512)
        throw new TypeError('A directional UV clip needs 1–512 timed atlas rectangles and an optional authored yaw');
      const frames = Array.from(clip.frames, (frame,index)=>{
        if (!fields(frame,['rect','time','duration']) || !fields(frame.rect,['x','y','width','height']))
          throw new TypeError('A directional UV frame needs an integer texel rectangle');
        const selection = TilesetSelection.pick(rule.tileset,image,frame.rect);
        return { ...frame, frame:index, rect:rect(selection) };
      });
      clips.set(id,{ id, yaw:clip.yaw, frames, at:SpriteCels.playback(frames,12,clip.playback ?? 'loop') });
    }
    const views = headings.filter(({direction})=>own(rule.directions,direction)).map(({direction,yaw})=>{
      const clip = clips.get(rule.directions[direction]);
      return { direction, yaw:clip.yaw ?? yaw, clip };
    });
    if (views.some((view,index)=>views.slice(index+1).some(other=>
      Math.abs(Math.atan2(Math.sin(view.yaw-other.yaw),Math.cos(view.yaw-other.yaw)))<1e-8)))
      throw new RangeError('Directional UV clips need distinct authored headings');
    return { views, fallback:views.find(view=>view.direction===rule.default) ?? views[0] };
  }

  function prepare(rule, document, materials, tilesets, tileWraps, makeMesh) {
    if (rule === undefined) return;
    const image = tilesets.source(rule?.tileset);
    const { views, fallback } = definitions(rule,image);
    const selected = new Set(rule.faces), faces = document.faces.filter(face=>selected.has(face.id));
    const base = fallback.clip.frames[0].rect, baseKey = key(base);
    const set = MaterialUV.resolve(document.uvBindings,'pigment'), setKey = MaterialUV.key(set);
    function bounds(crop) {
      const { pigmentUV } = A.tilesetFaces.cropSource(image,crop);
      return { lo:pigmentUV[3], hi:pigmentUV[1] };
    }
    const { lo,hi } = bounds(base);
    if (faces.length!==selected.size || faces.some(face=>
      materials.get(face.material)?.texture?.tileset !== rule.tileset || tileWraps?.has(face.id) ||
      face.corners.some(corner=>{
        const uv = MaterialUV.uv(corner,set);
        return !uv || uv.some((n,i)=>n<lo[i]-1e-7 || n>hi[i]+1e-7);
      })))
      throw new RangeError('Directional UV faces must sample their default clip’s first rectangle on the bound tileset');
    const fractions = faces.map(face=>face.corners.map(corner=>MaterialUV.uv(corner,set).map((n,i)=>
      hi[i]===lo[i] ? .5 : Math.max(0,Math.min(1,(n-lo[i])/(hi[i]-lo[i]))))));
    let cachedKey, cachedMesh;
    function sample(heading,time) {
      const view = heading === undefined ? fallback : PixelDirectionalViews.nearest(views,heading);
      const frame = view.clip.frames[view.clip.at(time)], region = key(frame.rect);
      if (region!==baseKey && region!==cachedKey) {
        const { lo,hi } = bounds(frame.rect);
        const polygons = faces.map((face,j)=>({...face,corners:face.corners.map((corner,i)=>{
          const uv = fractions[j][i].map((fraction,axis)=>lo[axis]+fraction*(hi[axis]-lo[axis]));
          return set ? {...corner,attributes:{...corner.attributes,[setKey]:uv}} : {...corner,uv};
        })}));
        cachedMesh = makeMesh(K.meshTopology.edit(document,{faces:polygons}));
        cachedKey = region;
      }
      return {mesh:region===baseKey ? undefined : cachedMesh, direction:view.direction, clip:view.clip.id,
        yaw:view.yaw, frame:frame.frame, rect:frame.rect};
    }
    return { sample, facing:rule.facing ?? 'direction', faces:rule.faces.slice(), tileset:rule.tileset };
  }

  function bind(world, instances, sourceInstances) {
    const targets = new Map(Object.entries(world.topologyMeshes ?? {}).filter(([,row])=>row.directionalUV));
    if (!targets.size) return;
    const authored = A.scenePrefabs.placements(sourceInstances), frames = new Map();
    for (const [id, link] of instances) for (const { object } of link.meshes.values())
      if (targets.has(object)) frames.set(object,{ basis:authored.get(id)?.basis, origin:link.origin, instance:id });
    world.directionalUV = {
      sample(current,camera,time) {
        const replacements = new Map(), rows = [];
        for (const [object, row] of targets) {
          const rule = row.directionalUV, { basis,origin=row.pivot ?? [0,0,0],instance } = frames.get(object) ?? {};
          const sight = rule.facing==='position' ? V.sub(camera.eye,origin) : camera.back;
          const local = basis ? M.app(M.tr(basis),sight) : sight;
          const heading = Math.hypot(local[0],local[2])>1e-8 ? Math.atan2(local[0],local[2]) : undefined;
          const { mesh, ...view } = rule.sample(heading,time);
          const selected = mesh ?? row.mesh, existing = current.topologyMeshes?.[object]?.mesh;
          if (existing && existing!==selected) replacements.set(existing,selected);
          rows.push({object,...(instance && {instance}),tileset:rule.tileset,faces:rule.faces,
            heading:heading ?? null,...view});
        }
        return { rows, world:replacements.size ? {...current,meshes:current.meshes.map(mesh=>replacements.get(mesh) ?? mesh),
          topologyMeshes:Object.fromEntries(Object.entries(current.topologyMeshes).map(([id,row])=>[id,
            replacements.has(row.mesh) ? {...row,mesh:replacements.get(row.mesh)} : row]))} : current };
      }
    };
  }

  function fromAtlas(atlas, request) {
    const { id } = K.world.data;
    if (!fields(request,['tileset','faces','directions','clip','default','facing','pitch']) ||
        !Array.isArray(request.directions) || !request.directions.length ||
        !Array.from(request.directions).every(direction=>compass.includes(direction)) ||
        new Set(request.directions).size!==request.directions.length ||
        request.clip!==undefined && !id(request.clip) || request.pitch!==undefined && !Number.isFinite(request.pitch))
      throw new TypeError('Choose a tileset, target faces, and a list of enabled compass directions');
    const { metadata } = atlas.snapshot(), { width,height } = metadata;
    A.tilesets.dimensions(width,height);
    if (metadata.scenery || metadata.cels || metadata.bump)
      throw new TypeError('Use a baked directional atlas from the pixel direction export');
    const source = request.clip && metadata.clips?.find(clip=>clip.id===request.clip);
    if (request.clip && !source) throw new RangeError('Unknown source atlas clip '+request.clip);
    const members = source && new Set(source.frames);
    const frames = metadata.frames.filter(row=>!members || members.has(row.frame ?? 0));
    const poses = [...new Set(frames.map(row=>row.frame ?? 0))].sort((a,b)=>a-b);
    const elevation = row=>row.pitch ?? metadata.pitch ?? 0;
    const rings = [...new Set(frames.map(elevation))].sort((a,b)=>Math.abs(a)-Math.abs(b) || a-b);
    const pitch = request.pitch ?? rings[0], ring = frames.filter(row=>Math.abs(elevation(row)-pitch)<1e-8);
    const clips = {}, directions = {};
    for (const direction of request.directions) {
      const candidates = ring.filter(row=>(row.frame ?? 0)===poses[0] &&
        PixelDirectionalViews.nearest(headings,row.yaw ?? 0).direction===direction);
      const nominal = headings.find(row=>row.direction===direction).yaw;
      const angle = PixelDirectionalViews.nearest(candidates.map(row=>({yaw:row.yaw ?? 0})),nominal)?.yaw;
      if (angle===undefined) throw new RangeError('No authored atlas view for direction '+direction);
      const rows = poses.map(pose=>{
        const matching = ring.filter(row=>(row.frame ?? 0)===pose &&
          Math.abs(Math.atan2(Math.sin((row.yaw ?? 0)-angle),Math.cos((row.yaw ?? 0)-angle)))<1e-8);
        if (matching.length!==1) throw new RangeError('Expected one authored '+direction+' view in atlas pose '+pose);
        const {rect,time,duration=1/(metadata.fps ?? 12)} = matching[0];
        return {rect,...(time!==undefined && {time}),duration};
      });
      const clip = (source?.id ?? 'view')+'-'+direction;
      directions[direction] = clip;
      clips[clip] = { yaw:angle, playback:source?.playback ?? 'loop', frames:rows };
    }
    const { tileset, faces, facing } = request;
    const rule = { version:1,tileset,atlasSize:[width,height],faces,directions,clips,
      default:request.default ?? request.directions[0],...(facing!==undefined && {facing}) };
    definitions(rule,{width,height});
    return rule;
  }

  A.directionalUV = Object.freeze({ compass, prepare, bind, fromAtlas });
})(KIT);
