const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const studio = require('..');
const PNG = require('../cli/png.js');

const cli = path.join(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const write = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};
const json = (file, value) => write(file, JSON.stringify(value));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source');
  const file = name => path.join(root, name);
  const source = file('scenes/pier.json'), pack = file('looks/relay.json'), attachments = file('attachments.json');
  const stripe = Uint8Array.of(244, 166, 94, 255);
  const png = PNG.encode(1, 1, stripe, 4);
  write(file('meshes/marker.obj'), 'mtllib marker.mtl\nv 0 0 0\nv 1 0 0\nv .2 1 0\nusemtl brass\nf 1 2 3\n');
  write(file('meshes/marker.mtl'), 'newmtl brass\nKd 0.72 0.42 0.13\nmap_Kd -o .1 .2 texture.png\n');
  write(file('meshes/texture.png'), png);
  write(file('prefabs/marker.obj'), 'v 0 0 0\nv 2 0 0\nv 1 1 0\nf 1 2 3\n');
  const def = { revision: 3, solids: { marker: { kind: 'mesh', asset: 'marker.obj', at: [0, 0, 0],
    size: .58, mat: 'metal', res: .16 } } };
  json(file('prefabs/pier-parts.json'), { marker: def });
  json(file('meshes/lamp.gltf'), {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, .4, .1, 1], baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: 'texture.png' }],
    buffers: [{ uri: 'lamp%20positions.bin', byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
      min: [0, 0, 0], max: [1, 1, 0] }]
  });
  const vertices = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, .7, 1, 0].forEach((value, index) => vertices.writeFloatLE(value, index * 4));
  write(file('meshes/lamp positions.bin'), vertices);
  studio.writeSpriteAtlas({ metadata: { width: 1, height: 1, frames: [{ rect: { x: 0, y: 0, width: 1, height: 1 } }] },
    images: { color: stripe } }, { out: file('sprites/lamp.json') });
  const atlasMap = JSON.parse(fs.readFileSync(file('sprites/lamp.json'), 'utf8')).files.color;
  const table = 'station,height\nOuter Pier,1.35\n';
  write(file('data/tides.csv'), table);
  write(pack, fs.readFileSync(path.join(__dirname, '../examples/relay-look-pack.json')));
  write(file('audio/relay.wav'), Buffer.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]));
  json(attachments, { 'relay-tone': 'audio/relay.wav' });
  json(source, { id: 'portable-pier', name: 'Portable pier', seed: 19,
    camera: { target: [0, .42, 0], dist: 5, yaw: .35, pitch: .18 },
    prefabLibrary: '../prefabs/pier-parts.json', instances: { beacon: { prefab: 'marker',
      transform: { translation: [1, .36, 0] } } },
    dataInputs: { tides: { kind: 'table', format: 'csv', key: 'station', file: '../data/tides.csv',
      columns: { station: { type: 'string' }, height: { type: 'number', units: 'm' } } } },
    finish: { detail: 24, dither: 0, look: { asset: 'relay/glazed-enamel' },
      spriteAtlases: [{ atlas: '../sprites/lamp.json', mode: 'card', at: [0, .94, .3], scale: .28 }] },
    solids: [
      { id: 'base', kind: 'box', at: [0, 0, 0], half: [1.4, .16, .62], mat: 'stone', res: .12 },
      { id: 'steel', kind: 'mesh', asset: '../meshes/marker', at: [-.8, .28, 0], size: .6, mat: 'pale', res: .14 },
      { id: 'lamp', kind: 'mesh', asset: '../meshes/lamp.gltf', at: [0, .24, 0], size: .38, mat: 'wood', res: .14 }
    ] });
  return { dir, root, source, pack, attachments, table, atlasMap, vertices };
}

