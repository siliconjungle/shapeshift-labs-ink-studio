/* A retained native-pixel stencil. Each accepted depth interval caps one pixel's projection. */
(function(K) {
  const V = K.V;
  const maxCells = 1024;
  const vec = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
  const faces = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  const seam = 1e-4;
  const modes = ['carve','through-cut','raise','fill','smooth'];
  const profiles = ['flat','round','taper'];
  const faceOffsets = [[-seam,-seam],[1+seam,-seam],[1+seam,1+seam],[-seam,1+seam]];
  const allowed = (value,keys) => value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).every(key=>keys.includes(key));
  const finite = (n,min,max) => Number.isFinite(n) && n>=min && n<=max;

  function settings(raw,mode) {
    if (!allowed(raw,['depth','direction','profile','falloff','radius','surface','preserveFeatures','minWall']) || !modes.includes(mode) ||
        !finite(raw.depth,.005,20))
      throw new TypeError('SDF shape operations need a supported mode and depth from .005 to 20');
    const { depth,direction='view',profile='flat',falloff={pixels:0},radius,surface,preserveFeatures,minWall } = raw;
    if (!['view','normal'].includes(direction) && (!vec(direction) || V.len(direction)<1e-8))
      throw new TypeError('SDF brush direction needs view, normal, or a nonzero outward XYZ axis');
    if (!profiles.includes(profile) && !(Array.isArray(profile) && profile.length>=2 && profile.length<=16 &&
        Array.from(profile).every(k=>Array.isArray(k) && k.length===2 && Array.from(k).every(n=>finite(n,0,1))) &&
        profile[0][0]===0 && profile.at(-1)[0]===1 && profile.every((key,i)=>i===0 || key[0]>profile[i-1][0])))
      throw new RangeError('Brush profile needs flat, round, taper, or 2–16 ordered [position,depth] keys from 0 to 1');
    if (!allowed(falloff,['pixels','curve']) || !finite(falloff.pixels,0,64) ||
        !['linear','smoothstep'].includes(falloff.curve ?? 'smoothstep'))
      throw new RangeError('Brush falloff needs a width from 0 to 64 pixels and linear or smoothstep');
    if (radius!==undefined && (mode!=='smooth' || !Number.isSafeInteger(radius) || !finite(radius,1,8)))
      throw new RangeError('Smoothing radius needs 1–8 pixels');
    if (preserveFeatures!==undefined && (mode!=='smooth' || typeof preserveFeatures!=='boolean'))
      throw new TypeError('preserveFeatures is a boolean on smooth brushes');
    if (minWall!==undefined && (!['carve','smooth'].includes(mode) || !finite(minWall,0,20)))
      throw new RangeError('Minimum wall thickness on carve and smooth brushes must be from 0 to 20');
    K.procedural.sdfBrushSurfaces.check(surface);
    return { ...(surface!==undefined && {surface}),...(preserveFeatures!==undefined && {preserveFeatures}),
      ...(minWall!==undefined && {minWall}),depth,direction:Array.isArray(direction) ? V.norm(direction) : direction,profile,
      falloff:{pixels:falloff.pixels,curve:falloff.curve ?? 'smoothstep'},...(mode==='smooth' && {radius:radius ?? 1}) };
  }

  function checkGrid(grid) {
    return Array.isArray(grid) && grid.length===2 && Array.from(grid).every(n=>Number.isSafeInteger(n) && finite(n,1,512));
  }

  function validProjection(projection) {
    return record(projection,['origin','right','down','forward','perspective']) &&
      [projection.origin,projection.right,projection.down,projection.forward].every(vec) &&
      typeof projection.perspective==='boolean';
  }

  function checkAttachment(attachment,grid,mode) {
    if (attachment===undefined) return;
    const { source,time,projection,frame,marks } = attachment ?? {};
    const named = value=>typeof value==='string' && value.trim().length>0 && value.length<=256;
    if (!record(attachment,['source','time','projection','frame','marks']) ||
        !record(source,['object','part']) || !named(source.object) || !(source.part===null || named(source.part)) ||
        !finite(time,0,120) || !validProjection(projection) ||
        !Array.isArray(frame) || frame.length!==12 || !Array.from(frame).every(n=>finite(n,-1e6,1e6)) ||
        Math.abs(V.dot(V.cross(frame.slice(0,3),frame.slice(3,6)),frame.slice(6,9)))<1e-8 ||
        !Array.isArray(marks) || !marks.length || marks.length>maxCells)
      throw new TypeError('Invalid grid brush attachment frame or source');
    const used = new Set(), [w] = grid;
    for (const mark of marks) {
      if (!record(mark,['at','sourceAt','depth','position','normal',...(mode==='smooth' ? ['smoothOffsets',...(mark?.smoothBlocks!==undefined ? ['smoothBlocks'] : [])] : [])]) ||
          !Array.isArray(mark.at) || mark.at.length!==2 ||
          !Array.from(mark.at).every(n=>Number.isSafeInteger(n) && finite(n,0,1e6)) ||
          !Array.isArray(mark.sourceAt) || mark.sourceAt.length!==2 ||
          !Array.from(mark.sourceAt).every((n,i)=>Number.isSafeInteger(n) && n>=0 && n<grid[i]) ||
          !finite(mark.depth,1e-4,2000) || !vec(mark.position) || !vec(mark.normal) || !finite(V.len(mark.normal),.99,1.01) ||
          mode==='smooth' && (!Array.isArray(mark.smoothOffsets) || mark.smoothOffsets.length!==8 ||
            !Array.from(mark.smoothOffsets).every(p=>p===null || vec(p))) ||
          mark.smoothBlocks!==undefined && (!Array.isArray(mark.smoothBlocks) || mark.smoothBlocks.length!==8 ||
            !Array.from(mark.smoothBlocks).every(code=>[null,'smooth-open-boundary','smooth-hard-corner','smooth-material-seam'].includes(code))))
        throw new RangeError('Invalid grid brush attachment mark');
      const key = mark.sourceAt[1]*w+mark.sourceAt[0];
      if (used.has(key)) throw new RangeError('Repeated grid brush attachment mark');
      used.add(key);
    }
    return used;
  }

  function checkColumns(brush,mode) {
    if (!allowed(brush,['version','grid','settings','columns','attachment']) || !checkGrid(brush.grid) ||
        !Array.isArray(brush.columns) || !brush.columns.length || brush.columns.length>maxCells)
      throw new TypeError('Grid shape operation needs a version 2 stencil of up to 1024 columns');
    settings(brush.settings,mode);
    const attached = checkAttachment(brush.attachment,brush.grid,mode);
    const change = mode==='carve' || mode==='through-cut' ? 'cut' : 'add';
    const [w,h] = brush.grid, used = new Set();
    for (const row of brush.columns) {
      if (!record(row,['at','corners','change']) || !Array.isArray(row.at) || row.at.length!==2 ||
          !Array.from(row.at).every((x,i)=>Number.isSafeInteger(x) && x>=0 && x<[w,h][i]) ||
          !Array.isArray(row.corners) || row.corners.length!==8 || !Array.from(row.corners).every(vec) ||
          !(mode==='smooth' ? ['add','cut'].includes(row.change) : row.change===change))
        throw new TypeError('A shape operation column needs a native pixel, eight rest-space corners, and a supported change');
      const key = row.at[1]*w+row.at[0];
      if (used.has(key) || attached && !attached.has(key)) throw new RangeError('Repeated or unanchored shape operation pixel');
      used.add(key);
      columnFromCorners(row.corners,true);
    }
    return brush;
  }

  function check(brush, mode) {
    if (brush?.version===3) {
      const freeform=K.procedural.freeformSculpt;
      if (!record(brush,['version','grid','settings','attachment','stamps']) || !checkGrid(brush.grid) ||
          !brush.attachment || brush.attachment.marks?.length>32)
        throw new TypeError('A version 3 freeform brush needs a native grid, attachment and resolved stamps');
      const {strength,depth}=freeform.settings(mode,brush.settings);
      checkAttachment(brush.attachment,brush.grid,mode);
      freeform.prepare({ mode,strength,depth,stamps:brush.stamps });
      return brush;
    }
    if (brush?.version===2) return checkColumns(brush,mode);
    if (mode!==undefined && !['add','cut'].includes(mode)) throw new TypeError('Shape operations need a version 2 stencil');
    if (!record(brush,['version','grid','projection','cells']) || brush.version !== 1 || !checkGrid(brush.grid) ||
        !Array.isArray(brush.cells) || !brush.cells.length || brush.cells.length > maxCells)
      throw new TypeError('Grid sculpt brush needs a version 1 stencil of up to 1024 cells');
    const { projection, grid:[w,h], cells } = brush;
    if (!validProjection(projection))
      throw new TypeError('Grid sculpt brush needs a finite projection frame');
    const { right, down, forward } = projection;
    const lengths = [right,down,forward].map(axis => Math.hypot(...axis));
    if (lengths.some(n=>n<1e-7 || n>1000) ||
        Math.abs(V.dot(V.cross(right,down),forward)) < lengths.reduce((a,b)=>a*b)*1e-4)
      throw new RangeError('Grid sculpt brush projection needs independent camera axes');
    const seen = new Set();
    for (const cell of cells) {
      if (!Array.isArray(cell) || cell.length !== 4) throw new TypeError('Grid sculpt cell needs [x,y,near,far]');
      const [x,y,near,far] = cell, pixel = y*w+x;
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x<0 || y<0 || x>=w || y>=h || seen.has(pixel) ||
          !Number.isFinite(near) || !Number.isFinite(far) || near<1e-4 || far-near<1e-5 || far>2000 || far-near>24)
        throw new RangeError('Invalid, repeated, or overlong grid sculpt cell');
      seen.add(pixel);
    }
    return brush;
  }

  function point({ origin,right,down,forward,perspective }, [w,h], x,y,depth) {
    const scale = perspective ? depth : 1;
    return V.mad(V.mad(V.mad(origin,forward,depth),right,(x-w/2)*scale),down,(y-h/2)*scale);
  }

  function boundsOf(points) {
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (const p of points) for (let i=0;i<3;i++) {
      min[i] = Math.min(min[i],p[i]);
      max[i] = Math.max(max[i],p[i]);
    }
    return { min,max };
  }

  function column(projection,grid,[x,y,near,far]) {
    const corners = [];
    // Tiny overlaps at shared edges keep internal cell boundaries out of the zero set.
    for (const depth of [near,far]) for (const [u,v] of faceOffsets)
      corners.push(point(projection,grid,x+u,y+v,depth));
    return columnFromCorners(corners);
  }

  function columnFromCorners(corners, validate=false) {
    const center = corners.reduce((sum,p)=>V.mad(sum,p,1/8),[0,0,0]);
    const planes = faces.map((indices,index)=>{
      const [a,b,c,d] = indices.map(i=>corners[i]);
      const cross = V.cross(V.sub(b,a),V.sub(c,a));
      let n = V.norm(cross);
      if (V.dot(n,V.sub(center,a))>0) n = V.mul(n,-1);
      const u = Math.max(V.dist(a,b),V.dist(d,c)), v = Math.max(V.dist(a,d),V.dist(b,c));
      if (validate && (V.len(cross)<1e-14 || V.dot(n,V.sub(center,a))>=-1e-8 ||
          Math.abs(V.dot(n,V.sub(d,a)))>1e-7 || corners.some(p=>V.dot(n,V.sub(p,a))>1e-7)))
        throw new RangeError('Shape operation column must be finite, convex, and have planar faces');
      return { index,a,b,c,d,n,offset:V.dot(n,a),u,v };
    });
    return { ...boundsOf(corners),center,planes };
  }

  function tree(cells) {
    if (cells.length === 1) return cells[0];
    const box = boundsOf(cells.flatMap(cell=>[cell.min,cell.max]));
    const extent = V.sub(box.max,box.min);
    const axis = extent.indexOf(Math.max(...extent));
    cells.sort((a,b)=>a.center[axis]-b.center[axis]);
    const half = Math.floor(cells.length/2);
    return { ...box,left:tree(cells.slice(0,half)),right:tree(cells.slice(half)) };
  }

  function outside(node,x,y,z) {
    const { min,max } = node;
    const a = Math.max(min[0]-x,0,x-max[0]), b = Math.max(min[1]-y,0,y-max[1]), c = Math.max(min[2]-z,0,z-max[2]);
    return Math.sqrt(a*a+b*b+c*c);
  }

  function distance(node,x,y,z,best,contact) {
    const lower = outside(node,x,y,z);
    if (lower>0 && lower>=best) return best;
    if (node.planes) {
      let d = -Infinity, plane;
      for (const face of node.planes) {
        const { n,offset }=face, value=n[0]*x+n[1]*y+n[2]*z-offset;
        if (value>d) { d=value; plane=face; }
      }
      const result=lower>0 ? Math.max(lower,d) : d;
      if (contact && result<best) Object.assign(contact,{plane,at:node.at});
      return Math.min(best,result);
    }
    return distance(node.right,x,y,z,distance(node.left,x,y,z,best,contact),contact);
  }

  function prepare(brush, mode, change) {
    const retained = check(brush,mode);
    const cells = retained.version===1 ? retained.cells.map(cell=>column(retained.projection,retained.grid,cell)) :
      retained.columns.filter(row=>!change || change===row.change).map(row=>({ ...columnFromCorners(row.corners),at:row.at }));
    if (!cells.length) return null;
    const root = tree(cells.slice());
    const bounds = { min:root.min,max:root.max };
    const sd = (x,y,z)=>distance(root,x,y,z,Infinity);
    return { bounds,sd,site([x,y,z]) {
      const contact={};
      distance(root,x,y,z,Infinity,contact);
      return contact;
    },solid(S,mat) {
      return S.add({ bc:V.mul(V.add(root.min,root.max),.5),br:V.dist(root.min,root.max)/2,geometryBounds:bounds,sd,
        sample(visit) {
          let samples = 0;
          for (const cell of cells) for (const {a,b,c,d,n,u,v} of cell.planes) {
            const nx = Math.ceil(u/this.res), ny = Math.ceil(v/this.res);
            samples += nx*ny;
            if (samples>1500000) throw new RangeError('Grid sculpt brush exceeds its surface sampling budget');
            for (let y=0;y<ny;y++) {
              const left = V.lerp(a,d,(y+.5)/ny), right = V.lerp(b,c,(y+.5)/ny);
              for (let x=0;x<nx;x++) {
                const p = V.lerp(left,right,(x+.5)/nx);
                if (sd(...V.mad(p,n,Math.min(this.res*.01,Math.min(u,v)*.01)))>=0) visit(...p);
              }
            }
          }
        }
      },mat,{hold:true});
    } };
  }

  K.procedural.gridSculptBrush = Object.freeze({ maxCells,modes:Object.freeze(modes),check,point,prepare,settings });
})(KIT);
