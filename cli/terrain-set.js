const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const files = require('./asset-files.js');

const format = 'ink-studio/terrain-stream';
const chunkFolder = 'tiles';
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const keyOf = at => at.join('/');
const match = (a, b) => a.every((n, i) => n === b[i]);
const ownFields = (o, allowed) => o && [Object.prototype, null].includes(Object.getPrototypeOf(o)) &&
  Object.keys(o).every(k => allowed.includes(k));
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const vector = (v, size, valid) => Array.isArray(v) && v.length === size && v.every(valid);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 1e6;
function need(ok, message) {
  if (!ok) throw new RangeError('Terrain command: ' + message);
}
function read(file, max = 24 * 1024 * 1024) {
  const stat = fs.statSync(file);
  need(stat.isFile() && stat.size <= max, 'input file exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeBake(source, directory, K) {
  const { id, grid, revision, tiles, report } = K.procedural.terrainSet.bake(source);
  const entries = tiles.map(tile => {
    const bytes = Buffer.from(JSON.stringify(tile) + '\n'), digest = hash(bytes);
    const file = chunkFolder + '/' + digest + '.json', target = path.join(directory, file);
    const existing = fs.statSync(target, { throwIfNoEntry: false });
    if (!existing?.isFile() || existing.size !== bytes.length || hash(fs.readFileSync(target)) !== digest)
      files.write(target, bytes);
    return { at: tile.at, digest, bytes: bytes.length, file, instances: tile.instances.length };
  });
  const manifest = { format, version: 1, id, grid, revision, tiles: entries };
  files.json(path.join(directory, 'build-report.json'), report);
  files.json(path.join(directory, 'manifest.json'), manifest);
  return { revision, tiles: entries.length, bytes: entries.reduce((n, row) => n + row.bytes, 0), ...report };
}

function readManifest(file, K) {
  const source = read(file, 4 * 1024 * 1024), { grid, tiles } = source;
  need(source?.format === format && source.version === 1 && id(source.id) && typeof source.revision === 'string' &&
    grid && vector(grid.origin, 2, coordinate) && vector(grid.size, 2, n => integer(n, 1, 128)) &&
    Number.isFinite(grid.cell) && grid.cell >= .025 && grid.cell <= 10 && integer(grid.tileCells, 2, 128) &&
    grid.size[0] * grid.size[1] <= 256 && Array.isArray(tiles) && tiles.length === grid.size[0] * grid.size[1],
  'invalid terrain stream manifest');
  const layout = K.procedural.chunks.grid({ dimensions: 2, size: grid.cell * grid.tileCells, origin: grid.origin });
  const entries = new Map();
  for (const row of tiles) {
    need(row && vector(row.at, 2, n => integer(n, 0, 127)) && row.at.every((n, k) => n < grid.size[k]) &&
      typeof row.digest === 'string' && /^[0-9a-f]{64}$/.test(row.digest) &&
      row.file === chunkFolder + '/' + row.digest + '.json' && integer(row.bytes, 1, 16 * 1024 * 1024) &&
      integer(row.instances, 0, 24000), 'invalid chunk receipt');
    const key = layout.key(source.id, row.at);
    need(!entries.has(key), 'duplicate chunk receipt');
    entries.set(key, row);
  }
  return { source, layout, entries, directory: path.dirname(file) };
}

async function stream(file, settings, K) {
  need(ownFields(settings, ['budgetBytes', 'concurrency', 'views']) && integer(settings.budgetBytes, 1, 256 * 1024 * 1024) &&
    integer(settings.concurrency ?? 2, 1, 8) && Array.isArray(settings.views) && integer(settings.views.length, 1, 64),
  'expected a byte budget and 1 to 64 views');
  const { source, layout, entries, directory } = readManifest(file, K);
  const { terrainSet, chunks } = K.procedural;
  const visited = new Set();
  const scheduler = chunks.createScheduler({ budgetBytes: settings.budgetBytes, concurrency: settings.concurrency,
    describe(key) {
      const row = entries.get(key);
      return row && { revision: row.digest, bytes: row.bytes, input: row };
    },
    async load({ input: row }, { signal }) {
      const name = path.join(directory, row.file), fd = await fs.promises.open(name, 'r');
      let bytes;
      try {
        const file = await fd.stat();
        need(file.isFile() && file.size === row.bytes, 'chunk byte count mismatch at ' + keyOf(row.at));
        const stored = Buffer.allocUnsafe(row.bytes);
        const { bytesRead } = await fd.read(stored, 0, row.bytes, 0);
        if (signal.aborted) throw new Error('Chunk load cancelled');
        need(bytesRead === row.bytes && hash(stored) === row.digest, 'chunk digest mismatch at ' + keyOf(row.at));
        bytes = stored;
      } finally {
        await fd.close();
      }
      const tile = JSON.parse(bytes);
      need(tile?.format === terrainSet.tileFormat && tile.version === 1 && tile.cell === source.grid.cell &&
        tile.tileCells === source.grid.tileCells && vector(tile.at, 2, Number.isSafeInteger) && match(row.at, tile.at) &&
        Array.isArray(tile.instances) && tile.instances.length === row.instances, 'chunk schema differs from receipt');
      for (const item of tile.instances) {
        need(item && typeof item.id === 'string' && vector(item.point, 3, coordinate) && id(item.prototypeId) && id(item.variant) &&
          Array.isArray(item.lods) && integer(item.lods.length, 1, 8) && item.lods.every((lod, i) =>
            lod && id(lod.asset) && Number.isFinite(lod.distance) && (i ? lod.distance > item.lods[i - 1].distance : lod.distance === 0)),
        'invalid resident instance or LOD table');
      }
      return tile;
    }
  });
  const interest = scheduler.interest('viewer'), knownNames = new Set();
  let prior = new Map();
  const views = [];
  try {
    for (const view of settings.views) {
      need(ownFields(view, ['id', 'at', 'radius']) && id(view.id) && !knownNames.has(view.id) &&
        vector(view.at, 2, coordinate) && integer(view.radius ?? 1, 0, 8), 'invalid view, radius or duplicate view ID');
      knownNames.add(view.id);
      const center = layout.index(view.at), radius = view.radius ?? 1, requests = [];
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const key = layout.key(source.id, [center[0] + dx, center[1] + dz]);
        if (entries.has(key)) requests.push({ key, priority: -Math.hypot(dx, dz) });
      }
      interest.update(requests);
      // Let the scheduler admit requests before waiting on the admitted subset.
      await Promise.resolve();
      const keys = requests.map(row => row.key), deferred = keys.filter(key => scheduler.status(key).state === 'budget');
      const blocked = new Set(deferred), ready = await interest.ready({ keys: keys.filter(key => !blocked.has(key)) });
      const current = new Map(), instances = [], levels = {};
      for (const { key, value } of ready) {
        const { at, file, bytes, digest } = entries.get(key);
        current.set(key, { at, file, bytes, digest });
        visited.add(key);
        for (const item of value.instances) {
          const instance = terrainSet.lod(item, view.at);
          levels[instance.level] = (levels[instance.level] ?? 0) + 1;
          instances.push(instance);
        }
      }
      // Reports remain bounded even with many overlapping camera windows.
      need(views.reduce((n, row) => n + row.instances.length, instances.length) <= 96000,
        'stream report exceeds its instance budget');
      views.push({ id: view.id, at: view.at, tiles: [...current.values()],
        loaded: [...current.keys()].filter(key => !prior.has(key)).map(key => current.get(key).at),
        retained: [...current.keys()].filter(key => prior.has(key)).map(key => current.get(key).at),
        evicted: [...prior.keys()].filter(key => !current.has(key)).map(key => prior.get(key).at),
        deferred: deferred.map(key => entries.get(key).at), bytes: scheduler.stats().bytes, levels, instances });
      prior = current;
    }
  } finally {
    interest.close();
    scheduler.dispose();
  }
  return { id: source.id, revision: source.revision, budgetBytes: settings.budgetBytes, verifiedTiles: visited.size, views };
}

