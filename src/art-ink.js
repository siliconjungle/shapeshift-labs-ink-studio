/* Art-pixel line classification and palettes. The inputs are top-down render passes. */
const ArtInk = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const defaults = Object.freeze({
    silhouette: { steps: 1, litSteps: 0 },
    crease: { steps: 1, litSteps: 0 },
    boundary: { steps: 1, litSteps: 0 },
    shadowEdge: null
  });
  const kinds = Object.keys(defaults);
  const treatments = [...kinds, 'hatch'];
  const styleKeys = [...treatments, 'distance', 'ramp', 'palette'];
  const edgeName = [null, 'silhouette', 'crease', 'boundary', 'reserved', 'shadowEdge', 'hatch'];
  const SILHOUETTE = 1, CREASE = 2, BOUNDARY = 3, RESERVED = 4, SHADOW_EDGE = 5, HATCH = 6;
  const priority = [SILHOUETTE, BOUNDARY, CREASE, SHADOW_EDGE];
  const lineDefaults = { ...defaults, shadowEdge: { steps: 1, litSteps: 1, threshold: .4, minLightDelta: .06 } };
  const hatchDefaults = { steps: 1, strength: 1, direction: [.7071067811865475,.7071067811865475,0],
    spacing: .15, width: .22, lightRange: [.1,.45] };
  const luma = (r, g, b) => .30 * r + .55 * g + .15 * b;
  const packedLuma = color => luma(color >> 16, (color >> 8) & 255, color & 255);
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const dotAt = (values, i, vector) => values[i] * vector[0] + values[i+1] * vector[1] + values[i+2] * vector[2];

  function directionOf(value, name) {
    const length = Array.isArray(value) && value.length === 3 && Math.hypot(...value);
    if (!length || !Number.isFinite(length) || !value.every(Number.isFinite))
      throw new TypeError(name + ' needs a finite nonzero XYZ direction');
    return value.map(v => v / length);
  }

  function packed(value, palette) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    if (Number.isSafeInteger(value) && value >= 0 && value < palette.length) return palette[value];
    throw new TypeError('Ink colors must be #rrggbb or scene palette indices');
  }

  function colors(values, palette) {
    if (!Array.isArray(values) || !values.length || values.length > 64)
      throw new RangeError('Ink palettes need between one and 64 colors');
    return values.map(value => packed(value, palette));
  }

  function depthRange(value) {
    if (value === undefined || value === false) return value;
    if (!record(value) || Object.keys(value).some(key => key !== 'near' && key !== 'far') ||
        !Number.isFinite(value.near) || !Number.isFinite(value.far) || value.near < 0 || value.far < value.near)
      throw new RangeError('Ink distance needs finite scene units with 0 <= near <= far');
    return { near:value.near, far:value.far };
  }

  function lostRule(value) {
    if (value === false) return false;
    if (!record(value) || Object.keys(value).some(key => !['strength', 'lightness', 'contrast', 'distance'].includes(key)))
      throw new TypeError('Lost edges need strength, lightness, contrast or distance settings');
    const { strength = 1, lightness, contrast, distance } = value;
    if (!unit(strength)) throw new RangeError('Lost edge strength must be in 0–1');
    const range = (pair, name) => {
      if (pair === undefined) return;
      if (!Array.isArray(pair) || pair.length !== 2 || !unit(pair[0]) || !unit(pair[1]) || pair[0] > pair[1])
        throw new RangeError('Lost edge ' + name + ' needs two ascending values in 0–1');
      return pair.slice();
    };
    return { strength, lightness: range(lightness, 'lightness'), contrast: range(contrast, 'contrast'),
      distance: depthRange(distance) };
  }

  function lineRule(rule, palette, kind) {
    if (rule === false) return null;
    if (rule === true) return {};
    if (!record(rule))
      throw new TypeError('Ink line rules must be true, false, or an object');
    const { color, highlight, shadow, steps, litSteps, distance, strength, lost, contrast, mask,
      cosine, threshold, minLightDelta } = rule;
    if (![steps, litSteps].every(value => value === undefined || Number.isSafeInteger(value) && Math.abs(value) <= 64))
      throw new RangeError('Ink steps must be integers between -64 and 64');
    if (strength !== undefined && !unit(strength)) throw new RangeError('Ink line strength must be in 0–1');
    if (cosine !== undefined && (kind !== 'crease' || !Number.isFinite(cosine) || Math.abs(cosine) > 1))
      throw new RangeError('Ink crease cosine must be in -1–1');
    if (threshold !== undefined && (kind !== 'shadowEdge' || !unit(threshold) || threshold === 0) ||
        minLightDelta !== undefined && (kind !== 'shadowEdge' || !unit(minLightDelta)))
      throw new RangeError('Ink shadow edge threshold must be in (0, 1] and minLightDelta in [0, 1]');
    let adaptive;
    if (contrast !== undefined && contrast !== false) {
      if (kind !== 'silhouette' || !record(contrast) ||
          Object.keys(contrast).some(key => !['dark', 'light', 'minGain'].includes(key)))
        throw new TypeError('Silhouette contrast needs dark and light outline swatches');
      const dark = packed(contrast.dark, palette), light = packed(contrast.light, palette);
      const minGain = contrast.minGain ?? 0, a = packedLuma(dark), b = packedLuma(light);
      if (a >= b || !unit(minGain)) throw new RangeError('Silhouette contrast needs increasing values and minGain in [0, 1]');
      adaptive = { dark, light, a, b, gain: minGain * 255 };
    }
    let painted;
    if (mask !== undefined && mask !== false) {
      if (!record(mask) || mask.type !== 'indexed') throw new TypeError('Ink masks need an indexed paint raster');
      const effects = typeof SplatEffects === 'undefined' ? require('./splat-effects.js') : SplatEffects;
      painted = effects.prepareMask(mask);
    }
    return {
      ...(steps !== undefined && { steps }), ...(litSteps !== undefined && { litSteps }),
      ...(color !== undefined && { color:packed(color, palette) }),
      ...(highlight !== undefined && { highlight:packed(highlight, palette) }),
      ...(shadow !== undefined && { shadow:packed(shadow, palette) }),
      ...(distance !== undefined && { distance:depthRange(distance) }),
      ...(strength !== undefined && { strength }),
      ...(lost !== undefined && { lost:lostRule(lost) }),
      ...(contrast !== undefined && { contrast:adaptive }), ...(mask !== undefined && { mask:painted }),
      ...(cosine !== undefined && { cosine }), ...(threshold !== undefined && { threshold }),
      ...(minLightDelta !== undefined && { minLightDelta })
    };
  }

  function hatchRule(rule, palette) {
    if (rule === false) return null;
    if (rule === true) return {};
    if (!record(rule) || Object.keys(rule).some(key =>
      !['color','steps','strength','distance','direction','spacing','width','lightRange'].includes(key)))
      throw new TypeError('Ink hatch needs color, steps, strength, distance or stripe settings');
    const { direction, spacing, width, lightRange, ...paint } = rule;
    if (spacing !== undefined && (!Number.isFinite(spacing) || spacing <= 0) ||
        width !== undefined && (!unit(width) || width === 0) ||
        lightRange !== undefined && (!Array.isArray(lightRange) || lightRange.length !== 2 ||
          !unit(lightRange[0]) || !unit(lightRange[1]) || lightRange[0] > lightRange[1]))
      throw new RangeError('Ink hatch needs positive spacing, width in (0, 1] and an ascending light range in [0, 1]');
    return { ...lineRule(paint,palette,'hatch'), ...(direction !== undefined && { direction:directionOf(direction,'Ink hatch') }),
      ...(spacing !== undefined && { spacing }), ...(width !== undefined && { width }),
      ...(lightRange !== undefined && { lightRange:lightRange.slice() }) };
  }

  function stylePatch(style, palette, ramps) {
    if (!record(style)) throw new TypeError('Ink styles must be objects');
    const patch = {};
    for (const kind of kinds) if (style[kind] !== undefined) patch[kind] = lineRule(style[kind],palette,kind);
    if (style.hatch !== undefined) patch.hatch = hatchRule(style.hatch,palette);
    if (style.distance !== undefined) patch.distance = depthRange(style.distance);
    if (style.ramp !== undefined) patch.ramp = colors(style.ramp,palette);
    if (style.palette !== undefined) {
      if (!ramps.has(style.palette)) throw new RangeError('Unknown reserved palette ' + style.palette);
      patch.palette = style.palette;
    }
    return patch;
  }

  function applyStyle(base, patch) {
    const result = { ...base, ...patch };
    for (const kind of kinds) if (patch[kind]) result[kind] = { ...lineDefaults[kind], ...base[kind], ...patch[kind] };
    if (patch.hatch) result.hatch = { ...hatchDefaults, ...base.hatch, ...patch.hatch };
    return result;
  }

  function prepare(definition, palette, shot) {
    if (definition === false || !definition && !shot) return null;
    const settings = definition === true || definition == null ? {} : definition;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Expected an ink settings object');
    const {
      depthGap = .09, creaseCosine = .72, litAt = .38, suppressSameMaterial = true,
      light = [-.5, .8, .45], emissionThreshold = .25, fogThreshold = .25, materials = {}, reserved = {},
      occlusionSilhouettes = false, targets = []
    } = settings;
    if (!Number.isFinite(depthGap) || depthGap <= 0 ||
        ![creaseCosine, litAt].every(value => Number.isFinite(value) && Math.abs(value) <= 1) ||
        ![emissionThreshold, fogThreshold].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        typeof suppressSameMaterial !== 'boolean' || typeof occlusionSilhouettes !== 'boolean')
      throw new RangeError('Invalid selective ink thresholds or light direction');
    if (shot !== undefined && (!record(shot) ||
        Object.keys(shot).some(key => ![...styleKeys,'materials','targets'].includes(key))))
      throw new TypeError('Ink shot overrides need style, materials or targets');
    const ramps = new Map(Object.entries(reserved).map(([key, value]) => [key, colors(value, palette)]));
    const base = applyStyle(defaults, stylePatch(settings,palette,ramps));
    const materialPatches = entries => {
      if (!record(entries)) throw new TypeError('Ink materials need an object keyed by material name');
      return new Map(Object.entries(entries).map(([name, style]) => [name, stylePatch(style,palette,ramps)]));
    };
    const targetPatches = rows => {
      if (!Array.isArray(rows) || rows.length > 128) throw new TypeError('Use an array of up to 128 ink targets');
      return rows.map(target => {
        if (!record(target) || Object.keys(target).some(key => key !== 'select' && !styleKeys.includes(key)))
          throw new TypeError('Ink targets need a selector and ink settings');
        return { select:selectors.prepare(target.select), patch:stylePatch(target,palette,ramps) };
      });
    };
    const styles = new Map([...materialPatches(materials)].map(([name,patch]) => [name,applyStyle(base,patch)]));
    const scoped = targetPatches(targets);
    const shotBase = shot && stylePatch(shot,palette,ramps);
    const shotStyles = materialPatches(shot?.materials ?? {});
    const shotScoped = targetPatches(shot?.targets ?? []);
    const all = [base, ...styles.values(), ...scoped.map(row=>row.patch),
      ...shotStyles.values(), ...shotScoped.map(row=>row.patch), ...(shotBase ? [shotBase] : [])];
    const hasLostEdges = all.some(style => kinds.some(kind => style[kind]?.lost?.strength > 0));
    const usesBackdrop = hasLostEdges || all.some(style => style.silhouette?.contrast);
    const painted = all.some(style => kinds.some(kind => style[kind]?.mask));
    const needsLight = all.some(style => style.hatch || style.shadowEdge);
    const hatching = all.some(style => style.hatch);
    return { base, styles, scoped, shotBase, shotStyles, shotScoped, all, ramps, depthGap, creaseCosine, litAt,
      suppressSameMaterial, occlusionSilhouettes, light:directionOf(light,'Ink light'), emissionThreshold, fogThreshold,
      hasLostEdges, usesBackdrop, painted, needsLight, hatching };
  }

  function bind(settings, world, passes) {
    const { base, styles, scoped, shotBase, shotStyles, shotScoped } = settings;
    const { materials, objects, materialId, objectId, splatId, partId, parts } = passes;
    const resolve = (style, rows, target) => {
      for (const { select, patch } of rows) if (selectors.matches(select,target)) style = applyStyle(style,patch);
      return style;
    };
    const byId = materials.map((label,id) => {
      const key = String(label ?? id);
      const authored = styles.get(key) ?? base, shotMaterial = shotStyles.get(key);
      return { authored, shotMaterial, style:finish(authored,shotMaterial) };
    });
    const fallback = { authored:base, style:finish(base) };
    function finish(style, shotMaterial) {
      if (shotBase) style = applyStyle(style,shotBase);
      if (shotMaterial) style = applyStyle(style,shotMaterial);
      return style;
    }
    if (!scoped.length && !shotScoped.length) return p => (byId[materialId[p]] ?? fallback).style;
    const index = world && selectors.index(world), splats = new WeakMap(), surfaces = new Map();
    function at(target, row) {
      return resolve(finish(resolve(row.authored,scoped,target),row.shotMaterial),shotScoped,target);
    }
    return p => {
      const row = byId[materialId[p]] ?? fallback, i = splatId[p] - 1;
      const object = objects?.[objectId[p]], material = materials[materialId[p]], part = parts?.[partId?.[p]]?.part;
      if (index && i >= 0 && i < world.count) {
        const target = index.row(i);
        if ((material == null || target.material === material) && (object == null || target.object === object) &&
            (part == null || target.part === part)) {
          if (!splats.has(target)) splats.set(target,at(target,row));
          return splats.get(target);
        }
        return at({ ...target, ...(object != null && {object,entity:object}), material, part:part ?? target.part },row);
      }
      const key = [objectId[p],materialId[p],partId?.[p] ?? 0].join('/');
      if (!surfaces.has(key)) surfaces.set(key,at({ object, entity:object, material, part },row));
      return surfaces.get(key);
    };
  }

  function opacity(rule, shared, depth) {
    const strength = rule.strength ?? 1;
    const range = rule.distance ?? shared;
    if (!range) return strength;
    if (depth >= range.far) return 0;
    return depth <= range.near ? strength : strength * ((range.far-depth)/(range.far-range.near));
  }

  function smooth(low, high, value) {
    if (value <= low) return 0;
    if (value >= high) return 1;
    const t = (value - low) / (high - low);
    return t * t * (3 - 2 * t);
  }

  function losesBelow(range, value) {
    return range ? 1 - smooth(range[0], range[1], value) : 1;
  }

  function blend(a, b, weight) {
    if (weight === 0) return a;
    if (weight === 1) return b;
    const r = a >> 16, g = a >> 8 & 255, blue = a & 255;
    return Math.round(r+((b>>16)-r)*weight)*65536 +
      Math.round(g+((b>>8&255)-g)*weight)*256 + Math.round(blue+((b&255)-blue)*weight);
  }

  function closest(ramp, r, g, b) {
    let best = 0, score = Infinity;
    for (let i = 0; i < ramp.length; i++) {
      const color = ramp[i], dr = r - (color >> 16), dg = g - ((color >> 8) & 255), db = b - (color & 255);
      const candidate = .30 * dr * dr + .55 * dg * dg + .15 * db * db;
      if (candidate < score) {
        best = i;
        score = candidate;
      }
    }
    return best;
  }

  function apply(frame, passes, settings, palette, signals, { world, time = 0, depthOffset = 0, inspect } = {}) {
    const { w, h, rgb, alpha } = frame;
    const { depth, normal, geometricNormal = normal, objectId, materialId, emission, splatId,
      objectPosition, inkShadow } = passes;
    const mask = new Uint8Array(w * h);
    const { ramps, depthGap, creaseCosine, litAt, light, suppressSameMaterial, occlusionSilhouettes,
      usesBackdrop, needsLight } = settings;
    const styleAt = bind(settings,world,passes);
    const source = rgb.slice();
    const outputPalette = Array.from(frame.palette || palette);
    const known = new Map(outputPalette.map((color, index) => [color, index]));
    const counts = new Uint32Array(outputPalette.length);
    const additions = [];
    const neighbors = new Int32Array(4);
    const edgeTypes = usesBackdrop ? new Uint8Array(4) : null;
    const surface = settings.painted ? { position:null, worldPosition:null, time } : null;
    const shade = needsLight && Float32Array.from(depth,(z,p) => {
      const q = p * 3;
      if (!Number.isFinite(z) || emits(q) || !(normal[q] || normal[q+1] || normal[q+2])) return -1;
      return clamp(dotAt(normal,q,light),0,1) * (1 - (inkShadow?.[p] ?? 0));
    });

    function surfaceNeighbor(p,z) {
      return z >= 0 && Math.abs(depth[p] - depth[z]) <= depthGap &&
        materialId[p] === materialId[z] && objectId[p] === objectId[z];
    }

    function classify(p, z, q, id, material, style) {
      if (z < 0 || !Number.isFinite(depth[z])) return 1 << SILHOUETTE;
      const dz = depth[z] - depth[p], sameMaterial = material > 0 && materialId[z] === material;
      const differentObject = id !== objectId[z] && (id || objectId[z]);
      if (occlusionSilhouettes && differentObject && dz > depthGap) return 1 << SILHOUETTE;
      if (differentObject || (material !== materialId[z] && (material || materialId[z])))
        return (!suppressSameMaterial || !sameMaterial) && (dz > depthGap || (dz >= -depthGap && p < z)) ? 1 << BOUNDARY : 0;
      let edges = 0;
      if (style.crease && (!splatId[p] || splatId[p] !== splatId[z])) {
        const n = style.crease?.cosine !== undefined || !splatId[p] ? geometricNormal : normal;
        const a = z * 3, dot = n[q] * n[a] + n[q+1] * n[a+1] + n[q+2] * n[a+2];
        const hasNormals = (n[q] || n[q+1] || n[q+2]) && (n[a] || n[a+1] || n[a+2]);
        if (dz > depthGap || (dz >= -depthGap && p < z && hasNormals && dot < (style.crease?.cosine ?? creaseCosine)))
          edges |= 1 << CREASE;
      }
      const shadowEdge = style.shadowEdge;
      if (shadowEdge && Math.abs(dz) <= depthGap && shade[p] >= 0 && shade[p] < shadowEdge.threshold &&
          shade[z] >= shadowEdge.threshold && shade[z] - shade[p] >= shadowEdge.minLightDelta)
        edges |= 1 << SHADOW_EDGE;
      return edges;
    }

    function emits(q) {
      const amount = emission ? Math.max(emission[q], emission[q + 1], emission[q + 2]) : 0;
      return amount >= settings.emissionThreshold && amount > 0;
    }

    function stripes(phase,width) {
      const period = Math.floor(phase);
      return period * width + Math.min(width,phase - period);
    }

    function hatchWeight(p, q, rule) {
      if (!objectPosition || shade[p] < 0 || shade[p] >= rule.lightRange[1]) return 0;
      const { direction, spacing, width, lightRange } = rule;
      const phase = dotAt(objectPosition,q,direction) / spacing;
      let dx = 0, dy = 0, count = 0;
      for (let i = 0; i < 4; i++) {
        const z = neighbors[i];
        if (!surfaceNeighbor(p,z)) continue;
        const step = Math.abs(dotAt(objectPosition,z*3,direction) / spacing - phase);
        if (i < 2) dx = Math.max(dx,step);
        else dy = Math.max(dy,step);
        count++;
      }
      const footprint = dx + dy;
      if (!count || !Number.isFinite(phase) || footprint === 0 || footprint >= .75) return 0;
      const center = phase - Math.round(phase) + width/2;
      const coverage = clamp((stripes(center + footprint/2,width) - stripes(center - footprint/2,width))/footprint,0,1);
      return coverage * (1 - smooth(.35,.75,footprint)) * (1 - smooth(lightRange[0],lightRange[1],shade[p]));
    }

    function stepColor(style, steps, r, g, b) {
      if (style.ramp) return style.ramp[clamp(closest(style.ramp,r,g,b) - steps,0,style.ramp.length - 1)];
      const gain = Math.pow(.73,steps);
      return palette[closest(palette,r * gain,g * gain,b * gain)];
    }

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, q = p * 3;
      const id = objectId[p], material = materialId[p], style = styleAt(p);
      let edges = 0;
      if (Number.isFinite(depth[p])) {
        for (let i = 0; i < 4; i++) {
          const z = i === 0 ? (x > 0 ? p - 1 : -1) : i === 1 ? (x + 1 < w ? p + 1 : -1) :
            i === 2 ? (y > 0 ? p - w : -1) : (y + 1 < h ? p + w : -1);
          const edge = classify(p,z,q,id,material,style);
          edges |= edge;
          neighbors[i] = z;
          if (usesBackdrop) edgeTypes[i] = edge;
        }
      }
      const r = source[q], g = source[q + 1], b = source[q + 2];
      const original = (r << 16) | (g << 8) | b;
      let color = original;
      const signal = signals?.[p] > settings.fogThreshold ? 'fog' : null;
      const emitting = emits(q);
      const reserved = (emitting && ramps.get('emission')) || ramps.get(signal || style.palette);
      if (reserved) {
        const index = closest(reserved, r, g, b);
        color = reserved[index];
        if (inspect?.pixel === p) inspect.ink(reserved,index,[r,g,b],emitting && ramps.has('emission') ? 'emission' : signal ?? style.palette,1);
        mask[p] = RESERVED;
      } else if (Number.isFinite(depth[p])) {
        const distance = depth[p]-depthOffset;
        const hatch = style.hatch;
        if (hatch) {
          const weight = opacity(hatch,style.distance,distance) * hatchWeight(p,q,hatch);
          if (weight && (hatch.color !== undefined || hatch.steps)) {
            const ink = hatch.color ?? stepColor(style,hatch.steps,r,g,b);
            color = blend(original,ink,weight);
            if (color !== original) {
              mask[p] = HATCH;
              if (inspect?.pixel === p) inspect.ink([ink],0,[r,g,b],'hatch',weight);
            }
          }
        }
        if (surface && edges) {
          surface.position = passes.objectPosition?.subarray(q,q+3);
          surface.worldPosition = passes.position?.subarray(q,q+3);
        }
        for (const edge of priority) {
          if (!(edges & (1 << edge))) continue;
          const type = edgeName[edge], rule = style[type];
          if (!rule) continue;
          const paint = rule.mask ? rule.mask(surface) : 1;
          if (!paint) continue;
          const weight = opacity(rule,style.distance,distance) * paint;
          let merge = 0, neighborColor = 0;
          if (rule.lost?.strength && !emitting) {
            const { strength, lightness, contrast, distance:range } = rule.lost;
            const value = luma(r,g,b) / 255;
            const reach = paint * strength * losesBelow(lightness,value) *
              (range ? smooth(range.near,range.far,distance) : 1);
            if (reach > 0) for (let i = 0; i < 4; i++) {
              const z = neighbors[i];
              if (!(edgeTypes[i] & (1 << edge)) || z < 0 || alpha?.[z] === 0 || emits(z * 3)) continue;
              const a = z * 3, nr = source[a], ng = source[a + 1], nb = source[a + 2];
              const amount = reach * losesBelow(contrast,Math.abs(value - luma(nr,ng,nb) / 255));
              if (amount > merge) {
                merge = amount;
                neighborColor = (nr << 16) | (ng << 8) | nb;
              }
            }
          }
          if (!weight && !merge) continue;
          const lit = edge !== SHADOW_EDGE && ((normal[q] || normal[q + 1] || normal[q + 2]) ?
            dotAt(normal,q,light) >= litAt : luma(r, g, b) > 160);
          let explicit = (lit ? rule.highlight : rule.shadow) ?? rule.color;
          if (rule.contrast) {
            const { a,b,dark,light:bright,gain } = rule.contrast;
            let back = 0, count = 0;
            for (let i = 0; i < 4; i++) {
              const z = neighbors[i];
              if (!(edgeTypes[i] & (1 << edge)) || z < 0 || alpha?.[z] === 0) continue;
              back += luma(source[z*3],source[z*3+1],source[z*3+2]);
              count++;
            }
            if (count) {
              const background = back/count;
              const low = Math.abs(a-background), high = Math.abs(b-background);
              explicit = Math.max(low,high) >= Math.abs(luma(r,g,b)-background)+gain ?
                (low>=high?dark:bright) : original;
            }
          }
          const steps = lit ? rule.litSteps : rule.steps;
          const before = color;
          if (weight && (explicit !== undefined || steps)) {
            const line = explicit ?? stepColor(style,steps,r,g,b);
            if (inspect?.pixel === p)
              inspect.ink([line],0,[before >> 16,before >> 8 & 255,before & 255],type,weight);
            color = blend(before,line,weight);
          }
          if (merge) {
            if (inspect?.pixel === p)
              inspect.ink([neighborColor],0,[color >> 16,color >> 8 & 255,color & 255],'lost-' + type,merge);
            color = blend(color,neighborColor,merge);
          }
          if (color !== before) mask[p] = color === original ? 0 : edge;
          break;
        }
      }
      rgb[q] = color >> 16;
      rgb[q + 1] = (color >> 8) & 255;
      rgb[q + 2] = color & 255;
      let index = known.get(color);
      if (index === undefined) {
        index = outputPalette.length;
        known.set(color, index);
        outputPalette.push(color);
        additions.push(0);
      }
      if (index < counts.length) counts[index]++;
      else additions[index - counts.length]++;
    }
    const use = new Uint32Array(outputPalette.length);
    use.set(counts);
    use.set(additions, counts.length);
    return { ...frame, palette: outputPalette, use, inkMask: mask };
  }

  const channels = Object.freeze(['depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId']);
  return Object.freeze({ prepare, apply, channels, labels:Object.freeze(edgeName), treatments:Object.freeze(treatments), reservedCode:RESERVED });
})();
if (typeof module !== 'undefined') module.exports = ArtInk;
