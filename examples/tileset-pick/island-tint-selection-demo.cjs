'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { fixture } = require('../mesh-uv-workshop.cjs');

const dir = path.resolve(process.argv[2] ?? 'island-tint-review');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir, name);
const write = (name, value) => fs.writeFileSync(file(name), value);
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
fs.mkdirSync(dir, { recursive: true });

const kit = ink.load(), { doc, view } = fixture(kit), amber = [.82, .46, .18];
const tintFaces = ['lid', 'rear', 'right-wing'];
const faces = doc.faces.map(face => tintFaces.includes(face.id) ? { ...face,
  corners: face.corners.map(corner => ({ ...corner, attributes: { ...corner.attributes, tint: amber } })) } : face);
const scene = { id: 'field-case-selection', style: 'slate', solids: [],
  camera: { target: [0,0,0], dist: 7.4, yaw: .49, pitch: .31, projection: 'orthographic', sway: 0 },
  topologyMeshes: { case: { document: { ...doc, faces }, materials: view.materials } } };
json('field-case.json', scene);
json('view.json', { w: view.w, h: view.h, camera: { ...view.camera, zoom: 1.75 } });
json('island-query.json', { domain: 'islands', atlas: { at: [.42,.4], material: 'enamel' } });
json('tint-query.json', { domain: 'faces', tint: { color: amber, match: 'all' } });
json('edge-query.json', { convert: 'edges' });

const commands = [];
function run(args, stdout) {
  commands.push('ink-studio ' + args.join(' ') + ' > ' + (stdout ?? '/dev/null'));
  const output = execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  if (stdout) write(stdout, output);
}
const sections = [
  ['island', 'UV ISLAND', 'ONE ATLAS PICK / FIVE CONNECTED FACES', ['faceplate','left-wall','left-wing','right-wall','right-wing']],
  ['tint', 'VERTEX TINT', 'THREE MATCHES / REAR FACE OCCLUDED', tintFaces]
];
for (const [key,,, expected] of sections) {
  run(['mesh-uv','select','field-case.json',key+'-query.json','--object','case','--view','view.json',
    '--preview',key,'--out',key+'-report.json','--topology-out',key+'-faces.json']);
  const report = read(key+'-report.json');
  assert.deepEqual(report.faces, expected);
  assert.deepEqual(read(key+'-faces.json').ids, expected);
  assert.deepEqual(report.preview.crossHighlight.faces.map(row => row.id), expected);
  if (key === 'tint') {
    const counts = new Map(report.preview.crossHighlight.faces.map(row => [row.id, row.visiblePixels]));
    assert.equal(counts.get('rear'), 0);
    assert(counts.get('lid') > 0 && counts.get('right-wing') > 0);
  }
}
run(['mesh-topology','select','field-case.json','edge-query.json','--object','case','--from','tint-faces.json'], 'tint-edges.json');
assert(read('tint-edges.json').ids.length > 0);

const W = 910, H = 522, art = kit.KIT.procedural.drawing2d;
const rect = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale,color='#f3edda') => ({type:'text',text,at:[x,y],scale,color});
const board = art.render({ width: W, height: H, edges: 'hard', commands: [
  rect(0,0,W,H,'#172831'),
  label('INK STUDIO / TILE MESHES',24,18,2,'#a0beaa'),
  label('Select by UV island or vertex tint',24,49,3),
  ...sections.flatMap(([,title,note],i) => {
    const x = 24 + i * 447;
    return [label(title,x,110,2,'#8ee2ca'),label(note,x,141,1,'#adc8c8'),
      rect(x-1,197,186,186,'#4d6c6e'),rect(x+196,197,234,186,'#4d6c6e'),
      label('ATLAS',x,176,1),label('SCENE / 1X',x+197,176,1)];
  }),
  label('ISLAND STOPS AT CUTS AND UV DISCONTINUITIES',24,405,1,'#adc8c8'),
  label('REAR STILL HIGHLIGHTS IN THE ATLAS',471,405,1,'#adc8c8'),
  rect(24,454,862,1,'#4d6c6e'),rect(24,473,8,8,'#75e2c8'),
  label('MATCHING FACES / SAME STABLE IDS IN BOTH VIEWS',42,473,1,'#adc8c8')
] });
for (const [i,[key]] of sections.entries()) for (const [name, x] of [['atlas',24],['model',221]]) {
  const { w, h, data } = PNG.raster(file(key+'/'+name+'-before.png'));
  for (let y=0; y<h; y++) {
    const at = ((198+y)*W+x+i*447)*4;
    board.data.set(data.subarray(y*w*4,(y+1)*w*4), at);
  }
}
write('Island-and-tint-selection.png', PNG.encode(W,H,board.data,4));
write('COMMANDS.sh', '#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md', `# Field case selection

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.

The atlas pick selects the connected front island. A second query selects
the lid, right wing, and rear by exact authored tint. The rear is hidden
from the review camera and remains highlighted in the atlas. Both queries
save reusable face selections. The final command converts the tint
selection to mesh edges.
`);
