const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { write } = require('./asset-files.js');
const { collectDependencies } = require('./project-dependencies.js');
const Experiment = require('./experiment-schema.js');

const textFile = /\.(?:json|geojson|gltf|obj|mtl|csv|tsv|txt|cube|svg)$/i;
const studio = () => require('../index.js');
const api = () => studio().load().KIT.authoring.projectBundles;
const digest = data => createHash('sha256').update(data).digest('hex');

function experimentToolkit() {
  const root = path.resolve(__dirname, '..'), hash = createHash('sha256');
  const hosts = ['index.js', 'src/simulation-checkpoint-store.js',
    ...fs.readdirSync(__dirname).filter(file => file.endsWith('.js')).sort().map(file => 'cli/' + file)];
  for (const file of hosts) {
    const bytes = fs.readFileSync(path.join(root,file));
    hash.update(file + '\0' + bytes.length + '\0').update(bytes);
  }
  return { version: studio().version, sourceHash: studio().nodeToolkitHash(), runnerHash: hash.digest('hex') };
}

function verifyExperimentFiles(snapshot) {
  for (const [name, record] of Object.entries(snapshot.files))
    if (digest(Buffer.from(record.data, record.encoding)) !== record.sha256)
      throw new Error('Corrupt experiment asset: ' + name);
}
const inside = (root, file) => {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
    throw new Error('Project references must stay inside the project root: ' + file);
  return relative.split(path.sep).join('/');
};

function packProject(scene, { out, root, revision, assetPack, paint, attachments } = {}) {
  if (typeof scene !== 'string' || !/\.json$/i.test(scene) || typeof out !== 'string' || !/\.json$/i.test(out))
    throw new TypeError('Project packing needs a JSON scene, take or experiment and a .json output file');
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new RangeError('Choose a positive project revision');
  const input = path.resolve(scene), projectRoot = path.resolve(root ?? path.dirname(input));
  const actualRoot = fs.realpathSync(projectRoot), entry = inside(projectRoot, input);
  const kit = studio().load().KIT, bundles = kit.authoring.projectBundles, records = new Map(), sources = new Set();
  let size = 0;
  function save(name, record, length) {
    size += length;
    if (size > bundles.maxBytes || records.size >= bundles.maxFiles) throw new RangeError('Project exceeds the file size or entry budget');
    records.set(name, record);
    return record;
  }
  function physical(file) {
    inside(projectRoot, file);
    const location = fs.realpathSync(file);
    inside(actualRoot, location);
    sources.add(location);
    return location;
  }
  function get(name) {
    if (records.has(name)) return records.get(name);
    const file = path.join(projectRoot, name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) return undefined;
    const location = physical(file);
    if (stat.size > bundles.maxBytes - size) throw new RangeError('Project exceeds the file size budget');
    const data = fs.readFileSync(location);
    const decoded = textFile.test(name) ? data.toString('utf8') : undefined;
    const text = decoded !== undefined && Buffer.from(decoded).equals(data);
    return save(name, { encoding: text ? 'utf8' : 'base64', data: text ? decoded : data.toString('base64') }, data.length);
  }
  function jsonFile(file) {
    if (typeof file !== 'string' || !file.trim()) throw new TypeError('Expected a project JSON dependency filename');
    const name = inside(projectRoot, path.resolve(file));
    const record = get(name);
    if (!record) throw new Error('Missing project file: ' + name);
    return JSON.parse(record.encoding === 'utf8' ? record.data : Buffer.from(record.data, 'base64').toString('utf8'));
  }
  let spec = jsonFile(input);
  if (spec?.format === bundles.format) throw new TypeError('Pack a source JSON diorama or save edits with withScene()');
  const take = spec?.format === 'ink-studio/take';
  const experiment = spec?.format === Experiment.format;
  if (experiment) {
    Experiment.validate(spec);
    if (assetPack !== undefined || paint !== undefined)
      throw new TypeError('Author experiment assets in the recipe before packing');
    if (revision !== undefined && revision !== (spec.revision ?? 1))
      throw new TypeError('Project revision must match the experiment recipe');
  }
  if (take && paint !== undefined) throw new TypeError('Apply paint to its scene before packing a native take');
  const refs = {};
  if (attachments !== undefined) {
    const mapping = jsonFile(attachments);
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new TypeError('Project attachments need a named file map');
    const owner = inside(projectRoot, path.resolve(attachments));
    for (const [id, ref] of Object.entries(mapping))
      Object.defineProperty(refs, id, { value: bundles.resolvePath(owner, ref), enumerable: true });
  }
  if (take && assetPack !== undefined) {
    const pack = inside(projectRoot, path.resolve(assetPack));
    spec = { ...spec, assetPack: path.posix.relative(path.posix.dirname(entry), pack) };
  } else if (assetPack !== undefined) spec = { ...spec, assetPacks: kit.authoring.assetPacks.merge(spec.assetPacks ?? [], jsonFile(assetPack)).packs };
  if (paint !== undefined) spec = { ...spec, finish: { ...spec.finish, paint: jsonFile(paint) } };
  if (assetPack !== undefined || paint !== undefined) {
    const record = records.get(entry);
    size -= Buffer.byteLength(record.data, record.encoding);
    records.delete(entry);
    const data = JSON.stringify(spec, null, 2) + '\n';
    save(entry, { encoding: 'utf8', data }, Buffer.byteLength(data));
  }
  const { atlasPaths } = collectDependencies(bundles, entry, get, refs), atlases = {};
  for (const name of atlasPaths) {
    const source = studio().readSpriteAtlas(path.join(projectRoot, name)).snapshot();
    atlases[name] = bundles.mapAtlasImages(source, data => Buffer.from(data).toString('base64'));
  }
  const file = path.resolve(out), prior = fs.statSync(file, { throwIfNoEntry: false });
  if (prior && [...sources].some(source => {
    const stat = fs.statSync(source);
    return stat.dev === prior.dev && stat.ino === prior.ino;
  })) throw new Error('Choose a project output separate from its inputs');
  const project = bundles.open({ format: bundles.format,
    version: experiment ? bundles.experimentVersion : take ? bundles.takeVersion : bundles.version,
    project: { id: spec.id ?? (take && spec.world ? jsonFile(path.resolve(path.dirname(input), spec.world)).id : undefined) ??
      path.basename(entry, path.extname(entry)), revision: revision ?? (experiment ? spec.revision ?? 1 : 1) },
    toolkit: experiment ? experimentToolkit() : { version: studio().version, sourceHash: digest(studio().bundle()) },
    entry, files: Object.fromEntries([...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name,record])=>[name,experiment?{...record,sha256:digest(Buffer.from(record.data,record.encoding))}:record])),
    attachments: refs, atlases }, { digest });
  return writeProjectBundle(project, { out: file });
}

