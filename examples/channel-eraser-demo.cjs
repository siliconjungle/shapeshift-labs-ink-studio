'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const { compile } = require('../cli/character-rig-assembly.js');
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'channel-eraser-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const file = name => path.join(out, name);
const put = (name, value) => fs.writeFileSync(file(name + '.json'), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name + '.json'), 'utf8'));
const run = (...args) => {
  const result = execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
  return result.startsWith('{') || result.startsWith('[') ? JSON.parse(result) : result;
};

const look = {
  sun: [-.44, .57, .74], amb: .25, sky: .21,
  palette: [0x111e2a, 0x152e3c, 0x234657, 0x386675, 0x618a93, 0xa8c3b9,
    0x733e29, 0xc16b3d, 0xf39b52, 0xffd087, 0x225757, 0x368885, 0x76bdae, 0xc6e6bf],
  roles: { case: [1,2,3,4,5], copper: [6,7,8,9], mint: [10,11,12,13] }
};
const ball = (id, at, r, mat) => ({ id, kind: 'ball', at, r, mat, res: .025 });
const box = (id, at, half, round, mat = 'case') => ({ id, kind: 'box', at, half, round, mat, res: .029 });
const view = { yaw: -.055, pitch: .09, sway: 0, fov: .69 };
put('plate', {
  id:'relay-face', style: look, camera: { ...view, target: [0,0,.1], dist: 3.30 },
  finish: { detail: 15, dither: 0 },
  solids: [box('rim',[0,0,-.11],[1.36,.91,.16],.15), box('face',[0,0,.04],[1.24,.78,.18],.13),
    ...[-1,1].flatMap(x => [-1,1].map(y => ball('rivet-'+x+'-'+y,[1.10*x,.64*y,.21],.07,'copper')))]
});

const attachment = { kind:'surface', slot:'plate', snap:{ mode:'surface', direction:[0,0,1], maxDistance:.38 } };
const band = (id,y,settings) => ({ id, attachment, mat:'copper', brush:{kind:'sphere',radius:.126},
  poses:[{point:[-.85,y,.48]},{point:[.86,y,.48]}], step:.045, ...settings });
const marks = [
  band('signal-paint', .43, { relief:{mode:'flat'} }),
  band('blue-glaze', .02, { finish:{tint:{color:'#84fbff',strength:.94},roughness:.23,
    coating:{weight:.8},emission:{color:'#8bffff',strength:.58}} }),
  { id:'stitches', attachment, mat:'mint', brush:{kind:'box',half:[.105,.039,.08],round:.018},
    poses:[{point:[-.80,-.46,.48]},{point:[.93,-.46,.48]}], step:.168,
    relief:{mode:'flat'}, direction:{field:{kind:'axis',axis:[0,1,0]},strength:1} }
];
put('placement',{id:'face-detail',bindings:{plate:'face'},
  painting:{format:KIT.authoring.paintings3d.format,version:1,id:'signal-bands',marks}});
run('painting-3d','apply','plate.json','placement.json','--out','full-plate.json');

const shapeEdit = (id, y, channel) => ({ op:'set-eraser', id, eraser:'middle',
  patch:{ points:[[-.19,y,.22],[.19,y,.22]], radius:.24, feather:.39, channels:[channel] } });
put('plate-edit',{id:'face-detail',edits:[
  shapeEdit('signal-paint',.43,'paint'),shapeEdit('blue-glaze',.02,'emission'),shapeEdit('stitches',-.46,'direction')
]});
run('painting-3d','update','full-plate.json','plate-edit.json','--out','erased-plate.json');
put('plate-restore',{id:'face-detail',edits:marks.map(({id})=>({op:'set-eraser',id,eraser:'middle',patch:{strength:.45}}))});
run('painting-3d','update','erased-plate.json','plate-restore.json','--out','soft-plate.json');
assert.deepEqual(run('painting-3d','inspect','soft-plate.json')[0].marks.map(mark=>mark.erasers[0].strength),[.45,.45,.45]);

