'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..');

const dir = path.resolve(process.argv[2] ?? 'relay-delivery');
const file = name => path.join(dir, name);
fs.mkdirSync(dir, { recursive: true });
const commands = [];
function cli(args, output) {
  const result = execFileSync(process.execPath, [path.resolve(__dirname, '../../cli/ink-studio.js'), ...args],
    { cwd: dir, encoding: 'utf8' });
  commands.push('ink-studio ' + args.join(' ') + (output ? ' > ' + output : ''));
  if (output) fs.writeFileSync(file(output), result);
  return result;
}

const scene = {
  id: 'relay-delivery', style: 'slate',
  camera: { target: [0, .65, 0], yaw: .46, pitch: .23, dist: 5.2, projection: 'orthographic', sway: 0 },
  solids: [
    { id: 'base', kind: 'box', at: [0, .15, 0], half: [.85, .15, .39], mat: 'dark' },
    { id: 'housing', kind: 'box', at: [0, .62, 0], half: [.73, .37, .34], mat: 'stone' },
    { id: 'panel', kind: 'box', at: [0, .64, .35], half: [.47, .19, .035], mat: 'dark' },
    { id: 'indicator', kind: 'ball', at: [0, .64, .40], r: .09, mat: 'glow' },
    { id: 'top-datum', kind: 'box', at: [0, 1.22, 0], half: [.21, .18, .22], mat: 'glow',
      deliveryHelper: { markerId: 'lift-datum' } },
    { id: 'service-clearance', kind: 'box', at: [1.10, .42, 0], half: [.22, .36, .31], mat: 'ember',
      deliveryHelper: { collisionRef: 'relay/clearance@1' } },
    { id: 'service-jack', kind: 'ball', at: [-1.00, .68, .13], r: .18, mat: 'glow',
      deliveryHelper: {}, sockets: { cable: { p: [-1.18, .68, .13], dir: [-1, 0, 0] } } }
  ]
};
fs.writeFileSync(file('scene.json'), JSON.stringify(scene, null, 2) + '\n');
cli(['render', 'scene.json', '--w', '288', '--h', '174', '--px', '1', '--zoom', '1.6', '--out', 'Authoring.png']);
const report = JSON.parse(cli(['export-glb', 'scene.json', '--res', '.075', '--texture-size', '256', '--out', 'relay.glb'],
  'delivery.json'));
cli(['interchange', 'relay.glb', '--out', 'relay.gltf'], 'interchange.json');
cli(['render', 'relay.glb', '--w', '288', '--h', '174', '--px', '1', '--yaw', '.46', '--pitch', '.23',
  '--ortho', '--out', 'Delivered.png']);
const asset = ink.readGltfAsset(file('relay.glb')), { document } = asset.snapshot();
assert.equal(report.helpers.length, 3);
assert.equal(document.meshes.length, 1);
for (const { node } of report.helpers) assert.ok(!Object.hasOwn(document.nodes[node], 'mesh'));
assert.deepEqual(ink.readGltfAsset(file('relay.gltf')).sample(), asset.sample());
fs.writeFileSync(file('COMMANDS.sh'), '#!/bin/sh\nset -eu\n' + commands.join('\n') + '\n');
fs.writeFileSync(file('README.md'), [
  '# Relay helper delivery', '',
  'Authoring.png shows the editable relay and its three brightly colored helper shapes.',
  'Delivered.png is a render of the exported GLB at the import preview scale.',
  'The GLB contains one visual mesh and three meshless helpers.',
  'delivery.json lists the lift datum, collision reference, and cable socket with their positions.',
  'relay.gltf contains the same node data in an inspectable JSON container.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.', ''
].join('\n'));
