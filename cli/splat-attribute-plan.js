'use strict';

const { createHash } = require('node:crypto');
const Provenance = require('../src/splat-provenance.js');
const Targets = require('../src/target-selectors.js');
const Fit = require('./splat-fit-asset.js');
const nearby = require('./splat-neighborhood.js');

const planFormat = 'ink-studio/splat-attribute-plan', maxRows = 32768;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const range = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
const integer = (value, lo, hi) => Number.isSafeInteger(value) && range(value, lo, hi);
const name = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const builtins = {
  position: { type: 'vec3' }, opacity: { type: 'number' }, pigment: { type: 'label' },
  normal: { type: 'vec3' }, variance: { type: 'number' }, object: { type: 'label' },
  material: { type: 'label' }, part: { type: 'label' }
};

function catalog(world, kit) {
  const A = kit.procedural.attributes;
  if (!integer(world?.count, 1, maxRows) || !(world.data instanceof Float32Array) || world.data.length < 16 * world.count)
    throw new RangeError('Splat attribute planning needs 1 to ' + maxRows + ' packed rows');
  const entities = A.entities('splat', world), owner = Targets.index(world).row, rows = [];
  const scan = world.gaussianHarmonics?.normals, authored = world.renderMetadata?.normals;
  for (let i = 0; i < world.count; i++) {
    const { id, point } = entities[i], q = i * 16, slot = i * 3;
    let n = authored && Array.from(authored.subarray(slot, slot + 3));
    if (!n?.some(Boolean) && scan) n = Array.from(scan.subarray(slot, slot + 3));
    const length = n ? Math.hypot(...n) : 0;
    const target = owner(i), attributes = { position: point, opacity: world.data[q + 3],
      pigment: Fit.pigmentAt(world, i), variance: world.data[q + 4] + world.data[q + 8] + world.data[q + 10],
      object: target.object ?? null, part: target.part ?? null, material: target.material ?? null,
      ...(length && { normal: n.map(value => value / length) }) };
    rows.push({ id, point, attributes, target, row: i });
  }
  return rows;
}

function attributes(rows, kit, retained) {
  const A = kit.procedural.attributes;
  const specs = { ...builtins };
  let source, byId;
  if (retained) {
    source = A.open(retained);
    if (source.domain !== 'splat' || source.entities.length > maxRows || source.channels.size > 105)
      throw new TypeError('Retained splat attributes need a bounded stable splat table');
    byId = new Map(source.entities.map(({ id }, i) => [id, i]));
    for (const [channel, slot] of source.channels) {
      if (Object.hasOwn(specs, channel)) continue;
      specs[channel] = { type: slot.type, interpolation: slot.interpolation };
    }
  }
  if (Object.keys(specs).length > 105) throw new RangeError('Splat attribute column budget exceeded');
  const value = rows.map(row => {
    const data = { ...(byId?.has(row.id) && source.read(byId.get(row.id))) };
    for (const channel of Object.keys(builtins)) delete data[channel];
    return { id: row.id, point: row.point, attributes: { ...data, ...row.attributes } };
  });
  return A.asset('splat', value, specs);
}

function selector(specification, columns, identities) {
  const { id, where = [], ids, exclude = [] } = specification ?? {};
  if (!fields(specification, ['id', 'where', 'ids', 'exclude']) || !name(id) || id === 'all' ||
      !Array.isArray(where) || where.length > 16)
    throw new RangeError('Invalid retained splat selection');
  function members(values) {
    if (!Array.isArray(values) || values.length > maxRows || new Set(values).size !== values.length ||
        !Array.from(values).every(value => identities.has(value)))
      throw new RangeError('Selections need unique IDs present in the target');
    return new Set(values);
  }
  const include = ids === undefined ? null : members(ids), excluded = members(exclude);
  const tests = where.map(condition => {
    const { channel, component, equals, min, max, exists } = condition ?? {};
    const column = columns.get(channel);
    const equality = Object.hasOwn(condition ?? {}, 'equals');
    const interval = min !== undefined || max !== undefined;
    if (!fields(condition, ['channel', 'component', 'equals', 'min', 'max', 'exists']) || !column ||
        component !== undefined && !integer(component, 0, column.size - 1) ||
        [equality, interval, exists !== undefined].filter(Boolean).length !== 1 ||
        equality && !(equals === null || ['string', 'boolean'].includes(typeof equals) || Number.isFinite(equals)) ||
        interval && (column.type === 'label' || column.size > 1 && component === undefined ||
          min !== undefined && !Number.isFinite(min) || max !== undefined && !Number.isFinite(max) ||
          min !== undefined && max !== undefined && min > max) ||
        exists !== undefined && typeof exists !== 'boolean')
      throw new RangeError('Invalid splat selection predicate for ' + channel);
    return values => {
      const value = component === undefined ? values[channel] :
        column.size === 1 ? values[channel] : values[channel]?.[component];
      if (exists !== undefined) return (value !== undefined) === exists;
      if (equality) return value === equals;
      return Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value <= max);
    };
  });
  return ({ id, values }) => (!include || include.has(id)) && !excluded.has(id) && tests.every(test => test(values));
}

