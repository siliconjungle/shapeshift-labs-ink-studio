/* Plan visible draw payloads before asking the residency scheduler to load them. */
(function(K) {
  const { chunks } = K.procedural;
  const integer = Number.isSafeInteger, name = value => typeof value === 'string' && value.length > 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const empty = Object.freeze([]);

  chunks.createSceneStream = function createSceneStream({
    budgetBytes, maxSplats, startsPerFrame = 2, concurrency = 2, maxPortals = 1, maxCandidates = 4096,
    query, load, release, sizeOf, splatsOf, projectedError, layers = {}, guardPixels = 0
  } = {}) {
    if (!integer(budgetBytes) || budgetBytes < 1 || !integer(maxSplats) || maxSplats < 1 ||
        !integer(maxPortals) || maxPortals < 0 || maxPortals > 16 || !integer(maxCandidates) || maxCandidates < 1 || !integer(guardPixels) || guardPixels < 0 || guardPixels > 4096)
      throw new RangeError('Scene streaming limits are invalid');
    if (typeof query !== 'function' || typeof load !== 'function' ||
        [sizeOf, splatsOf, release].some(fn => fn !== undefined && typeof fn !== 'function'))
      throw new TypeError('Scene streaming needs chunk query and load callbacks');
    const { targetPx = 2, hysteresis = .2 } = projectedError ?? {};
    if (projectedError != null && (typeof projectedError !== 'object' || Array.isArray(projectedError) ||
        !Number.isFinite(targetPx) || targetPx <= 0 || !Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 1))
      throw new RangeError('Projected chunk error needs a positive pixel target and hysteresis in [0, 1)');
    if (!layers || typeof layers !== 'object' || Array.isArray(layers)) throw new TypeError('Expected named chunk layer budgets');
    const layerLimits = new Map(Object.entries(layers).map(([id, value]) => {
      const { maxSplats = Infinity, splatsPerPixel = Infinity } = value ?? {};
      if (!name(id) || !value || typeof value !== 'object' || Array.isArray(value) || maxSplats !== Infinity && (!integer(maxSplats) || maxSplats < 0) ||
          typeof splatsPerPixel !== 'number' || !(splatsPerPixel >= 0))
        throw new RangeError('Chunk layer budgets need nonnegative splat and pixel-density caps');
      return [id, { maxSplats, splatsPerPixel }];
    }));
    const errorHistory = new Map();
    const { visibility } = chunks;
    let descriptions = new Map(), plan, published, disposed = false;
    const scheduler = chunks.createScheduler({
      budgetBytes, concurrency, startsPerFrame,
      describe: key => descriptions.get(key),
      load: ({ input }, context) => load(input, context),
      release: release && ((value, descriptor) => release(value, descriptor.input)),
      sizeOf(value, { input }) {
        const count = splatsOf ? splatsOf(value, input) : value?.splats?.count ?? value?.count ?? input.splats;
        if (!integer(count) || count < 0 || count > input.splats)
          throw new RangeError('Loaded chunk exceeds its frame splat reservation or has an invalid count');
        return sizeOf ? sizeOf(value, input) : input.bytes;
      }
    });
    const interest = scheduler.interest('scene-stream');
    function guard() {
      if (disposed) throw new Error('The scene stream has been disposed');
    }
    function levels(place, row) {
      if (!Array.isArray(row.levels) || !row.levels.length || row.levels.length > 16)
        throw new RangeError('Streaming chunks need one to sixteen levels');
      const ids = new Set();
      let prior = { bytes: 0, splats: 0 };
      const usesError = row.levels.some(level => level?.error !== undefined);
      return Array.from(row.levels, raw => {
        const { id, bytes, splats, revision, maxDistance = Infinity, error, input } = raw ?? {};
        if (!name(id) || ids.has(id) || !integer(bytes) || bytes < 1 || bytes < prior.bytes ||
            !integer(splats) || splats < 0 || splats < prior.splats || !(integer(revision) || name(revision)) ||
            !(maxDistance > 0) || typeof maxDistance !== 'number' ||
            usesError && (!Number.isFinite(error) || error < 0 || error > (prior.error ?? Infinity)))
          throw new TypeError('Chunk levels need unique IDs, a revision and increasing byte and splat reservations');
        const key = JSON.stringify([place, row.id, id]);
        const descriptor = Object.freeze({ key, place, chunk: row.id, level: id, bytes, splats, revision, error, layer: row.layer, input });
        ids.add(id);
        prior = descriptor;
        return { key, id, bytes, splats, maxDistance, error, revision: JSON.stringify([revision, splats]), input: descriptor };
      });
    }

    function viewsFor(place, camera, portals, limit) {
      if (!Array.isArray(portals) || portals.length > maxCandidates) throw new TypeError('Expected a bounded portal list');
      const ids = new Set();
      const options = [];
      for (const portal of portals) {
        const { id, to, opening } = portal ?? {};
        if (!name(id) || ids.has(id) || !name(to?.place)) throw new TypeError('Streaming portals need unique IDs and a destination place');
        ids.add(id);
        if (!limit || portal.active === false || opening == null || portal.from && portal.from.place !== place) continue;
        const projected = visibility.aperture(camera, opening);
        if (projected) options.push({ id: 'portal/' + id, portalId: id, place: to.place, opening, ...projected });
      }
      options.sort((a, b) => b.area - a.area || order(a.id, b.id));
      return [{ id: 'main', place, camera, window: visibility.screen },
        ...options.slice(0, limit).map(portal => {
          const { opening } = portal;
          return { ...portal, camera: visibility.camera({ ...camera, ...opening.camera(camera),
            observer: opening.point(camera.observer) }) };
        })].map(view => Object.freeze(view));
    }

    function discover(views, selected) {
      const candidates = new Map(), guarded = new Map();
      let count = 0;
      for (const view of views) {
        const { camera, window, opening, place } = view;
        const planes = visibility.frustum(camera, window, opening?.to);
        let guard;
        if (guardPixels) {
          if (!camera.pixelHeight) throw new TypeError('Chunk guard bands need camera.pixelHeight');
          const y = 2 * guardPixels / camera.pixelHeight, x = y / camera.aspect;
          const [left, right, bottom, top] = window;
          guard = visibility.frustum(camera, [left - x, right + x, bottom - y, top + y], opening?.to);
        }
        const rows = query(view);
        if (!Array.isArray(rows) || (count += rows.length) > maxCandidates)
          throw new RangeError('Scene stream query exceeds its candidate budget');
        const seen = new Set();
        for (const row of rows) {
          if (!name(row?.id) || seen.has(row.id) || row.layer !== undefined && !name(row.layer) || row.subjects !== undefined &&
              (!Array.isArray(row.subjects) || !Array.from(row.subjects).every(name)))
            throw new TypeError('Streaming chunks need unique IDs per view and optional subject IDs');
          seen.add(row.id);
          const box = visibility.bounds(row.bounds);
          const key = JSON.stringify([place, row.id]);
          if (!visibility.visible(box, planes)) {
            if (guard && visibility.visible(box, guard)) {
              for (const level of levels(place, row).reverse()) {
                const before = plan?.requests.get(level.key);
                if (before?.bytes === level.bytes && before.revision === level.revision &&
                    (resident(level) || scheduler.status(level.key).state === 'loading')) {
                  if (!guarded.has(key)) guarded.set(key, level);
                  break;
                }
              }
            }
            continue;
          }
          const variants = levels(place, row);
          const distance = visibility.distance(box, camera.observer);
          const density = layerLimits.get(row.layer)?.splatsPerPixel ?? Infinity;
          const screen = (projectedError && variants[0].error !== undefined) || density !== Infinity
            ? visibility.projected(box, camera, window) : undefined;
          const drawLimit = density === Infinity ? Infinity : Math.floor(density * screen.pixels);
          const chosen = selected.has(row.id) || Boolean(row.subjects?.some(id => selected.has(id)));
          const previous = candidates.get(key);
          if (previous) {
            if (previous.layer !== row.layer || previous.levels.length !== variants.length || variants.some((v, i) => {
              const old = previous.levels[i];
              return v.id !== old.id || v.bytes !== old.bytes || v.revision !== old.revision ||
                v.maxDistance !== old.maxDistance || v.error !== old.error;
            })) throw new Error('A visible chunk must describe the same levels in every view');
            previous.views.push(view.id);
            previous.distance = Math.min(previous.distance, distance);
            previous.selected ||= chosen;
            previous.scale = Math.max(previous.scale, screen?.scale ?? 0);
            previous.drawLimit = Math.min(previous.drawLimit, drawLimit);
          } else {
            candidates.set(key, { key, place, id: row.id, levels: variants, distance,
              selected: chosen, layer: row.layer, scale: screen?.scale ?? 0, drawLimit, views: [view.id] });
          }
        }
      }
      for (const key of candidates.keys()) guarded.delete(key);
      return { guarded, candidates: [...candidates.values()].sort((a, b) => Number(b.selected) - Number(a.selected) ||
        a.distance - b.distance || order(a.key, b.key)) };
    }

    function projectLevels(candidates, guarded) {
      const next = new Map();
      for (const key of guarded.keys()) if (errorHistory.has(key)) next.set(key, errorHistory.get(key));
      for (const candidate of candidates) {
        const { key, levels, scale } = candidate;
        if (!projectedError || levels[0].error === undefined) continue;
        const schema = JSON.stringify(levels.map(({ id, error, revision }) => [id, error, revision]));
        const old = errorHistory.get(key);
        let level = old?.schema === schema ? old.level : 0;
        const band = old?.schema === schema ? hysteresis : 0;
        while (level > 0 && levels[level - 1].error * scale <= targetPx * (1 - band)) level--;
        while (level < levels.length - 1 && levels[level].error * scale > targetPx * (1 + band)) level++;
        next.set(key, { schema, level });
        candidate.projectedLevel = level;
      }
      errorHistory.clear();
      for (const [key, value] of next) errorHistory.set(key, value);
    }

    function allocate(candidates, views, guarded) {
      let bytes = 0, splats = 0;
      const admitted = new Map(), layerSplats = new Map();
      function fit(candidate, level) {
        const old = admitted.get(candidate.key)?.level;
        const nextBytes = bytes - (old?.bytes ?? 0) + level.bytes;
        const delta = (level.splats - (old?.splats ?? 0)) * candidate.views.length;
        const nextSplats = splats + delta;
        const layerCount = (layerSplats.get(candidate.layer) ?? 0) + delta;
        if (nextBytes > budgetBytes || nextSplats > maxSplats || level.splats > candidate.drawLimit ||
            layerCount > (layerLimits.get(candidate.layer)?.maxSplats ?? Infinity)) return false;
        layerSplats.set(candidate.layer, layerCount);
        bytes = nextBytes;
        splats = nextSplats;
        admitted.set(candidate.key, { candidate, level });
        return true;
      }
      function upgrade(candidate) {
        if (!admitted.has(candidate.key)) return;
        for (let i = candidate.selected ? candidate.levels.length - 1 : candidate.projectedLevel ?? candidate.levels.length - 1; i > 0; i--) {
          const level = candidate.levels[i];
          if ((candidate.selected || candidate.projectedLevel !== undefined || candidate.distance <= level.maxDistance) && fit(candidate, level)) break;
        }
      }
      // Give each live view a base before spending the budget on refinements.
      for (const view of views) {
        const first = candidates.find(candidate => candidate.views.includes(view.id));
        if (first && !admitted.has(first.key)) fit(first, first.levels[0]);
      }
      for (const candidate of candidates) {
        if (!candidate.selected) break;
        if (!admitted.has(candidate.key)) fit(candidate, candidate.levels[0]);
        upgrade(candidate);
      }
      for (const candidate of candidates) if (!admitted.has(candidate.key)) fit(candidate, candidate.levels[0]);
      for (const candidate of candidates) if (!candidate.selected) upgrade(candidate);

      // Keep a resident coarse level until its upgrade is available if the
      // extra residency fits. It replaces the planned draw while loading.
      let fallbackBytes = 0;
      const requests = new Map();
      for (const entry of admitted.values()) requests.set(entry.level.key, entry.level);
      for (const entry of admitted.values()) {
        const { candidate, level } = entry;
        if (resident(level)) continue;
        for (const lower of candidate.levels.slice(0, candidate.levels.indexOf(level)).reverse()) {
          if (!resident(lower) || bytes + fallbackBytes + lower.bytes > budgetBytes) continue;
          entry.fallback = lower;
          requests.set(lower.key, lower);
          fallbackBytes += lower.bytes;
          break;
        }
      }
      let guardedBytes = 0, retained = 0;
      for (const level of guarded.values()) {
        if (bytes + fallbackBytes + guardedBytes + level.bytes > budgetBytes) continue;
        requests.set(level.key, level);
        guardedBytes += level.bytes;
        retained++;
      }
      return { admitted, requests, bytes, splats, fallbackBytes, guardedBytes, retained, layerSplats };
    }
    function resident(level) {
      const entry = scheduler.get(level.key);
      return entry?.descriptor.revision === level.revision && entry.descriptor.bytes === level.bytes ? entry : null;
    }

    function advance({ place, camera, portals = [], selected = [], portalLimit = maxPortals } = {}) {
      guard();
      if (!name(place) || !Array.isArray(selected) || !Array.from(selected).every(name) ||
          !integer(portalLimit) || portalLimit < 0)
        throw new TypeError('Scene streaming needs a place and optional selected subject IDs');
      const views = viewsFor(place, visibility.camera(camera), portals, Math.min(portalLimit, maxPortals));
      const { candidates, guarded } = discover(views, new Set(selected));
      projectLevels(candidates, guarded);
      const allocation = allocate(candidates, views, guarded);
      const { requests } = allocation;
      const refresh = [...requests].some(([key, row]) => {
        const old = descriptions.get(key);
        return old && (old.bytes !== row.bytes || old.revision !== row.revision);
      });
      descriptions = requests;
      interest.update([...requests.keys()].map((key, i) => ({ key, priority: -i })));
      if (refresh) scheduler.refresh();
      scheduler.advance();
      plan = { views, visible: candidates.length, ...allocation };
      published = undefined;
      return snapshot();
    }

    function snapshot() {
      const state = scheduler.snapshot();
      if (published?.state === state && published.plan === plan) return published.result;
      const byView = new Map(plan?.views.map(view => [view.id, []]));
      let ready = 0, fallback = 0, drawSplats = 0;
      const drawsByLayer = new Map();
      for (const { candidate, level, fallback: backup } of plan?.admitted.values() ?? empty) {
        const current = resident(level), entry = current ?? (backup && resident(backup));
        if (!entry) continue;
        if (current) ready++;
        else fallback++;
        const descriptor = (current ? level : backup).input;
        const count = descriptor.splats * candidate.views.length;
        drawSplats += count;
        drawsByLayer.set(candidate.layer, (drawsByLayer.get(candidate.layer) ?? 0) + count);
        const errorPx = candidate.projectedLevel === undefined ? undefined : descriptor.error * candidate.scale;
        const row = Object.freeze({ ...descriptor, value: entry.value, fallback: !current, ...(errorPx !== undefined && { errorPx }) });
        for (const id of candidate.views) byView.get(id).push(row);
      }
      const result = Object.freeze({ sequence: state.sequence, views: Object.freeze((plan?.views ?? empty).map(view =>
        Object.freeze({ ...view, entries: Object.freeze(byView.get(view.id)) }))),
        budget: Object.freeze({ maxSplats, budgetBytes, startsPerFrame, drawSplats, ready, fallback,
          visible: plan?.visible ?? 0, admitted: plan?.admitted.size ?? 0, plannedSplats: plan?.splats ?? 0,
          plannedBytes: plan?.bytes ?? 0, fallbackBytes: plan?.fallbackBytes ?? 0, guardedBytes: plan?.guardedBytes ?? 0, retained: plan?.retained ?? 0,
          layers: Object.freeze(Object.fromEntries([...layerLimits].map(([id, limits]) => [id, Object.freeze({
            ...limits, plannedSplats: plan?.layerSplats.get(id) ?? 0, drawSplats: drawsByLayer.get(id) ?? 0
          })]))) })
      });
      published = { state, plan, result };
      return result;
    }

    return Object.freeze({ advance, snapshot, stats: scheduler.stats,
      status: scheduler.status,
      failures() {
        return [...(plan?.admitted.values() ?? empty)].flatMap(({ level }) => {
          const { state, error } = scheduler.status(level.key);
          return state === 'failed' ? [{ chunk: level.input.chunk, level: level.id, message: error?.message ?? String(error) }] : [];
        });
      },
      ready(options) { guard(); return interest.ready({ ...options, keys: [...(plan?.admitted.values() ?? empty)].map(entry => entry.level.key) }); },
      retry() { guard(); scheduler.refresh(); },
      dispose() {
        if (disposed) return;
        disposed = true;
        scheduler.dispose();
        descriptions.clear();
        errorHistory.clear();
        plan = published = undefined;
      }
    });
  };
})(KIT);
