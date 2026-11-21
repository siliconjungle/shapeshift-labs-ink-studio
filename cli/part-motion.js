const { surfacePoint } = require('./scene-optics.js');

function catalog(world) {
  const { objectIds, objects, targetIds, targets } = world.renderMetadata ?? {};
  const rig = world.anim?.rig, bones = world.anim?.bones;
  const rest = world.rest ?? world.data;
  const parts = [null], keys = [null], groups = new Map(), rows = new Uint32Array(world.count);
  for (let i = 0; i < rows.length; i++) {
    const object = objects?.[objectIds?.[i]], target = targets?.[targetIds?.[i]], entity = target?.entity;
    const rigSlot = rig?.bid?.[i] || 0, q = i*16;
    const kind = Math.round(rest[q+11]) % 16;
    const bone = bones && (kind === 12 || kind === 13) ? (rest[q+14] > .5 ? rest[q+13] : rest[q+12]) : null;
    const part = target?.part ?? (rigSlot ? rig.names?.[rigSlot] ?? String(rigSlot) : undefined);
    const source = target?.part ? 'authored' : rigSlot ? 'rig' : bone != null ? 'bone' : 'object';
    if (part === undefined && bone == null && object == null && entity == null) continue;
    const key = JSON.stringify([source, entity ?? (source !== 'rig' ? object : null), part ?? bone]);
    if (!groups.has(key)) {
      groups.set(key, parts.length);
      keys.push(key);
      parts.push({ source, ...(entity != null && {entity}), ...(object != null && source !== 'rig' && {object}),
        ...(part !== undefined && {part}), ...(source === 'bone' && {part:'bone '+bone, bone}) });
    }
    rows[i] = groups.get(key);
  }
  return { parts, keys, rows };
}

function history() {
  let last, pending, grouping = false, cut = false;
  return Object.freeze({
    previous() { return cut ? undefined : last; },
    store(snapshot, reset) {
      if (grouping) {
        pending = snapshot;
        cut ||= reset;
      } else last = snapshot;
    },
    output(draw) {
      grouping = true;
      try {
        const result = draw();
        if (pending) last = pending;
        return result;
      } finally {
        grouping = cut = false;
        pending = undefined;
      }
    },
    clear() {
      last = pending = undefined;
      cut = grouping;
    }
  });
}

function cameraPoint(view, x, y, z) {
  return [
    view[0]*x + view[4]*y + view[8]*z + view[12],
    view[1]*x + view[5]*y + view[9]*z + view[13],
    -(view[2]*x + view[6]*y + view[10]*z + view[14])
  ];
}

function reference(w, h, input, parts, topDown, owner, depth) {
  const { camera, source, time } = input;
  const snapshot = { w, h, camera, source, time, keys:parts.keys, rows:parts.rows,
    owner:topDown(owner,1), depth:topDown(depth,1), surface:new Float32Array(w*h).fill(Infinity), poses:new Map() };
  const previous = input.previous;
  const usable = !input.reset && previous?.source === source && previous?.w === w &&
    previous?.h === h && previous.rows.length === parts.rows.length &&
    previous.camera.ortho === camera.ortho && previous.time <= time;
  return { snapshot, previous: usable ? previous : null };
}

function capture(w, h, parts, owner, depth, input, geometry, topDown, sample, atlasOwners, selected) {
  const { snapshot, previous } = reference(w,h,input,parts,topDown,owner,depth);
  const vectors = selected.has('partMotion') ? new Float32Array(w*h*2) : null;
  const previousDepth = selected.has('previousDepth') ? new Float32Array(w*h).fill(Infinity) : null;
  const valid = vectors || previousDepth || selected.has('partMotionValid') ? new Uint8Array(w*h) : null;
  const frames = new Map();
  for (let p = 0; p < snapshot.owner.length; p++) {
    const i = snapshot.owner[p];
    if (i < 0 || i >= parts.rows.length) continue;
    const x = p % w, y = Math.floor(p/w), bottom = (h-1-y)*w+x;
    const atlas = atlasOwners?.get(bottom);
    if (atlas && !atlas.sdf) continue;
    if (!frames.has(i)) {
      const frame = sample(i);
      const center = [geometry.x[i], geometry.y[i], geometry.z[i]];
      const scale = geometry.scale[i];
      frames.set(i, frame);
      snapshot.poses.set(i,{ center, scale, basis:Array.from(frame.basis().anchor) });
    }
    const frame = frames.get(i), pose = snapshot.poses.get(i), z = snapshot.depth[p];
    const ray = geometry.rayAt(x+.5,h-y-.5);
    let point = atlas?.position;
    if (!point && frame.normal) point = surfacePoint(ray,frame.normal,...pose.center,z,geometry.span);
    if (!point || point.every((n,k)=>n === pose.center[k]))
      point = ray.origin.map((n,k)=>n+z*ray.direction[k]/ray.axial);
    const view = input.camera.view;
    snapshot.surface[p] = -(view[2]*point[0]+view[6]*point[1]+view[10]*point[2]+view[14]);
    const prior = valid && previous?.poses.get(i);
    if (!prior || pose.scale <= 0 || prior.scale <= 0) continue;
    const key = parts.keys[parts.rows[i]], oldKey = previous.keys[previous.rows[i]];
    if (key !== oldKey) continue;
    const offset = frame.localOffset(point[0]-pose.center[0],point[1]-pose.center[1],point[2]-pose.center[2]);
    const m = prior.basis, k = prior.scale/pose.scale;
    const before = prior.center.map((n,j)=>n+k*(m[j*3]*offset[0]+m[j*3+1]*offset[1]+m[j*3+2]*offset[2]));
    const camera = previous.camera, [u,v,priorZ] = cameraPoint(camera.view,...before);
    if (!Number.isFinite(priorZ) || priorZ < camera.near) continue;
    const unitsPerPixel = (camera.ortho ? 1 : priorZ) / camera.focal;
    const px = w/2+u/unitsPerPixel, py = h/2-v/unitsPerPixel;
    if (!(px >= 0 && px < w && py >= 0 && py < h)) continue;
    const q = Math.floor(py)*w+Math.floor(px), priorOwner = previous.owner[q];
    // A different splat on the same part can cover the prior pixel. Its surface
    // depth must still agree with the reprojected point.
    const matches = key ? previous.keys[previous.rows[priorOwner]] === key : priorOwner === i;
    if (!matches || Math.abs(previous.surface[q]-priorZ) > Math.max(1e-4,unitsPerPixel*1.25)) continue;
    valid[p] = 255;
    if (vectors) {
      vectors[p*2] = x+.5-px;
      vectors[p*2+1] = y+.5-py;
    }
    if (previousDepth) previousDepth[p] = previous.depth[q];
  }
  return { snapshot, vectors, previousDepth, valid };
}

module.exports = { catalog, capture, history };
