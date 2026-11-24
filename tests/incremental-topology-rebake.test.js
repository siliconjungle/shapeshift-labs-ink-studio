const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inflateSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');

const { KIT } = ink.load();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readMesh = result => read(result.materialBake).meshes[0];
const faceRow = (mesh, name) => mesh.chartReport.layout.charts.find(chart => chart.faces.includes(name));
const owners = (dir, descriptor) => inflateSync(fs.readFileSync(path.join(dir, descriptor.file)));

function topology({ revised = false, collision } = {}) {
  const vertices = [], faces = [];
  function panel(id, west, east, uvWest, uvEast, uvNorth, uvSouth, { clip, newVertices } = {}) {
    const corners = [];
    const uv = [[0,1],[1,1],...(clip ? [[1,.25],[.75,0]] : [[1,0]]),[0,0]];
    for (const [i, [x, y]] of uv.entries()) {
      const suffix = clip && i === 2 ? 'clip-lower' : clip && i === 3 ? 'clip-upper' : clip && i === 4 ? '3' : i;
      const vertex = id + '-' + (newVertices ? 'replacement-' : '') + suffix;
      vertices.push({ id: vertex, position: [west + x * (east - west), .6 - 1.2 * y, 0] });
      corners.push({ id: id + '/' + suffix, vertex, uv: [uvWest + x * (uvEast - uvWest), uvNorth + y * (uvSouth - uvNorth)] });
    }
    faces.push({ id, material: 'enamel', corners });
  }
  panel('reference', -2.7, -1.5, .06, .23, .08, .30);
  const moved = collision === 'overlap' ? [.12,.31,.08,.30] :
    collision === 'gutter' ? [.232,.42,.08,.30] : [.09,.31,.61,.84];
  panel('relocated', -1.17, -.04, ...(revised ? moved : [.28,.46,.08,.30]), { clip: revised });
  panel('replacement', revised ? .65 : .2, revised ? 1.85 : 1.41, .53, .70, .08, .30, { newVertices: revised });
  if (!revised) panel('discard', 1.75, 2.6, .77, .94, .08, .30);
  return KIT.meshTopology.create({ id: 'test-enamel', vertices: revised ? vertices.reverse() : vertices,
    faces: revised ? faces.reverse() : faces });
}

function target(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-topology-rebake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bake = (name, doc, options) => ink.exportGlb(doc, {
    out: path.join(root, name, 'model.glb'), bakeDir: path.join(root, name), ...options
  });
  return { root, bake };
}

function preserved(a, b, aDir, bDir, oldOwners, newOwners, owner) {
  let count = 0;
  for (const set of ['maps', 'masks']) for (const name of Object.keys(a[set])) {
    const input = PNG.raster(path.join(aDir, a[set][name].file)).data;
    const output = PNG.raster(path.join(bDir, b[set][name].file)).data;
    let retained = 0;
    for (let i = 0; i < input.length; i += 4) if (oldOwners.readUInt32LE(i) === owner) {
      assert.equal(newOwners.readUInt32LE(i), owner);
      assert.equal(Buffer.compare(input.subarray(i, i + 4), output.subarray(i, i + 4)), 0, name + ' at ' + i / 4);
      retained++;
    }
    count = retained;
  }
  return count;
}

