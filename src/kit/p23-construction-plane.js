/* Shared scene coordinates for placement, transform pivots and alignment. */
(function (K) {
  const A = K.authoring, { V } = K, { freeze } = K.procedural.data;
  const fields = ['origin','right','up','grid'];
  const vector = (value,size) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);

  function resolve(raw = {}) {
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key=>!fields.includes(key)))
      throw new TypeError('A construction plane needs origin, right, up, and grid');
    const {origin=[0,0,0],right=[1,0,0],up=[0,1,0],grid=1} = raw;
    if (![origin,right,up].every(value=>vector(value,3)))
      throw new TypeError('A construction plane needs finite XYZ vectors');
    if (!Number.isFinite(grid) || grid<=0) throw new RangeError('Construction plane grid must be positive');
    const r = Math.hypot(...right), u = Math.hypot(...up);
    if (!r || !u || !Number.isFinite(r) || !Number.isFinite(u))
      throw new RangeError('Construction plane axes need nonzero directions');
    const x = right.map(value=>value/r), guide = up.map(value=>value/u);
    if (Math.abs(V.dot(x,guide)) > 1e-10) throw new RangeError('Construction plane right and up must be perpendicular');
    const z = V.norm(V.cross(x,guide)), y = V.cross(z,x);
    const axes = [x,y,z].map(axis=>axis.map(value=>value || 0));
    return freeze({plane:{origin:origin.slice(),right:right.slice(),up:up.slice(),grid},axes});
  }

  function point(frame, at) {
    if (!vector(at,2)) throw new TypeError('Construction plane grid coordinates need a finite [u, v] pair');
    const {plane:{origin,grid},axes:[right,up]} = frame;
    const result = V.mad(V.mad(origin,right,at[0]*grid),up,at[1]*grid);
    if (!vector(result,3)) throw new RangeError('Construction plane grid point exceeds coordinate bounds');
    return result;
  }

  function project(frame, position, mode = 'plane') {
    if (!vector(position,3) || !['plane','grid'].includes(mode))
      throw new TypeError('Construction plane alignment needs a world point and plane or grid mode');
    const delta = V.sub(position,frame.plane.origin);
    const at = frame.axes.slice(0,2).map(axis=>V.dot(delta,axis)/frame.plane.grid);
    const gridAt = mode === 'grid' ? at.map(value=>Math.round(value) || 0) : at;
    return {point:point(frame,gridAt),gridAt};
  }

  A.constructionPlane = Object.freeze({resolve,point,project});
})(KIT);
