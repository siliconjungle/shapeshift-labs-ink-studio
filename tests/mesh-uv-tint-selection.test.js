'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');
const { fixture } = require('../examples/mesh-uv-workshop.cjs');
const kit = ink.load(), topology = kit.KIT.meshTopology, uv = topology.uv;
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-uv-tint-'));
  t.after(() => fs.rmSync(cwd, { force: true, recursive: true }));
  const at = file => path.join(cwd, file);
  return { at, write: (file, data) => fs.writeFileSync(at(file), JSON.stringify(data)),
    read: file => JSON.parse(fs.readFileSync(at(file), 'utf8')),
    run: (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' })) };
}

const amber = [.82,.46,.18];
function colorFace(face, values) {
  return { ...face, corners: face.corners.map((row, i) => ({ ...row, attributes: { ...row.attributes, tint: values(i) } })) };
}

test('vertex tint selects by authored color, channel tolerance and per-face corner participation', () => {
  const { doc } = fixture(kit);
  const tints = new Map([
    ['faceplate', () => amber],
    ['right-wing', i => i === 0 ? amber : [.46,.82,.18]],
    ['rear', () => [.83,.46,.18,.5]],
    ['left-wall', () => [.82,.46]]
  ]);
  const colored = topology.edit(doc, { faces: doc.faces.filter(face => tints.has(face.id))
    .map(face => colorFace(face, tints.get(face.id))) });
  const query = tint => uv.select(colored, { domain: 'faces', tint });
  const exact = query({ color: amber });
  assert.deepEqual(exact.faces, ['faceplate','right-wing']);
  assert.deepEqual(exact.tint.matches[1], { face: 'right-wing', corners: ['right-wing/frb'] });
  assert.deepEqual(query({ color: amber, tolerance: .01, match: 'all' }).faces, ['faceplate','rear']);
  assert.deepEqual(query({ color: [...amber,1], tolerance: .01, match: 'all' }).faces, ['faceplate']);
  assert.deepEqual(query({ color: [...amber,.5], tolerance: .01 }).faces, ['rear']);
  assert.deepEqual(query({ color: [.1,.2,.3] }).faces, []);
  assert.deepEqual(uv.select(colored, { domain: 'faces', from: exact }).faces, exact.faces);
  assert.throws(() => uv.select(doc, { domain: 'faces', from: exact }), /mesh revision/);
  assert.throws(() => uv.select(colored, { domain: 'islands', tint: { color: amber } }), /faces domain/);
  assert.throws(() => query({ color: [1.2,0,0] }), /normalized RGB or RGBA/);
  assert.throws(() => uv.select(colored, { domain: 'faces', ids: ['faceplate'], tint: { color: amber } }), /Choose a UV selection/);
});

test('cross-highlights reuse one authored face selection across atlas sheets and visible scene pixels', t => {
  const { doc, view } = fixture(kit), { at, write, read, run } = workspace(t);
  const faces = doc.faces.map(face => ['rear','right-wing'].includes(face.id) ?
    { ...colorFace(face, () => amber), ...(face.id === 'rear' && { material: 'back' }) } : face);
  const scene = { id: 'case', solids: [], camera: { target: [0,0,0], dist: 7.4, yaw: .49, pitch: .31,
    projection: 'orthographic', sway: 0 }, topologyMeshes: { box: { document: { ...doc, faces },
    materials: [...view.materials, { ...view.materials[0], id: 'back' }] } } };
  write('scene.json', scene);
  write('view.json', { w: view.w, h: view.h, camera: view.camera, material: 'enamel' });
  write('query.json', { domain: 'faces', tint: { color: amber } });
  write('island.json', { domain: 'islands', atlas: { at: [.42,.4] } });
  write('edges.json', { convert: 'edges' });
  run('mesh-uv','select','scene.json','query.json','--object','box','--view','view.json','--preview','tint',
    '--out','tint.json','--topology-out','tint-faces.json');
  const tinted = read('tint.json'), selection = read('tint-faces.json');
  assert.deepEqual(tinted.faces, ['rear','right-wing']);
  assert.deepEqual(selection.ids, tinted.faces);
  assert.deepEqual(tinted.preview.crossHighlight.sheets, [
    { material: 'enamel', file: 'atlas-before.png' }, { material: 'back', file: 'atlas-2.png' }
  ]);
  assert.equal(tinted.preview.crossHighlight.faces[0].visiblePixels, 0);
  assert(tinted.preview.crossHighlight.faces[1].visiblePixels > 0);
  for (const file of ['atlas-before.png','atlas-2.png','model-before.png']) {
    const { data } = PNG.raster(at('tint/'+file));
    assert(data.some((n, i) => i % 4 === 0 && n === 117 && data[i+1] === 226 && data[i+2] === 200), file);
  }
  const island = run('mesh-uv','select','scene.json','island.json','--object','box','--topology-out','island-faces.json');
  assert.equal(island.ids.length, 1);
  assert(island.faces.length > 1);
  assert.deepEqual(read('island-faces.json').ids, island.faces);
  const converted = run('mesh-topology','select','scene.json','edges.json','--object','box','--from','tint-faces.json');
  assert.deepEqual(converted, topology.select(scene.topologyMeshes.box.document, { from: selection, convert: 'edges' }));
  assert.deepEqual(read('scene.json'), scene);
});

test('glTF import retains normalized COLOR_0 including alpha and skips uncolored primitives', t => {
  const { write, read, run } = workspace(t);
  const bytes = Buffer.alloc(72);
  [0,0,0, 1,0,0, 0,1,0, 0,0, 1,0, 0,1].forEach((value,i) => bytes.writeFloatLE(value, i*4));
  bytes.set([255, 128, 0, 64, 255, 128, 0, 64, 255, 128, 0, 64], 60);
  write('tint.gltf', { asset: { version:'2.0' }, scene: 0, scenes: [{nodes:[0]}], nodes:[{mesh:0}],
    buffers:[{uri:'data:application/octet-stream;base64,'+bytes.toString('base64'),byteLength:bytes.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:12}],
    accessors:[
      {bufferView:0,componentType:5126,count:3,type:'VEC3'},
      {bufferView:1,componentType:5126,count:3,type:'VEC2'},
      {bufferView:2,componentType:5121,count:3,type:'VEC4',normalized:true}
    ],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1,COLOR_0:2}}, {attributes:{POSITION:0,TEXCOORD_0:1}}]}] });
  run('mesh-uv','import','tint.gltf','--join-coincident','on','--out','mesh.json');
  const doc = read('mesh.json'), color = [1,128/255,0,64/255];
  assert.equal(doc.vertices.length, 3);
  assert.deepEqual(doc.faces[0].corners[1].attributes.tint, color);
  assert.equal(doc.faces[1].corners[1].attributes?.tint, undefined);
  assert.deepEqual(uv.select(doc, { domain: 'faces', tint: { color, match: 'all' } }).faces, ['f/0']);
  run('mesh-uv','import','mesh.json','--out','reimported.json');
  assert.deepEqual(uv.select(read('reimported.json'), { domain: 'faces', tint: { color } }).faces, ['f/0']);
});
