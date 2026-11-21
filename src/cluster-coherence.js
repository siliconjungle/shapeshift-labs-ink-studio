/* Temporal topology for authored swatches on the resolved art grid. */
const ClusterCoherence = (() => {
  const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const fields = ['swatches', 'birthFrames', 'holdFrames', 'splitFrames', 'mergeFrames', 'overlap'];

  function prepare(rules = []) {
    if (!Array.isArray(rules) || rules.length > 32) throw new TypeError('Expected up to 32 cluster coherence rules');
    const colors = new Map();
    for (const rule of rules) {
      if (!rule || Object.getPrototypeOf(rule) !== Object.prototype || Object.keys(rule).some(key => !fields.includes(key)))
        throw new TypeError('Invalid cluster coherence rule');
      const { swatches, birthFrames = 1, holdFrames = 1, splitFrames = 2, mergeFrames = 2, overlap = .35 } = rule;
      if (!Array.isArray(swatches) || !swatches.length || swatches.length > 64 ||
          !Array.from(swatches).every(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)))
        throw new TypeError('Cluster coherence needs exact #rrggbb swatches');
      if (![birthFrames, splitFrames, mergeFrames].every(n => Number.isInteger(n) && within(n, 1, 60)) ||
          !Number.isInteger(holdFrames) || !within(holdFrames, 0, 60) || !within(overlap, .01, 1))
        throw new RangeError('Invalid cluster coherence frame counts or overlap');
      const policy = { birthFrames, holdFrames, splitFrames, mergeFrames, overlap };
      for (const hex of swatches) {
        const color = parseInt(hex.slice(1), 16);
        if (colors.has(color)) throw new TypeError('Duplicate cluster coherence swatch');
        colors.set(color, policy);
      }
    }
    return colors;
  }

  function history() {
    let last;
    return Object.freeze({ previous: () => last, store: value => { last = value; }, clear: () => { last = undefined; } });
  }

  function projector({ view, tangent, ortho, clipNear = .4, clipFar = 400 }, positions) {
    return (i, w, h) => {
      const [x, y, z] = positions(i);
      const depth = -(view[2]*x + view[6]*y + view[10]*z + view[14]);
      if (!within(depth, clipNear, clipFar)) return null;
      const scale = h / (2 * tangent * (ortho ? 1 : depth));
      return [w*.5 + scale*(view[0]*x + view[4]*y + view[8]*z + view[12]),
        h*.5 - scale*(view[1]*x + view[5]*y + view[9]*z + view[13]), scale, depth];
    };
  }

  function adjacent(p, w, size, visit) {
    const x = p % w;
    if (x) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < size - w) visit(p + w);
  }

  function segment(pixels, domain, profiles, w) {
    const labels = new Uint32Array(pixels.length), parts = [null];
    for (let p = 0; p < pixels.length; p++) {
      if (!domain[p] || labels[p]) continue;
      const slot = domain[p], color = pixels[p], policy = profiles[slot].rule.coherence.get(color);
      if (!policy) continue;
      const label = parts.length, cells = [p];
      labels[p] = label;
      for (let i = 0; i < cells.length; i++) adjacent(cells[i], w, pixels.length, q => {
        if (labels[q] || domain[q] !== slot || pixels[q] !== color) return;
        labels[q] = label;
        cells.push(q);
      });
      parts.push({ slot, color, policy, cells, area:cells.length });
    }
    return { labels, parts };
  }

  function link(current, previous, address) {
    const parents = [null], children = previous.parts.map(() => []);
    for (let label = 1; label < current.parts.length; label++) {
      const { cells, color, area, policy } = current.parts[label], counts = new Map();
      for (const p of cells) {
        const before = previous.labels[address[p]];
        if (before && previous.parts[before].color === color) counts.set(before, (counts.get(before) ?? 0) + 1);
      }
      parents[label] = [];
      for (const [before, hits] of counts) {
        if (hits < policy.overlap * Math.min(area, previous.parts[before].area)) continue;
        parents[label].push({ before, hits });
        children[before].push(label);
      }
    }
    return { parents, children };
  }

  function reproject(frame, owners, slots, profiles, previous, project, maxMotion) {
    const { w, h } = frame, address = new Int32Array(w * h).fill(-1), centers = new Map();
    for (let p = 0; p < slots.length; p++) {
      if (!slots[p]) continue;
      const owner = owners[p], x = p % w, y = Math.floor(p / w);
      let u = x, v = y, priorCenter;
      if (project) {
        if (!centers.has(owner)) centers.set(owner, project(owner - 1, w, h));
        const center = centers.get(owner);
        if (!center || !previous) continue;
        priorCenter = previous.centers.get(owner);
        if (!priorCenter) continue;
        const scale = priorCenter[2] / center[2];
        const px = priorCenter[0] + (x + .5 - center[0]) * scale;
        const py = priorCenter[1] + (y + .5 - center[1]) * scale;
        if (Math.hypot(px - x - .5, py - y - .5) > maxMotion || !within(scale, .5, 2)) continue;
        u = Math.floor(px);
        v = Math.floor(py);
      }
      if (!previous || u < 0 || u >= w || v < 0 || v >= h) continue;
      const q = v * w + u, priorSlot = previous.domain[q];
      if (!priorSlot || previous.keys[priorSlot] !== profiles[slots[p]].key) continue;
      if (priorCenter) {
        const surface = previous.centers.get(previous.owners[q]);
        if (!surface || Math.abs(surface[3] - priorCenter[3]) > .12 * Math.min(surface[3], priorCenter[3])) continue;
      }
      address[p] = q;
    }
    return { address, centers };
  }

  function donor(part, pixels, domain, profiles, w) {
    const votes = new Map(), colors = profiles[part.slot].rule.coherence;
    for (const p of part.cells) adjacent(p, w, pixels.length, q => {
      const color = pixels[q];
      if (domain[q] === part.slot && !colors.has(color)) votes.set(color, (votes.get(color) ?? 0) + 1);
    });
    let best, support = 0;
    for (const [color, count] of votes) if (count > support || count === support && color < best) {
      best = color;
      support = count;
    }
    return best;
  }

  function sustain(raw, pixels, domain, profiles, previous, address, w) {
    const pending = new Map(), missed = new Map(), held = new Set();
    const report = { heldPixels:0, editedPixels:0, deferredBirths:0, deferredSplits:0, deferredMerges:0 };
    if (!previous) {
      for (const part of raw.parts.slice(1)) part.age = part.policy.birthFrames;
      return { pending, missed, report, colors:pixels };
    }

    const observed = link(raw, previous.raw, address);
    const visible = link(raw, previous.shown, address);
    const colors = pixels.slice(), bridges = new Set();
    function waiting(key, frames) {
      const n = Math.min(60, (previous.pending.get(key) ?? 0) + 1);
      pending.set(key, n);
      return n < frames;
    }
    for (let i = 1; i < visible.children.length; i++) {
      const part = previous.shown.parts[i], { id, misses } = part;
      const children = visible.children[i];
      const policy = children.length ? raw.parts[children[0]].policy : part.policy;
      if (children.length > 1 && waiting('split/' + id, policy.splitFrames)) {
        bridges.add(i);
        report.deferredSplits++;
      }
      const count = children.length ? 0 : misses + 1;
      missed.set(id, count);
      if (count && count <= policy.holdFrames) held.add(i);
    }
    // Ensure a reused background swatch still belongs to the current palette domain.
    const present = new Map();
    function available(slot) {
      if (!present.size) for (let p = 0; p < pixels.length; p++) {
        const key = domain[p];
        if (!key) continue;
        if (!present.has(key)) present.set(key, new Set());
        present.get(key).add(pixels[p]);
      }
      return present.get(slot);
    }
    for (let i = 1; i < raw.parts.length; i++) {
      const part = raw.parts[i], matches = visible.parents[i], { birthFrames, mergeFrames } = part.policy;
      part.age = Math.min(60, 1 + observed.parents[i].reduce((age, { before }) =>
        Math.max(age, previous.raw.parts[before].age), 0));
      const birth = !matches.length && part.age < birthFrames;
      const ids = matches.map(({ before }) => previous.shown.parts[before].id).sort((a, b) => a - b);
      const merge = ids.length > 1 && waiting('merge/' + ids.join(','), mergeFrames);
      if (!birth && !merge) continue;
      const chosen = donor(part, pixels, domain, profiles, w);
      if (chosen === undefined) continue;
      if (birth) report.deferredBirths++;
      if (merge) report.deferredMerges++;
      const parents = new Set(matches.map(({ before }) => before));
      const policyColors = profiles[part.slot].rule.coherence;
      for (const p of part.cells) {
        const q = address[p];
        if (merge && parents.has(previous.shown.labels[q])) continue;
        if (merge && q < 0) continue;
        const prior = previous.colors[q];
        colors[p] = merge && !policyColors.has(prior) && available(part.slot)?.has(prior) ? prior : chosen;
      }
    }
    for (let p = 0; p < pixels.length; p++) {
      // A retained footprint only fills currently untracked tones.
      if (raw.labels[p]) continue;
      const before = previous.shown.labels[address[p]];
      if (!held.has(before) && !bridges.has(before)) continue;
      colors[p] = previous.shown.parts[before].color;
      if (held.has(before)) report.heldPixels++;
    }
    for (let p = 0; p < pixels.length; p++) if (colors[p] !== pixels[p]) report.editedPixels++;
    return { pending, missed, report, colors };
  }

  function track(shown, previous, address, missed, w, profiles, nextId) {
    const events = [], assigned = new Set();
    const ancestry = previous && link(shown, previous.shown, address);
    if (ancestry) {
      const pairs = [];
      ancestry.parents.forEach((parents, label) => {
        for (const { before, hits } of parents ?? []) pairs.push({ label, before, hits });
      });
      pairs.sort((a, b) => b.hits - a.hits || previous.shown.parts[a.before].id - previous.shown.parts[b.before].id ||
        a.label - b.label);
      for (const { label, before } of pairs) {
        const part = shown.parts[label], id = previous.shown.parts[before].id;
        if (part.id || assigned.has(id)) continue;
        part.id = id;
        part.misses = missed.get(id) ?? 0;
        assigned.add(id);
      }
    }
    const clusters = [];
    for (const part of shown.parts.slice(1)) {
      part.id ??= nextId++;
      part.misses ??= 0;
      if (part.id > 0xffffffff) throw new RangeError('Cluster coherence exhausted its label IDs');
      let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0, sx = 0, sy = 0;
      for (const p of part.cells) {
        const x = p % w, y = Math.floor(p / w);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        sx += x + .5;
        sy += y + .5;
      }
      clusters.push({ id:part.id, target:profiles[part.slot].target, swatch:'#' + part.color.toString(16).padStart(6,'0'),
        area:part.area, bounds:[x0,y0,x1-x0+1,y1-y0+1], center:[sx/part.area,sy/part.area], held:part.misses > 0 });
    }
    if (ancestry) {
      const prior = previous.shown.parts;
      ancestry.children.forEach((children, before) => {
        if (!before) return;
        const from = [prior[before].id], to = children.map(i => shown.parts[i].id).sort((a,b)=>a-b);
        if (to.length > 1) events.push({ type:'split', from, to });
        if (!to.length) events.push({ type:'disappear', from, to });
      });
      ancestry.parents.forEach((parents, label) => {
        if (!label) return;
        const from = parents.map(({before}) => prior[before].id).sort((a,b)=>a-b), to = [shown.parts[label].id];
        if (from.length > 1) events.push({ type:'merge', from, to });
        if (!from.length) events.push({ type:'appear', from, to });
      });
    }
    return { clusters:clusters.sort((a,b)=>a.id-b.id), events, nextId };
  }

  const compact = ({labels, parts}) => ({ labels, parts:parts.map(part => {
    if (!part) return null;
    const { color, area, age, id, misses, policy } = part;
    return { color, area, age, id, misses, policy };
  }) });

  function apply(frame, rgb, { owners, domain, locked, profiles, plan }, {
    history, source, time = 0, reset = false, project, projection, captureLabels = false
  } = {}) {
    const { w, h } = frame, size = w * h;
    if (size > 1048576) throw new RangeError('Cluster coherence exceeds its art pixel budget');
    const last = history?.previous();
    const previous = !reset && last?.source === source && last?.w === w && last.h === h &&
      last.key === plan.key && last.projection === projection && last.time <= time &&
      Boolean(last.projected) === Boolean(project) ? last : null;
    const slots = new Uint32Array(size), pixels = new Uint32Array(size);
    for (let p = 0, q = 0; p < size; p++, q += 3) {
      if (locked[p] || !profiles[domain[p]]?.rule.coherence.size) continue;
      slots[p] = domain[p];
      pixels[p] = rgb[q] << 16 | rgb[q+1] << 8 | rgb[q+2];
    }
    const { address, centers } = reproject(frame, owners, slots, profiles, previous, project, plan.maxMotion);
    const raw = segment(pixels, slots, profiles, w);
    const { pending, missed, report, colors } = sustain(raw, pixels, slots, profiles, previous, address, w);
    const shown = report.editedPixels ? segment(colors, slots, profiles, w) : raw;
    const { clusters, events, nextId } = track(shown, previous, address, missed, w, profiles, previous?.nextId ?? 1);
    const output = report.editedPixels ? rgb.slice() : rgb;
    if (report.editedPixels) for (let p = 0, q = 0; p < size; p++, q += 3) {
      if (colors[p] === pixels[p]) continue;
      output[q] = colors[p] >> 16;
      output[q+1] = colors[p] >> 8 & 255;
      output[q+2] = colors[p] & 255;
    }
    if (history) {
      const recorded = compact(raw);
      history.store({ source, time, projection, projected:Boolean(project), w, h, key:plan.key, nextId, pending, centers,
        domain:slots, keys:profiles.map(profile=>profile?.key), ...(project && { owners:owners.slice() }),
        colors, raw:recorded, shown:shown === raw ? recorded : compact(shown) });
    }
    const labels = captureLabels && Uint32Array.from(shown.labels, label => shown.parts[label]?.id ?? 0);
    return { rgb:output, tracking:{ w, h, ...report, clusters, events, ...(labels && { labels }) } };
  }

  return Object.freeze({ prepare, apply, history, projector });
})();
if (typeof module !== 'undefined') module.exports = ClusterCoherence;