module.exports = async function terrainCLI([action, ...args], opt, { KIT: K }) {
  const counts = { inspect: 1, edit: 2, bake: 1, stream: 2 }, api = K.procedural.terrainSet;
  need(Object.hasOwn(counts, action) && args.length === counts[action], 'use inspect, edit, bake or stream');
  const allowed = action === 'edit' ? ['out', 'report'] : ['out'];
  need(Object.entries(opt).every(([k, v]) => allowed.includes(k) && typeof v === 'string' && v.trim()) &&
    (action !== 'bake' || opt.out), 'invalid options or missing bake output directory');
  const inputs = args.map(file => path.resolve(file)), outputs = [opt.out, opt.report].filter(Boolean).map(file => path.resolve(file));
  const produced = action === 'bake' ? ['manifest.json', 'build-report.json'].map(n => path.join(outputs[0], n)) : outputs;
  need(new Set(outputs).size === outputs.length && !produced.some(name => inputs.includes(name)),
    'write results separately from their inputs');
  function publish(value) {
    if (opt.out) files.json(path.resolve(opt.out), value);
    else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  }
  if (action === 'stream') return publish(await stream(inputs[0], read(inputs[1], 2 * 1024 * 1024), K));
  const source = api.create(read(inputs[0]));
  if (action === 'inspect') publish(api.inspect(source));
  else if (action === 'bake') {
    process.stdout.write(JSON.stringify(writeBake(source, outputs[0], K), null, 2) + '\n');
  } else {
    const { document, report } = api.edit(source, read(inputs[1], 2 * 1024 * 1024));
    publish(document);
    if (opt.report) files.json(path.resolve(opt.report), report);
  }
};
