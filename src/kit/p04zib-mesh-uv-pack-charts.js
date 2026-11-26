/* Pack retained UV islands at fixed texel density. */
const meshUVPackCharts = (() => {
  const {fields, tuple, integer, name, sorted, grid, ids, protection, bounds} = meshUVRegions;
  const stableEdge = n => Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
  const expand = (box,gutter) => box.map((n,i)=>n + (i < 2 ? -gutter : gutter));
  const envelope = (box,atlas) => box.map((n,i)=>(i<2 ? Math.floor : Math.ceil)(stableEdge(n*atlas[i%2])));
  const offsetBox = (box,offset) => box.map((n,i)=>n+offset[i%2]);

  function grouping(settings, selected) {
    if (!Array.isArray(settings) || settings.length > 128) throw new RangeError('Choose up to 128 UV chart groups');
    const claimed = new Set(), named = new Set();
    const groups = Array.from(settings,row=>{
      if (!fields(row,['id','islands']) || !name(row.id) || named.has(row.id))
        throw new TypeError('UV chart groups need unique names');
      const islands = ids(row.islands,selected,'selected UV islands');
      if (islands.length < 2 || islands.some(id=>claimed.has(id)))
        throw new RangeError('A UV chart group needs at least two selected islands that belong to no other group');
      named.add(row.id);
      islands.forEach(id=>claimed.add(id));
      return {id:islands[0],group:row.id,islands};
    });
    return groups.concat([...selected.keys()].filter(id=>!claimed.has(id)).map(id=>({id,islands:[id]})))
      .sort((a,b)=>a.id < b.id ? -1 : 1);
  }

  function pack(g, islandIds, operation, points, atlasFor, conflict) {
    if (!fields(operation,['op','ids','selection','domain','atlas','pool','gutter','groups','protect']))
      throw new TypeError('Unknown UV chart packing setting');
    const material = g.islands.get(islandIds[0]).material;
    if (islandIds.length > 256 || islandIds.some(id=>g.islands.get(id).material!==material))
      throw new RangeError('Pack up to 256 islands on one material sheet per operation');
    const atlas = grid(operation.atlas ?? atlasFor?.(material)?.size);
    const {pool=[0,0,...atlas],gutter=2,groups=[],protect} = operation;
    if (!integer(gutter,0,32) || !tuple(pool,4,n=>integer(n,0,4096)) || !pool[2] || !pool[3] ||
        pool[0]+pool[2]>atlas[0] || pool[1]+pool[3]>atlas[1])
      throw new RangeError('Chart packing needs a nonempty texel pool inside the atlas and a gutter from 0 to 32');
    const selected = new Map(islandIds.map(id=>[id,g.islands.get(id)]));
    const held = protection(g,protect), work = {remaining:16e6};
    const boxes = new Map(), anchors = new Set();
    for (const [id,row] of selected) {
      boxes.set(id,envelope(row.bounds,atlas));
      if (row.faces.some(face=>g.faces.get(face).corners.some(corner=>held.fixed.has(g.atWeld.get(corner.id)))))
        anchors.add(id);
    }
    const entries = grouping(groups,selected).map(row=>{
      const box = bounds(row.islands.flatMap(id=>[boxes.get(id).slice(0,2),boxes.get(id).slice(2)]));
      return {...row,box,held:row.islands.some(id=>anchors.has(id)),
        dims:[box[2]-box[0]+gutter*2,box[3]-box[1]+gutter*2]};
    });
    const obstacles = [...g.islands.values()].filter(row=>row.material===material && !selected.has(row.id))
      .map(row=>envelope(row.bounds,atlas)).concat(entries.filter(row=>row.held).map(row=>row.box));
    const free = meshUVTexelBudget.freeSpace(pool,obstacles.map(box=>expand(box,gutter)),work);
    const moving = [];
    const degenerate = new Set();
    for (const row of entries) {
      if (row.held) continue;
      const invalid = row.islands.filter(id=>{
        const [l,t,r,b] = selected.get(id).bounds;
        return r-l<=1e-12 || b-t<=1e-12;
      });
      if (invalid.length) {
        degenerate.add(row.id);
        conflict('degenerate-pack-chart',{islands:invalid,...(row.group && {group:row.group})});
      } else moving.push(row);
    }
    const {placed,missed} = meshUVTexelBudget.place(free,moving,work,true);
    const overflow = new Set(missed), charts = [], clusters = [];
    for (const row of entries) {
      const at = placed.get(row.id);
      const reason = overflow.has(row.id) ?
        row.dims.some((n,i)=>n>pool[i+2]) ? 'chart-exceeds-pool' : 'chart-no-free-rectangle' : undefined;
      const status = row.held ? 'held' : at ? 'packed' : degenerate.has(row.id) ? 'degenerate' : 'overflow';
      const delta = at ? at.map((n,i)=>n+gutter-row.box[i]) : row.held ? [0,0] : null;
      if (reason) conflict(reason,{islands:row.islands,required:row.dims,...(row.group && {group:row.group})});
      if (row.group) clusters.push({id:row.group,islands:row.islands,status,source:row.box,
        destination:delta && offsetBox(row.box,delta),translation:delta,required:row.dims,...(reason && {reason})});
      for (const id of row.islands) {
        const {faces} = selected.get(id), source = boxes.get(id);
        charts.push({id,faces,status,source,destination:delta && offsetBox(source,delta),translation:delta,
          required:row.group ? null : row.dims,...(row.group && {group:row.group}),...(reason && {reason})});
        if (at && delta.some(Boolean)) for (const face of faces) for (const corner of g.faces.get(face).corners)
          points.set(corner.id,corner.uv.map((uv,i)=>uv+delta[i]/atlas[i]));
      }
    }
    return {material,atlas,pool,gutter,protection:held.report,charts,groups:clusters,
      unpacked:sorted(charts.filter(row=>row.destination===null).map(row=>row.id)),retainedCuts:[],edgeChanges:[]};
  }

  return Object.freeze({pack});
})();
