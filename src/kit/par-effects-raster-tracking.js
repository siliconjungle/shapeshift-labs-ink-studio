/* Associate connected raster regions across frames with bounded, one-to-one matching. */
(function (P) {
  const { view, int } = P.pixelEffectSupport;
  const maxContourCells = 500000;
  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

  // Rectangular Hungarian assignment. The extra columns let any track remain unmatched.
  function assign(costs, misses) {
    const rows = costs.length, detections = costs[0].length, cols = detections + rows;
    const rowCost = new Float64Array(rows + 1), colCost = new Float64Array(cols + 1);
    const rowAt = new Int32Array(cols + 1), previous = new Int32Array(cols + 1);
    const minimum = new Float64Array(cols + 1), visited = new Uint8Array(cols + 1);
    for (let r = 1; r <= rows; r++) {
      rowAt[0] = r;
      minimum.fill(Infinity);
      visited.fill(0);
      let col = 0;
      do {
        visited[col] = 1;
        const row = rowAt[col], line = costs[row - 1];
        let delta = Infinity, next = 0;
        for (let j = 1; j <= cols; j++) {
          if (visited[j]) continue;
          const cost = j <= detections ? line[j - 1] : misses;
          const reduced = cost - rowCost[row] - colCost[j];
          if (reduced < minimum[j]) { minimum[j] = reduced; previous[j] = col; }
          if (minimum[j] < delta) { delta = minimum[j]; next = j; }
        }
        for (let j = 0; j <= cols; j++) {
          if (visited[j]) { rowCost[rowAt[j]] += delta; colCost[j] -= delta; }
          else minimum[j] -= delta;
        }
        col = next;
      } while (rowAt[col]);
      do {
        const prior = previous[col];
        rowAt[col] = rowAt[prior];
        col = prior;
      } while (col);
    }
    return rowAt.subarray(1, detections + 1);
  }

  function association(track, detection, time, maxDistance, minAreaRatio, forbidden) {
    const dt = time - track.time, { center, velocity, area, bounds } = track.region;
    const dx = velocity[0] * dt, dy = velocity[1] * dt;
    const distance = Math.hypot(detection.center[0] - center[0] - dx, detection.center[1] - center[1] - dy);
    const gate = maxDistance * (track.missed + 1);
    const ratio = Math.min(area, detection.area) / Math.max(area, detection.area);
    if (distance > gate || ratio < minAreaRatio) return forbidden;
    const { x, y, width, height } = detection.bounds;
    const left = bounds.x + dx, top = bounds.y + dy;
    const overlap = Math.max(0, Math.min(x + width, left + bounds.width) - Math.max(x, left)) *
      Math.max(0, Math.min(y + height, top + bounds.height) - Math.max(y, top));
    const union = width * height + bounds.width * bounds.height - overlap;
    return .7 * distance / gate + .2 * (1 - ratio) + .1 * (1 - overlap / union);
  }

  function measure(source, segmentation, maxRegions) {
    const { width, height } = view(source);
    if (width * height > maxContourCells) throw new RangeError('Region tracking exceeds its frame pixel budget');
    const { value, labels } = P.drawing2d.components(source, segmentation);
    if (value.length > maxRegions) throw new RangeError('Region tracking exceeds its region budget');
    const cells = value.reduce((sum, { rect }) => sum + (rect.width + 1) * (rect.height + 1), 0);
    if (cells > maxContourCells) throw new RangeError('Region tracking exceeds its contour cell budget');
    const { data } = labels, sums = new Float64Array((value.length + 1) * 2);
    for (let p = 0; p < data.length; p++) {
      const i = data[p] * 2;
      if (!i) continue;
      sums[i] += p % width + .5;
      sums[i + 1] += Math.floor(p / width) + .5;
    }
    const detections = value.map(({ id, area, rect: bounds }) => {
      const { x, y, width: w, height: h } = bounds;
      const contours = P.contours.march((u, v) => {
        const col = Math.floor(u), row = Math.floor(v);
        return col >= x && col < x + w && row >= y && row < y + h && data[row * width + col] === id ? -1 : 1;
      }, { bounds: { min: [x - .5, y - .5], max: [x + w + .5, y + h + .5] }, cell: 1, maxCells: maxContourCells });
      return { area, bounds, center: [sums[id * 2] / area, sums[id * 2 + 1] / area], contours };
    });
    return { detections, labels };
  }

  function intersections(previous, labels, tracks, time, count) {
    const { width, height, data } = labels;
    const visible = new Map();
    const rows = tracks.map(track => {
      const same = new Uint32Array(count), moved = new Uint32Array(count);
      if (!track.missed) {
        const [vx, vy] = track.region.velocity, dt = time - track.time;
        visible.set(track.region.id, { same, moved, dx: Math.round(vx * dt), dy: Math.round(vy * dt) });
      }
      return { same, moved };
    });
    for (let p = 0; p < previous.length; p++) {
      if (!previous[p]) continue;
      const { same, moved, dx, dy } = visible.get(previous[p]);
      same[data[p]]++;
      const x = p % width + dx, y = Math.floor(p / width) + dy;
      const label = x >= 0 && x < width && y >= 0 && y < height ? data[y * width + x] : 0;
      moved[label]++;
    }
    return rows;
  }

  function linksFor(previous, labels, tracks, detections, pairs, costs, time, threshold) {
    const children = tracks.map(() => []), parents = detections.map(() => []);
    if (!previous || !tracks.length || !detections.length) return { children, parents };
    const overlaps = intersections(previous, labels, tracks, time, detections.length + 1);
    const primary = new Int32Array(tracks.length);
    pairs.forEach((row, col) => { if (row) primary[row - 1] = col + 1; });
    const candidates = [];
    overlaps.forEach(({ same, moved }, row) => {
      const track = tracks[row], match = primary[row];
      if (track.missed) return;
      const area = track.region.area;
      // Pick one alignment for the whole footprint. Counting both could clone a moving region.
      const overlap = moved[0] < same[0] || moved[0] === same[0] && moved[match] > same[match] ? moved : same;
      detections.forEach((detection, col) => {
        const count = overlap[col + 1];
        if (!count || count < threshold * Math.min(detection.area, area)) return;
        const owner = pairs[col];
        if (match && match !== col + 1 && owner && owner !== row + 1 && !tracks[owner - 1].missed) return;
        children[row].push(col);
        parents[col].push(row);
        candidates.push({ row, col, weight: count / Math.max(detection.area, area) });
      });
    });
    // A substantial split or merge can fail the normal area gate. Retain one
    // eligible ID by preferring its strongest overlap among unassigned regions.
    candidates.sort((a, b) => b.weight - a.weight || a.row - b.row || a.col - b.col);
    for (const { row, col, weight } of candidates) {
      if (primary[row] || pairs[col] || (children[row].length < 2 && parents[col].length < 2)) continue;
      pairs[col] = row + 1;
      primary[row] = col + 1;
      costs[row][col] = 1 - weight;
    }
    return { children, parents };
  }

  function eventsFor(tracks, visible, pairs, matched, { children, parents }, time) {
    const events = [], relatedFrom = new Set(), relatedTo = new Set();
    const ids = records => records.map(({ region }) => region.id).sort((a, b) => a - b);
    function push(type, before, after, details) {
      const from = ids(before), to = ids(after);
      const subjects = after.length ? after : before;
      let area = 0, x = 0, y = 0;
      for (const { region } of subjects) {
        area += region.area;
        x += region.center[0] * region.area;
        y += region.center[1] * region.area;
      }
      events.push({ type, time, from, to, center: [x / area, y / area], ...details });
    }
    function topology(type, before, after) {
      for (const row of before) relatedFrom.add(row);
      for (const col of after) relatedTo.add(col);
      push(type, before.map(row => tracks[row]), after.map(col => visible[col]));
    }
    children.forEach((after, row) => { if (after.length > 1) topology('split', [row], after); });
    parents.forEach((before, col) => { if (before.length > 1) topology('merge', before, [col]); });
    tracks.forEach((track, row) => {
      if (!track.missed && !matched.has(row) && !relatedFrom.has(row)) push('disappear', [track], []);
    });
    pairs.forEach((row, col) => {
      const track = tracks[row - 1];
      if (track?.missed && !relatedTo.has(col))
        push('reappear', [track], [visible[col]], { missedFrames: track.missed });
    });
    return P.data.freeze(events);
  }

  function createRegionTracker({ channel, threshold = 1, connectivity = 4, minArea = 1, invert = false,
    maxDistance = 24, minAreaRatio = .3, maxMissed = 2, maxRegions = 32, eventOverlap = .6 } = {}) {
    if (!inRange(maxDistance, .01, 16384) || !inRange(minAreaRatio, 0, 1) ||
        !int(maxMissed, 0, 60) || !int(maxRegions, 1, 128) || !inRange(eventOverlap, .01, 1))
      throw new RangeError('Invalid region tracking distance, area ratio, limits, or event overlap');
    const segmentation = { channel, threshold, connectivity, minArea, invert };
    let tracks = [], nextId = 1, lastTime, width, height, previous;
    function update(source, time) {
      if (!inRange(time, -1e9, 1e9) || lastTime !== undefined && time - lastTime < 1e-6)
        throw new RangeError('Region tracking needs increasing timestamps in seconds');
      if (width !== undefined && (source?.width !== width || source?.height !== height))
        throw new RangeError('Region tracking frames must have a common size');
      const { detections, labels } = measure(source, segmentation, maxRegions);
      const miss = tracks.length + 1, forbidden = miss + 1;
      const costs = tracks.map(track => detections.map(detection =>
        association(track, detection, time, maxDistance, minAreaRatio, forbidden)));
      const pairs = tracks.length && detections.length ? assign(costs, miss) : new Int32Array(detections.length);
      const links = linksFor(previous, labels, tracks, detections, pairs, costs, time, eventOverlap);
      const matched = new Set(), ids = new Uint32Array(detections.length + 1);
      let id = nextId;
      const visible = detections.map((detection, index) => {
        const match = pairs[index] - 1, track = tracks[match], prior = track?.region;
        const key = prior ? prior.id : id++;
        if (key > 0xffffffff) throw new RangeError('Region tracking exhausted its label IDs');
        ids[index + 1] = key;
        const velocity = prior ? detection.center.map((value, i) => (value - prior.center[i]) / (time - track.time)) : [0, 0];
        const confidence = prior ? (1 - costs[match][index]) / (1 + .25 * track.missed) : .5;
        if (prior) matched.add(match);
        return { region: { id: key, ...detection, velocity, confidence }, time, missed: 0 };
      });
      const retained = tracks.flatMap((track, i) => !matched.has(i) && track.missed < maxMissed ?
        [{ ...track, missed: track.missed + 1 }] : []);
      const events = eventsFor(tracks, visible, pairs, matched, links, time);
      retained.sort((a, b) => a.missed - b.missed || a.region.id - b.region.id);
      const ordered = visible.sort((a, b) => a.region.id - b.region.id);
      const value = P.data.freeze(ordered.map(({ region }) => region));
      for (let i = 0; i < labels.data.length; i++) labels.data[i] = ids[labels.data[i]];
      previous = labels.data.slice();
      tracks = ordered.concat(retained.slice(0, maxRegions - ordered.length)).sort((a, b) => a.region.id - b.region.id);
      nextId = id;
      lastTime = time;
      ({ width, height } = labels);
      return { value, labels, time, events };
    }

    return Object.freeze({ update, reset() {
      tracks = [];
      nextId = 1;
      lastTime = width = height = previous = undefined;
    } });
  }

  P.pixelEffects.createRegionTracker = createRegionTracker;
})(KIT.procedural);