function plan(world, definition, kit, load) {
  if (!fields(definition, ['format', 'version', 'target', 'attributes', 'selections', 'outliers', 'transfers', 'groups', 'rowEdits']) ||
      definition.format !== planFormat || definition.version !== 1)
    throw new TypeError('Use a version 1 splat attribute plan');
  const { target = { object: 'gaussian-cloud' }, selections = [], outliers = [], transfers = [],
    groups = [], rowEdits = [], attributes: attributePath } = definition;
  const limits = [[selections, 32], [outliers, 8], [transfers, 16], [groups, 32], [rowEdits, maxRows]];
  if (!fields(target, ['object', 'part']) || !Targets.name(target.object) || target.part !== undefined && !Targets.name(target.part) ||
      limits.some(([data, limit]) => !Array.isArray(data) || data.length > limit))
    throw new RangeError('Invalid target or over-budget splat attribute operations');
  const A = kit.procedural.attributes, all = catalog(world, kit);
  const base = attributes(all, kit, attributePath === undefined ? world.proceduralSplatAttributes : load(attributePath));
  const input = A.open(base);
  const eligible = all.filter(row => Targets.objectScope(target, row.target) && Fit.paintable(world, row.row))
    .map(row => ({ ...row, values: input.read(row.row) }));
  if (!eligible.length) throw new RangeError('No editable splats in the requested target');
  const byId = new Map(eligible.map(row => [row.id, row])), members = new Map([['all', eligible]]);
  for (const group of selections) {
    const test = selector(group, input.channels, byId);
    if (members.has(group.id)) throw new RangeError('Duplicate splat selection ' + group.id);
    members.set(group.id, eligible.filter(test));
  }
  function select(id = 'all') {
    if (!members.has(id)) throw new RangeError('Unknown splat selection ' + id);
    return members.get(id);
  }

  const spatial = nearby(eligible.map(row => row.point)), removed = new Set(), removalEvidence = [], weightEvidence = [];
  let visits = 0, queries = 0;
  function find(sampler, p, count, options) {
    const result = sampler(p, count, options);
    visits += result.visits;
    if (++queries > 300000 || visits > 16_000_000 || result.limited)
      throw new RangeError('Splat neighborhood budget exceeded. Reduce the selection or radius or simplify coincident donors.');
    return result.nearest;
  }
  for (const rule of outliers) {
    const { selection, radius, minNeighbors, protect } = rule ?? {};
    if (!fields(rule, ['selection', 'radius', 'minNeighbors', 'protect']) || !range(radius, .00001, 1e6) ||
        !integer(minNeighbors, 1, 32))
      throw new RangeError('Outlier removal needs a radius and minimum neighbor count');
    const pinned = new Set(protect === undefined ? [] : select(protect).map(row => row.id));
    const evidence = [], protectedOutliers = [];
    for (const row of select(selection)) {
      const hits = find(spatial, row.point, minNeighbors, { radius, coincident: false });
      if (hits.length >= minNeighbors) continue;
      const receipt = { id: row.id, neighbors: hits.length };
      if (pinned.has(row.id)) protectedOutliers.push(receipt);
      else { evidence.push(receipt); removed.add(row.id); }
    }
    removalEvidence.push({ selection: selection ?? 'all', radius, minNeighbors, removed: evidence, protected: protectedOutliers });
  }

  const weights = new Map();
  for (const transfer of transfers) {
    const { id, selection, source, channel, radius, neighbors = 4, fallback = 0 } = transfer ?? {};
    if (!fields(transfer, ['id', 'selection', 'source', 'channel', 'radius', 'neighbors', 'fallback']) || !name(id) ||
        weights.has(id) || !range(radius, .00001, 1e6) || !integer(neighbors, 1, 16) || !range(fallback, 0, 1))
      throw new RangeError('Invalid splat weight transfer');
    const donor = A.open(load(source)), slot = donor.channels.get(channel);
    if (!slot || slot.type !== 'number' || donor.entities.length > maxRows ||
        slot.values.some((value, i) => !slot.missing.has(i) && !range(value, 0, 1)))
      throw new RangeError('Transferred weights need a bounded retained numeric donor column in [0, 1]');
    const sample = nearby(donor.points), values = new Map(), rows = [];
    weights.set(id, { values, fallback });
    for (const row of select(selection)) {
      if (removed.has(row.id)) continue;
      const allHits = find(sample, row.point, neighbors, { radius, accept: i => !slot.missing.has(i) });
      const exact = allHits.filter(hit => hit.distance <= 1e-14), hits = exact.length ? exact : allHits;
      const inverse = hits.map(hit => exact.length ? 1 : 1 / hit.distance);
      const sum = inverse.reduce((acc, value) => acc + value, 0);
      const blend = inverse.map(n => n / sum);
      const result = A.blend(slot, hits.map(hit => hit.row), blend);
      const weight = result === undefined ? fallback : Math.max(0, Math.min(1, result));
      values.set(row.id, weight);
      rows.push({ id: row.id, weight, fallback: result === undefined,
        donors: hits.map((hit, i) => ({ id: donor.entities[hit.row].id, distance: Math.sqrt(hit.distance), factor: blend[i] })) });
    }
    weightEvidence.push({ id, source, channel, selection: selection ?? 'all', fallback, rows });
  }

  const nativeGroups = groups.map(group => {
    const { id, selection, weight, pivot, falloff, modifiers } = group ?? {};
    if (!fields(group, ['id', 'selection', 'weight', 'pivot', 'falloff', 'modifiers']) ||
        weight !== undefined && !weights.has(weight) && input.channels.get(weight)?.type !== 'number')
      throw new RangeError('A weighted deformation needs a transfer ID or a retained numeric column');
    const rows = select(selection).filter(row => !removed.has(row.id)).map(row => row.id);
    const blend = weights.get(weight);
    const mask = weight === undefined ? undefined : rows.map(member => {
      const value = blend ? blend.values.get(member) ?? blend.fallback : byId.get(member).values[weight] ?? 0;
      if (!range(value, 0, 1)) throw new RangeError('Retained deformation weight must be in [0, 1]');
      return [member, value];
    });
    return { id, pivot, members: rows, modifiers, ...(falloff !== undefined && { falloff }), ...(mask && { mask }) };
  });
  const changes = new Map([...removed].map(id => [id, { coverage: 0 }])), edited = new Set();
  for (const row of rowEdits) {
    const { id, ...change } = row ?? {};
    if (!byId.has(id) || removed.has(id) || edited.has(id) ||
        !fields(change, ['position', 'orientation', 'scale', 'opacity']) || !Object.keys(change).length)
      throw new RangeError('Row edits need a unique retained ID and an editable transform or opacity');
    edited.add(id);
    changes.set(id, change);
  }
  if (eligible.length === removed.size) throw new RangeError('Outlier removal would erase the entire target');
  const added = {};
  for (const [id, rows] of members) {
    const selected = new Set(rows.map(row => row.id));
    added['selection/' + id] = { type: 'label', values: all.map(row => selected.has(row.id)) };
  }
  for (const [id, { values, fallback }] of weights)
    added['weight/' + id] = { type: 'number', values: all.map(row => values.get(row.id) ?? fallback) };
  const columns = { ...base.channels, ...added };
  if (Object.keys(columns).length > 105) throw new RangeError('Splat attribute column budget exceeded');
  const data = A.asset('splat', base.entities, columns);
  const initial = { format: Fit.format, version: 2, target, edits: [], attributes: [...changes],
    sourceSignature: Fit.sourceSignature(world), retainedAttributesSha256: hash(data) };
  const { asset, report: deformation } = Fit.planSplatGroups(world, { target, groups: nativeGroups, base: initial });
  const report = { format: 'ink-studio/splat-attribute-report', version: 1, target, sourceRows: world.count,
    sourceSignature: asset.sourceSignature, selected: Object.fromEntries([...members].map(([id, rows]) => [id, rows.map(row => row.id)])),
    removed: [...removed], outliers: removalEvidence, transfers: weightEvidence,
    rowEdits: [...edited], deformation, work: { queries, visits } };
  return { asset, data, report };
}

module.exports = { plan, catalog, attributes, hash, maxRows };
