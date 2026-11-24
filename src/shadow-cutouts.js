/* Light-space samples of oriented pixel cutouts, independent of the camera. */
const ShadowCutouts = (() => {
  const shells = typeof ShadowShell === 'undefined' ? require('./shadow-shell.js') : ShadowShell;
  const atlasAPI = () => typeof AtlasSprites === 'undefined' ? require('./atlas-sprites.js') : AtlasSprites;
  const slipSymbol = Symbol.for('ink-studio.spriteSurface.uvSlip');
  const surfaceCache = new WeakMap(), sceneryCache = new WeakMap(), imageIds = new WeakMap();
  let nextImageId = 1;
  const maxPlanes = 16, maxPixels = 1048576;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const delta = (a, b) => a.map((n, k) => n - b[k]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const clampIndex = (n, size) => Math.min(size - 1, Math.max(0, Math.floor(n)));
  const integer = n => Number.isSafeInteger(n) && n >= 0;

  function mask(width, height, read) {
    if (!integer(width) || !integer(height) || width < 1 || height < 1 ||
        width > 1024 || height > 1024)
      throw new RangeError('A shadow cutout mask must be from 1 to 1024 pixels on each axis');
    const alpha = new Uint8Array(width * height);
    let any = false;
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      alpha[i] = read(x, y);
      any ||= alpha[i] >= 128;
    }
    return any ? { width, height, alpha } : null;
  }

  function plane(origin, right, down, image, mapping, cutoff = 128) {
    const raw = cross(right, down), area = Math.hypot(...raw);
    if (!(area > 1e-10) || !Number.isFinite(area))
      throw new RangeError('A painted shadow caster needs a nondegenerate plane');
    const normal = raw.map(n => n / area);
    return { origin, normal, image, mapping, cutoff,
      u: cross(down, normal).map(n => n / area),
      v: cross(normal, right).map(n => n / area) };
  }

  function surfacePlanes(atlas, emit, shadowShells, accepts) {
    const { shadowFaces, width, height, vertices, pixels, revision = 0 } = atlas;
    if (!Array.isArray(shadowFaces) || shadowFaces.length > maxPlanes ||
        !(vertices instanceof Float32Array) || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4)
      throw new RangeError('Invalid painted shadow faces in a sprite surface atlas');
    let cache = surfaceCache.get(atlas);
    if (!cache || cache.pixels !== pixels || cache.width !== width || cache.height !== height || cache.revision !== revision) {
      cache = { pixels, width, height, revision, masks: new Map(), shells: new WeakMap() };
      surfaceCache.set(atlas, cache);
    }
    const slip = atlas[slipSymbol];
    const edits = slip?.vertices === vertices && slip.width === width && slip.height === height ? slip.ranges : [];
    for (const { first, region, shell: authoredShell, subdivisions = 1 } of shadowFaces) {
      if(accepts){
        const chart=atlas.surfaceCharts?.find(row=>row.first<=first&&row.end>first);
        if(!accepts(chart?{object:chart.objectId,entity:chart.objectId,material:chart.materialId,part:chart.partId,surface:chart.id}:{})) continue;
      }
      const shell=shadowShells && authoredShell;
      const span = 3 * subdivisions ** 2, end = first + 2 * span;
      if (!integer(first) || first % 3 || !Number.isSafeInteger(subdivisions) || subdivisions < 1 || subdivisions > 16 ||
          end * 5 > vertices.length)
        throw new RangeError('Invalid painted shadow face vertex range');
      const base = first * 5, vertex = i => Array.from(vertices.subarray(base + i * 5, base + i * 5 + 5));
      const bIndex = (subdivisions - 1) * 6 + 1;
      const [a, b, c, c2, b2, corner] = [0, bIndex, span - 1, span, span + bIndex, 2 * span - 1].map(vertex);
      const nearly = (p, q) => Math.abs(p - q) <= 2e-6 * Math.max(1, Math.abs(p), Math.abs(q));
      if (!a.every((n, k) => nearly(b[k], b2[k]) && nearly(c[k], c2[k]) && nearly(b[k] + c[k] - n, corner[k])) ||
          !nearly(a[3], c[3]) || !nearly(a[4], b[4]))
        throw new RangeError('A painted shadow face must stay a single planar, UV-aligned quad');
      const change = edits.find(edit => edit.first < end && edit.end > first);
      if (change && (change.first > first || change.end < end))
        throw new RangeError('UV slip must move the whole painted shadow face');
      const bounds = change?.bounds ?? [region.x, region.y, region.x + region.width - 1, region.y + region.height - 1];
      const [x, y, x1, y1] = bounds, w = x1 - x + 1, h = y1 - y + 1;
      if (![x, y, x1, y1].every(integer) || x1 >= width || y1 >= height)
        throw new RangeError('Painted shadow face UV bounds are outside its atlas');
      const key = bounds.join('/');
      let masks=cache.masks;
      if (shell) {
        if (!cache.shells.has(shell)) cache.shells.set(shell,new Map());
        masks=cache.shells.get(shell);
      }
      if (!masks.has(key)) {
        if (masks.size >= maxPlanes) masks.clear();
        const image=mask(w,h,(u,v)=>pixels[((y+v)*width+x+u)*4+3]);
        if (image && shell) image.shell=shells.fit(shell,w,h);
        masks.set(key,image);
      }
      const image = masks.get(key);
      if (!image) continue;
      const [sx, sy, tx, ty] = change?.transform ?? [1, 1, 0, 0];
      const mapping = [a[3] * sx + tx - x, a[4] * sy + ty - y, (b[3] - a[3]) * sx, (c[4] - a[4]) * sy];
      emit(plane(a.slice(0, 3), delta(b, a).slice(0, 3), delta(c, a).slice(0, 3), image, mapping));
    }
  }

  function sceneryPlanes(placement, time, interfaceTime, emit, shadowShells) {
    const { atlas, at, frame, yaw, scale, depth, opacity } = placement;
    if (placement.clock === 'interface') time = interfaceTime ?? time;
    if (opacity < 128 / 255 || placement.visibleAt && !placement.visibleAt(time)) return;
    const A = atlasAPI();
    const anchor = typeof at === 'function' ? A.vector(at(time), 'Shadow caster anchor') : at;
    const cell = atlas.select(typeof frame === 'function' ? frame(time) : frame ?? placement.frameAt?.(time), 'scenery');
    const { rect, pivot } = cell, units = cell.unitsPerPixel * scale;
    const axes = A.basis(cell.yaw + yaw, cell.pitch);
    const shell=shadowShells && placement.shadowShell;
    let cache = sceneryCache.get(atlas);
    if (!cache || cache.cell !== cell || cache.depth !== depth || cache.shell !== shell) {
      cache = { cell, depth, shell, masks: new Map() };
      sceneryCache.set(atlas, cache);
    }
    const channels = { depth: false, lighting: false, emission: false };
    const out = { color: [0, 0, 0], normal: [0, 0, 0], emission: [0, 0, 0] };
    const bands = depth ? atlas.sceneryPlanes : [{ depth: 0 }];
    for (const { id, depth: z, bounds } of bands) {
      const x = bounds ? Math.max(0, bounds[0] - rect.x) : 0, y = bounds ? Math.max(0, bounds[1] - rect.y) : 0;
      const w = Math.min(rect.width, bounds ? bounds[2] - rect.x : rect.width) - x;
      const h = Math.min(rect.height, bounds ? bounds[3] - rect.y : rect.height) - y;
      if (w <= 0 || h <= 0) continue;
      if (!cache.masks.has(id)) {
        const image=mask(w,h,(u,v)=>atlas.sample(cell,x+u,y+v,channels,out,id) ? Math.round(255*out.alpha) : 0);
        if (image && shell) image.shell=shells.crop(shell,rect.x+x,rect.y+y,w,h);
        cache.masks.set(id,image);
      }
      const image = cache.masks.get(id);
      if (!image) continue;
      const origin = anchor.map((n, k) => n + units * ((x - pivot.x) * axes.right[k] +
        (pivot.y - y) * axes.up[k]) - z * scale * axes.normal[k]);
      const row=plane(origin,axes.right.map(n=>n*w*units),axes.up.map(n=>-n*h*units),
        image,[0,0,w,h],Math.ceil(128/opacity));
      if (shell) row.shellScale=scale;
      emit(row);
    }
  }

  function prepare(world, { time = 0, interfaceTime, enabled = true, surfaces = world.spriteSurfaces,
    sprites = world.spriteAtlases, atlasMode, shadowShells = world.shadowShells !== false, accepts } = {}) {
    const planes = [];
    if (!enabled || world.cutoutShadows === false) return planes;
    let pixels = 0;
    const masks = new Set();
    function emit(value) {
      if (!masks.has(value.image)) {
        masks.add(value.image);
        pixels += value.image.width * value.image.height;
      }
      if (planes.length >= maxPlanes || pixels > maxPixels)
        throw new RangeError('Painted shadows support up to 16 cutout planes and 1,048,576 mask pixels');
      planes.push(value);
    }
    for (const atlas of Array.isArray(surfaces) ? surfaces : [surfaces])
      if (atlas?.shadowFaces?.length) surfacePlanes(atlas,emit,shadowShells,accepts);
    if (Array.isArray(sprites) && (atlasMode === undefined || atlasMode === 'scenery')) {
      const A = atlasAPI();
      for (const placement of sprites)
        if ((placement?.castsShadow || placement?.shadowShell !== undefined && placement.shadowShell !== false) &&
            (!accepts || accepts({object:placement.id,entity:placement.id})))
          sceneryPlanes(A.place(placement),time,interfaceTime,emit,shadowShells);
    }
    return planes;
  }

  function shellDepth({origin:at,normal,u,v,image,mapping,cutoff,shellScale=1},origin,direction,distance) {
    const offset=delta(at,origin);
    return shells.firstHit(image,mapping,cutoff,[-dot(offset,u),-dot(offset,v),dot(offset,normal)],
      [dot(direction,u),dot(direction,v),-dot(direction,normal)],distance,shellScale);
  }

  function occludes(planes, origin, direction, distance) {
    for (const plane of planes) {
      const {origin:at,normal,u,v,image,mapping,cutoff}=plane;
      if (image.shell) {
        if (Number.isFinite(shellDepth(plane,origin,direction,distance))) return true;
        continue;
      }
      const facing = dot(direction, normal);
      if (Math.abs(facing) <= 1e-8) continue;
      const ox = at[0] - origin[0], oy = at[1] - origin[1], oz = at[2] - origin[2];
      const axial = ox * normal[0] + oy * normal[1] + oz * normal[2];
      const hit = axial / facing;
      if (hit <= 1e-5 || hit >= distance) continue;
      const xh = hit * direction[0] - ox, yh = hit * direction[1] - oy, zh = hit * direction[2] - oz;
      const s = xh * u[0] + yh * u[1] + zh * u[2], t = xh * v[0] + yh * v[1] + zh * v[2];
      if (s < 0 || t < 0 || s > 1 || t > 1) continue;
      const x = clampIndex(mapping[0] + s * mapping[2], image.width), y = clampIndex(mapping[1] + t * mapping[3], image.height);
      if (image.alpha[y * image.width + x] >= cutoff) return true;
    }
    return false;
  }

  function historyKey(planes) {
    if (!planes.some(row=>row.image.shell)) return '';
    return planes.map(({image,origin,normal,u,v,mapping,cutoff,shellScale=1}) => {
      if (!imageIds.has(image)) imageIds.set(image,nextImageId++);
      return [imageIds.get(image),...origin,...normal,...u,...v,...mapping,cutoff,shellScale].join(',');
    }).join(';');
  }

  return Object.freeze({ prepare, occludes, shellDepth, historyKey });
})();
if (typeof module !== 'undefined') module.exports = ShadowCutouts;
