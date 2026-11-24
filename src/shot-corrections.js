/* Exact native-pixel cels with explicit shot timing and visible surface anchors. */
const ShotCorrections = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const splats = typeof SplatProvenance === 'undefined' ? require('./splat-provenance.js') : SplatProvenance;
  const prepared = new WeakSet();
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const pair = (value, check) => Array.isArray(value) && value.length === 2 && Array.from(value).every(check);
  const idOK = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(value);
  const xy = (value, bound) => pair(value, n => integer(n, -bound, bound));
  const maxPixels = 1048576;
  const dimensions = value => pair(value, n => integer(n, 1, 8192)) && value[0] * value[1] <= maxPixels;
  const check = (ok, message) => { if (!ok) throw new RangeError('Shot corrections: ' + message); };

  function anchor(raw) {
    check(keys(raw, ['splat', 'offset', 'target', 'depthOffset']) &&
      (integer(raw.splat, 0, Number.MAX_SAFE_INTEGER) || splats.validId(raw.splat)),
    'anchor needs a splat row or stable splat ID');
    const { splat, offset = [0, 0], target, depthOffset = 0 } = raw;
    check(xy(offset, 8192) && Number.isFinite(depthOffset) && Math.abs(depthOffset) <= 4096,
      'anchor needs a bounded art-pixel offset and finite depth offset');
    return Object.freeze({ splat, offset: Object.freeze(offset.slice()), depthOffset,
      ...(target !== undefined && { target: selectors.prepare(target) }) });
  }

  function prepare(raw) {
    if (raw === undefined || raw === false) return null;
    if (prepared.has(raw)) return raw;
    check(keys(raw, ['size', 'fps', 'startTime', 'corrections']), 'expected a shot correction document');
    const { size, fps, startTime = 0, corrections = [] } = raw;
    check(dimensions(size) && Number.isFinite(fps) && fps > 0 && fps <= 240 && Number.isFinite(startTime) &&
      Array.isArray(corrections) && corrections.length <= 256, 'invalid native grid, shot clock, or correction count');
    const ids = new Set();
    let count = 0;
    const rows = Array.from(corrections, row => {
      check(keys(row, ['id', 'frames', 'anchor', 'pixels', 'depthTolerance']) && idOK(row.id) && !ids.has(row.id),
        'corrections need unique IDs');
      const { id, frames, pixels, depthTolerance } = row;
      check(pair(frames, n => integer(n, 0, 1e9)) && frames[0] <= frames[1],
        'frame range needs ordered inclusive shot frames');
      check(depthTolerance === undefined || Number.isFinite(depthTolerance) && depthTolerance > 0 && depthTolerance <= 4096,
        'invalid depth tolerance');
      check(Array.isArray(pixels) && pixels.length <= 4096 && (count += pixels.length) <= 16384,
        'correction paint exceeds its pixel budget');
      const written = new Set();
      const ink = Array.from(pixels, entry => {
        check(Array.isArray(entry) && entry.length === 3 && integer(entry[0], -size[0], size[0]) &&
          integer(entry[1], -size[1], size[1]) && typeof entry[2] === 'string' && /^#[\da-f]{6}$/i.test(entry[2]),
        'paint needs signed integer offsets and exact #rrggbb swatches');
        const [x, y, color] = entry, key = x + '/' + y;
        check(!written.has(key), 'each pixel can appear once in a correction');
        written.add(key);
        return Object.freeze([x, y, color.toLowerCase()]);
      });
      ids.add(id);
      return Object.freeze({ id, frames: Object.freeze(frames.slice()), anchor: anchor(row.anchor),
        pixels: Object.freeze(ink), ...(depthTolerance !== undefined && { depthTolerance }) });
    });
    const plan = Object.freeze({ size: Object.freeze(size.slice()), fps, startTime, corrections: Object.freeze(rows) });
    prepared.add(plan);
    return plan;
  }

  function paint(raw, correction) {
    const plan = prepare(raw), rows = plan.corrections.slice();
    const i = rows.findIndex(row => row.id === correction?.id);
    if (i < 0) rows.push(correction);
    else rows[i] = correction;
    return prepare({ ...plan, corrections: rows });
  }

  function frameIndex(plan, time, explicit) {
    if (explicit !== undefined) {
      check(integer(explicit, 0, 1e9), 'shotCorrectionFrame must be a nonnegative integer');
      return explicit;
    }
    const sample = (time - plan.startTime) * plan.fps;
    check(Number.isFinite(sample) && Math.abs(sample) <= Number.MAX_SAFE_INTEGER, 'shot sample falls outside the clock');
    const nearest = Math.round(sample);
    return Math.abs(sample - nearest) <= 1e-8 ? nearest : Math.floor(sample);
  }

  function targetOf(row) {
    const target = Object.fromEntries(['object', 'entity', 'part', 'surface', 'material']
      .filter(key => row[key] !== undefined).map(key => [key, row[key]]));
    if (target.object === target.entity) delete target.entity;
    return Object.keys(target).some(key => key !== 'material') ? target : undefined;
  }

  function resolve(art, passes, plan, world, { time = 0, shotCorrectionFrame, project, shotCorrectionHits } = {}) {
    const { w, h } = art;
    check(dimensions([w, h]) && w === plan.size[0] && h === plan.size[1],
      'native frame must match the authored grid');
    const { splatId: owners, depth } = passes;
    check(owners?.length === w * h && depth?.length === w * h && typeof project === 'function',
      'native depth, owners, and surface projection are required');
    const frame = frameIndex(plan, time, shotCorrectionFrame), target = selectors.index(world).row;
    let byId;
    const corrections = [], edits = new Map();
    for (const { id, frames, anchor, pixels: ink, depthTolerance } of plan.corrections) {
      if (frame < frames[0] || frame > frames[1]) continue;
      let row = anchor.splat;
      if (typeof row === 'string') {
        byId ??= splats.identities(world);
        row = byId.rowOf(row);
      }
      const rule = integer(row, 0, world.count - 1) ? target(row) : null;
      const domain = rule && targetOf(rule);
      const inScope = rule && (!anchor.target || selectors.matches(anchor.target, rule));
      const center = inScope && project(row, w, h);
      const skippedHits = id === shotCorrectionHits ? [] : undefined;
      if (!center) {
        if (skippedHits) {
          const reason = !rule ? 'missing-anchor' : !inScope ? 'anchor-outside-target' : 'anchor-not-projected';
          for (const [dx,dy] of ink) skippedHits.push({ offset:[dx,dy], at:null, reason });
        }
        corrections.push({ id, at: null, painted: 0, clipped: ink.length, ...(skippedHits && { skippedHits }) });
        continue;
      }
      const [u, v, scale, z] = center;
      const x0 = Math.floor(u) + anchor.offset[0], y0 = Math.floor(v) + anchor.offset[1];
      const distance = depthTolerance ?? 3 / scale, plane = z + anchor.depthOffset;
      let painted = 0;
      const matches = new Map();
      for (const [dx, dy, color] of ink) {
        const x = x0 + dx, y = y0 + dy;
        const p = y * w + x, owner = owners[p];
        let reason;
        if (x < 0 || x >= w || y < 0 || y >= h) reason = 'outside-grid';
        else if (owner < 1 || owner > world.count || art.alpha?.[p] === 0 || !Number.isFinite(depth[p]))
          reason = 'no-surface';
        else if (Math.abs(depth[p] - plane) > distance) reason = 'depth-mismatch';
        else {
          if (!matches.has(owner)) matches.set(owner, domain ? selectors.matches(domain, target(owner - 1)) : owner - 1 === row);
          if (!matches.get(owner)) reason = 'different-owner';
        }
        if (reason) {
          skippedHits?.push({ offset:[dx,dy], at:[x,y], reason });
          continue;
        }
        edits.set(p, parseInt(color.slice(1), 16));
        painted++;
      }
      corrections.push({ id, at: [x0, y0], painted, clipped: ink.length - painted,
        ...(skippedHits && { skippedHits }) });
    }
    return { edits, frame, corrections };
  }

  function apply(rgb, edits) {
    if (!edits.size) return rgb;
    const pixels = rgb.slice();
    for (const [p, packed] of edits) {
      const at = p * 3;
      pixels[at] = packed >> 16;
      pixels[at + 1] = packed >> 8 & 255;
      pixels[at + 2] = packed & 255;
    }
    return pixels;
  }

  function capture({ w, h }, { splatId, depth }, world, project) {
    check(dimensions([w, h]) && splatId?.length === w * h && depth?.length === w * h && typeof project === 'function',
      'capture needs aligned depth, owners and projection on the native grid');
    const owners = splatId.slice(), distances = depth.slice(), rows = new Map(), target = selectors.index(world).row;
    const ids = splats.identities(world);
    for (const owner of owners) {
      if (!integer(owner, 1, world.count) || rows.has(owner)) continue;
      const row = owner - 1;
      if (ids.ambiguous(row)) {
        rows.set(owner,null);
        continue;
      }
      const center = project(row, w, h);
      rows.set(owner, { center, target: targetOf(target(row)), splat: ids.idAt(row) ?? row });
    }
    function pin(x, y) {
      if (!integer(x, 0, w - 1) || !integer(y, 0, h - 1)) return null;
      const p = y * w + x, row = rows.get(owners[p]);
      if (!row?.center || !Number.isFinite(distances[p])) return null;
      const [u, v, , z] = row.center;
      return anchor({ splat: row.splat, target: row.target, offset: [x - Math.floor(u), y - Math.floor(v)],
        depthOffset: distances[p] - z });
    }
    return Object.freeze({ w, h, pin });
  }

  return Object.freeze({ prepare, paint, resolve, apply, capture });
})();
if (typeof module !== 'undefined') module.exports = ShotCorrections;
