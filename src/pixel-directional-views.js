/* Shared registration for editable views of the same sprite pose. */
const PixelDirectionalViews = (() => {
  const tau = Math.PI*2;
  const id = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const records = (value,fields)=>value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key=>fields.includes(key));
  const vector = (value,n)=>Array.isArray(value) && value.length === n &&
    Array.from(value).every(n=>Number.isFinite(n) && Math.abs(n) <= 1e6);
  const heading = yaw=>((yaw%tau)+tau)%tau;
  const bearing = (a,b)=>Math.min(Math.abs(a-b),tau-Math.abs(a-b));

  function prepare(source,frames,swatches) {
    if (source === undefined) return;
    if (!records(source,['version','views','partAnchors','approvedSwatches','viewBlend']) || source.version !== 1 ||
        !Array.isArray(source.views) || !source.views.length || source.views.length > 512 ||
        source.viewBlend !== undefined && !['nearest','depth-reprojected'].includes(source.viewBlend))
      throw new TypeError('Use a version 1 directional set with 1–512 registered views');
    const swatchIds = source.approvedSwatches;
    if (swatchIds !== undefined && (!Array.isArray(swatchIds) || !swatchIds.length ||
        !Array.from(swatchIds).every(key=>swatches.has(key)) || new Set(swatchIds).size !== swatchIds.length))
      throw new RangeError('Approved directional swatches need unique document swatch IDs');
    const partAnchors = source.partAnchors ?? [], anchorIds = new Set();
    if (!Array.isArray(partAnchors) || partAnchors.length > 64) throw new RangeError('Use up to 64 directional part anchors');
    for (const anchor of partAnchors) {
      if (!records(anchor,['id','part','point']) || !id(anchor.id) || !id(anchor.part) ||
          !vector(anchor.point,3) || anchorIds.has(anchor.id))
        throw new TypeError('Part anchors need a unique ID, named part and finite asset-space XYZ');
      anchorIds.add(anchor.id);
    }
    const usedFrames = new Set(), angles = new Map();
    for (const view of source.views) {
      if (!records(view,['frame','pose','yaw','pitch','pivot','unitsPerPixel','anchors','handoff']) ||
          !frames.has(view.frame) || usedFrames.has(view.frame) ||
          !Number.isSafeInteger(view.pose) || view.pose < 0 || view.pose > 32767 ||
          !Number.isFinite(view.yaw) || Math.abs(view.yaw) > 1e6 ||
          !Number.isFinite(view.pitch) || Math.abs(view.pitch) > Math.PI/2 ||
          !vector(view.pivot,2) || !Number.isFinite(view.unitsPerPixel) || view.unitsPerPixel < 1e-6 ||
          view.handoff !== undefined && !['blend','exact'].includes(view.handoff) ||
          view.anchors !== undefined && (!records(view.anchors,[...anchorIds]) ||
            !Object.values(view.anchors).every(point=>vector(point,2))))
        throw new TypeError('Directional views need distinct document frames, registered angles, scale and valid anchors');
      const key = view.pose+'/'+view.pitch, yaw = heading(view.yaw);
      if (!angles.has(key)) angles.set(key,[]);
      if (angles.get(key).some(other=>bearing(yaw,other) < 1e-8))
        throw new RangeError('Directional views repeat a heading in pose '+view.pose+' at pitch '+view.pitch);
      angles.get(key).push(yaw);
      usedFrames.add(view.frame);
    }
    return source;
  }

  function remap(source,map) {
    if (map.scale[0] !== map.scale[1])
      throw new RangeError('Directional view registration needs uniform canvas resampling');
    const point = pair=>pair.map((value,i)=>(value-map.offset[i])/map.scale[i]);
    const views = source.views.map(view=>({ ...view,pivot:point(view.pivot),unitsPerPixel:view.unitsPerPixel*map.scale[0],
      ...(view.anchors && { anchors:Object.fromEntries(Object.entries(view.anchors).map(([id,at])=>[id,point(at)])) })
    }));
    return { ...source,views };
  }

  function adjacent(views) {
    const poses = new Map(), result = [];
    for (const view of views) {
      if (!poses.has(view.pose)) poses.set(view.pose,new Map());
      const rings = poses.get(view.pose);
      if (!rings.has(view.pitch)) rings.set(view.pitch,[]);
      rings.get(view.pitch).push(view);
    }
    const pairs = new Set();
    function add(a,b,axis) {
      const key = [a.frame,b.frame].sort().join('/');
      if (pairs.has(key)) return;
      pairs.add(key);
      result.push({ from:a.frame,to:b.frame,axis,
        radians:Math.acos(Math.max(-1,Math.min(1,Math.sin(a.pitch)*Math.sin(b.pitch)+
          Math.cos(a.pitch)*Math.cos(b.pitch)*Math.cos(a.yaw-b.yaw)))) });
    }
    for (const rings of poses.values()) {
      const ordered = [...rings].sort(([a],[b])=>a-b).map(([,rows])=>rows.sort((a,b)=>heading(a.yaw)-heading(b.yaw)));
      for (const [i,rows] of ordered.entries()) {
        if (rows.length > 1) rows.forEach((view,j)=>add(view,rows[(j+1)%rows.length],'yaw'));
        if (i === 0) continue;
        const lower = ordered[i-1];
        const closest = (view,candidates)=>candidates.reduce((best,next)=>
          bearing(heading(view.yaw),heading(next.yaw)) < bearing(heading(view.yaw),heading(best.yaw)) ? next : best);
        for (const view of rows) add(closest(view,lower),view,'pitch');
        for (const view of lower) add(view,closest(view,rows),'pitch');
      }
    }
    return result;
  }

  return Object.freeze({ prepare,remap,adjacent });
})();
if (typeof module !== 'undefined') module.exports = PixelDirectionalViews;
else globalThis[Symbol.for('ink-studio.pixel-directional-views')] = PixelDirectionalViews;
