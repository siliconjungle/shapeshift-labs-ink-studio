'use strict';

const assert = require('node:assert/strict'), {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'station-properties');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js'), file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const read = name => fs.readFileSync(file(name));
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(dir,{recursive:true});

const {scene,library,view} = fixture(), {KIT:K} = ink.load();
library.bay.properties = {finish:'enamel',gain:2};
json('project-properties.json',{version:1,definitions:{
  powered:{type:'boolean'},finish:{type:'enum',choices:['steel','enamel','copper']},
  gain:{type:'number',min:0,max:5},label:{type:'string'}
},values:{powered:true,finish:'steel',gain:1,label:'Station'}});
json('library.json',library);
json('scene.json',{...scene,id:'station-properties',topologyMeshes:{},customProperties:'project-properties.json',
  instances:{...scene.instances,west:{...scene.instances.west,properties:{powered:false,gain:0,label:''}}}});
json('view.json',{...view,w:210,h:105,camera:{...view.camera,zoom:1.33}});
json('inspect.json',{scope:'instance',instance:'west'});
json('clear.json',{scope:'instance',instance:'west',values:{powered:null,gain:null,label:null}});

const commands = [];
function run(args,receipt) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+' > '+receipt);
  write(receipt,result);
  return JSON.parse(result);
}

const command = ['mesh-topology','custom-properties'];
const before = run([...command,'scene.json','inspect.json'],'inspect-receipt.json');
const cleared = run([...command,'scene.json','clear.json','--preview','review','--view','view.json',
  '--out','inherited.json'],'clear-receipt.json');
const after = run([...command,'inherited.json','inspect.json'],'inherited-receipt.json');
assert(before.before.powered.value===false && before.before.gain.value===0 && before.before.label.value==='');
assert(after.before.gain.value===2 && after.before.gain.source==='prefab');
assert(after.before.powered.value===true && after.before.powered.source==='project');
assert.deepEqual(cleared.after,after.before);
assert.deepEqual(read('review/before.png'),read('review/after.png'));

const width=640,height=257, drawing=K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const bg='#192c34', white='#efe6ce', mint='#b6e1cf', gold='#f3c96f', soft='#9dbab6';
const rows = [
  ['POWERED','powered'],['FINISH','finish'],['GAIN','gain'],['LABEL','label']
];
const values = row => {
  const authored = scope => Object.hasOwn(row.authored,scope) ? JSON.stringify(row.authored[scope]) : '-';
  return ['project','prefab','instance'].map(authored);
};
const rowCommands = rows.flatMap(([name,id],index) => {
  const y = 111+index*24, entry = before.before[id], next = after.before[id];
  return [label(name,16,y,1,white),
    ...values(entry).map((value,i)=>label(value,[116,218,320][i],y,1,soft)),
    label(JSON.stringify(entry.value),423,y,1,gold),
    label(JSON.stringify(next.value),520,y,1,mint),
    label(next.source,520,y+8,1,soft)];
});
const board = drawing.render({width,height,edges:'hard',commands:[
  {type:'rect',rect:[0,0,width,height],fill:bg},
  label('INK STUDIO / CUSTOM PROPERTIES',16,13,1,mint),
  label('Which value wins?',16,30,3,white),
  label('West bay retains its own values until the override is cleared.',16,65,1,soft),
  {type:'rect',rect:[14,88,608,111],fill:'#263e47'},
  ...['PROPERTY','PROJECT','PREFAB','INSTANCE','EFFECTIVE','AFTER CLEAR'].map((word,i)=>
    label(word,[16,116,218,320,423,520][i],95,1,i<4 ? mint : gold)),
  ...rowCommands,
  label('false, 0 and "" are explicit. A dash marks an omitted value.',16,213,1,white),
  label('The reviewed before and after renders match at 1x.',16,229,1,soft)
]});
write('Typed-custom-properties.png',PNG.encode(width,height,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Which value wins?','',
  'Open Typed-custom-properties.png for the property values at each scope.',
  'Run sh COMMANDS.sh in a fresh copy with ink-studio on your PATH.',
  'West inherits the enamel finish but stores false, 0 and an empty label locally.',
  'Clear those instance values and inspect which defaults take over.',
  'The receipts show each authored value and the scope that supplied the result.',
  'The native before and after renders compare byte for byte.',''
].join('\n'));
