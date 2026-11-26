const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const kit = require('..').load(), { KIT: K } = kit;
const { compile } = require('../cli/character-rig-assembly.js');
const { loadBinding } = require('../cli/character-rig-bind.js');
const { compileCatalog, sample: sampleMotion } = require('../cli/character-motion.js');
const { render, grid } = require('../cli/render.js');
const files = require('../cli/asset-files.js');
const PNG = require('../cli/png.js');

const out = path.resolve(process.argv[2] ?? 'surveyor-signal');
const at = (...parts) => path.join(out,...parts);
const save = (name,document) => files.json(at(name),document);
const read = name => JSON.parse(fs.readFileSync(at(name),'utf8'));
const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const run = (...args) => JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8'}));
const rig = (...args) => run('character-rig',...args);
const motion = (...args) => run('character-motion',...args);

execFileSync(process.execPath,[path.join(__dirname,'cinder-surveyor-rig.cjs'),at('cinder')]);
const source = read('cinder/rig.json'), sourcePose = read('cinder/rest.json');
const scale = [.86,1.18,1.08], stretch = p => p.map((n,i)=>n*scale[i]);
const enamel = {'#216473':'#81535a','#378893':'#a2625d','#68b2ac':'#d18a73','#b1dfc1':'#ffc09a'};
const pigment = color => enamel[color] ?? color;
const targetPlan = {...read('cinder/rig-plan.json'),id:'ember-surveyor',
  placements:Object.fromEntries(source.joints.map(({id,at})=>[id,stretch(at)]))};
save('ember/rig-plan.json',targetPlan);
rig('assemble',at('ember','rig-plan.json'),'--out',at('ember','rig.json'));
const binding = read('cinder/bind-plan.json');
binding.scene.palette = binding.scene.palette.map(pigment);
for (const carrier of binding.carriers) {
  const asset = read('cinder/'+carrier.file);
  if (carrier.materials) for (const material of carrier.materials) material.color = pigment(material.color);
  if (asset.vertices) for (const vertex of asset.vertices) vertex.position = stretch(vertex.position);
  if (asset.points) asset.points = asset.points.map(stretch);
  if (asset.mats) for (const material of asset.mats) material.rgb = pigment(material.rgb);
  if (asset.splats) for (const splat of asset.splats) {
    splat.at = stretch(splat.at);
    splat.normal = K.V.norm(splat.normal.map((n,i)=>n/scale[i]));
    splat.color = pigment(splat.color);
  }
  save('ember/'+carrier.file,asset);
}
save('ember/bind-plan.json',binding);
rig('bind',at('ember','rig.json'),at('ember','bind-plan.json'),'--out',at('ember','binding.json'));

const key = (time,value,ease='smooth') => ({time,value,ease});
const keys = (...rows) => rows.map(row=>key(...row));
const plants = read('cinder/reach-targets.json').targets.slice(0,2)
  .map(row=>({...row,start:0,end:2,tolerance:.004}));
const motionDoc = {format:'ink-studio/character-motion',version:1,id:'surveyor-signal',rigHash:sourcePose.rigHash,
  rootAllowance:[.18,.13,.15],clips:{
    weight:{type:'curves',duration:2,contacts:plants,root:keys(
      [0,[0,0,0]],[.4,[-.08,-.17,.01]],[.95,[.14,-.10,.095]],[1.48,[.09,-.14,.07]],[2,[0,0,0]]),
      joints:{'body.hips':keys([0,[0,0,0]],[.5,[7,-6,-7]],[1.1,[-6,9,6]],[2,[0,0,0]]),
        'body.spine':keys([0,[0,0,0]],[.5,[13,-2,-3]],[1.1,[-8,4,-8]],[2,[0,0,0]])}},
    salute:{type:'curves',duration:2,joints:{
      'arm-r.shoulder':keys([0,[0,0,0]],[.4,[-13,-10,15]],[1.02,[-13,5,72]],[1.32,[-12,6,62]],
        [1.7,[-40,18,33]],[2,[0,0,0]]),
      'arm-r.elbow':keys([0,[0]],[.4,[43]],[1.02,[52]],[1.32,[72]],[1.7,[29]],[2,[0]]),
      'arm-l.shoulder':keys([0,[0,0,0]],[.4,[-12,15,-22]],[1.25,[-18,-4,-18]],[2,[0,0,0]]),
      'body.chest':keys([0,[0,0,0]],[.55,[5,-13,-4]],[1.02,[-7,18,1]],[2,[0,0,0]])}},
    wrist:{type:'curves',duration:.65,joints:{
      'arm-r.hand':keys([0,[0,0,0]],[.27,[-12,15,-42]],[.47,[19,8,21]],[.65,[0,0,0]]),
      'body.head':keys([0,[0,0,0]],[.32,[0,29,4]],[.65,[0,0,0]])}},
    gesture:{type:'mix',duration:2,layers:[
      {id:'main-arc',clip:'salute',at:0},
      {id:'flash',clip:'wrist',at:.69,in:.08,out:.62,speed:.9,mode:'add',
        mask:['arm-r.hand','body.head'],weight:keys([0,0],[.19,1],[.42,1],[.6,0])}
    ]},
    signal:{type:'mix',duration:2,layers:[{id:'grounding',clip:'weight',at:0},{id:'upper-body',clip:'gesture',at:0}]}
  }};
