'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const ink = require('../..'), PNG = require('../../cli/png.js');
const {fixture} = require('./prefab-isolation-fixture.cjs');

const dir = path.resolve(process.argv[2] ?? 'prefab-replacement-demo');
const cli = path.resolve(__dirname,'../../cli/ink-studio.js');
const file = name => path.join(dir,name);
const write = (name,data) => fs.writeFileSync(file(name),data);
const json = (name,data) => write(name,JSON.stringify(data,null,2)+'\n');
const read = name => JSON.parse(fs.readFileSync(file(name)));
fs.mkdirSync(dir,{recursive:true});

const {scene,library,panel} = fixture();
const {prefabLibrary,instances,...base} = scene, {KIT:K} = ink.load();
const pick = x => ink.pickTilesetRectangle(scene,'enamel',{x,y:0,width:24,height:24});
const editor = ink.createSceneEditor({...base,topologyMeshes:{panel}});
editor.applyTilesetReskin({object:'panel',face:'grille',selection:pick(48)});
const revised = {revision:7,solids:{body:{...library.bay.solids.body,half:[.86,.53,.12],mat:'stone'}},
  topologyMeshes:{fascia:editor.meshTopology('panel')},usesTilesets:['enamel']};
json('source.json',{...base,id:'replace-station-bays',prefabs:{...library,revised},instances:{},topologyMeshes:{},
  constructionPlane:{origin:[-2.03,0,0],grid:[.5,.5]},
  camera:{target:[0,.49,0],yaw:-.06,pitch:.08,dist:5,projection:'orthographic',sway:0}});
json('stamp.json',{prefab:'bay',id:'bay',at:[0,0],count:3,step:[4.06,0],snapGrid:false});
json('local.json',{instance:'bay.0',faces:{panel:['sign']},edits:[{member:'panel',reskin:{face:'sign',selection:pick(48)}}]});
const decal = K.surfaceDecals.add(undefined,{id:'right-marker',kind:'lettering',
  anchor:{object:'bay.2.panel',face:'sign',uv:{min:[.06,.10],max:[.13,.27]},bias:.004},
  image:{width:1,height:1,pixels:[246,195,110,255]}});
json('decorate.json',[{op:'set',path:'/surfaceDecals',value:decal},
  {op:'set',path:'/instances/bay.2/overrides',value:[{op:'set',path:'/solids/body/mat',value:'dark'}]}]);
json('pick.json',{domain:'instances',query:{kind:'prefab',ids:['bay.0','bay.2']}});
json('replace.json',{to:'revised',revision:7,migrations:{bay:{revision:3,members:{topologyMeshes:{panel:'fascia'}}}}});
json('view.json',{w:226,h:110,raw:true,camera:{yaw:-.06,pitch:.08,dist:5,target:[0,.49,0],ortho:true,zoom:1.45}});

const commands = [];
function run(args,report) {
  const result = execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  commands.push('ink-studio '+args.join(' ')+(report ? ' > '+report : ''));
  if (report) write(report,result);
  return result;
}
run(['tileset','stamp-prefab','stamp.json','--scene','source.json','--out','row.json'],'stamp-receipt.json');
run(['mesh-topology','isolate-prefab','row.json','local.json','--out','local-row.json'],'local-receipt.json');
run(['scene','apply','local-row.json','decorate.json','--out','decorated.json']);
run(['tileset','select','pick.json','--scene','decorated.json','--out','selected.json'],'selection-receipt.json');
const args = ['mesh-topology','replace-prefab','decorated.json','replace.json','--selection','selected.json','--view','view.json','--preview','review'];
const preview = JSON.parse(run(args,'preview-receipt.json'));
const receipt = JSON.parse(run([...args,'--out','replaced.json'],'replace-receipt.json'));
assert.deepEqual(preview,receipt);
assert(receipt.canCommit);
assert.deepEqual(receipt.instances.map(row=>row.instance),['bay.0','bay.2']);
assert.equal(receipt.instances[0].meshOverrides[0].status,'rebased');
assert.equal(receipt.instances[1].overrides[0].status,'touched');
assert.equal(receipt.anchors.find(row=>row.id==='right-marker').after.object,'bay.2.fascia');
assert(receipt.preview.instances.every(row=>row.changedPixels>0));
assert.equal(read('replaced.json').instances['bay.1'].prefab,'bay');

const w=730,h=253, drawing = K.procedural.drawing2d;
const label = (text,x,y,scale,color) => ({type:'text',text,at:[x,y],scale,color});
const panels = [
  ['ORIGINAL PLACEMENTS','before.png','Replace the left and right bays.'],
  ['AFTER REPLACEMENT','after.png','The local sign and marker carry over.'],
  ['CHANGED PIXELS','changes.png','The middle bay stays on its source.']
];
const board = drawing.render({width:w,height:h,edges:'hard',commands:[
  {type:'rect',rect:[0,0,w,h],fill:'#192c34'},
  label('INK STUDIO / LINKED PREFABS',16,15,1,'#abc9b4'),
  label('Replace two bays in place',16,34,3,'#efe6ce'),
  ...panels.flatMap(([title,,note],i) => {
    const x=16+i*236;
    return [label(title,x,89,1,'#b6e1cf'),label(note,x,229,1,'#abc9b4')];
  })
]});
for (const [i,[,png]] of panels.entries()) {
  const {w:width,h:height,data} = PNG.raster(file('review/'+png));
  const x=16+i*236;
  for (let y=0;y<height;y++) board.data.set(data.subarray(y*width*4,(y+1)*width*4),((101+y)*w+x)*4);
}
write('Prefab-replacement.png',PNG.encode(w,h,board.data,4));
write('COMMANDS.sh','#!/bin/sh\nset -eu\n'+commands.join('\n')+'\n');
write('README.md',[
  '# Replace two bays in place','',
  'Run `sh COMMANDS.sh` with `ink-studio` on your PATH.',
  'Select the outside bays and replace them with revision 7.',
  'The left sign is a local mesh override. The right has a body material override and a UV marker.',
  'The new prefab renames the panel member to fascia, and the marker follows it.',
  'The center bay stays linked to the original definition.',
  'The receipts list the retained transforms, overrides, and anchor coverage.', ''
].join('\n'));
