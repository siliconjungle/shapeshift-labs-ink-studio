/* Incremental dual-contour meshes for copy-on-write signed bricks. */
(function(K){
  const P=K.procedural, {V}=K, {freeze}=P.data;
  const controls=new WeakMap();
  const axes=[0,1,2], name=id=>typeof id==='string' && id.trim().length>0;
  const vector=(p,test)=>Array.isArray(p)&&p.length===3&&Array.from(p).every(test);
  const bounded=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const same=(a,b)=>a.length===b.length && a.every((value,i)=>value===b[i]);

  function create({bricks:initial,bounds,objectId,materials,materialAt,normal,refine=3,protection,derived,
    maxBricks=512,maxCells=1600000,maxTriangles=400000}={}) {
    if (!P.sparseBricks.isSnapshot(initial) || !name(objectId) ||
        !vector(bounds?.min,Number.isFinite) || !vector(bounds?.max,Number.isFinite) ||
        bounds.min.some((n,i)=>n>=bounds.max[i]) ||
        materialAt!==undefined&&typeof materialAt!=='function' || normal!==undefined&&typeof normal!=='function' ||
        !bounded(refine,0,8) || !bounded(maxBricks,1,1024) || !bounded(maxCells,1,4000000) ||
        !bounded(maxTriangles,1,500000))
      throw new TypeError('Brick meshes need a sparse snapshot, bounded XYZ domain, object ID and valid budgets');
    if (!Array.isArray(materials) || !bounded(materials.length,1,64))
      throw new TypeError('Brick meshes need one to 64 labeled opaque materials');
    const colors=Array.from(materials,row=>{
      if (!name(row?.id)||!bounded(row.color,0,0xffffff))
        throw new TypeError('Each brick material needs an ID and RGB24 color');
      return Object.freeze({id:row.id,color:row.color});
    });
    const materialSlots=new Map(colors.map((row,i)=>[row.id,i]));
    if (materialSlots.size!==colors.length) throw new RangeError('Brick mesh material IDs must be distinct');
    const assetsAPI=P.sdfDerivedAssets, assetOptions=assetsAPI.settings(derived);
    const guards=freeze(P.data.clone(P.sdfProtection.check(protection)));
    const {cell,brickSize}=initial;
    const snap=n=>{
      const q=n/cell, near=Math.round(q);
      return Math.abs(q-near)<=Number.EPSILON*4*Math.max(1,Math.abs(q)) ? near : q;
    };
    const grid={min:bounds.min.map(n=>Math.floor(snap(n))),max:bounds.max.map(n=>Math.ceil(snap(n)))};
    if (![...grid.min,...grid.max].every(n=>bounded(n,-(2**38),2**38)))
      throw new RangeError('Brick mesh bounds exceed the lattice coordinate limit');
    const toWorld=box=>({min:box.min.map(n=>n*cell),max:box.max.map(n=>n*cell)});
    const extent=freeze(toWorld(grid));
    if (guards.some(({bounds})=>axes.some(i=>bounds.min[i]<extent.min[i] || bounds.max[i]>extent.max[i])))
      throw new RangeError('Protected feature bounds must lie inside the brick mesh domain');
    const first=grid.min.map(n=>Math.floor(n/brickSize)), end=grid.max.map(n=>Math.ceil(n/brickSize));
    if (end.reduce((n,v,i)=>n*(v-first[i]),1)>maxBricks)
      throw new RangeError('Brick mesh domain exceeds its brick budget');
    const specs=[], byKey=new Map();
    let cellBudget=0;
    for (let z=first[2];z<end[2];z++) for (let y=first[1];y<end[1];y++) for (let x=first[0];x<end[0];x++) {
      const coordinate=[x,y,z], key=coordinate.join('/');
      const owned={min:coordinate.map((n,i)=>Math.max(n*brickSize,grid.min[i])),
        max:coordinate.map((n,i)=>Math.min((n+1)*brickSize,grid.max[i]))};
      const lattice={min:owned.min.map((n,i)=>Math.max(grid.min[i],n-2)),
        max:owned.max.map((n,i)=>Math.min(grid.max[i],n+2))};
      cellBudget+=lattice.max.reduce((n,v,i)=>n*(v-lattice.min[i]),1);
      if (cellBudget>maxCells) throw new RangeError('Brick mesh domain exceeds its padded lattice cell budget');
      const spec={key,bounds:freeze(toWorld(owned)),lattice,owned,
        ownSamples:{min:owned.min,max:owned.max.map(n=>n-1)}};
      specs.push(spec);
      byKey.set(key,spec);
    }

    function dependencies(dirty) {
      const geometry=new Set(), material=new Set(), local=new Set();
      for (const edit of dirty) {
        // Material taps round to samples at most .45 cells from an owned crossing.
        const offset=edit.channel==='offset', padding=offset ? 2 : 0;
        const affected=offset ? geometry : material, {min,max}=edit.lattice;
        const from=first.map((n,i)=>Math.max(n,Math.ceil((min[i]-padding)/brickSize)-1));
        const to=end.map((n,i)=>Math.min(n-1,Math.floor((max[i]+padding)/brickSize)));
        for (let z=from[2];z<=to[2];z++) for (let y=from[1];y<=to[1];y++) for (let x=from[0];x<=to[0];x++) {
          const spec=byKey.get([x,y,z].join('/'));
          if (edit.touches(offset ? spec.lattice : spec.owned)) affected.add(spec.key);
          if (edit.key===spec.key && edit.touches(spec.ownSamples)) local.add(spec.key);
        }
      }
      return {geometry,material,local};
    }

    function slot(bricks,point,normal) {
      const material=bricks.attributes(...point).material ??
        bricks.attributes(...V.mad(point,normal,cell*.45)).material ??
        materialAt?.(...point) ?? colors[0].id;
      const index=materialSlots.get(material);
      if (index===undefined) throw new RangeError('Unknown brick mesh material: '+material);
      return index;
    }

    function compile(bricks,spec,previous) {
      const surface=P.geometry.dualContour(bricks.distance,undefined,{
        cell,latticeBounds:spec.lattice,ownedEdges:spec.owned,normal,refine
      });
      const positions=[], indices=[], materials=[], byVertex=new Map();
      const sites=new Float64Array(surface.crossings.length*6), faceCounts=new Uint8Array(surface.crossings.length);
      for (const [i,hit] of surface.crossings.entries()) {
        const material=slot(bricks,hit.p,hit.n);
        sites.set(hit.p,i*6);
        sites.set(hit.n,i*6+3);
        for (let triangle=i*2;triangle<i*2+2;triangle++) {
          const points=surface.triangles[triangle].map(j=>surface.points[j].map(Math.fround));
          const area=V.len(V.cross(V.sub(points[1],points[0]),V.sub(points[2],points[0])));
          if (area<=cell*cell*1e-10) continue;
          for (const point of points) {
            const key=point.join('/');
            if (!byVertex.has(key)) {
              byVertex.set(key,positions.length/3);
              positions.push(...point);
            }
            indices.push(byVertex.get(key));
          }
          materials.push(material);
          faceCounts[i]++;
        }
      }
      return {geometry:publish(bricks,spec,positions,indices,materials,previous),sites:{points:sites,faceCounts},work:surface.work};
    }

    function recolor(bricks,spec,previous,{points,faceCounts}) {
      const materials=[];
      for (let i=0;i<faceCounts.length;i++) {
        const offset=i*6;
        const material=slot(bricks,points.subarray(offset,offset+3),points.subarray(offset+3,offset+6));
        for (let count=0;count<faceCounts[i];count++) materials.push(material);
      }
      return publish(bricks,spec,previous.positions,previous.indices,materials,previous);
    }

    function publish(bricks,spec,positions,indices,materials,previous) {
      const sameShape=previous && (positions===previous.positions || same(positions,previous.positions)) &&
        (indices===previous.indices || same(indices,previous.indices));
      if (sameShape && (!assetOptions.bakePaint || !materials.length) && same(materials,previous.faceMaterials))
        return previous;
      const source=Object.freeze({objectId,key:spec.key,revision:(current?.revision??0)+1,bounds:spec.bounds,bricks,
        positions:Object.freeze(positions),indices:Object.freeze(indices),faceMaterials:Object.freeze(materials),
        materials:Object.freeze(colors)});
      const paint=materials.length && assetsAPI.paint(assetOptions.bakePaint,source,colors);
      const mesh=paint ? K.sceneMeshes.create({id:JSON.stringify([objectId,spec.key]),objectId,positions,indices,
        uvs:paint.uvs,materials:paint.materials,faceMaterials:materials}) : null;
      const depthProxy=mesh && assetOptions.depthProxy && (sameShape ? previous.depthProxy :
        K.sceneMeshes.depthProxy({id:JSON.stringify([objectId,spec.key,'depth']),objectId,positions,indices}));
      if (mesh) {
        const layer=K.sceneMeshes.layer(mesh);
        layer.brickField=objectId;
        layer.surfaceMotionKey=JSON.stringify([mesh.id,(current?.revision??0)+1]);
      }
      return Object.freeze({key:spec.key,bounds:spec.bounds,positions:Object.freeze(positions),
        indices:Object.freeze(indices),faceMaterials:Object.freeze(materials),triangles:materials.length,mesh,
        ...(depthProxy && {depthProxy}),
        ...(mesh && assetOptions.maxSplats && {splats:assetsAPI.splats(mesh,positions,indices,assetOptions.maxSplats)})});
    }

    let current, currentSites, currentShape, updating=false;
    function update(bricks) {
      if (updating) throw new Error('Cannot update a brick field while deriving its assets');
      updating=true;
      try { return rebuild(bricks); }
      finally { updating=false; }
    }

    function rebuild(bricks) {
      if (!P.sparseBricks.sharesBase(initial,bricks))
        throw new TypeError('Brick meshes need a snapshot from their original sparse field');
      if (current?.bricks===bricks) return current;
      const dirty=current ? bricks.sampleChangesFrom(current.bricks,{channels:['offset','material']}) : [];
      const affected=current && dependencies(dirty);
      const rebuilt=[], recolored=[], seamNeighbors=[], changed=[], reused=[], sites=[];
      let triangles=0,cells=0,samples=0,splats=0;
      const chunks=specs.map((spec,i)=>{
        const previous=current?.chunks[i];
        let geometry=previous, saved=currentSites?.[i];
        if (!affected || affected.geometry.has(spec.key)) {
          const built=compile(bricks,spec,previous);
          geometry=built.geometry;
          saved=built.sites;
          cells+=built.work.cells;
          samples+=built.work.samples;
          rebuilt.push(spec.key);
          if (affected && !affected.local.has(spec.key)) seamNeighbors.push(spec.key);
        } else if (affected.material.has(spec.key)) {
          geometry=recolor(bricks,spec,previous,saved);
          recolored.push(spec.key);
          if (!affected.local.has(spec.key)) seamNeighbors.push(spec.key);
        }
        sites.push(saved);
        (geometry===previous ? reused : changed).push(spec.key);
        triangles+=geometry.triangles;
        if (triangles>maxTriangles) throw new RangeError('Brick mesh triangles exceed the scene budget');
        splats+=geometry.splats?.count ?? 0;
        if (splats>assetOptions.maxSplats) throw new RangeError('SDF splat patches exceed the field budget');
        return geometry;
      });
      const checked=guards.length && P.sdfProtection.verify(guards,chunks,bricks,current,
        current && dirty.map(edit=>P.spatial.expand(edit.bounds,cell)));
      const trace=Object.freeze({objectId,bounds:extent,distance:bricks.distance,maxStep:cell*.85,
        material(point,n){return colors[slot(bricks,point,n)];}});
      const {assets,shape}=assetsAPI.assemble(chunks,trace,assetOptions,affected && !affected.geometry.size ? currentShape : undefined);
      current=Object.freeze({assets,revision:(current?.revision??0)+1,bricks,bounds:extent,objectId,chunks:Object.freeze(chunks),trace,
        materials:Object.freeze(colors.map(row=>row.id)),
        work:freeze({dirty:dirty.map(({key,channel,samples,bounds})=>({key,channel,samples,bounds})),
          rebuilt,recolored,seamNeighbors,changed,reused,cells,samples,triangles,...(checked && {checkedFeatures:checked})})});
      currentSites=sites;
      currentShape=shape;
      return current;
    }

    function edit(brush) {
      if (brush?.material!=null && !materialSlots.has(brush.material))
        throw new RangeError('Unknown brick mesh material: '+brush.material);
      return update(current.bricks.edit(brush));
    }
    const controller=Object.freeze({current:()=>current,update,edit});
    update(initial);
    controls.set(controller,objectId);
    return controller;
  }

  function frame(world,enabled) {
    if (enabled===false||world.brickMeshes===undefined) return [];
    const list=world.brickMeshes;
    if (!Array.isArray(list)||list.length>8)
      throw new TypeError('A scene supports up to eight live brick mesh fields');
    const ids=new Set();
    let bricks=0, triangles=0;
    return Array.from(list,row=>{
      const id=controls.get(row);
      if (!id||ids.has(id)) throw new TypeError('Scene brick meshes need valid fields with unique object IDs');
      ids.add(id);
      const snapshot=row.current();
      bricks+=snapshot.chunks.length;
      triangles+=snapshot.work.triangles;
      if (bricks>1024||triangles>500000) throw new RangeError('Scene brick meshes exceed the brick or triangle budget');
      return snapshot;
    });
  }

  function layers(snapshots) {
    return snapshots.flatMap(row=>row.assets.paintBakes);
  }

  function splatWorld(snapshot,options) {
    return P.sdfDerivedAssets.splatWorld(snapshot,options);
  }

  function clearance(snapshots,solids=[]) {
    return P.clearance.field([...solids,...snapshots.map(row=>row.assets.collision)]);
  }

  P.brickMeshes=Object.freeze({create,frame,layers,splatWorld,clearance});
})(KIT);
