/* A headless rendering of the prepared cells and the native solver trace. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), {isDeepStrictEqual}=require('node:util');
const files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js');
const {KIT:K}=require('../..').load(), {V,M}=K;
const model=path.join(__dirname,'stormglass-span.json'), cli=path.join(__dirname,'../../cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/stormglass-span'), asset=name=>path.join(out,name);
const command=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
const read=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
fs.mkdirSync(out,{recursive:true});
files.write(asset('stormglass-span.json'),fs.readFileSync(model));
command('fracture','run',asset('stormglass-span.json'),'--out',asset('native'));
const preparation=read('native/preparation.json'), report=read('native/report.json'), recording=read('native/fracture.run.json');
const verification=JSON.parse(command('sim','verify',asset('native/fracture.run.json')));
assert.equal(verification.status,'verified');
const R=K.world.runtime;
for(const tick of report.checkpoints){
  const checkpoint=read('native/checkpoints/'+tick+'.json');
  const run=R.openRecording(recording,{checkpoint});
  for(const capture of report.captures.filter(frame=>frame.tick>=tick)){
    run.advance(capture.tick);
    const actual=run.query();
    for(const field of ['pieces','constraints','contacts'])assert(
      isDeepStrictEqual(actual.probe('failure/'+field).value,capture[field]),'Divergent '+field+' at '+capture.tick);
  }
  assert(R.checkpointsEqual(run.checkpoint(),recording.end));
}

const frames=new Map(report.captures.map(row=>[row.tick,row]));
const frame=tick=>frames.get(tick), event=kind=>report.events.find(row=>row.kind==='fracture-'+kind);
const handoffs=report.events.filter(row=>row.kind==='fracture-handoff');
const copper=event('yield').bond, crack=event('crack'), tear=event('tear');
const firstHit=report.captures.find(row=>row.contacts.length);
const maxOf=key=>Math.max(...handoffs.map(row=>row[key]));
const last=frame(report.ticks), permanent=last.constraints.find(row=>row.id===copper).plastic;
assert(crack.tick<tear.tick&&tear.tick<firstHit.tick&&permanent>.13&&report.end.massError===0&&
  maxOf('positionError')<1e-10&&maxOf('rotationError')<1e-10&&
  maxOf('linearMomentumError')<1e-10&&maxOf('angularMomentumError')<1e-10);
const receipt={verification,restoredTicks:report.checkpoints,crackTick:crack.tick,tearTick:tear.tick,
  firstContact:firstHit.tick,permanentBendDeg:permanent*180/Math.PI,massError:report.end.massError,
  maxPositionError:maxOf('positionError'),maxRotationError:maxOf('rotationError'),
  maxLinearMomentumError:maxOf('linearMomentumError'),maxAngularMomentumError:maxOf('angularMomentumError'),
  cells:report.prepared.cells,bonds:report.prepared.bonds,handoffs:handoffs.length,
  still:'stormglass-span.png',loop:'stormglass-span-loop.png'};
files.json(asset('demo-report.json'),receipt);

const W=1120,H=570, bg='#111b21', card='#182830', sky='#1b2c34', edge='#38525a',
  muted='#8da6a9', white='#f0e3c4', orange='#f1a76d', teal='#78d9d7', pink='#ee948d';
const tones={
  copper:['#774739','#bb7958','#e4a579','#ffcc92'],
  glaze:['#285365','#4e989e','#77cbd0','#b2ebe3'],
  weave:['#773c50','#ad5968','#db8690','#ffc2aa']
};
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=white)=>({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const line=(points,stroke,width=1)=>({type:'path',points,stroke,width});
const polygon=(points,fill)=>({type:'polygon',points,fill});
const dot=(x,y,r,fill)=>({type:'ellipse',rect:[x-r,y-r,2*r,2*r],fill});
const avg=points=>points.reduce((p,q)=>V.mad(p,q,1/points.length),[0,0,0]);
const tween=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t);
const world=(pose,p)=>V.add(pose.position,M.app(pose.rotation,p));
const facing=V.norm([.33,-.15,1]), sunlight=V.norm([-.38,.76,.55]);
const prepared=Object.values(preparation.cells).map(cell=>{
  const shape=K.world.colliders.local(cell.hull).parts[0];
  return {...cell,shape};
});

function scene(cmd,row,{x,y,w,h},large=false){
  const scale=Math.min((w-13)/7.2,(h-10)/3.85), floor=y+h-17;
  const at=([u,v,z])=>[x+w*.46+(u-.33*z)*scale,floor-(v+.15*z)*scale];
  cmd.push(rect(x,y,w,h,sky),rect(x,floor,w,y+h-floor,'#16232a'),rect(x,floor,w,1,edge));
  for(let gx=-3;gx<=4;gx++){
    const [px]=at([gx,0,0]);
    if(px>x+2&&px<x+w-2)cmd.push(rect(px,floor+3,1,4,edge));
  }
  for(const thick of [1,2,3]){
    const [u,v]=at([-2.98,2.42+thick*.19,.12]);
    cmd.push(rect(u-5,v-2,7,2,thick===2?muted:edge));
  }
  const faceRows=[];
  for(const cell of prepared){
    const pose=row.pieces[cell.id], {vertices,faces,directions}=cell.shape, pos=vertices.map(p=>world(pose,p));
    const [px]=at(pose.position), width=Math.max(4,Math.min(36,cell.volume*43))*scale/34;
    const shadowWidth=width*(1+pose.position[1]*.16);
    cmd.push({type:'ellipse',rect:[px-shadowWidth/2,floor-1,shadowWidth,4],fill:'#101b21'});
    for(const [i,face] of faces.entries()){
      const normal=M.app(pose.rotation,directions[i]);
      if(V.dot(normal,facing)<1e-6)continue;
      const worldFace=face.map(j=>pos[j]), center=avg(worldFace);
      const base=V.dot(normal,sunlight), color=tones[cell.material][base>.80?3:base>.42?2:base>.03?1:0];
      faceRows.push({points:worldFace.map(at),center:at(center),depth:V.dot(center,facing),color,
        faceFront:directions[i][2]>.99, material:cell.material});
    }
  }
  for(const {points,center,color,faceFront,material} of faceRows.sort((a,b)=>a.depth-b.depth)){
    cmd.push(polygon(points,color),line([...points,points[0]],'#18242a',large?1.4:1));
    if(faceFront){
      const inset=points.map(p=>tween(center,p,.78));
      cmd.push(line([...inset,inset[0]],tones[material][1],1));
      if(material==='glaze')cmd.push(dot(center[0],center[1],large?4:2,tones.glaze[3]));
      if(material==='weave'){
        for(const t of [.18,.38,.57,.77]){
          const a=tween(inset[0],inset[1],t),b=tween(inset[1],inset[2],t);
          cmd.push(line([a,b],tones.weave[0],1));
        }
      }
    }
  }
  // Seam markers move with the recorded piece poses. Failed endpoints are separate.
  for(const rowBond of row.constraints){
    if(!rowBond.guide)continue;
    const {a,b,point,broken,law}=rowBond, color={ductile:orange,brittle:teal,fibrous:pink}[law];
    const ends=[a,b].map(name=>at(world(row.pieces[name],V.sub(V.add(point,[0,0,.245]),preparation.cells[name].center))));
    if(broken){
      for(const [u,v] of ends)cmd.push(rect(u-1,v-1,2,2,color));
    }else{
      const middle=tween(...ends,.5);
      if(Math.hypot(ends[1][0]-ends[0][0],ends[1][1]-ends[0][1])>2)cmd.push(line(ends,color,1));
      cmd.push(rect(middle[0]-1.5,middle[1]-1.5,3,3,color));
    }
  }
  for(const contact of row.contacts){
    const p=contact.measurement?.point;
    if(!p)continue;
    const [cx,cy]=at(p);
    if(cx>=x+4&&cx<=x+w-4&&cy>=y+4&&cy<=y+h-4)
      cmd.push(line([[cx-4,cy],[cx+4,cy]],white),line([[cx,cy-4],[cx,cy+4]],white));
  }
}

function timeline(cmd,{x,y,w,h},playhead){
  const start=x+24, end=x+w-17, top=y+13, bottom=y+h-20, tx=tick=>start+(end-start)*tick/report.ticks;
  cmd.push(rect(x,y,w,h,card));
  for(let n=0;n<=4;n++){
    const yy=bottom-(bottom-top)*n/4;
    cmd.push(rect(start,yy,end-start,1,n===0?'#536267':edge));
  }
  for(const [tick,label,color] of [[crack.tick,'CRACK',teal],[tear.tick,'TEAR',pink],[firstHit.tick,'CONTACT',white]]){
    const px=tx(tick);
    for(let yy=top;yy<bottom;yy+=6)cmd.push(rect(px,yy,1,3,edge));
    cmd.push(text(label,px-4,y+h-11,1,color));
  }
  const curve=(bond,key,color,mult=1)=>{
    const points=report.captures.map(row=>[tx(row.tick),bottom-(bottom-top)*row.constraints.find(b=>b.id===bond)[key]*mult]);
    cmd.push(line(points,color,2));
  };
  curve(tear.bond,'damage',pink);
  curve(crack.bond,'damage',teal);
  curve(copper,'plastic',orange,2.1);
  if(playhead!==undefined)cmd.push(rect(tx(playhead),top-3,1,bottom-top+5,white));
}
const metric=(label,value,cmd,x,y,color=white)=>cmd.push(text(label,x,y,1,muted),text(value,x,y+16,2,color));
const base=subtitle=>[
  rect(0,0,W,H,bg),rect(0,0,W,4,teal),text('STORMGLASS SPAN',28,23,4),text(subtitle,30,64,1,muted),
  rect(28,88,1064,1,edge)
];
const ticks=n=>String(n).padStart(2,'0');
const rendered=cmd=>K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:cmd});

const still=base('FEATURE-GUIDED FRACTURE / FIXED CAMERA / NATIVE SOLVER AT 60 HZ');
const panels=[
  {title:'01  PREPARE',tick:0,color:white,caption:'6 CELLS / 5 CONSTRAINTS'},
  {title:'02  BEND',tick:22,color:orange,caption:'COPPER YIELDS / WEAVE STRETCHES'},
  {title:'03  CRACK',tick:39,color:teal,caption:'GLAZE SPLITS / 1 RIGID ISLAND'},
  {title:'04  TEAR',tick:56,color:pink,caption:'WEAVE PARTS / 2 RIGID ISLANDS'}
];
for(const [i,panel] of panels.entries()){
  const x=28+i*268,w=260;
  still.push(rect(x,106,w,242,card),rect(x,106,w,2,panel.color),text(panel.title,x+10,120,2,panel.color),
    text('TICK '+ticks(panel.tick),x+10,145,1,muted),text(panel.caption,x+10,327,1,white));
  scene(still,frame(panel.tick),{x:x+7,y:160,w:w-14,h:157});
}
still.push(text('MATERIAL RESPONSE BY TICK',30,371,2),text('DAMAGE / RESIDUAL BEND',445,377,1,muted));
timeline(still,{x:28,y:396,w:674,h:119});
still.push(rect(724,365,368,150,card),rect(724,365,368,2,edge),text('NATIVE RIGID HANDOFF',738,378,2),
  text('01   GLAZE RELEASES 3 CELLS',739,405,1,teal),text('02   MOVING ISLAND SPLITS INTO 2',739,423,1,pink),
  text('POSE AND MOMENTUM MATCHED',739,453,1,white),text('4 CHECKPOINT CONTINUATIONS VERIFIED',739,475,1,muted),
  text('MASS ERROR  0.000000',739,493,1,muted));
still.push(rect(28,535,1064,1,edge));
for(const [i,[label,color]] of [['COPPER / PLASTIC BEND',orange],['GLAZE / BRITTLE CRACK',teal],['WEAVE / FIBROUS TEAR',pink]].entries())
  still.push(rect(30+i*248,549,9,5,color),text(label,47+i*248,548,1,muted));
files.write(asset(receipt.still),PNG.encode(W,H,rendered(still).data,4));

const animate=tick=>{
  const row=frame(tick), cmd=base('SAME CAMERA AND SOLVER TRACE / PREPARE, BEND, CRACK, TEAR');
  cmd.push(rect(28,102,686,409,card),text('TICK '+ticks(tick),40,117,2,white));
  scene(cmd,row,{x:40,y:147,w:662,h:352},true);
  cmd.push(rect(738,102,354,409,card),text('SPAN STATUS',750,119,2),rect(750,145,330,1,edge));
  metric('COPPER / PERMANENT BEND',(row.constraints.find(b=>b.id===copper).plastic*180/Math.PI).toFixed(1)+' DEG',cmd,750,163,orange);
  metric('GLAZE / BRITTLE SEAM',tick>=crack.tick?'CRACKED':'LINKED',cmd,750,219,teal);
  metric('WEAVE / FIBROUS SEAM',tick>=tear.tick?'TORN':'LINKED',cmd,750,275,pink);
  metric('FREE RIGID ISLANDS',String(row.groups.length),cmd,750,330);
  timeline(cmd,{x:750,y:387,w:330,h:109},tick);
  cmd.push(rect(28,535,1064,1,edge),text('STABLE CELLS  '+report.prepared.cells+'   /   MASS ERROR  '+report.end.massError,30,548,1,muted));
  return PNG.packRGBA(rendered(cmd));
};
const playback=[...Array.from({length:8},()=>0),...Array.from({length:45},(_,i)=>i*2),
  ...Array.from({length:10},()=>report.ticks)];
const cached=new Map();
const framesOut=playback.map(tick=>{
  if(!cached.has(tick))cached.set(tick,animate(tick));
  return cached.get(tick);
});
files.write(asset(receipt.loop),PNG.encodeAnimation(framesOut,22));
console.log(asset(receipt.still));
