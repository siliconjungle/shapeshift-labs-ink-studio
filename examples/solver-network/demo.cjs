const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load();
const PNG=require('../../cli/png.js'), files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'out/ceramic-mill'), at=(...parts)=>path.join(out,...parts);
const source=at('source');
const input=(...parts)=>path.join(source,...parts);
const save=(name,data)=>files.json(input(name),data);
const read=name=>JSON.parse(fs.readFileSync(input(name),'utf8'));
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
function run(...args){
  const output=execFileSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:32*1024**2});
  return output.trim().startsWith('{')?JSON.parse(output):undefined;
}

const stock=require('../world-contact-effects.json');
save('stages/control.json',{format:'ink-studio/solver-stage',version:1,id:'trimmed-control',kind:'control',revision:1,
  config:{op:'scale',scale:1},ports:{inputs:{value:'number'},outputs:{value:'number'}}});
const gate=0, cell=.2, width=24, height=16, origin=[-2.4,-2.65];
const pool={kind:'water',revision:1,schedule:{substeps:2},config:{
  width,height,cell,origin,friction:.16,base:-.03,
  initial:[{bounds:{min:[-2.4,-2.65],max:[-.01,.55]},value:.34}],
  gates:{flume:{axis:0,opening:0,bounds:{min:[gate-.005,-2.65],max:[gate+.005,.55]}}},
  sensors:{outlet:[.70,-1.24],intake:[-.70,-1.24]}},
  ports:{inputs:{'gate.flume':'number'},outputs:{volume:'number','depth.outlet':'number'}}};
const drive={...stock.systems.drive,config:{...stock.systems.drive.config,contactEvents:'material',
  bodies:{...stock.systems.drive.config.bodies,'wet-cart':{...stock.systems.drive.config.bodies['wet-cart'],
    position:[-.86,.27,-2.32]}}}};
save('network.json',{format:'ink-studio/solver-network',version:1,id:'ceramic-mill',revision:1,seed:41,numerics:{dt:1/30},
  library:{trim:{file:'stages/control.json',revision:1},pool,
    clay:{...stock.systems.ground,revision:1},cart:{...drive,revision:1},
    trace:{...stock.systems.feedback,revision:1},wear:{...stock.systems.tracks,revision:1}},
  stages:{pedal:{use:'trim'},gate:{use:'trim',config:{scale:.89}},
    motor:{use:'trim',config:{scale:.80}},pond:{use:'pool'},ground:{use:'clay'},
    drive:{use:'cart'},feedback:{use:'trace'},tracks:{use:'wear'}},
  world:{assetPacks:stock.assetPacks},
  connections:[
    {from:'pedal/value',to:'gate/value'},{from:'pedal/value',to:'motor/value'},
    {from:'gate/value',to:'pond/gate.flume'},
    {from:'motor/value',to:'drive/force.wet-left'},{from:'motor/value',to:'drive/force.wet-right'},
    ...stock.connections],
  inputs:{pedal:'pedal/value'},outputs:{gate:'pond/gate.flume',intake:'pond/depth.intake',
    outlet:'pond/depth.outlet',volume:'pond/volume'}});
save('inputs/release.json',[{frame:6,input:'pedal',value:1},{frame:6,action:'drive/impulse',
  args:{body:'wet-cart',linear:[0,.62,1.95],angular:[.025,0,0]}}]);
const all=Array.from({length:25},(_,i)=>i), start=5, finish=24;
const recipe={format:'ink-studio/solver-network-run',version:1,id:'ceramic-mill-branches',
  fps:10,network:'network.json',branches:{
    hold:{to:finish,frames:all,checkpoints:[finish]},
    release:{from:{branch:'hold',frame:start},to:finish,frames:all.slice(start),checkpoints:[finish],commands:'inputs/release.json'}
  },inspect:{
    depth:{kind:'field',field:'pond/depth',samples:{grid:{
      min:[origin[0]+cell/2,0,origin[1]+cell/2],
      max:[origin[0]+(width-.5)*cell,0,origin[1]+(height-.5)*cell],counts:[width,1,height]}}},
    particles:{kind:'particles',field:'feedback/frame',path:'/particles'},
    contacts:{kind:'contacts',field:'drive/contacts'},
    carts:{kind:'probe',field:'drive/bodies'}
  }};