function readProjectBundle(file) {
  const bundles = api();
  if (fs.statSync(file).size > bundles.maxBytes * 2) throw new RangeError('Project bundle exceeds the JSON size budget');
  const project = bundles.open(fs.readFileSync(file, 'utf8'), { digest });
  if (project.metadata.kind === 'experiment') verifyExperimentFiles(project.snapshot());
  return project;
}

function materialize(project, directory) {
  const snapshot = project.snapshot();
  if (project.metadata.kind === 'experiment') verifyExperimentFiles(snapshot);
  collectDependencies(api(), snapshot.entry, file => Object.hasOwn(snapshot.files, file) ? snapshot.files[file] : undefined,
    snapshot.attachments);
  for (const name of project.files()) {
    const file = path.resolve(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, project.readFile(name), { flag: 'wx' });
  }
  return path.join(directory, project.metadata.entry);
}

function mountProject(project, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-project-'));
  try { return callback(materialize(project, directory), directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function withTakeSource(input, callback) {
  if (/\.json$/i.test(input)) {
    const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
    if (raw?.format === api().format && raw.version === api().takeVersion)
      return mountProject(readProjectBundle(input), callback);
  }
  return callback(input);
}

function replayProjectShot(input, id, options) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Select a named shot with --shot');
  const project = readProjectBundle(input), doc = project.takeDocument?.(), snapshot = project.snapshot();
  const file = doc ? Object.hasOwn(doc.shots ?? {}, id) && api().resolvePath(snapshot.entry, doc.shots[id]) :
    Object.hasOwn(snapshot.attachments, id) && snapshot.attachments[id];
  if (!file) throw new RangeError('Unknown project shot ' + id);
  return mountProject(project, (_, folder) => require('./shot-recipes.js').replay(path.resolve(folder, file),
    { ...options, portable: true, protect: [input] }));
}

function unpackProject(input, { out } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Choose a new project output directory');
  const project = readProjectBundle(input), directory = path.resolve(out);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  try {
    const entry = materialize(project, directory);
    return { directory, entry, project };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function writeProjectBundle(source, { out } = {}) {
  if (typeof out !== 'string' || !/\.json$/i.test(out)) throw new TypeError('Choose a project .json output filename');
  const bundles = api(), project = typeof source?.snapshot === 'function' ? source : bundles.open(source, { digest });
  const snapshot = project.snapshot();
  if (project.metadata.kind === 'experiment') verifyExperimentFiles(snapshot);
  const data = JSON.stringify(snapshot, null, 2) + '\n', file = path.resolve(out);
  if (Buffer.byteLength(data) > bundles.maxBytes * 2) throw new RangeError('Project bundle exceeds the JSON size budget');
  write(file, data);
  return { file, project };
}

module.exports = { packProject, readProjectBundle, writeProjectBundle, mountProject, unpackProject, withTakeSource, replayProjectShot,
  experimentToolkit };