const hinge = { type:'hinge',axis:[0,0,1],angle:[-170,170] };
const rig = compile({format:'ink-studio/character-rig',version:1,id:'semaphore',components:[],joints:[
  {id:'stand.base',parent:null,at:[0,0,0],limit:{type:'fixed'}},
  {id:'stand.shoulder',parent:'stand.base',at:[-.48,.21,.15],limit:hinge},
  {id:'stand.elbow',parent:'stand.shoulder',at:[-.92,.21,.15],limit:hinge},
  {id:'stand.signal',parent:'stand.elbow',at:[-1.38,.21,.15],limit:{type:'fixed'}},
  {id:'stand.dial',parent:'stand.base',at:[.22,.29,.40],limit:hinge},
  {id:'stand.dial-tip',parent:'stand.dial',at:[.22,.53,.40],limit:{type:'fixed'}}
]},KIT);
put('rig',rig.document);
const keys = value => [{time:0,value:[value]}];
const pose = (shoulder,elbow,dial) => ({type:'curves',duration:1,joints:{
  'stand.shoulder':keys(shoulder),'stand.elbow':keys(elbow),'stand.dial':keys(dial)
}});
const motion = {format:'ink-studio/character-motion',version:1,id:'signal',rigHash:rig.hash,clips:{
  weight:pose(-65,-12,18),reach:pose(-65,74,-34),
  signal:{type:'mix',duration:1,layers:[{id:'weight',clip:'weight',at:0},{id:'reach',clip:'reach',at:0}]}
}};
put('full-motion',motion);
const motionEdit = patch => ({format:'ink-studio/character-motion-edit',version:1,
  operations:[{op:'set-eraser',clip:'signal',layer:'reach',eraser:'elbow-soften',patch}]});
put('motion-edit',motionEdit({start:.2,end:.8,controls:['stand.elbow'],strength:1}));
run('character-motion','edit','rig.json','full-motion.json','motion-edit.json','--out','erased-motion.json');
put('motion-restore',motionEdit({strength:.45}));
run('character-motion','edit','rig.json','erased-motion.json','motion-restore.json','--out','soft-motion.json');
assert.deepEqual(read('soft-motion').clips.reach,motion.clips.reach);

const tube = (id,a,b,r,mat) => ({id,kind:'tube',pts:[a,b],r,mat,res:.024});
const reports = [];
for (const label of ['full','erased','soft']) {
  run('character-motion','sample','rig.json',label+'-motion.json','signal','--at','.5','--out',label+'-pose.json');
  const sample = read(label+'-pose');
  const joint = name => sample.joints['stand.'+name].position;
  const shoulder = joint('shoulder'), elbow = joint('elbow'), signal = joint('signal');
  const dial = joint('dial'), needle = joint('dial-tip');
  reports.push({file:label+'-pose.json',elbow:sample.angles['stand.elbow'][0],dial:sample.angles['stand.dial'][0]});
  put(label+'-actor',{id:'signal-stand',style:look,camera:{...view,target:[-.18,.2,0],dist:2.94},
    finish:{detail:15,dither:0},
    solids:[
      box('bus',[0,-.51,-.1],[.97,.11,.32],.13),box('tower',[-.15,-.025,-.05],[.51,.49,.25],.16),
      box('gauge',[.24,.28,.14],[.33,.35,.17],.18),
      tube('upper',shoulder,elbow,.09,'case'), tube('fore',elbow,signal,.078,'mint'),
      ball('pivot',shoulder,.134,'copper'),ball('elbow',elbow,.098,'copper'),ball('lamp',signal,.124,'copper'),
      tube('needle',dial,needle,.026,'copper'),ball('dial',dial,.07,'mint')
    ]});
}
assert.deepEqual(reports.map(({elbow,dial})=>[Math.round(elbow),Math.round(dial)]),[[74,-34],[-12,-34],[35,-34]]);
put('demo-report',{sampleTime:.5,motion:reports,paintEdit:'plate-edit.json',motionEdit:'motion-edit.json'});

const w=324,h=215,gap=12,W=3*w+4*gap,H=540;
const commands = [{type:'rect',rect:[0,0,W,H],fill:'#0d1a24'}];
const text = (text,x,y,scale,color) => commands.push({type:'text',text,at:[x,y],scale,color});
const cream='#f2dbc1', mint='#8ac6c6';
text('CHANNEL ERASERS',gap,12,3,cream);
text('SURFACE  /  PIGMENT, GLOW AND BRUSH DIRECTION',gap,45,1,mint);
text('MOTION  /  SAME FRAME, ELBOW ONLY',gap,296,1,mint);
const variants = [['full','ORIGINAL'],['erased','100% ERASE'],['soft','45% ERASE']];
for (const [i,[,title]] of variants.entries()) {
  const x=gap+i*(w+gap);
  text(title,x+8,272,2,cream);
}
const sheet = KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for (const [i,[label]] of variants.entries()) for (const [row,subject] of ['plate','actor'].entries()) {
  const name = label+'-'+subject;
  run('render',name+'.json','--ortho','--raw','--px','1','--w',String(w),'--h',String(h),'--out',name+'.png');
  const image = PNG.raster(file(name+'.png'));
  const x=gap+i*(w+gap), y=row ? 310 : 53;
  for(let j=0;j<h;j++) sheet.data.set(image.data.subarray(j*w*4,(j+1)*w*4),((y+j)*W+x)*4);
}
const image = file('channel-eraser-demo.png');
fs.writeFileSync(image,PNG.encode(W,H,sheet.data,4));
console.log(image);
