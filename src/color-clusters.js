/* Coalesce connected colors inside a visible material at native art resolution. */
const ColorClusters = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const temporal = typeof ClusterCoherence === 'undefined' ? require('./cluster-coherence.js') : ClusterCoherence;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  function fields(value, keys, name) {
    if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid ' + name);
    return value;
  }

  function prepare(definition) {
    if (definition === undefined || definition === false) return null;
    const { targets, maxMotion = 12 } = fields(definition, ['targets', 'maxMotion'], 'color cluster settings');
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 128)
      throw new RangeError('Color clusters need 1 to 128 target rules');
    if (!Number.isFinite(maxMotion) || maxMotion < .01 || maxMotion > 256)
      throw new RangeError('Color cluster maxMotion must be in [.01, 256] art pixels');
    const rules = Array.from(targets, raw => {
      const { select, minPixels = 4, grain = {}, protect = {} } =
        fields(raw, ['select', 'minPixels', 'grain', 'protect', 'coherence'], 'color cluster target');
      if (!Number.isSafeInteger(minPixels) || minPixels < 1 || minPixels > 4096)
        throw new RangeError('Color cluster minPixels must be an integer from 1 to 4096');
      const { angle = 0, strength = 0 } = fields(grain, ['angle', 'strength'], 'color cluster grain');
      if (!Number.isFinite(angle) || !Number.isFinite(strength) || strength < 0 || strength > 1)
        throw new RangeError('Color cluster grain needs an angle in degrees and strength in [0, 1]');
      const { boundaries = true, details = true, swatches = [], targets = [] } =
        fields(protect, ['boundaries', 'details', 'swatches', 'targets'], 'color cluster protection');
      if (typeof boundaries !== 'boolean' || typeof details !== 'boolean' ||
          !Array.isArray(swatches) || swatches.length > 256 ||
          !Array.from(swatches).every(hex => typeof hex === 'string' && /^#[\da-f]{6}$/i.test(hex)) ||
          !Array.isArray(targets) || targets.length > 128)
        throw new TypeError('Color cluster protection needs boolean switches, #rrggbb swatches and target selectors');
      const theta = (angle % 180) * Math.PI / 180, u = Math.cos(theta), v = Math.sin(theta);
      return { select: selectors.prepare(select), minPixels, boundaries, details, coherence: temporal.prepare(raw.coherence),
        swatches: new Set(swatches.map(hex => parseInt(hex.slice(1), 16))),
        targets: Array.from(targets, selectors.prepare),
        weights: directions.map(([x, y]) => (1 + 4 * strength * (x * u + y * v) ** 2 / (x * x + y * y)) /
          (x && y ? Math.SQRT2 : 1))
      };
    });
    const coherent = rules.some(rule => rule.coherence.size);
    return { rules, ...(coherent && { coherent, maxMotion, key:JSON.stringify(definition) }) };
  }

  function apply(frame, passes, plan, world, options) {
    const { w, h, rgb, alpha, inkMask, effectsMask } = frame, count = w * h;
    const owners = passes?.splatId;
    const empty = { rgb, changedPixels: 0, mergedClusters: 0 };
    if (!owners || !plan) return empty;
    const { rules } = plan, targetAt = selectors.index(world).row;
    const { protected: protectedPixels, paletteOwner, paletteOwners, emission } = passes;
    const byTarget = new Map(), bySplat = new Map(), profiles = [null];
    const domain = new Uint32Array(count), locked = new Uint8Array(count);
    const colorAt = p => (rgb[3 * p] << 16) | (rgb[3 * p + 1] << 8) | rgb[3 * p + 2];
    function domainOf(owner, palette) {
      const i = owner - 1, key = palette ? i + ':' + palette : i;
      if (bySplat.has(key)) return bySplat.get(key);
      const target = targetAt(i);
      let choices = byTarget.get(target);
      if (!choices) {
        const rule = rules.findLast(rule => selectors.matches(rule.select, target));
        const blocked = rule && rule.targets.some(filter => selectors.matches(filter, target));
        byTarget.set(target, choices = { rule: rule && (rule.minPixels > 1 || rule.coherence.size) &&
          !target.mediumKind ? rule : null, blocked, slots: new Map() });
      }
      let id = 0;
      if (choices.rule) {
        id = choices.slots.get(palette);
        if (id === undefined) {
          id = profiles.length;
          choices.slots.set(palette, id);
          const key = choices.rule.coherence.size ? JSON.stringify([
            Object.entries(target).sort(([a], [b]) => a.localeCompare(b)),
            paletteOwners?.[palette] ?? [palette, options?.palette]
          ]) : undefined;
          profiles.push({ ...choices, target, key });
        }
      }
      bySplat.set(key, id);
      return id;
    }

    let eligible = false;
    for (let p = 0; p < count; p++) {
      const owner = owners[p];
      if (!owner || owner > world.count || alpha?.[p] === 0) continue;
      const slot = domainOf(owner, paletteOwner?.[p] ?? 0);
      if (!slot) continue;
      const { rule, blocked } = profiles[slot], i = p * 3;
      domain[p] = slot;
      locked[p] = Number(blocked || rule.swatches.has(colorAt(p)) || rule.details &&
        Boolean(protectedPixels?.[p] || inkMask?.[p] || effectsMask?.[p] ||
          (world.data[(owner - 1) * 16 + 11] & 32) ||
          (emission && Math.max(emission[i], emission[i + 1], emission[i + 2]) > .12)));
      eligible ||= !locked[p];
    }
    function finish(result) {
      if (!plan.coherent) return result;
      const coherent = temporal.apply(frame, result.rgb, { owners, domain, locked, profiles, plan },
        { ...options, source:options?.source ?? world });
      let changedPixels = result.changedPixels;
      if (coherent.rgb !== result.rgb) {
        changedPixels = 0;
        for (let q = 0; q < rgb.length; q += 3)
          changedPixels += Number(rgb[q] !== coherent.rgb[q] || rgb[q+1] !== coherent.rgb[q+1] || rgb[q+2] !== coherent.rgb[q+2]);
      }
      return { ...result, ...coherent, changedPixels };
    }
    if (!eligible) return finish(empty);
    for (let p = 0; p < count; p++) {
      if (!domain[p] || locked[p] || !profiles[domain[p]].rule.boundaries) continue;
      const x = p % w;
      if (x === 0 || x === w - 1 || p < w || p >= count - w ||
          domain[p - 1] !== domain[p] || domain[p + 1] !== domain[p] ||
          domain[p - w] !== domain[p] || domain[p + w] !== domain[p]) locked[p] = 1;
    }

    function adjacent(p, limit, visit) {
      const x = p % w, y = Math.floor(p / w), source = domain[p];
      for (let d = 0; d < limit; d++) {
        const [dx, dy] = directions[d];
        if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
        const q = p + dx + dy * w;
        if (domain[q] !== source || locked[q]) continue;
        if (dx && dy && (domain[p + dx] !== source || locked[p + dx]) &&
            (domain[p + dy * w] !== source || locked[p + dy * w])) continue;
        visit(q, d);
      }
    }
    const spatial = rules.some(rule => rule.minPixels > 1);
    if (!spatial) return finish(empty);
    const labels = new Uint32Array(count), next = new Int32Array(count).fill(-1), components = [null];
    for (let p = 0; p < count; p++) {
      if (!domain[p] || locked[p] || labels[p] || profiles[domain[p]].rule.minPixels === 1) continue;
      const id = components.length, color = colorAt(p);
      const component = { parent: id, color, start: p, end: p, size: 1, rule: profiles[domain[p]].rule };
      labels[p] = id;
      for (let q = p; q >= 0; q = next[q]) adjacent(q, 4, neighbor => {
        if (labels[neighbor] || colorAt(neighbor) !== color) return;
        labels[neighbor] = id;
        next[component.end] = neighbor;
        component.end = neighbor;
        component.size++;
      });
      components.push(component);
    }

    function root(id) {
      while (id !== components[id].parent) {
        const direct = components[id].parent;
        id = components[id].parent = components[direct].parent;
      }
      return id;
    }
    function distance(a, b) {
      const r = (a >> 16) - (b >> 16), g = (a >> 8 & 255) - (b >> 8 & 255), blue = (a & 255) - (b & 255);
      return (r * r * .30 + g * g * .55 + blue * blue * .15) / 255 ** 2;
    }
    let mergedClusters = 0;
    for (let id = 1; id < components.length; id++) {
      if (components[id].parent !== id) continue;
      let active = id;
      while (components[active].size < components[active].rule.minPixels) {
        const source = components[active], votes = new Map();
        for (let p = source.start; p >= 0; p = next[p]) adjacent(p, directions.length, (q, d) => {
          const other = root(labels[q]);
          if (other === active) return;
          let vote = votes.get(other);
          if (!vote) votes.set(other, vote = { support: 0, edge: false });
          vote.support += source.rule.weights[d];
          vote.edge ||= d < 4;
        });
        let best = 0, score = -1;
        for (const [other, { support, edge }] of votes) {
          if (!edge) continue;
          const candidate = components[other];
          const value = source.color === candidate.color ? Infinity : support / (1 + 3 * distance(source.color, candidate.color));
          if (value > score || value === score && (candidate.size > components[best].size ||
              candidate.size === components[best].size && other < best)) {
            best = other;
            score = value;
          }
        }
        if (!best) break;
        const target = components[best];
        source.parent = best;
        next[target.end] = source.start;
        target.end = source.end;
        target.size += source.size;
        active = best;
        mergedClusters++;
      }
    }
    if (!mergedClusters) return finish(empty);
    const output = rgb.slice();
    let changedPixels = 0;
    for (let p = 0; p < count; p++) {
      if (!labels[p]) continue;
      const color = components[root(labels[p])].color;
      if (color === colorAt(p)) continue;
      output[3 * p] = color >> 16;
      output[3 * p + 1] = color >> 8 & 255;
      output[3 * p + 2] = color & 255;
      changedPixels++;
    }
    return finish({ rgb: output, changedPixels, mergedClusters });
  }

  return Object.freeze({ prepare, apply, history:temporal.history, projector:temporal.projector });
})();
if (typeof module !== 'undefined') module.exports = ColorClusters;
