'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../..');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');
const R = require('../../cli/render.js');
const sample = require('./fixture.cjs');

function run(directory) {
  const dir = path.resolve(directory), api = ink.load().KIT.meshTopology;
  const { cage, target, stack } = sample.fixture(api);
  const materials = sample.materials();
  const view = { w: 160, h: 112, camera: { target: [0,-.65,.18], dist: 4.8, yaw: -.42, pitch: .30, ortho: true }, materials };
  const scene = { id: 'worklight-bench', style: 'slate', solids: [], topologyMeshes: {
    lamp: { document: cage, materials, modifiers: stack,
      bindings: [{ id: 'paint-owner', domain: 'faces', element: 'panel' },
        { id: 'seam-anchor', domain: 'corners', element: 'c1' }],
      bakes: [{ id: 'face-paint', material: 'paint', maps: { roughness: .4 } }] },
    mount: { document: target, materials }
  } };
  const save = (name, item) => files.json(path.join(dir, name + '.json'), item);
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  for (const [name, item] of Object.entries({
    cage, 'stack-order': stack, targets: { mount: target }, view, 'binding-scene': scene,
    bypass: { id: 'bank', patch: { enabled: false } }, 'reordered-order': [...stack.slice(0, -2), stack.at(-1), stack.at(-2)]
  })) save(name, item);
  const executable = path.join(__dirname, '../../cli/ink-studio.js');
  function cli(...args) {
    return execFileSync(process.execPath, [executable, 'mesh-topology', 'modifiers', ...args], { cwd: dir, encoding: 'utf8' });
  }
  const targets = ['--targets', 'targets.json'];
  cli('set', 'cage.json', 'stack-order.json', ...targets, '--out', 'retained.json');
  cli('set', 'retained.json', 'reordered-order.json', ...targets, '--out', 'reordered.json', '--report', 'reordered-report.json');
  cli('update', 'retained.json', 'bypass.json', ...targets, '--out', 'one-lamp.json');
  function capture(file, name, through) {
    cli('inspect', file, ...targets, ...(through && ['--through', through] || []),
      '--view', 'view.json', '--preview', name, '--report', name + '-report.json');
    return PNG.read(path.join(dir, name, 'stage.png'));
  }
  const images = [capture('cage.json','cage-only'), capture('retained.json','symmetry','symmetry'),
    capture('retained.json','bevel-stage','trim'), capture('retained.json','rounded','round'),
    capture('retained.json','complete'), capture('one-lamp.json','bypassed-bank')];
  const combined = R.upscale(R.grid(images, 3), 2);
  PNG.write(path.join(dir, 'comparison.png'), combined.w, combined.h, combined.rgb);

  cli('apply', 'binding-scene.json', '--object', 'lamp', '--through', 'round', '--report', 'apply-review.json');
  cli('apply', 'binding-scene.json', '--object', 'lamp', '--through', 'round', '--out', 'partial-scene.json');
  const proposed = read('apply-review');
  assert(proposed.topology.bindings.some(row => row.id === 'paint-owner' && row.change === 'needs-review'));
  assert.deepEqual(read('partial-scene').topologyMeshes.lamp.modifiers.map(row => row.id), ['bank']);
  assert.deepEqual(read('retained').document, cage);
  const before = ink.createSceneEditor(scene).inspectMeshModifiers('lamp').document;
  const after = ink.createSceneEditor(read('partial-scene')).inspectMeshModifiers('lamp').document;
  assert.deepEqual(after, before);
}

if (require.main === module) run(process.argv[2] ?? 'output/mesh-modifiers');