test('stable chart revisions reuse map and mip pixels and remap approved paint only where correspondence survives', t => {
  const { bake } = target(t), doc = topology();
  const capture = bake('capture', doc, { textureSize: 256, capturePaint: { format: 'ink-studio/material-paint-cameras',
    version: 1, views: [{ id: 'front', width: 140, height: 80, camera: { pitch: 0, yaw: 0 } }] } });
  const paintViews = path.join(path.dirname(capture.materialBake), read(capture.materialBake).paintManifest);
  const [view] = read(paintViews).views;
  const approved = new Uint8Array(view.width * view.height * 3);
  for (let i = 0; i < approved.length; i += 3) approved.set([243, 51, 16], i);
  PNG.write(path.join(path.dirname(paintViews), view.paint), view.width, view.height, approved);
  const baseline = bake('baseline', doc, { textureSize: 256, paintViews });
  const edited = topology({ revised: true });
  const revision = bake('revision', edited, { rebakeFrom: baseline.materialBake });
  const a = readMesh(baseline), b = readMesh(revision), aDir = path.dirname(baseline.materialBake), bDir = path.dirname(revision.materialBake);
  const clean = faceRow(b, 'reference'), move = faceRow(b, 'relocated'), changed = faceRow(b, 'replacement');
  assert.deepEqual(b.chartReport.reused, [clean.id]);
  assert.equal(clean.space, 'preserved');
  assert.deepEqual(clean.uvBefore, clean.uvAfter);
  assert.equal(clean.paint.status, 'retained');
  assert.equal(move.space, 'revised');
  assert.notDeepEqual(move.uvBefore, move.uvAfter);
  assert.equal(move.paint.status, 'transferred');
  assert(move.paint.transferredTexels > 1000);
  assert.equal(changed.paint.status, 'partially-transferred');
  assert(changed.paint.unmappedTexels > 100 && changed.paint.transferredTexels > 100);
  assert.deepEqual(b.chartReport.layout.retired[0].removedFaces, ['discard']);
  assert(b.chartReport.layout.retired[0].paintTexels > 100);
  const oldOwners = owners(aDir, a.rebakeState.owners), newOwners = owners(bDir, b.rebakeState.owners);
  assert(preserved(a,b,aDir,bDir,oldOwners,newOwners,clean.id + 1) > 1000);
  const index = (u, v) => (Math.floor(v * b.height) * b.width + Math.floor(u * b.width)) * 4;
  assert.equal(newOwners.readUInt32LE(index(.36, .20)), 0);
  assert.equal(newOwners.readUInt32LE(index(.86, .20)), 0);
  const image = PNG.raster(path.join(bDir, b.maps.pigment.file)).data;
  assert.deepEqual(Array.from(image.subarray(index(.17, .72), index(.17, .72) + 4)), [243,51,16,255]);
  assert.deepEqual(Array.from(image.subarray(index(.36, .20), index(.36, .20) + 4)), [0,0,0,255]);
  for (let i = 0; i < 4; i++) {
    const x = a.mipmaps.levels[i], y = b.mipmaps.levels[i];
    assert(preserved(x,y,aDir,bDir,owners(aDir,x.owners),owners(bDir,y.owners),clean.id + 1) > 0);
    assert(y.changedOwners > 0 && y.clearedTexels > 0);
  }
  const rebased = readMesh(bake('next-revision', edited, { rebakeFrom: revision.materialBake }));
  assert.equal(rebased.chartReport.sampledTexels, 0);
  assert.deepEqual(rebased.maps, b.maps);
  assert.deepEqual(rebased.rebakeState.owners, b.rebakeState.owners);
  for (const [i, level] of rebased.mipmaps.levels.entries()) {
    assert.equal(level.filteredTexels, 0);
    assert.deepEqual(level.maps, b.mipmaps.levels[i].maps);
    assert.deepEqual(level.owners, b.mipmaps.levels[i].owners);
  }
});

test('export-glb writes a structured result for retained topology and refuses chart overlaps and occupied gutters', t => {
  const { bake, root } = target(t), baseline = bake('baseline', topology(), { textureSize: 256 });
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = collision => {
    const key = collision ?? 'valid', model = path.join(root, key + '.json'), out = path.join(root, key + '.glb');
    const report = path.join(root, key + '-report.json');
    fs.writeFileSync(model, JSON.stringify(topology({ revised: true, collision })));
    const invoke = () => execFileSync(process.execPath,
      [cli, 'export-glb', model, '--out', out, '--bake-dir', path.join(root, key),
        '--rebake-from', baseline.materialBake, '--rebake-report', report], { stdio: 'pipe' });
    if (!collision) invoke();
    else assert.throws(invoke, /Chart revision cannot preserve atlas space/);
    assert.equal(fs.existsSync(out), !collision);
    return read(report);
  };
  const success = run();
  assert(success.ready && success.meshes[0].chartReport.layout.charts.some(c => c.space === 'preserved'));
  assert.equal(run('overlap').conflicts[0].code, 'atlas-overlap');
  const gutter = run('gutter');
  assert(!gutter.ready);
  assert.equal(gutter.conflicts[0].code, 'retained-texel');
  assert(gutter.conflicts[0].gutter);
});