test('project bundles retain local dependencies, rebuild in the CLI, and save editor revisions after relocation', t => {
  const { dir, root, source, pack, attachments, table, atlasMap, vertices } = fixture(t);
  const bundle = path.join(dir, 'project.json'), former = path.join(dir, 'before.png');
  const view = ['--w', '90', '--h', '60', '--px', '1'];
  run('render', source, ...view, '--asset-pack', pack, '--out', former);
  run('project', 'pack', source, '--out', bundle, '--revision', '4', '--root', root, '--asset-pack', pack, '--attachments', attachments);
  const moved = path.join(dir, 'relocated', 'studio.json');
  fs.mkdirSync(path.dirname(moved));
  fs.renameSync(bundle, moved);
  fs.rmSync(root, { recursive: true, force: true });
  const project = studio.readProjectBundle(moved);
  assert.equal(project.metadata.revision, 4);
  assert.equal(project.metadata.toolkit.version, studio.version);
  assert.match(project.metadata.toolkit.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(project.readFile('meshes/lamp positions.bin')), vertices);
  assert.equal(Buffer.from(project.readFile('data/tides.csv')).toString(), table);
  assert(project.files().includes('sprites/' + atlasMap));
  assert.equal(project.attachment('relay-tone').path, 'audio/relay.wav');
  const preview = path.join(dir, 'moved.png');
  run('render', moved, ...view, '--out', preview);
  assert.deepEqual(fs.readFileSync(preview), fs.readFileSync(former));
  assert.equal(JSON.parse(run('data-inputs', moved, 'tides', '--rows')).rows[0].height, 1.35);
  assert.match(run('validate', moved), /sound/);
  const inspect = JSON.parse(run('project', 'inspect', moved));
  assert.equal(inspect.entry, 'scenes/pier.json');
  assert.equal(inspect.files.length, project.files().length);
  assert.equal(studio.readDataInputs(moved).get('tides').rows[0].height, 1.35);
  const editor = studio.createSceneEditor(fs.readFileSync(moved, 'utf8'));
  const baked = editor.build();
  assert.equal(baked.spriteAtlases[0].atlas.snapshot().metadata.width, 1);
  assert.equal(editor.node('prefab:beacon').revision, 3);
  editor.setTransform({ translation: [0, .3, 0] }, 'solid:base');
  const amended = project.withScene(editor.snapshot()), revised = path.join(dir, 'revised.json');
  assert.equal(JSON.parse(amended.snapshot().files[amended.metadata.entry].data).dataInputs.tides.file, '../data/tides.csv');
  studio.writeProjectBundle(amended, { out: revised });
  assert.equal(studio.readProjectBundle(revised).metadata.revision, 5);
  assert.deepEqual(amended.scene().solids[0].transform.translation, [0, .3, 0]);
  assert.equal(project.scene().solids[0].transform, undefined);
  const next = path.join(dir, 'amended.png');
  run('render', revised, ...view, '--out', next);
  assert.notDeepEqual(fs.readFileSync(next), fs.readFileSync(preview));
});

test('invalid versions and incomplete or escaping dependency paths fail before publishing', t => {
  const { dir, root, source, pack } = fixture(t), out = path.join(dir, 'project.json');
  assert.throws(() => studio.packProject(source, { out, assetPack: pack }), /project root/);
  const { project } = studio.packProject(source, { out, root, assetPack: pack });
  const input = project.snapshot(), old = fs.readFileSync(out);
  const api = studio.load().KIT.authoring.projectBundles;
  assert.throws(() => api.open({ ...input, version: 999 }), /project bundle version/);
  input.files['../escaped.png'] = { encoding: 'base64', data: 'AA==' };
  assert.throws(() => api.open(input), /leaves the root/);
  delete input.files['../escaped.png'];
  delete input.files['meshes/texture.png'];
  assert.throws(() => api.open(input), /Missing project file: meshes\/texture.png/);
  fs.rmSync(path.join(root, 'meshes/texture.png'));
  assert.throws(() => studio.packProject(source, { out, root, assetPack: pack }), /Missing project file/);
  assert.deepEqual(fs.readFileSync(out), old);
});

test('the browser toolkit opens and edits the same project file without its loose inputs',
  { skip: !process.env.INK_TEST_CHROME }, t => {
    const { dir, root, source, pack, attachments } = fixture(t), file = path.join(dir, 'bundle.json');
    const { project } = studio.packProject(source, { out: file, root, assetPack: pack, attachments });
    const count = project.build().count;
    fs.rmSync(root, { recursive: true, force: true });
    write(path.join(dir, 'toolkit.js'), studio.bundle());
    const page = path.join(dir, 'browser.html');
    write(page, `<!doctype html><body><script src="toolkit.js"></script><script>
      fetch('bundle.json').then(response => response.json()).then(document => {
        const original = KIT.authoring.projectBundles.open(document);
        const editor = original.editor();
        editor.setTransform({translation:[0,.3,0]},'solid:base');
        const revision = original.withScene(editor.snapshot());
        const world = original.build();
        window.document.body.dataset.result = world.count === ${count} && world.spriteAtlases.length === 1 &&
          world.dataInputs.get('tides').rows[0].height === 1.35 && revision.metadata.revision === 2 &&
          revision.attachment('relay-tone').bytes[0] === 82 ? 'verified' : 'changed';
      }).catch(err => document.body.dataset.result = err.message);
    </script>`);
    const html = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--allow-file-access-from-files',
      '--disable-background-networking', '--virtual-time-budget=5000', '--user-data-dir=' + path.join(dir, 'chrome'),
      '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8' });
    assert.match(html, /data-result="verified"/);
  });
