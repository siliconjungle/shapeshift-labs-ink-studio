'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const { fixture } = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-isolation-demo');
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const file = name => path.join(dir, name);
const write = (name, value) => fs.writeFileSync(file(name), value);
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
fs.mkdirSync(dir, { recursive: true });

const { scene, library, request, view, image } = fixture();
const context = { ...request, hideSurroundings: false, edits: [] };
const blocked = { ...request, edits: [{ member: 'panel', transform: { operation: { kind: 'move', offset: [.12,0,0] } } }] };
json('station.json', scene);
json('library.json', library);
json('view.json', view);
json('context.json', context);
json('edit-west.json', request);
json('blocked.json', blocked);
write('Bay-paint.png', image);

const commands = [];
function run(source, query, image, output, report = query + '-report.json') {
  const args = ['mesh-topology','isolate-prefab',source,query + '.json',
    ...(image ? ['--view','view.json','--preview',image] : []), ...(output ? ['--out',output] : [])];
  commands.push('ink-studio ' + args.join(' ') + ' > ' + report);
  write(report, execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'}));
  return read(report);
}
const panels = ['Context-1x.png','Isolated-1x.png','Restored-1x.png'];
const first = run('station.json','context',panels[0]);
const edited = run('station.json','edit-west',panels[1],'revised-station.json');
const final = run('revised-station.json','context',panels[2],undefined,'restored-report.json');
const failed = spawnSync(process.execPath,[cli,'mesh-topology','isolate-prefab','station.json','blocked.json','--out','rejected.json'],
  { cwd:dir,encoding:'utf8' });
assert.equal(failed.status,1);
write('blocked-report.json',failed.stdout);
commands.push('status=0','ink-studio mesh-topology isolate-prefab station.json blocked.json --out rejected.json > blocked-report.json || status=$?',
  'test "$status" -eq 1','test ! -e rejected.json');
assert.deepEqual(read('blocked-report.json').conflicts[0].faces,['grille']);
assert.deepEqual(edited.edits[0].changedFaces,['sign']);
assert(first.preview.visible.some(row=>row.object==='pillar'));
assert.deepEqual(edited.preview.visible.map(row=>row.object),['west.body','west.panel']);
assert.deepEqual(final.preview.visible.map(row=>row.object),first.preview.visible.map(row=>row.object));
assert.deepEqual(read('revised-station.json').instances.east,scene.instances.east);

const W=1292,H=378,art=ink.load().KIT.procedural.drawing2d;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale,color='#f0e9d3')=>({type:'text',text,at:[x,y],scale,color});
const views=[
  ['FULL SCENE','Two instances share the same painted sign.'],
  ['ISOLATED WEST BAY','The pillar and east bay are hidden for inspection.'],
  ['RETURN TO SCENE','West has the new sign. East keeps its original paint.']
];
const board=art.render({width:W,height:H,edges:'hard',commands:[
  rect(0,0,W,H,'#192c34'),label('INK STUDIO / PREFAB EDITING',20,16,2,'#a7c4b4'),
  label('Isolate the west bay',20,43,3),
  ...views.flatMap(([title,note],i)=>{
    const x=20+i*424;
    return [label(title,x,97,2,'#a6dcc6'),rect(x-1,121,414,202,'#4d6e70'),label(note,x,339,1,'#b2c5c2')];
  })
]});
for (const [i,name] of panels.entries()) {
  const {w,h,data}=PNG.raster(file(name)), x=20+i*424;
  for (let y=0;y<2*h;y++) for (let u=0;u<2*w;u++) {
    const at=(Math.floor(y/2)*w+Math.floor(u/2))*4;
    board.data.set(data.subarray(at,at+4),((122+y)*W+x+u)*4);
  }
}
write('Prefab-isolation.png',PNG.encode(W,H,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',`# Isolate the west bay

Run \`sh COMMANDS.sh\` with \`ink-studio\` on your PATH.

Only the west sign is active. The isolation preview reveals the sign
behind a foreground pillar. The reskin changes its tile from BAY to NXT
and saves a local override. In context, the pillar returns and the east
bay retains its original sign.

A separate move tries to move the edge shared with the inactive grille.
The report names the grille as the blocker and the CLI produces no scene.
`);
