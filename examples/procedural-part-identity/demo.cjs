/* A relay cabinet retains its authored roles through three graph regenerations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {KIT: K} = ink.load();
const output = path.resolve(process.argv[2] ?? 'relay-review');
fs.mkdirSync(output, {recursive: true});
const file = name => path.join(output, name);
const save = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data, null, 2) + '\n');
const node = (op, inputs) => ({op, inputs});
const input = input => ({input});
const ref = (node, port) => ({node, ...(port && {port})});
const edit = (member, mat) => ({op: 'set', path: ['solids', member, 'mat'], value: mat});
const part = (id, value, splitFrom) => ({id, value, ...(splitFrom && {splitFrom})});
const box = (at, half, mat, round = .035) => ({kind: 'box', at, half, mat, round, res: .042});
const tube = (pts, r, mat) => ({kind: 'tube', pts, r, mat, res: .028});
const ball = (at, r, mat) => ({kind: 'ball', at, r, mat, res: .027});

const graph = {format: 'ink-studio/graph-project', version: 1, seed: 57,
  inputs: {revision: 'number', pieces: 'array<record>', scatter: 'record'},
  groups: {
    Shape: {inputs: {item: 'record'}, nodes: {read: node('data.get', {record: input('item'), key: 'value'})},
      outputs: {value: ref('read')}},
    Fastener: {inputs: {item: 'record'}, nodes: {
      at: node('data.get', {record: input('item'), key: 'point'}),
      jitter: node('random', {}),
      variance: node('multiply', {a: ref('jitter'), b: .013}),
      size: node('add', {a: ref('variance'), b: .056}),
      head: node('data.record', {kind: 'ball', at: ref('at'), r: ref('size'), mat: 'alloy', res: .023})
    }, outputs: {value: ref('head')}}
  },
  nodes: {
    plates: {...node('array.mapById', {items: input('pieces')}), group: 'Shape'},
    scatter: node('proc.scatter', {options: input('scatter')}),
    bolts: {...node('array.mapById', {items: ref('scatter', 'samples')}), group: 'Fastener'},
    batches: node('data.record', {plates: ref('plates'), bolts: ref('bolts')}),
    sections: node('data.record', {solids: ref('batches')}),
    prefab: node('model.prefab', {model: 'mothlight-relay', revision: input('revision'), sections: ref('sections')})
  },
  outputs: {prefab: ref('prefab'), fasteners: ref('scatter', 'samples')}
};
save('relay.graph.json', graph);
const project = ink.createGraphProject(graph);

function controls(revision, span) {
  const pieces = [
    part('chassis', box([0, .99, -.12], [span, .98, .37], 'slate', .13)),
    part('panel', box([0, 1.04, .264], [span - .175, .797, .093], 'patina', .087)),
    part('bolt-rail', box([0, 1.867, .30], [span - .10, .075, .095], 'rail', .04)),
    part('toe', box([0, .120, .025], [span + .08, .165, .395], 'slate', .065)),
    part('conduit', tube([[-span+.28,.38,.356],[-span+.47,.37,.495],[-.61,.46,.51],
      [-.25,.73,.513],[.22,.71,.51],[.56,.44,.508],[span-.49,.41,.49],[span-.28,.56,.355]], .042, 'slate')),
    part('screen-case', box([-.25,1.30,.363],[.64,.315,.056],'slate',.07)),
    part('screen', box([-.25,1.30,.43],[.54,.238,.037],'glass',.045)),
    part('waveform', tube([[-.70,1.275,.489],[-.53,1.275,.489],[-.43,1.389,.489],[-.31,1.173,.489],
      [-.16,1.353,.489],[-.04,1.275,.489],[.20,1.275,.489]],.019,'mint')),
    ...[0,1,2].map(i => part('lamp-'+i,ball([span-.34,1.54-i*.25,.379],[.084,.084,.042],
      ['mint','gold','pink'][i]))),
    ...[-1,1].flatMap(side => [0,1,2].map(i => part('vent-'+(side === -1 ? 'left' : 'right')+'-'+i,
      box([side*(span-.39),.74+i*.11,.368],[.16,.024,.021],'rail',.012)))),
    ...[-1,1].map(side => part('socket-'+(side < 0 ? 'left' : 'right'),ball([side*(span-.29),side < 0 ? .38 : .56,.385],
      [.114,.114,.071],'alloy')))
  ];
  if (revision < 3) pieces.push(part('rail', box([0,.26,.394],[span-.29,.037,.049],'patina',.024)),
    part('service-tag', box([.48,1.13,.402],[.12,.068,.034],'rail',.016)));
  else for (const [name, side] of [['rail-left',-1],['rail-right',1]])
    pieces.push(part(name, box([side*span*.52,.26,.394],[span*.4-.12,.037,.049],'patina',.024), 'rail'));
  return {revision, pieces: revision === 2 ? pieces.reverse() : pieces,
    scatter: {bounds: {min: [-span+.20, 1.829, .402], max: [span-.20, 1.907, .48]}, radius: .13,
      grid: {id: 'fastener', origin: [0,1.868,.443], step: [.32,.26,.21], jitter: .13}}};
}

const palette = ['#101f2e','#1b2c3b','#2f4351','#49606a','#6e858a','#a3b3aa',
  '#1c4446','#286260','#429080','#86be9a','#3c2b3e','#69424c','#a45a55','#d48965','#f5c485','#ffe2a6',
  '#182a34','#234451','#33616a','#64a89a','#91e1bc','#dbf3ce',
  '#6c3949','#b95063','#f28683'].map(color => Number.parseInt(color.slice(1),16));
const overrides = [
  edit('panel','enamel'), edit('conduit','mint'), edit('fastener.0.0.0','pink'),
  edit('rail','gold'), edit('service-tag','mint')
];
const scene = {id: 'mothlight-relay', solids: [
  box([0,-.15,.004],[2.24,.13,.67],'slate',.14),
  box([0,-.048,.127],[2.13,.035,.58],'alloy',.04)
], prefabLibrary: 'library.json', instances: {relay: {prefab: 'cabinet', overrides}},
palette, roles: {metal:[2,4,5], accent:[23,24], slate: [1,2,3,4], alloy:[2,4,5,15], patina:[6,7,8,9], enamel:[10,11,12,13,14],
  rail:[0,1,2], glass:[16,17,18,19], mint:[7,9,20,21], pink:[22,23,24], gold:[11,13,14,15]},
light: {sun: [-.49,.88,.64], amb: .54},
camera: {target: [0,.91,0], yaw: .15, pitch: .135, dist: 5.35, projection: 'orthographic'},
finish: {radius: 8, dither: 0, fog: {c: 0, start: 1, max: 0}}};

const revisions = [1.25, 1.61, 1.61].map((span,i) => {
  const values = controls(i+1,span), result = project.run({inputs: values}).outputs;
  save('r'+(i+1)+'.inputs.json',values);
  return result;
});
const library = n => ({cabinet: revisions[n-1].prefab});
const editor = ink.createSceneEditor(scene,{env:{prefabs:library(1)}});
const compatible = editor.planPrefabRefresh(library(2));
assert(compatible.ok);
assert(compatible.instances[0].overrides.every(row => row.status === 'preserved'));
assert(revisions[1].fasteners.length > revisions[0].fasteners.length);
for (const {id} of revisions[0].fasteners)
  assert.deepEqual(revisions[0].prefab.solids[id],revisions[1].prefab.solids[id]);
editor.refreshPrefabs(library(2));
const blocked = editor.planPrefabRefresh(library(3));
assert.equal(blocked.ok,false);
assert.deepEqual(blocked.instances[0].overrides.slice(-2).map(row => row.status),['split','removed']);
assert.equal(editor.node('prefab:relay').revision,2);
const resolution = {...scene, instances: {relay: {prefab:'cabinet',
  overrides: [...overrides.slice(0,3), edit('rail-left','gold')]}}};
save('compatible-review.json',compatible);
save('split-review.json',blocked);

const w = 194, h = 124, renders = [];
for (const [i,source] of [scene, scene, resolution].entries()) {
  const dir = file('r'+(i+1));
  fs.mkdirSync(dir,{recursive:true});
  save('r'+(i+1)+'/scene.json',source);
  save('r'+(i+1)+'/library.json',library(i+1));
  const built = ink.createSceneEditor(source,{env:{prefabs:library(i+1)}}).build();
  const frame = ink.render(built,{w,h,px:1,raw:true,edges:false,lockCamera:true});
  PNG.write(path.join(dir,'native.png'),w,h,frame.rgb);
  renders.push(frame);
}

const width = 1244, height = 472, commands = [];
const rect = (x,y,w,h,fill) => commands.push({type:'rect',rect:[x,y,w,h],fill});
const text = (text,x,y,scale,color) => commands.push({type:'text',text,at:[x,y],scale,color});
const ivory = '#e8eee2', muted = '#97b2be', mint = '#7cdec4', gold = '#f7c283';
rect(0,0,width,height,'#0d1824');
rect(23,24,13,3,mint);
text('INK STUDIO / PROCEDURAL MODELING',48,19,2,mint);
text('Mothlight Relay',22,48,4,ivory);
text('THE SAME PLACED CABINET THROUGH THREE GRAPH REVISIONS',23,86,1,muted);
for (const [i,[title,note1,note2,color]] of [
  ['Original cabinet','LOCAL FINISHES ON PANEL, CONDUIT AND FASTENER','BRASS RAIL AND MINT SERVICE TAG',mint],
  ['Wider regeneration','MORE FASTENERS, SAME AUTHORED PART IDS','ALL FIVE LOCAL OVERRIDES CARRY FORWARD',mint],
  ['Split reviewed','RAIL SPLIT REQUIRES AN EXPLICIT TARGET','BRASS MOVES TO LEFT RAIL. SERVICE TAG RETIRED.',gold]
].entries()) {
  const x = 23+i*405;
  text(title,x,120,2,color);
  rect(x-1,143,w*2+2,h*2+2,'#355163');
  text(note1,x,407,1,ivory);
  text(note2,x,425,1,muted);
}
rect(23,449,width-46,1,'#2b4556');
text('MATCHED NATIVE RENDERS    194 X 124 DISPLAYED AT 2X',23,458,1,muted);
const board = K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
for (const [i,frame] of renders.entries()) {
  const x = 23+i*405;
  for (let row=0; row<h*2; row++) for (let col=0; col<w*2; col++) {
    const from=(Math.floor(row/2)*w+Math.floor(col/2))*3, to=((144+row)*width+x+col)*4;
    board.data.set(frame.rgb.subarray(from,from+3),to);
  }
}
fs.writeFileSync(file('comparison.png'),PNG.encodeFrame(PNG.packRGBA(board)));
