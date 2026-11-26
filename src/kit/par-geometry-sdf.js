/* Signed fields for native sculpt shapes, CSG, meshing and orthogonal sections. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, T = P.transforms;
  const { integer, range, vector, bounds, pixels, color, sliceAxes } = P.sceneGraphSupport;

  const metadata = new WeakMap();
  const emptyTags = Object.freeze({ objectId: '', materialId: '', color: null });
  const untagged = Object.freeze({ work: 1, objects: [], materials: [] });
  const info = source => metadata.get(source) ?? untagged;
  const evaluate = source => typeof source === 'function' ? source : source.sample.bind(source);
  function scalar(sample) {
    const value = typeof sample === 'number' ? sample : sample?.value;
    if (!Number.isFinite(value)) throw new RangeError('Signed distance sample must be finite');
    return value;
  }

  function field(sample, extent, { read, work = 1, objects = [], materials = [] } = {}) {
    if (work > 4096) throw new RangeError('Signed field exceeds its composition budget');
    const box = P.data.freeze(bounds(extent));
    metadata.set(sample, P.data.freeze({ read, work, objects, materials }));
    return Object.freeze(Object.assign(sample, { bounds: box }));
  }

  function extent(source, override) {
    return bounds(override ?? source?.bounds ?? (source?.lo && { min: source.lo, max: source.hi }));
  }

  function sampler(source, time = 0) {
    if (!P.graphTypes.validator('field')(source) || !Number.isFinite(time))
      throw new TypeError('Signed distance sampling needs a field and finite time');
    const sample = evaluate(source), { work } = info(source);
    let remaining = 120e6;
    return (x, y, z) => {
      remaining -= work;
      if (remaining < 0) throw new RangeError('Signed field exceeds its sampling work budget');
      return scalar(sample(x, y, z, time));
    };
  }

  function tagCatalog(sources, fallback = '') {
    const table = key => ['', ...(fallback ? [fallback] : []),
      ...[...new Set(sources.flatMap(source => info(source)[key]))].filter(label => label !== fallback).sort()];
    const objects = table('objects'), materials = table('materials');
    const index = ids => new Map(ids.map((id, i) => [id, i]));
    return { objects, materials, objectIndex: index(objects), materialIndex: index(materials) };
  }

  function tagSampler(source, time = 0) {
    const { read, work } = info(source);
    if (!read) return null;
    let remaining = 120e6;
    return (x, y, z) => {
      remaining -= work;
      if (remaining < 0) throw new RangeError('Signed field exceeds its attribute sampling work budget');
      return read(x, y, z, time);
    };
  }

  function tag(source, { objectId = '', materialId = '', color: pigment } = {}) {
    if (!P.graphTypes.validator('field')(source)) throw new TypeError('Surface attributes need a signed field');
    if (![objectId, materialId].every(id => typeof id === 'string' && id.length <= 100 && id.trim() === id))
      throw new RangeError('Signed field IDs need up to 100 characters without surrounding whitespace');
    if (Array.isArray(pigment) && pigment.length === 4) {
      if (pigment[3] !== 1) throw new RangeError('Signed-field pigment needs opaque sRGB');
      pigment = pigment.slice(0, 3);
    }
    const rgb = pigment === undefined ? null : P.data.freeze(color(pigment));
    const { read, work, objects, materials } = info(source), sample = evaluate(source);
    const apply = previous => ({ objectId: objectId || previous.objectId, materialId: materialId || previous.materialId,
      color: rgb ?? previous.color });
    const tagged = read ? (x, y, z, time) => apply(read(x, y, z, time)) : (() => {
      const fixed = Object.freeze(apply(emptyTags));
      return () => fixed;
    })();
    return field((x, y, z, time) => scalar(sample(x, y, z, time)), extent(source), {
      read: tagged, work: work + 1, objects: objectId ? [objectId] : objects, materials: materialId ? [materialId] : materials
    });
  }

  function shape(kind, { center = [0, 0, 0], radius = .7, half = [.6, .6, .6], round = 0,
    major = .68, minor = .19, length = 1, rotation = [0, 0, 0] } = {}) {
    if (!vector(center, 3) || !vector(rotation, 3)) throw new RangeError('SDF shape needs a finite center and rotation');
    const S = makeSculpt(makeBuilder(1, [0, 0xffffff])), held = { hold: true };
    const positive = n => range(n, .0001, 1e4);
    let dimensions, sd;
    if (kind === 'sphere' && positive(radius)) {
      dimensions = [radius, radius, radius];
      sd = S.ball([0, 0, 0], radius, null, held).sd;
    } else if (kind === 'box' && vector(half, 3) && half.every(positive) && range(round, 0, Math.min(...half))) {
      dimensions = half.slice();
      sd = S.box([0, 0, 0], half, null, { ...held, rd: round }).sd;
    } else if (kind === 'torus' && positive(major) && positive(minor) && minor < major) {
      dimensions = [major + minor, minor, major + minor];
      sd = S.torus([0, 0, 0], major, minor, null, held).sd;
    } else if (kind === 'capsule' && positive(length) && positive(radius)) {
      dimensions = [radius, length / 2 + radius, radius];
      // A capsule is the distance to a centered segment minus its radius.
      sd = (x, y, z) => Math.hypot(x, Math.max(0, Math.abs(y) - length / 2), z) - radius;
    } else if (kind === 'cylinder' && positive(length) && positive(radius)) {
      dimensions = [radius, length / 2, radius];
      sd = (x, y, z) => {
        const edge = Math.hypot(x, z) - radius, cap = Math.abs(y) - length / 2;
        return Math.hypot(Math.max(0, edge), Math.max(0, cap)) + Math.min(0, Math.max(edge, cap));
      };
    } else throw new RangeError('Invalid sphere, rounded box, torus, capsule or cylinder dimensions');
    const b = { min: dimensions.map(n => -n * 1.002), max: dimensions.map(n => n * 1.002) };
    const solid = field(sd, b);
    return center.some(Boolean) || rotation.some(Boolean) ? transformSDF(solid, { position: center, rotation }) : solid;
  }

  function transformSDF(source, { bounds: explicitBounds, ...options } = {}) {
    const pose = T.local(options), scale = T.distanceScale(pose), inverse = K.M.inv(pose.R), domain = extent(source, explicitBounds);
    if (!P.graphTypes.validator('field')(source)) throw new TypeError('Transform needs a signed field');
    const sample = evaluate(source), { read, work, objects, materials } = info(source);
    const local = fn => (x, y, z, time) => {
      const a = x - pose.t[0], b = y - pose.t[1], c = z - pose.t[2];
      return fn(inverse[0] * a + inverse[1] * b + inverse[2] * c,
        inverse[3] * a + inverse[4] * b + inverse[5] * c, inverse[6] * a + inverse[7] * b + inverse[8] * c, time);
    };
    return field(local((x, y, z, time) => scalar(sample(x, y, z, time)) * scale), T.bounds(pose, domain),
      { read: read && local(read), work: work + 1, objects, materials });
  }

  function combine(sources, { operation = 'union' } = {}) {
    if (!Array.isArray(sources) || !integer(sources.length, operation === 'subtract' ? 2 : 1, 32) ||
        !['union', 'intersection', 'subtract'].includes(operation)) throw new RangeError('Invalid signed-field combination');
    return combineFields(sources, operation);
  }

  function combineFields(sources, operation) {
    const boxes = sources.map(source => extent(source));
    const union = operation === 'union', subtract = operation === 'subtract', fold = union ? Math.min : Math.max;
    const bound = boxes[0];
    if (!subtract) for (const box of boxes.slice(1)) for (let i = 0; i < 3; i++) {
      bound.min[i] = fold(bound.min[i], box.min[i]);
      bound.max[i] = -fold(-bound.max[i], -box.max[i]);
    }
    // A disjoint intersection is an empty field with a valid domain for consumers.
    if (bound.min.some((n, i) => n >= bound.max[i])) {
      const domain = extent(sources[0]);
      for (const box of boxes.slice(1)) for (let i = 0; i < 3; i++) {
        domain.min[i] = Math.min(domain.min[i], box.min[i]);
        domain.max[i] = Math.max(domain.max[i], box.max[i]);
      }
      Object.assign(bound, domain);
    }
    const evaluations = sources.map(evaluate), definitions = sources.map(info);
    const work = definitions.reduce((sum, item) => sum + item.work, 1);
    const take = (x, y, z, time, tags) => {
      let best = scalar(evaluations[0](x, y, z, time)), winner = 0;
      for (let i = 1; i < evaluations.length; i++) {
        const distance = scalar(evaluations[i](x, y, z, time)), candidate = subtract ? -distance : distance;
        if (union ? candidate < best : candidate > best) { best = candidate; winner = i; }
      }
      if (!tags) return best;
      const selected = definitions[winner].read?.(x, y, z, time);
      if (!subtract || winner === 0) return selected ?? emptyTags;
      const body = definitions[0].read?.(x, y, z, time) ?? emptyTags;
      return selected ? { objectId: body.objectId, materialId: selected.materialId || body.materialId,
        color: selected.color ?? body.color } : body;
    };
    return field((x, y, z, time) => take(x, y, z, time, false), bound, {
      work, read: definitions.some(item => item.read) ? (x, y, z, time) => take(x, y, z, time, true) : undefined,
      objects: (subtract ? definitions.slice(0, 1) : definitions).flatMap(item => item.objects),
      materials: definitions.flatMap(item => item.materials)
    });
  }

  function repeat(source, { count = [2, 1, 1], spacing = [1.5, 1.5, 1.5], center = [0, 0, 0], idPrefix = '' } = {}) {
    if (!vector(count, 3) || !count.every(n => integer(n, 1, 32)) || count[0] * count[1] * count[2] > 256 ||
        !vector(spacing, 3) || !spacing.every(n => range(n, .0001, 1e4)) || !vector(center, 3))
      throw new RangeError('Signed field repeat needs positive spacing and 1–256 copies, up to 32 per axis');
    if (typeof idPrefix !== 'string' || idPrefix.trim() !== idPrefix || idPrefix.length > 92)
      throw new RangeError('Signed field repeat needs an ID prefix up to 92 characters without surrounding whitespace');
    const copies = [];
    for (let z = 0; z < count[2]; z++) for (let y = 0; y < count[1]; y++) for (let x = 0; x < count[0]; x++) {
      const position = [x, y, z].map((n, axis) => center[axis] + (n - (count[axis] - 1) / 2) * spacing[axis]);
      const copy = transformSDF(source, { position });
      copies.push(idPrefix ? tag(copy, { objectId: idPrefix + '/' + x + '/' + y + '/' + z }) : copy);
    }
    return combineFields(copies, 'union');
  }

  function symmetry(source, { axis = 'x', plane = 0 } = {}) {
    const i = ['x', 'y', 'z'].indexOf(axis);
    if (i === -1 || !Number.isFinite(plane)) throw new RangeError('Signed field symmetry needs an axis and a finite plane');
    const position = [0, 0, 0], scale = [1, 1, 1];
    position[i] = 2 * plane;
    scale[i] = -1;
    return combineFields([source, transformSDF(source, { position, scale })], 'union');
  }

  function sdfMesh(source, { bounds: explicitBounds, time = 0, color: tint = '#b7bccb', ...options } = {}) {
    return K.sdf.toMesh(sampler(source, time), { ...options, bounds: extent(source, explicitBounds), color: color(tint) });
  }

  function facetedSDF(source,{bounds:explicitBounds,time=0,appearance={},...options}={}) {
    const plan=K.facets.fromSdf(sampler(source,time),{...options,bounds:extent(source,explicitBounds)});
    return {value:plan,mesh:K.facets.toMesh(plan,appearance)};
  }

  function slices(source, { width = 32, height = 32, count = 20, axis = 'z', bounds: explicitBounds, time = 0,
    level = 0, color: tint = '#b7bccb' } = {}) {
    const size = pixels(width, height, 131072);
    if (!integer(count, 1, 256) || size * count > 131072 || !Object.hasOwn(sliceAxes, axis) || !Number.isFinite(level))
      throw new RangeError('Invalid signed-field slice count, axis or level');
    const domain = extent(source, explicitBounds), sample = sampler(source, time);
    const center = domain.min.map((n, i) => (n + domain.max[i]) / 2);
    const [a, b, c] = sliceAxes[axis](domain.max.map((n, i) => n - domain.min[i])).map(Math.abs);
    const pixelSize = [a / width, b / height], spacing = c / count;
    const base = color(tint), tags = tagSampler(source, time);
    const { objects, materials, objectIndex, materialIndex } = tagCatalog([source]);
    const objectId = [], materialId = [];
    const rgb8 = new Map();
    function pixel(rgb) {
      if (!rgb8.has(rgb)) rgb8.set(rgb, [...rgb.map(n => Math.round(n * 255)), 255]);
      return rgb8.get(rgb);
    }
    const value = Array.from({ length: count }, (_, z) => {
      const data = new Uint8Array(size * 4), owners = new Uint16Array(size), paints = new Uint16Array(size);
      for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
        const point = sliceAxes[axis]([(x + .5 - width / 2) * pixelSize[0], (height / 2 - y - .5) * pixelSize[1],
          (z + .5 - count / 2) * spacing]).map((n, i) => n + center[i]);
        if (sample(...point) > level) continue;
        const surface = tags?.(...point) ?? emptyTags;
        data.set(pixel(surface.color ?? base), p * 4);
        owners[p] = objectIndex.get(surface.objectId);
        paints[p] = materialIndex.get(surface.materialId);
      }
      objectId.push({ width, height, data: owners, channels: 1 });
      materialId.push({ width, height, data: paints, channels: 1 });
      return { width, height, data, channels: 4 };
    });
    return { value, objectId, materialId, layout: { axis, pixelSize, spacing, center, objects, materials } };
  }

  function boundSDF(source, domain) {
    if (!P.graphTypes.validator('field')(source)) throw new TypeError('Bounds need a signed field');
    const sample = evaluate(source), { work, ...tags } = info(source);
    return field((x, y, z, time) => scalar(sample(x, y, z, time)), domain, { ...tags, work: work + 1 });
  }

  Object.assign(A, { shape, boundSDF, transformSDF, combineSDF: combine, sdfMesh, facetedSDF, sdfSlices: slices,
    repeatSDF: repeat, symmetrySDF: symmetry, tagSDF: tag, sdfTags: tagSampler, sdfTagCatalog: tagCatalog,
    sdfExtent: extent, sdfSampler: sampler });
  Object.assign(P.sceneGraphSupport, { sdfExtent: extent, sdfSampler: sampler, boundedSDF: field });
})(KIT);