save('motion.json',motionDoc);
motion('catalog',at('cinder','rig.json'),at('motion.json'),'--out',at('catalog.json'));
save('retarget-plan.json',{format:'ink-studio/character-motion-retarget',version:1,id:'ember-signal',fps:16,scale});
const report = motion('retarget',at('cinder','rig.json'),at('motion.json'),'signal',at('ember','rig.json'),
  at('retarget-plan.json'),'--out',at('ember-motion.json'),'--report',at('retarget-report.json'),'--require-solved');
assert(report.passed);

const newView = {...read('cinder/view.json'),w:202,h:230};
newView.camera = {...newView.camera,target:[0,1.54,0],dist:6.2};
save('view.json',newView);
const sample = (actor,catalog,label,time,...options)=>motion('sample',at(actor,'rig.json'),at(catalog),'signal',
  '--at',String(time),'--out',at('frames',label+'.json'),'--require-solved',...options);
function capture(actor,label) {
  const v = rig('preview',at(actor,'rig.json'),at(actor,'binding.json'),at('frames',label+'.json'),
    '--view',at('view.json'),'--out',at('renders',label));
  const bytes = fs.readFileSync(at('renders',label,v.image));
  files.write(at('frames',label+'.png'),bytes);
  return PNG.raster(at('frames',label+'.png'));
}
const beats = [['gather',.395],['signal',1.02],['release',1.695]];
const frames = [], free = sample('cinder','motion.json','free-signal',1.02,'--free');
for (const [actor,catalog] of [['cinder','motion.json'],['ember','ember-motion.json']]) {
  for (const [label,time] of beats) {
    const id = actor+'-'+label, pose = sample(actor,catalog,id,time);
    frames.push({id,time,pose,image:capture(actor,id)});
  }
}
const peak = frames.find(frame=>frame.id==='ember-signal').pose;
const changed = {...peak.angles,'arm-r.elbow':[8],'body.head':[-8,-43,-5]};
save('pose-adjustment.json',{format:'ink-studio/character-ik',version:1,
  root:{min:peak.rootTranslation.map(n=>Math.min(0,n)),max:peak.rootTranslation.map(n=>Math.max(0,n))},
  initial:{angles:changed,root:peak.rootTranslation},targets:peak.solve.targets.map(row=>({
    id:row.id,joint:row.joint,at:row.position.at,offset:report.contacts.find(contact=>contact.id===row.id).offset,
    tolerance:row.position.tolerance,weight:row.position.weight
  }))});
rig('solve',at('ember','rig.json'),at('pose-adjustment.json'),'--out',at('adjusted-pose.json'),'--require-solved');
const index = motion('catalog',at('ember','rig.json'),at('ember-motion.json'));
save('edits.json',{format:'ink-studio/character-motion-edit',version:1,revision:index.revision,
  operations:[{op:'key-pose',clip:'signal',time:1.02,pose:'adjusted-pose.json',controls:['arm-r.elbow','body.head']}]});
motion('edit',at('ember','rig.json'),at('ember-motion.json'),at('edits.json'),'--out',at('ember-edited.json'));
const edited = sample('ember','ember-edited.json','ember-edited',1.02);
assert(Math.abs(edited.angles['arm-r.elbow'][0]-8)<1e-8);
assert(edited.angles['body.head'][1]<-40);
const contactError = row => Math.max(...row.solve.targets.map(target=>target.position.residual));
const before = Math.max(...plants.map(p=>{
  const joint = free.joints[p.joint], point = K.V.add(joint.position,K.M.app(joint.matrix.slice(0,9),p.offset));
  return K.V.dist(point,p.at);
}));
const after = Math.max(...frames.map(({pose})=>contactError(pose)),contactError(edited));
assert(after<=.004 && before>.05);
assert(report.maxContactResidual<=.004);
const panels = [...frames.slice(0,3),null,...frames.slice(3),{id:'ember-edited',time:1.02,pose:edited,
  image:capture('ember','ember-edited')}];

