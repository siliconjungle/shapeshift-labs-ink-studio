/* A fixed camera over a volume wake and its matched spectral control. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), {isDeepStrictEqual}=require('node:util');
const files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js'), {study}=require('./study.cjs');
const {KIT:K}=require('../..').load(), {V,M}=K, R=K.world.runtime;
const out=path.resolve(process.argv[2]??'studio/lantern-sound'), asset=name=>path.join(out,name);
const cli=path.join(__dirname,'../../cli/ink-studio.js'), command=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
const read=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
const selected=28, plan=study(), stationary={...plan,run:{...plan.run,ticks:selected,commands:[],checkpoints:[],
  captures:[{tick:selected,outputs:['ocean']}]}};
files.json(asset('study.json'),plan);
files.json(asset('stationary-study.json'),stationary);
command('liquid3d','run',asset('study.json'),'--out',asset('native'));
command('liquid3d','run',asset('stationary-study.json'),'--out',asset('stationary'));
const summary=read('native/report.json'), log=read('native/liquid.run.json'), verified=JSON.parse(command('sim','verify',asset('native/liquid.run.json')));
assert.equal(verified.status,'verified');
for(const tick of summary.checkpoints){
  const resumed=R.openRecording(log,{checkpoint:read('native/checkpoints/'+tick+'.json')});
  for(const {tick:next,time,colliders,...report} of summary.frames.filter(row=>row.tick>=tick)){
    resumed.advance(next);
    assert(isDeepStrictEqual(resumed.query().probe('liquid/report').value,report),'Liquid trace changed at tick '+next);
    assert(isDeepStrictEqual(resumed.query().probe('liquid/colliders').value,colliders));
  }
  assert(R.checkpointsEqual(resumed.checkpoint(),log.end));
}
command('liquid3d','surface',asset('native/checkpoints/'+selected+'.json'),'--out',asset('wake-surface.obj'));

const source='native/frames/'+selected, active=read(source+'/ocean.json'), mesh=read(source+'/surface.json'),
  baseline=read('stationary/frames/'+selected+'/ocean.json'), stats=summary.summary;
let peakNear=0,farError=0;
const delta=active.weights.map((w,i)=>{
  const difference=active.positions[i*3+1]-baseline.positions[i*3+1];
  if(w>0||baseline.weights[i]>0)peakNear=Math.max(peakNear,Math.abs(difference));
  else farError=Math.max(farError,Math.abs(difference));
  return difference;
});
assert(peakNear>.075&&farError===0&&stats.pressure.after<stats.pressure.before*.3&&stats.peakSpray>40&&
  stats.peakFoam>40&&stats.clearance>0&&mesh.triangles.length>6000);
assert(summary.frames.every(row=>row.markers===stats.markers&&row.volume===stats.volume));
const receipt={still:'lantern-sound.png',loop:'lantern-sound-loop.png',mesh:'wake-surface.obj',comparisonTick:selected,
  verify:verified,restored:summary.checkpoints,triangleCount:mesh.triangles.length/3,nearVertices:active.report.nearVertices,
  spectralVertices:active.report.spectralVertices,peakNear,farError,...stats};
files.json(asset('demo-report.json'),receipt);

const W=1160,H=648,bg='#0f1d28',card='#162b36',ink='#ead9aa',soft='#9db8b3',lineColor='#344f5a',
  aqua='#82dcd3',orange='#ecb276';
const shades=['#173644','#1a465c','#1c566c','#236880','#2e7e90','#45939e','#63acae','#8fcbc1','#bcddc6'];
const minus=['#244451','#4d585b','#805f50','#b08062','#e0a779'],plus=['#244451','#275c69','#38818c','#58a6aa','#9ad8c7'];
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=ink)=>({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const path2=(points,stroke,width=1)=>({type:'path',points,stroke,width});
const poly=(points,fill,width)=>({type:'polygon',points,fill,...(width&&{stroke:fill,width})});
const dot=(x,y,r,fill)=>({type:'ellipse',rect:[x-r,y-r,r*2,r*2],fill});
const colorAt=(colors,value)=>colors[Math.max(0,Math.min(colors.length-1,Math.floor(value*colors.length)))];
const middle=points=>points.reduce((sum,p)=>V.mad(sum,p,1/points.length),[0,0,0]);
const normal=([a,b,c])=>V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
const render=(w,h,commands)=>K.procedural.drawing2d.render({width:w,height:h,commands,edges:'hard'});
const split=flat=>Array.from({length:flat.length/3},(_,i)=>flat.slice(i*3,i*3+3));
const sun=V.norm([-1,1.25,.45]);

function viewpoint(width,height,eye,target,focal){
  const ahead=V.norm(V.sub(target,eye)), right=V.norm(V.cross(ahead,[0,1,0])), up=V.cross(right,ahead);
  function at(p){
    const d=V.sub(p,eye), depth=V.dot(d,ahead);
    return [width*.5+focal*V.dot(d,right)/Math.max(.001,depth),height*.47-focal*V.dot(d,up)/Math.max(.001,depth),depth];
  }
  return {at,eye,width,height};
}

function surfaceRows(geometry,camera,shade){
  const points=split(geometry.positions), projected=points.map(camera.at), rows=[];
  for(let i=0;i<geometry.triangles.length;i+=3){
    const ids=geometry.triangles.slice(i,i+3), screen=ids.map(id=>projected[id]);
    if(screen.some(p=>p[2]<.35)||screen.every(p=>p[0]<0)||screen.every(p=>p[0]>camera.width)||
      screen.every(p=>p[1]<0)||screen.every(p=>p[1]>camera.height))continue;
    const world=ids.map(id=>points[id]), n=normal(world), center=middle(world);
    if(V.dot(n,V.sub(camera.eye,center))<0)continue;
    const fill=shade(n,center,ids);
    rows.push({depth:(screen[0][2]+screen[1][2]+screen[2][2])/3,
      draw:poly(screen.map(([x,y])=>[x,y]),fill,.94)});
  }
  return rows;
}

const faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
function boxRows(camera,at,half,turn,colors){
  const local=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],
    rotation=M.rot([0,1,0],turn), vertices=local.map(p=>V.add(at,M.app(rotation,p.map((n,i)=>n*half[i]))));
  return faces.flatMap(face=>{
    const world=face.map(i=>vertices[i]), n=normal(world), center=middle(world);
    if(V.dot(n,V.sub(camera.eye,center))<=0)return [];
    const points=world.map(camera.at), color=colorAt(colors,.45+.4*V.dot(n,sun));
    return [{depth:points.reduce((s,p)=>s+p[2]/4,0),draw:poly(points.map(([x,y])=>[x,y]),color)}];
  });
}

function sea(frame,water,secondary,w,h){
  const camera=viewpoint(w,h,[6.9,5.4,9.1],[0,.63,0],w*.93), commands=[rect(0,0,w,h,'#203441')];
  for(let i=0;i<5;i++)commands.push(rect(0,i*24,w,24,['#283c43','#314a50','#38555b','#45666b','#4e7274'][i]));
  const waterRows=surfaceRows(water,camera,(n,center,ids)=>{
    const drift=ids.reduce((a,id)=>a+water.weights[id]/3,0), sight=V.norm(V.sub(camera.eye,center));
    return colorAt(shades,.47+.35*V.dot(n,sun)-.24*V.dot(n,sight)+.10*drift+(center[1]-.72)*.35);
  });
  const {position,turn}=frame.colliders.sled, deck=V.add(position,[0,.257,0]);
  const bodies=[...boxRows(camera,position,[.57,.26,.35],turn,['#543b43','#854b4b','#be6556','#e78b61','#f5af74']),
    ...boxRows(camera,V.add(deck,[0,.062,0]),[.30,.068,.27],turn,['#173544','#375b63','#6f8580','#f1c892'])];
  const lantern=V.add(deck,M.app(M.rot([0,1,0],turn),[.27,.17,0])), [lx,ly,ld]=camera.at(lantern);
  bodies.push({depth:ld,draw:dot(lx,ly,3.7,'#ffdd87')});
  const spray=secondary.flatMap(row=>{
    const [x,y,d]=camera.at(row.position);
    if(d<.35||x<1||x>=w-1||y<0||y>=h)return [];
    const age=row.age/row.life, radius=row.kind==='spray'?Math.max(.85,2.0-.92*age):1.4;
    return [{depth:d-(row.kind==='foam'?.15:.10),draw:dot(x,y,radius,row.kind==='spray'?'#f5edc2':'#90d6cb')}];
  });
  for(const {draw} of [...waterRows,...bodies,...spray].sort((a,b)=>b.depth-a.depth))commands.push(draw);
  commands.push(rect(13,13,145,36,'#152a35'),text('TICK '+String(frame.tick).padStart(2,'0'),23,20,2),text('LOCKED CAMERA',23,39,1,soft));
  return render(w,h,commands).data;
}

function isolated(w,h){
  const camera=viewpoint(w,h,[4.3,3.8,5.4],[0,.40,0],w*.81), commands=[rect(0,0,w,h,'#172e3b')];
  for(let y=14;y<h;y+=19)commands.push(rect(0,y,w,1,'#27414c'));
  const faces=surfaceRows(mesh,camera,(n,p)=>colorAt(shades,.30+.62*V.dot(n,sun)+.12*p[1]));
  for(const {draw} of faces.sort((a,b)=>b.depth-a.depth))commands.push(draw);
  return render(w,h,commands).data;
}

function wakeMap(cmd,x,y,w,h){
  const [nx,nz]=active.shape, dx=w/nx, dz=h/nz;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const value=delta[j*nx+i], a=Math.min(1,Math.abs(value)/peakNear);
    const left=Math.round(i*dx), top=Math.round(j*dz);
    cmd.push(rect(x+left,y+top,Math.round((i+1)*dx)-left,Math.round((j+1)*dz)-top,colorAt(value<0?minus:plus,a*.999)));
  }
  const {min,max}=plan.config.ocean.bounds, {origin,shape,cell}=plan.config.grid;
  const px=v=>x+w*(v-min[0])/(max[0]-min[0]), pz=v=>y+h*(v-min[1])/(max[1]-min[1]);
  const a=[px(origin[0]),pz(origin[2])],b=[px(origin[0]+shape[0]*cell),pz(origin[2]+shape[2]*cell)];
  cmd.push(path2([a,[b[0],a[1]],b,[a[0],b[1]],a],'#aac6be',1));
}

function pressure(cmd,frame){
  const x=34,y=491,w=718,h=95, left=x+14,bottom=y+h-15,
    max=Math.max(...summary.frames.map(frame=>frame.pressure.before))*1.08;
  const px=tick=>left+(w-26)*tick/summary.ticks, py=value=>bottom-(h-25)*value/max;
  cmd.push(rect(x,y,w,h,card));
  for(let i=0;i<4;i++)cmd.push(rect(left,bottom-i*19,w-26,1,lineColor));
  for(const [key,color] of [['before',orange],['after',aqua]])
    cmd.push(path2(summary.frames.map(row=>[px(row.tick),py(row.pressure[key])]),color,2));
  cmd.push(rect(px(frame.tick),y+8,1,h-23,soft),text('0',left,y+h-10,1,soft),text('TICK '+summary.ticks,x+w-58,y+h-10,1,soft));
}

const local=isolated(344,138);
function board(frame,water,secondary){
  const cmd=[rect(0,0,W,H,bg),rect(0,0,W,4,aqua),text('LANTERN SOUND',33,23,4),
    text('SURVEY SLED WAKE / 3D LIQUID AND DIRECTIONAL SEA',35,64,1,soft),rect(34,88,1092,1,lineColor),
    rect(34,104,718,341,card),rect(775,104,351,202,card),
    text('EXTRACTED 3D SURFACE',786,114,2,aqua),text('TICK 28 / '+receipt.triangleCount+' TRIANGLES',787,282,1,soft),
    rect(775,318,351,268,card),text('WAKE VS STATIONARY SLED',785,330,2),text('ALIGNED HEIGHT DIFFERENCE / TICK 28',787,356,1,soft),
    text('PEAK LOCAL CHANGE  '+peakNear.toFixed(3)+' UNITS',787,537,1,aqua),text('SPECTRAL-ONLY DIFFERENCE  '+farError.toFixed(3),787,555,1,soft),
    text('PRESSURE DIVERGENCE',33,466,2),text('BEFORE',455,472,1,orange),text('AFTER',544,472,1,aqua),
    text('PRIMARY MARKERS  '+stats.markers,34,612,1,soft),text('SPRAY  '+frame.spray+'   FOAM  '+frame.foam,322,612,1,soft),
    text('REPLAY + FOUR CHECKPOINTS VERIFIED',876,612,1,soft),rect(34,599,1092,1,lineColor)];
  wakeMap(cmd,788,376,324,145);
  pressure(cmd,frame);
  const result=render(W,H,cmd);
  for(const panel of [{x:35,y:105,w:716,h:339,pixels:sea(frame,water,secondary,716,339)},
    {x:778,y:134,w:344,h:138,pixels:local}]){
    const {x,y,w,h,pixels}=panel;
    for(let j=0;j<h;j++)result.data.set(pixels.subarray(j*w*4,(j+1)*w*4),((y+j)*W+x)*4);
  }
  return result;
}
const frameAt=tick=>summary.frames.find(row=>row.tick===tick);
const boardAt=tick=>board(frameAt(tick),read('native/frames/'+tick+'/ocean.json'),read('native/frames/'+tick+'/secondary.json'));
const sheet=boardAt(selected);
files.write(asset(receipt.still),PNG.encode(W,H,sheet.data,4));
const cycle=[...Array(5).fill(0),...Array.from({length:22},(_,i)=>i*2),...Array(10).fill(42)], boards=new Map();
const animation=cycle.map(tick=>{
  if(!boards.has(tick))boards.set(tick,PNG.packRGBA(boardAt(tick)));
  return boards.get(tick);
});
files.write(asset(receipt.loop),PNG.encodeAnimation(animation,17));
console.log(asset(receipt.still));
