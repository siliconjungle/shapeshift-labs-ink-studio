/* Project durable site-state receipts onto the current solid surfaces. */
(function (K) {
  const W = K.world, F = W.worldFacts, V = K.V;
  const { check, own, record } = W.data, { freeze } = K.procedural.data;
  const format = 'ink-studio/visual-consequences';
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const point = p => W.data.vector(p) && Array.from(p).every(n => bounded(n, -1e7, 1e7));
  const axis = p => point(p) && V.len(p) > 1e-7;

  function paintLayer(effect, site, palette, id) {
    const { kind, color, opacity = 1, select, normal, reach = .18, spacing } = effect;
    const colors = Array.isArray(color) ? color : [color];
    check(colors.length >= 1 && colors.length <= 8 && Array.from(colors).every(i =>
      Number.isSafeInteger(i) && i >= 0 && i < palette.length) && bounded(opacity, 0, 1) &&
      bounded(reach, .005, 3) && (normal === undefined || axis(normal)) &&
      (spacing === undefined || bounded(spacing, .02, 2)), 'Invalid paint settings for visual consequence ' + id);
    if (select !== undefined) TargetSelectors.prepare(select);
    const common = ['kind', 'color', 'opacity', 'select', 'normal', 'reach', 'spacing'];
    const shared = { kind, color, opacity, select, normal, reach };
    if (kind === 'trail') {
      const { path, width = .38 } = effect;
      check(fields(effect, [...common, 'path', 'width']) && Array.isArray(path) && path.length >= 2 && path.length <= 64 &&
        Array.from(path).every(point) && bounded(width, .02, 5), 'Invalid trail for visual consequence ' + id);
      const length = path.slice(1).reduce((sum, p, i) => sum + V.dist(p, path[i]), 0);
      check(bounded(length, .02, 120) && path.slice(1).every((p, i) => V.dist(p, path[i]) >= .001),
        'Trail needs distinct points and bounded length in visual consequence ' + id);
      return { ...shared, path, width, spacing: spacing ?? Math.max(.04, length / 600, width / 22) };
    }
    const { pattern, length = .8, width = .35, heading, point: at } = effect;
    check(kind === 'imprint' && fields(effect, [...common, 'pattern', 'point', 'heading', 'length', 'width']) &&
      ['soot', 'repair', 'tide-line', 'scuff'].includes(pattern) && [length, width].every(n => bounded(n, .01, 14)) &&
      (at === undefined ? point(site.at?.point) || W.data.id(site.at?.entity) : point(at)) &&
      (heading === undefined || axis(heading)), 'Invalid imprint or site location for visual consequence ' + id);
    return { ...shared, pattern, point: at, heading, length, width, spacing: spacing ?? Math.max(.03, length / 42, width / 30) };
  }

  function prepare(raw, world, palette) {
    if (raw === undefined || raw === false) return null;
    check(fields(raw, ['version', 'rules']) && raw.version === 1 && record(raw.rules) &&
      Object.keys(raw.rules).length <= 32 && record(world.siteHistory?.sites),
    'Visual consequences need version 1, site history and at most 32 rules');
    return Object.keys(raw.rules).sort().map(id => {
      const rule = raw.rules[id];
      check(PaintCorrections.idOK(id) && id.length <= 48 && fields(rule, ['site', 'field', 'visits', 'when', 'range', 'paint']) &&
        F.qualified(rule.site) && own(world.siteHistory.sites, rule.site) && (rule.visits === true ? rule.field === undefined :
          rule.visits === undefined && W.data.id(rule.field) && own(world.siteHistory.sites[rule.site].fields ?? {}, rule.field)) &&
        record(rule.paint),
      'Visual consequence ' + id + ' needs a known site and one state field or visits');
      const { site, field, visits, when, range } = rule, spec = world.siteHistory.sites[site];
      W.query.condition(when, undefined);
      check(range === undefined || (visits || ['number', 'integer'].includes(spec.fields[field])) &&
        Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[1] > range[0] &&
        Number.isFinite(range[1] - range[0]), 'Visual consequence ' + id + ' needs an increasing numeric opacity range');
      return { id, site, field, visits, when, range, layer: paintLayer(rule.paint, spec, palette, id) };
    });
  }

  function reference(view, row) {
    const result = { ...row, world: view.world.id, branch: W.committedEvents.branchAt(view.eventStream, row.tick) };
    return { ...result, beatId: W.inspectionLinks.identify(result) };
  }

  function sample(definition, view, query) {
    const active = [], sites = new Map();
    for (const rule of definition) {
      const { site, field, visits, when, range, id, layer } = rule;
      if (!sites.has(site)) sites.set(site, query.probe('world/site-history', undefined, { site }).value);
      const state = sites.get(site), records = view.siteHistory?.records;
      if (!state) continue;
      const ledger = visits && records && own(records, site) ? records[site] : undefined;
      const last = ledger?.visitors.at(-1)?.last;
      const receipt = visits ? ledger?.history.find(row => row.id === last) ??
        (last && { id: last, tick: F.eventTick(last) }) : state.consequences[field];
      if (!receipt) continue;
      const value = visits ? state.visits : receipt.value;
      if (!W.query.condition(when, value)) continue;
      const amount = layer.opacity * (range === undefined ? 1 : K.clamp((value - range[0]) / (range[1] - range[0]), 0, 1));
      if (amount <= 0) continue;
      const { id: event, tick, outcome, source, visit } = receipt;
      const change = reference(view, { id: event, tick, kind: visits ? 'site-visited' : 'site-changed', system: 'world' });
      const at = layer.kind === 'imprint' ? layer.point ?? state.at.point ??
        (state.at.entity && query.target({ entity: state.at.entity, socket: state.at.socket })?.point) : undefined;
      active.push({ layer: { ...layer, id: 'consequence-' + id, opacity: amount, ...(layer.kind === 'imprint' && { point: at }) },
        report: { id, site, ...(visits ? { visits: true } : { field }), value, amount, kind: layer.kind,
          ...(outcome && { outcome }), ...(at && { point: at }), ...(layer.path && { path: layer.path }), change,
          ...(source && { cause: reference(view, source) }), ...(visit && { visit: reference(view, { ...visit,
            kind: 'site-visited', system: 'world' }) }) } });
    }
    return active;
  }

  function paint(B, palette, view, active) {
    const ready = active.filter(({ layer }) => layer.kind === 'trail' || point(layer.point)), renderSdfs = B.renderSdfSources();
    const layers = ready.length && renderSdfs.length ?
      K.surfaceMarks.bake({ renderSdfs, pal: palette }, { layers: ready.map(row => row.layer), maxWork: 2400000 }).layers : [];
    const counts = new Map(layers.map(layer => [layer.id, layer.decals.length]));
    return {
      paint: layers.filter(layer => layer.decals.length),
      report: freeze({ format, version: 1, world: view.world.id, tick: view.tick, time: view.time,
        active: active.map(({ layer, report }) => {
          const samples = counts.get(layer.id) ?? 0;
          return { ...report, samples, status: samples ? 'painted' : layer.kind === 'imprint' && !point(layer.point) ?
            'missing-location' : 'no-surface' };
        }) })
    };
  }

  W.visualConsequences = Object.freeze({ format, prepare, sample, paint });
})(KIT);