const W=902,H=632, ground='#101d29', ink='#f1d9ae', soft='#a8c6c1', line='#486870';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=ink)=>({type:'text',text,at:[x,y],scale,color});
const commands=[rect(0,0,W,H,ground),text('SURVEYOR SIGNAL',22,18,3),text('LAYERED CHARACTER MOTION',689,25,1,soft),
  rect(22,58,858,1,line),text('CINDER / SOURCE',22,72,1,'#8ed3c6'),text('EMBER / RETARGET',22,342,1,'#f1a886'),
  rect(22,328,858,1,line),rect(22,602,858,1,line),
  text('BOTH BOOTS PLANTED THROUGH ALL SHOWN POSES',22,615,1,soft),
  text('WORST SHOWN BOOT ERROR  '+after.toFixed(4)+' UNITS',640,615,1,soft)];
for (const [i,title] of ['GATHER','SIGNAL','RELEASE','KEYED POSE'].entries()) {
  const x=22+i*219;
  if(i<3) commands.push(text(title+'  '+beats[i][1].toFixed(3)+' S',x,317,1,soft));
  commands.push(text(i<3?title+'  '+beats[i][1].toFixed(3)+' S':title+'  1.020 S',x,587,1,soft));
}
commands.push(rect(679,86,202,216,'#172b36'),text('PLANTED CONTACTS',692,103,1,'#8ed3c6'),
  text('SOURCE AT 1.020 S',692,122,1,soft),text('CONTACTS OFF',692,146,1,soft),
  text(before.toFixed(4)+' UNITS',692,162,2),text('CONTACTS ON',692,197,1,soft),
  text(contactError(frames[1].pose).toFixed(6)+' UNITS',692,213,2),
  rect(692,251,173,1,line),text('EMBER HAS LONGER LIMBS',692,267,1,soft),
  text('POSE EDIT RE-KEYS ELBOW',692,281,1,soft),text('AND HEAD CONTROLS',692,293,1,soft));
const sheet = K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for (const [i,panel] of panels.entries()) {
  if (!panel) continue;
  const image=panel.image,x0=22+(i%4)*219,y0=i<4?84:354;
  for (let y=0;y<image.h;y++) {
    const source=y*image.w*4, target=((y0+y)*W+x0)*4;
    sheet.data.set(image.data.subarray(source,source+image.w*4),target);
  }
}
files.write(at('surveyor-signal.png'),PNG.encode(W,H,sheet.data,4));
const motionSessions = [['cinder',motionDoc],['ember',read('ember-motion.json')]].map(([actor,document])=>{
  const target = compile(read(actor+'/rig.json'),K);
  return {actor,catalog:compileCatalog(target,document,K),binding:loadBinding(target,read(actor+'/binding.json'),at(actor),kit)};
});
const fps=12, count=24, loopFrames=[], loopReceipts=[];
const viewOptions={w:newView.w,h:newView.h,px:1,t:0,raw:true,
  camera:K.procedural.sceneGraph.camera(newView.camera),splatDepthProxies:true,shutter:false,renderGrid:false};
for (let i=0;i<count;i++) {
  const time=i/fps, measurements={time};
  const views=motionSessions.map(({actor,catalog,binding})=>{
    const pose=sampleMotion(catalog,'signal',time,K);
    assert(pose.solve.passed && pose.solve.targets.length===2,JSON.stringify(pose.solve));
    measurements[actor]=contactError(pose);
    binding.apply(pose);
    return render(binding.world,viewOptions);
  });
  loopFrames.push(PNG.packFrame(grid(views,2,['CINDER / SOURCE','EMBER / RETARGET'])));
  loopReceipts.push(measurements);
}
const loop='surveyor-signal-loop.png';
files.write(at(loop),PNG.encodeAnimation(loopFrames,fps));
const verify=PNG.readFullFrameAnimation(at(loop),{w:newView.w*2,h:newView.h,count,fps});
assert(new Set(verify.map(frame=>frame.compressed.toString('base64'))).size===count);
save('demo-report.json',{image:'surveyor-signal.png',loop:{file:loop,fps,count,contacts:loopReceipts,
    worstResidual:Math.max(...loopReceipts.flatMap(({cinder,ember})=>[cinder,ember]))},
  catalog:'catalog.json',retarget:'retarget-report.json',edited:'ember-edited.json',
  scale,frames:panels.filter(Boolean).map(({id,time,pose})=>({image:'frames/'+id+'.png',pose:'frames/'+id+'.json',time,
    contactResidual:contactError(pose),maxBoneDrift:pose.maxBoneDrift})),
  disabledPeakContactResidual:before,sourcePeakContactResidual:contactError(frames[1].pose),worstPreviewContactResidual:after,
  editedElbow:{before:peak.angles['arm-r.elbow'][0],after:edited.angles['arm-r.elbow'][0]}});
console.log(at('surveyor-signal.png'));
