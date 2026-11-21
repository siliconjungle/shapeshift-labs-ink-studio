// Pack pixel art for depth-tested, world-space surfaces.
const SpriteSurface = (() => {
  const slips = Symbol.for('ink-studio.spriteSurface.uvSlip');
  const namedFaces = new WeakMap(), sampledAtlases = new WeakMap();
  const resampling = typeof PaletteResampling === 'undefined' ? require('./palette-resampling.js') : PaletteResampling;

  function make(width = 1024, limit = 4096) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(limit) || limit < 1)
      throw new RangeError('Expected positive atlas dimensions');
    let x = 0, y = 0, shelf = 0;
    const entries = [], vertices = [];
    const regions = new WeakSet();
    const faces = new Map(), sampling = [];
    const geometry = typeof TexturedSurface !== 'undefined' ? TexturedSurface : require('./textured-surface.js');
    function reserve(w, h, paint) {
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || w > width || h < 1 ||
        paint !== undefined && typeof paint !== 'function')
        throw new RangeError('Expected bounded sprite dimensions and an optional paint function');
      let nextX = x, nextY = y, nextShelf = shelf;
      if (nextX + w > width) { nextX = 0; nextY += nextShelf; nextShelf = 0; }
      if (nextY + h > limit) throw new RangeError('Sprite surface atlas is full');
      const pixels = new Uint8Array(w * h * 4);
      if (paint) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const ink = paint(i, j);
        if (ink == null) continue;
        if (!Number.isSafeInteger(ink) || ink < 0 || ink > 0xffffff)
          throw new RangeError('Surface paint must return RGB hex or a transparent pixel');
        pixels.set([(ink >>> 16) & 255, (ink >>> 8) & 255, ink & 255, 255], (j * w + i) * 4);
      }
      const region = Object.freeze({ x: nextX, y: nextY, width: w, height: h });
      regions.add(region);
      entries.push({ x: nextX, y: nextY, w, h, pixels });
      x = nextX + w;
      y = nextY;
      shelf = Math.max(nextShelf, h);
      return region;
    }
    function faceOptions(options) {
      if (options === undefined) return {};
      const { id, sampling } = options ?? {};
      if (!options || ![Object.prototype,null].includes(Object.getPrototypeOf(options)) ||
          Object.keys(options).some(key => !['id', 'sampling'].includes(key)) ||
          id !== undefined && (typeof id !== 'string' || !id.trim() || faces.has(id)))
        throw new TypeError('A named surface needs a distinct nonempty ID and optional palette sampling');
      return { id, rule: resampling.settings(sampling) };
    }
    function writeMesh(surface, region, { id, rule }) {
      const { x, y, width, height } = region;
      const first = vertices.length / 5, count = surface.triangles.length;
      if (id !== undefined) faces.set(id, { first, count, from: region });
      if (rule && count) sampling.push({ first, end: first + count, region, rule });
      for (const index of surface.triangles) {
        vertices.push(surface.points[index * 3], surface.points[index * 3 + 1], surface.points[index * 3 + 2],
          x + .5 + (width - 1) * surface.uvs[index * 2], y + .5 + (height - 1) * surface.uvs[index * 2 + 1]);
      }
      return surface;
    }
    function mesh(surface, w, h, paint, options) {
      geometry.validate(surface);
      if (typeof paint !== 'function') throw new RangeError('Expected a surface paint function');
      const settings = faceOptions(options);
      return writeMesh(surface, reserve(w, h, paint), settings);
    }
    function meshRegion(surface, region, options) {
      geometry.validate(surface);
      if (!regions.has(region)) throw new RangeError('Reserve the surface region in this atlas first');
      return writeMesh(surface, region, faceOptions(options));
    }
    function quad(origin, right, up) {
      if (![origin, right, up].every(v => v && v.length === 3 && Array.from(v).every(Number.isFinite)))
        throw new RangeError('Expected a finite surface frame');
      const points = [];
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]])
        points.push(...Array.from(origin, (n, k) => n + right[k] * u + up[k] * (1 - v)));
      return { points, uvs: [0, 0, 1, 0, 0, 1, 1, 1], triangles: [0, 1, 2, 2, 1, 3] };
    }
    function face(origin, right, up, w, h, paint, options) {
      mesh(quad(origin, right, up), w, h, paint, options);
    }
    function faceRegion(origin, right, up, region, options) {
      meshRegion(quad(origin, right, up), region, options);
    }
    function finish() {
      const height = Math.max(1, y + shelf), pixels = new Uint8Array(width * height * 4);
      for (const e of entries) for (let row = 0; row < e.h; row++) {
        pixels.set(e.pixels.subarray(row * e.w * 4, (row + 1) * e.w * 4), ((row + e.y) * width + e.x) * 4);
      }
      const atlas = { width, height, pixels, vertices: Float32Array.from(vertices) };
      if (faces.size) namedFaces.set(atlas, new Map(faces));
      if (sampling.length) atlas.paletteSampling = sampling.slice();
      return atlas;
    }
    return { face, mesh, finish, reserve, meshRegion, faceRegion };
  }
  const updates = new WeakMap();
  function markDirty(atlas, rect = { x: 0, y: 0, width: atlas.width, height: atlas.height }) {
    checkRect(atlas, rect);
    const revision = (atlas.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision) || revision < 1) throw new RangeError('Invalid atlas revision');
    atlas.revision = revision;
    if (!updates.has(atlas)) updates.set(atlas, []);
    const history = updates.get(atlas); history.push({ revision, ...rect });
    if (history.length > 32) history.shift();
    return revision;
  }
  function checkRect(atlas, rect, message = 'Invalid atlas update rectangle') {
    if (!rect || !Number.isSafeInteger(rect.x) || !Number.isSafeInteger(rect.y) || !Number.isSafeInteger(rect.width) || !Number.isSafeInteger(rect.height) ||
      rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > atlas.width || rect.y + rect.height > atlas.height)
      throw new RangeError(message);
  }

  function uvSlip(atlas, edits = []) {
    const { vertices, width, height } = atlas ?? {};
    if (!(vertices instanceof Float32Array) || vertices.length % 15 ||
        ![width, height].every(n => Number.isSafeInteger(n) && n > 0) ||
        !Array.isArray(edits) || edits.length > 1024)
      throw new RangeError('UV slip needs an atlas and up to 1024 edits');
    const names = namedFaces.get(atlas);
    const ranges = Array.from(edits, edit => {
      if (!edit || Object.getPrototypeOf(edit) !== Object.prototype ||
          Object.keys(edit).some(key => !['face', 'first', 'count', 'from', 'to', 'cells', 'flipU', 'flipV'].includes(key)))
        throw new TypeError('Invalid UV slip edit');
      const { face, flipU = false, flipV = false, cells } = edit;
      const named = face === undefined ? undefined : names?.get(face);
      if (face !== undefined && (!named || edit.first !== undefined || edit.count !== undefined))
        throw new RangeError('UV slip needs a named face or an explicit vertex range');
      const { first, count } = named ?? edit;
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || first < 0 || count < 3 ||
          first % 3 || count % 3 || first + count > vertices.length / 5 ||
          typeof flipU !== 'boolean' || typeof flipV !== 'boolean')
        throw new RangeError('UV slip needs a triangle-aligned range and boolean flips');
      const from = edit.from ?? named?.from;
      checkRect(atlas, from, 'Invalid UV slip source rectangle');
      let to = edit.to ?? from;
      if (cells !== undefined) {
        if (edit.to !== undefined || !Array.isArray(cells) || cells.length !== 2 ||
            !Array.from(cells).every(Number.isSafeInteger))
          throw new RangeError('Use an atlas destination or an integer XY cell offset');
        to = { ...from, x: from.x + cells[0] * from.width, y: from.y + cells[1] * from.height };
      }
      checkRect(atlas, to, 'Invalid UV slip destination rectangle');
      const u = slipAxis(from.x, from.width, to.x, to.width, flipU);
      const v = slipAxis(from.y, from.height, to.y, to.height, flipV);
      return Object.freeze({ first, end: first + count,
        transform: Object.freeze([u[0], v[0], u[1], v[1]]),
        bounds: Object.freeze([to.x, to.y, to.x + to.width - 1, to.y + to.height - 1]) });
    }).sort((a, b) => a.first - b.first);
    if (ranges.some((range, i) => i && ranges[i - 1].end > range.first))
      throw new RangeError('UV slip ranges must not overlap');
    if (ranges.length)
      Object.defineProperty(atlas, slips, {
        configurable: true, value: Object.freeze({ vertices, width, height, ranges: Object.freeze(ranges) })
      });
    else delete atlas[slips];
  }

  function slipAxis(from, span, to, size, flip) {
    if (span === 1) return [0, to + size * .5];
    const scale = (size - 1) / (span - 1) * (flip ? -1 : 1);
    return [scale, to + .5 + (flip ? size - 1 : 0) - (from + .5) * scale];
  }
  function update(atlas, rect, { w, h, rgba } = {}) {
    checkRect(atlas, rect);
    if (!(atlas.pixels instanceof Uint8Array) || atlas.pixels.length !== atlas.width * atlas.height * 4 ||
      w !== rect.width || h !== rect.height || !(rgba instanceof Uint8Array) || rgba.length !== w * h * 4)
      throw new RangeError('A surface update needs a matching top-down RGBA raster');
    const revision = markDirty(atlas, rect);
    for (let row = 0; row < h; row++) {
      const start = ((rect.y + row) * atlas.width + rect.x) * 4;
      atlas.pixels.set(rgba.subarray(row * w * 4, (row + 1) * w * 4), start);
    }
    return revision;
  }
  function updatesSince(atlas, revision) {
    if (revision === (atlas.revision ?? 0)) return [];
    const rows = (updates.get(atlas) ?? []).filter(row => row.revision > revision);
    return rows[0]?.revision === revision + 1 && rows.at(-1).revision === atlas.revision ? rows.map(row => ({ ...row })) : null;
  }
  function samplingPlan(atlas) {
    const rules = atlas.paletteSampling;
    if (rules === undefined) return null;
    const { vertices, width, height, pixels, revision = 0 } = atlas;
    const count = vertices.length / 5, slip = atlas[slips];
    const changes = slip?.vertices === vertices && slip.width === width && slip.height === height ? slip.ranges : [];
    const cached = sampledAtlases.get(atlas);
    if (cached && cached.rules === rules && cached.slip === slip && cached.revision === revision &&
        cached.vertices === vertices && cached.pixels === pixels && cached.width === width && cached.height === height)
      return cached.ranges;
    if (!Array.isArray(rules) || rules.length > 1024) throw new RangeError('An atlas supports up to 1024 palette sampling ranges');
    let previous = 0;
    const checked = Array.from(rules, entry => {
      const { first, end, region, rule } = entry ?? {};
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || first % 3 || end % 3 ||
          first < previous || end <= first || end > count) throw new RangeError('Invalid atlas palette sampling ranges');
      checkRect(atlas, region, 'Invalid palette sampling region');
      previous = end;
      return { first, end, region, rule: resampling.settings(rule) };
    });
    const points = [...new Set([0, count, ...checked.flatMap(r => [r.first,r.end]), ...changes.flatMap(r => [r.first,r.end])])].sort((a,b) => a-b);
    const tables = new Map(), ranges = [];
    let recipeIndex = 0, slipIndex = 0, budget = 1048576;
    for (let i = 0; i + 1 < points.length; i++) {
      const first = points[i], end = points[i + 1];
      while (checked[recipeIndex]?.end <= first) recipeIndex++;
      while (changes[slipIndex]?.end <= first) slipIndex++;
      const recipe = checked[recipeIndex], edit = changes[slipIndex];
      const shift = edit?.first <= first ? edit : undefined;
      let filter;
      if (recipe?.first <= first && recipe.rule) {
        const [x, y, right, bottom] = shift?.bounds ?? [];
        const region = shift ? { x, y, width:right - x + 1, height:bottom - y + 1 } : recipe.region;
        const key = JSON.stringify([region.x, region.y, region.width, region.height, recipe.rule]);
        if (!tables.has(key)) {
          budget -= (region.width + 1) * (region.height + 1);
          if (budget < 0) throw new RangeError('Palette sampling exceeded the atlas prefix-table budget');
          const compiled = resampling.compile(atlas, region, recipe.rule);
          tables.set(key, { ...compiled, sample: resampling.sampler(compiled) });
        }
        filter = tables.get(key);
      }
      ranges.push({ first, end, shift, filter });
    }
    sampledAtlases.set(atlas, { rules, slip, revision, vertices, pixels, width, height, ranges });
    return ranges;
  }

  const geometryUpdates=new WeakMap();
  function markGeometryDirty(atlas,{first=0,count=atlas?.vertices?.length/5}={}) {
    if(!(atlas?.vertices instanceof Float32Array)||atlas.vertices.length%15||!Number.isSafeInteger(first)||!Number.isSafeInteger(count)||first<0||count<1||first%3||count%3||(first+count)*5>atlas.vertices.length||!atlas.vertices.subarray(first*5,(first+count)*5).every(Number.isFinite))
      throw new RangeError('Invalid surface geometry range');
    const revision=(atlas.geometryRevision??0)+1;
    if(!Number.isSafeInteger(revision)||revision<1)throw new RangeError('Invalid surface geometry revision');
    atlas.geometryRevision=revision;
    if(!geometryUpdates.has(atlas))geometryUpdates.set(atlas,[]);
    const history=geometryUpdates.get(atlas);history.push({revision,first,count});if(history.length>32)history.shift();
    return revision;
  }
  function geometryUpdatesSince(atlas,revision){
    if(revision===(atlas.geometryRevision??0))return [];
    const rows=(geometryUpdates.get(atlas)??[]).filter(r=>r.revision>revision);
    return rows[0]?.revision===revision+1&&rows.at(-1)?.revision===atlas.geometryRevision?rows.map(r=>({...r})):null;
  }
  return Object.freeze({ make, markDirty, updatesSince, update, markGeometryDirty, geometryUpdatesSince, uvSlip, samplingPlan, samplingGLSL: resampling.glsl });
})();
if (typeof module !== 'undefined') module.exports = SpriteSurface;