save('run.json',recipe);
run('solver-network','inspect',input('network.json'),'--out',input('contracts.json'));
run('solver-network','compile',input('network.json'),'--out',input('compiled.json'));
run('solver-network','run',input('run.json'),'--out',input('bake'));
const report=read('bake/report.json'), hold=report.branches.hold, release=report.branches.release;
assert.deepEqual(hold.frames[start],release.frames[0]);
assert.equal(hold.checkpoints[start].tick,15);
const end=release.frames.at(-1), staticEnd=hold.frames.at(-1);
assert(end.outputs.outlet>.03 && staticEnd.outputs.outlet<.01);
const maxContacts=Math.max(...release.frames.map(row=>row.inspect.contacts.count));
const frameWithParticles=release.frames.reduce((best,frame)=>frame.inspect.particles.count>best.inspect.particles.count?frame:best);
assert(frameWithParticles.inspect.particles.count>0);
assert(release.frames.some(row=>row.inspect.contacts.count>0));

const check=hold.checkpoints[start];
save('resume.json',{...recipe,id:'mill-checkpoint-resume',branches:{restored:{...recipe.branches.release,
  from:{checkpoint:'bake/'+check.file,frame:start}}}});
run('solver-network','run',input('resume.json'),'--out',input('resume'));
const resumed=read('resume/report.json');
assert.deepEqual(resumed.branches.restored.frames,release.frames);
save('experiment.json',{format:'ink-studio/simulation-experiment',version:1,id:'ceramic-mill-replay',
  assets:{checkpoints:{fork:'bake/'+check.file,holdTail:'bake/'+hold.checkpoints[finish].file,
      releaseTail:'bake/'+release.checkpoints[finish].file},
    notes:{contracts:'contracts.json',model:'compiled.json'}},
  runs:{branches:{kind:'solver-network',source:'run.json',expected:'bake/report.json'},
    restored:{kind:'solver-network',source:'resume.json',expected:'resume/report.json'}}});
const archive=at('ceramic-mill.project.json');
run('project','pack',input('experiment.json'),'--root',source,'--out',archive);
const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mill-portable-'));
let verification;
try {
  const relocated=path.join(isolated,'archive.json');
  fs.copyFileSync(archive,relocated);
  verification=run('project','verify',relocated);
} finally {fs.rmSync(isolated,{recursive:true,force:true});}
assert(verification.passed);
files.json(at('verification.json'),verification);

