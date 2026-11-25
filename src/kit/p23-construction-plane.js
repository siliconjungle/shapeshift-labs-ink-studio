/* Shared scene coordinates for placement, transform pivots and alignment. */
(function (K) {
  const A = K.authoring, { V } = K, { freeze } = K.procedural.data;
  const fields = ['origin','right','up','grid','lock'];
  const names = ['x','y','z'];
  const vector = (value,size) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);

  function resolve(raw = {}) {
    if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Object.keys(raw).some(key=>!fields.includes(key)))
      throw new TypeError('A construction plane needs origin, right, up, grid, and an optional axis lock');
    const {origin=[0,0,0],right=[1,0,0],up=[0,1,0],grid=1,lock} = raw;
    if (lock != null && !names.includes(lock)) throw new TypeError('Construction plane lock must be x, y, or z');
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
    if (lock != null && Math.abs(axes[2][names.indexOf(lock)]) < 1-1e-10)
      throw new RangeError('Construction plane normal must match its '+lock.toUpperCase()+' lock');
    return freeze({plane:{origin:origin.slice(),right:right.slice(),up:up.slice(),grid,...(lock && {lock})},axes});
  }

  function pick(raw, pose, {lock} = {}) {
    const current = resolve(raw), camera = CameraLens.pose(pose);
    const {lock:previous,...plane} = current.plane, locked = lock === undefined ? previous : lock;
    if (locked != null && !names.includes(locked)) throw new TypeError('Construction plane lock must be x, y, or z');
    // Prefer the front plane, then the side, on equal face-on scores.
    const index = locked == null ? [2,0,1].reduce((best,i)=>
      Math.abs(camera.back[i])>Math.abs(camera.back[best])+1e-12 ? i : best) : names.indexOf(locked);
    const axis = names[index];
    const kept = locked != null && (previous === locked ||
      Math.abs(current.axes[2][index]) >= 1-1e-10 && V.dot(current.axes[2],camera.back) >= -1e-12);
    let frame;
    if (kept) frame = resolve({...plane,lock:locked});
    else {
      const normal = [0,0,0];
      normal[index] = camera.back[index]<-1e-12 ? -1 : 1;
      let best = -Infinity, right, up;
      for (let i=0;i<3;i++) if (i !== index) for (const facing of [1,-1]) {
        const candidate = [0,0,0];
        candidate[i] = facing;
        const vertical = V.cross(normal,candidate).map(n=>n || 0);
        const score = V.dot(candidate,camera.right)+V.dot(vertical,camera.up);
        if (score>best+1e-12) {
          best=score;
          right=candidate;
          up=vertical;
        }
      }
      frame = resolve({...plane,right,up,lock:locked});
    }
    return freeze({...frame,axis,kept,camera});
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

  A.constructionPlane = Object.freeze({resolve,pick,point,project});
})(KIT);
