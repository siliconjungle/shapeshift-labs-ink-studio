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

  function check(brush) {
    if (!record(brush,['version','grid','projection','cells']) || brush.version !== 1 ||
        !Array.isArray(brush.grid) || brush.grid.length !== 2 ||
        !Array.from(brush.grid).every(n => Number.isSafeInteger(n) && n >= 1 && n <= 512) ||
        !Array.isArray(brush.cells) || !brush.cells.length || brush.cells.length > maxCells)
      throw new TypeError('Grid sculpt brush needs a version 1 stencil of up to 1024 cells');
    const { projection, grid:[w,h], cells } = brush;
    if (!record(projection,['origin','right','down','forward','perspective']) ||
        ![projection.origin,projection.right,projection.down,projection.forward].every(vec) ||
        typeof projection.perspective !== 'boolean')
      throw new TypeError('Grid sculpt brush needs a finite projection frame');
    const { right, down, forward } = projection;
    const lengths = [right,down,forward].map(axis => Math.hypot(...axis));
    if (lengths.some(n=>n<1e-7 || n>1000) ||
        Math.abs(V.dot(V.cross(right,down),forward)) < lengths.reduce((a,b)=>a*b)*.999)
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
    for (const depth of [near,far]) for (const [u,v] of [[-seam,-seam],[1+seam,-seam],[1+seam,1+seam],[-seam,1+seam]])
      corners.push(point(projection,grid,x+u,y+v,depth));
    const center = point(projection,grid,x+.5,y+.5,(near+far)/2);
    const planes = faces.map(indices=>{
      const [a,b,c,d] = indices.map(i=>corners[i]);
      let n = V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
      if (V.dot(n,V.sub(center,a))>0) n = V.mul(n,-1);
      const u = Math.max(V.dist(a,b),V.dist(d,c)), v = Math.max(V.dist(a,d),V.dist(b,c));
      return { a,b,c,d,n,offset:V.dot(n,a),u,v };
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

  function distance(node,x,y,z,best) {
    const lower = outside(node,x,y,z);
    if (lower>0 && lower>=best) return best;
    if (node.planes) {
      let d = -Infinity;
      for (const { n,offset } of node.planes) d = Math.max(d,n[0]*x+n[1]*y+n[2]*z-offset);
      return Math.min(best,lower>0 ? Math.max(lower,d) : d);
    }
    return distance(node.right,x,y,z,distance(node.left,x,y,z,best));
  }

  function prepare(brush) {
    const { grid,projection,cells:points } = check(brush);
    const cells = points.map(cell=>column(projection,grid,cell));
    const root = tree(cells.slice());
    const bounds = { min:root.min,max:root.max };
    const sd = (x,y,z)=>distance(root,x,y,z,Infinity);
    return { bounds,sd,solid(S,mat) {
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

  K.procedural.gridSculptBrush = Object.freeze({ maxCells,check,point,prepare });
})(KIT);