const W=1002,H=524, mute='#9bb4b1', gold='#eecb82', blue='#83ddd0', edge='#48636d';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=gold)=>({type:'text',text,at:[x,y],scale,color});
const circle=(x,y,r,fill)=>({type:'ellipse',rect:[x-r,y-r,r*2,r*2],fill});
const ink=['#183442','#255066','#317482','#4e9f9d','#72c4b5','#a1d2b9','#dbddb1'];
const px=12, py=10, pw=width*px, ph=height*py;
function project(x0,y0,[x,,z]){
  return [x0+(x-origin[0])*px/cell,y0+(z-origin[1])*py/cell];
}
function pane(commands,frame,x,y){
  commands.push(rect(x-4,y-4,pw+8,ph+8,edge));
  const {samples}=frame.inspect.depth.value;
  samples.forEach((entry,i)=>{
    const value=entry.value??0, step=Math.round(Math.min(1,value/.32)*(ink.length-1));
    const x0=x+i%width*px,y0=y+Math.floor(i/width)*py;
    commands.push(rect(x0,y0,px,py,ink[step]));
    if(value>.05&&(i%9===1||i%11===0))commands.push(rect(x0+3,y0+4,4,1,ink[Math.min(6,step+1)]));
  });
  const gx=x+pw/2;
  for(let dy=2;dy<ph;dy+=9)commands.push(rect(gx-1,y+dy,2,Math.min(5,ph-dy),frame.outputs.gate>.1?'#b27e55':'#e0b06d'));
  for(const [name,cart] of Object.entries(frame.inspect.carts.value)){
    const [u,v]=project(x,y,cart.position);
    if(u<x+7||u>x+pw-7||v<y+8||v>y+ph-8)continue;
    commands.push(rect(u-7,v-7,14,14,'#1b292d'),rect(u-5,v-5,10,10,name==='wet-cart'?'#e7af71':'#f0d89d'),
      rect(u-3,v-3,6,2,'#55412e'));
  }
  for(const row of frame.inspect.contacts.value){
    const point=row.point??row.at;
    if(!point)continue;
    const [u,v]=project(x,y,point);
    if(u>=x&&u<x+pw&&v>=y&&v<y+ph)commands.push(circle(u,v,1.5,'#ffbb72'));
  }
  const p=frame.inspect.particles.value.positions;
  for(let i=0;i<p.length;i+=3){
    const [u,v]=project(x,y,p.slice(i,i+3));
    if(u>=x&&u<x+pw&&v>=y&&v<y+ph)commands.push(circle(u,v,1,'#ffeea6'));
  }
}
function renderBoard(selectedHold,selectedRelease,still=false){
  const cmds=[
    rect(0,0,W,H,'#0d202a'),text('CERAMIC MILL',26,22,3),text('SOLVER NETWORK / BRANCH REPLAY',764,29,1,mute),
    rect(26,62,950,1,edge),text('SHARED CHECKPOINT',26,79,1,gold),text('FRAME '+start+'  /  TICK '+check.tick,26,96,1,mute),
    text('HOLD',354,79,1,gold),text('FRAME '+selectedHold.frame+'  /  OUTLET '+selectedHold.outputs.outlet.toFixed(3),354,96,1,mute),
    text('RELEASE',682,79,1,blue),text('FRAME '+selectedRelease.frame+'  /  OUTLET '+selectedRelease.outputs.outlet.toFixed(3),682,96,1,mute),
    rect(26,316,950,1,edge),text('OUTLET DEPTH / MATCHED PICTURE FRAMES',26,334),
    text('CONTACT INSPECTION',682,334,1,blue),
    text('CHECKPOINT REPLAY MATCHED',682,350,1,mute),text('NATIVE PARTICLE POINT BUFFER',682,367,1,mute),
    text(frameWithParticles.inspect.particles.count+' PARTICLES / FRAME '+frameWithParticles.frame,682,384,1,gold),
    text('PEAK CONTACT RECORDS  '+maxContacts,682,435,1,mute),
    text('PACKAGED RUNS VERIFIED  '+Object.keys(verification.runs).length,682,453,1,mute),
    rect(26,485,950,1,edge),text('WATER DEPTH',26,501,1,mute),
    text('GATE',282,501,1,mute),text('CONTACT POINTS',339,501,1,mute),
    text('CONTACT / WATER / CONTROL PORTS',682,501,1,mute)
  ];
  pane(cmds,hold.frames[start],26,120);
  pane(cmds,selectedHold,354,120);
  pane(cmds,selectedRelease,682,120);
  for(const [i,c] of ink.entries())cmds.push(rect(105+i*19,501,17,6,c));
  cmds.push(rect(270,501,5,6,'#e0b06d'),circle(327,505,2,'#ffbb72'));
  const axes={x:28,y:358,w:606,h:105}, yMax=.30;
  cmds.push(rect(axes.x,axes.y,axes.w,axes.h,'#132a34'));
  for(let i=0;i<=3;i++)cmds.push(rect(axes.x,axes.y+i*32,axes.w,1,edge));
  const cx=frame=>axes.x+5+(axes.w-10)*frame/finish;
  const cy=value=>axes.y+axes.h-9-92*Math.min(1,value/yMax);
  for(const [rows,stroke] of [[hold.frames,'#d9aa76'],[release.frames,blue]]){
    cmds.push({type:'path',points:rows.map(row=>[cx(row.frame),cy(row.outputs.outlet)]),width:2,stroke});
  }
  const fork=Math.round(cx(start));
  cmds.push(rect(fork,axes.y,1,axes.h,'#ab8771'),text('FORK',fork+6,axes.y+7,1,mute));
  const playhead=Math.round(cx(selectedRelease.frame));
  cmds.push(rect(playhead,axes.y,1,axes.h,'#91a7a6'));
  if(still){
    const p=frameWithParticles.inspect.particles.value.positions;
    const left=706,top=404;
    for(let i=0;i<p.length;i+=3){
      const x=left+(p[i]+2.3)*47,y=top+(p[i+2]+1.8)*12;
      if(x>678&&x<974&&y>391&&y<435)cmds.push(circle(x,y,1.25,blue));
    }
  }
  return K.procedural.drawing2d.render({width:W,height:H,commands:cmds,edges:'hard'});
}
const sheet=renderBoard(staticEnd,end,true);
files.write(at('ceramic-mill.png'),PNG.encode(W,H,sheet.data,4));
const playback=all.filter(i=>i>=start&&i%2===0).map(i=>PNG.packRGBA(renderBoard(hold.frames[i],release.frames[i-start])));
files.write(at('ceramic-mill-loop.png'),PNG.encodeAnimation(playback,5));
files.json(at('demo-report.json'),{image:'ceramic-mill.png',loop:'ceramic-mill-loop.png',archive:'ceramic-mill.project.json',
  trace:'source/bake/report.json',verification:'verification.json',fork:{frame:start,tick:check.tick,hash:check.sha256},
  end:{frame:finish,holdOutlet:staticEnd.outputs.outlet,releaseOutlet:end.outputs.outlet},
  inspectedParticles:frameWithParticles.inspect.particles.count,particleFrame:frameWithParticles.frame,
  maxContacts,checkedRuns:Object.keys(verification.runs).length});
console.log(at('ceramic-mill.png'));
