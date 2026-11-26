/* Fixed-camera contact and strain evidence from the native material lab. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), {isDeepStrictEqual}=require('node:util');
const {study}=require('./study.cjs'), files=require('../../cli/asset-files.js'), PNG=require('../../cli/png.js');
const {KIT:K}=require('../..').load(), {V}=K, R=K.world.runtime;
const cli=path.join(__dirname,'../../cli/ink-studio.js');
const out=path.resolve(process.argv[2]??'studio/bellows-and-beads'), asset=name=>path.join(out,name);
const command=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
const read=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
const recipe=study();
files.json(asset('study.json'),recipe);
command('material-lab','run',asset('study.json'),'--out',asset('native'));
const preparation=read('native/preparation.json'), report=read('native/report.json'), log=read('native/materials.run.json');
const verified=JSON.parse(command('sim','verify',asset('native/materials.run.json')));
assert.equal(verified.status,'verified');
for(const tick of report.checkpoints){
  const run=R.openRecording(log,{checkpoint:read('native/checkpoints/'+tick+'.json')});
  for(const frame of report.frames.filter(row=>row.tick>=tick)){
    run.advance(frame.tick);
    const query=run.query(), fields={points:'points',strain:'strain',contact:'contact-report',samples:'contacts',work:'work'};
    for(const [name,field] of Object.entries(fields))assert(isDeepStrictEqual(query.probe('lab/'+field).value,frame[name]),
      'Material lab replay changed '+field+' at tick '+frame.tick);
  }
  assert(R.checkpointsEqual(run.checkpoint(),log.end));
}
const frames=report.frames, held=frames.find(row=>row.tick===36), final=frames.at(-1);
const byLane={A:'felt/grit',B:'grit/polished'}, pairStats=report.summary.contact.pairs;
const slip=Object.fromEntries(Object.entries(byLane).map(([name,pair])=>[name,pairStats[pair].slipAfter/pairStats[pair].slipBefore]));
const volume=Object.fromEntries(Object.entries(held.strain).map(([name,row])=>[name,row.ratio]));
const inverted=frames.reduce((n,row)=>n+Object.values(row.strain).reduce((sum,c)=>sum+c.inverted,0),0);
const working=report.summary.work, peak=working.maxTick;
function top(frame,name){
  return Math.max(...frame.points.filter(row=>row.group===name).map(row=>row.position[1]));
}
assert(volume.A>.89&&volume.B<.7&&Math.abs(top(held,'A')-top(held,'B'))<1e-4&&inverted===0&&
  final.strain.A.ratio>.99&&final.strain.B.ratio>.99&&report.summary.speedLimited===0&&
  slip.A<.2&&slip.B>.8&&peak<working.perTickBudget);
const receipt={still:'bellows-and-beads.png',loop:'bellows-and-beads-loop.png',verified,restored:report.checkpoints,
  points:preparation.points.length,cells:preparation.cells.length,grains:preparation.points.filter(row=>row.kind==='grain').length,
  holdTick:held.tick,heldHeight:{A:top(held,'A'),B:top(held,'B')},volume,slip,inverted,
  speedLimited:report.summary.speedLimited,work:working,measuredPairs:Object.keys(pairStats).length,
  samples:report.summary.contact.recorded,omittedSamples:report.summary.contact.omitted};
files.json(asset('demo-report.json'),receipt);

const W=1160,H=645, bg='#162024', panel='#1c2b30', sky='#202f35', grid='#32454c',
  pale='#f1dfb9', soft='#98aeac', teal='#87d6c3', sand='#efaa6e';
const palette={
  A:['#25535a','#347579','#4c9d92','#71c9ad','#ade5be'],
  B:['#754b39','#9a6149','#b77755','#e7a578','#f2cd92']
};
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=pale)=>({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const line=(points,stroke,width=1)=>({type:'path',points,stroke,width});
const poly=(points,fill)=>({type:'polygon',points,fill});
const dot=(x,y,r,fill)=>({type:'ellipse',rect:[x-r,y-r,r*2,r*2],fill});
const pose=points=>new Map(points.map(row=>[row.id,row.position??row.at]));
const rest=pose(preparation.points), combinations=[[0,1,2,3],[0,1,3,2],[0,2,3,1],[1,2,3,0]];
const outer=new Map(), normal=(a,b,c)=>V.cross(V.sub(b,a),V.sub(c,a));
for(const cell of preparation.cells)for(const [a,b,c,d] of combinations){
  const ids=[a,b,c].map(i=>cell.nodes[i]), key=ids.slice().sort().join('/');
  if(outer.has(key)){outer.delete(key);continue;}
  const [p,q,r]=ids.map(id=>rest.get(id));
  if(V.dot(normal(p,q,r),V.sub(rest.get(cell.nodes[d]),p))>0)[ids[1],ids[2]]=[ids[2],ids[1]];
  outer.set(key,{ids,group:cell.group});
}
const camera=V.norm([-.42,.33,1]), sunlight=V.norm([-.48,.67,.58]);
const laneColors={A:{label:'SILICONE',surface:'FELT',color:teal,tile:'#5d526e'},
  B:{label:'FOAM',surface:'POLISHED',color:sand,tile:'#52727d'}};
const percent=value=>(value*100).toFixed(1)+'%';

function bay(cmd,frame,key,x,y,w,h){
  const spec=laneColors[key], center=key==='A'?-1.6:1.6, zoom=137;
  const locate=([a,b,c])=>[x+w*.43+zoom*(a-center+.42*c),y+h*.67-zoom*(b-.33*c)];
  const project=points=>points.map(locate);
  cmd.push(rect(x,y,w,h,sky));
  for(let i=1;i<=4;i++)cmd.push(rect(x,y+i*39,w,1,'#26383e'));
  const slab=(u,v,y0,z0,z1,color)=>cmd.push(poly(project([
    [center-u,y0,z0],[center+v,y0,z0],[center+v,y0,z1],[center-u,y0,z1]
  ]),color));
  slab(1.54,1.54,-.10,-.86,1.82,'#16272e');
  slab(1.30,1.30,-.002,.56,1.76,spec.tile);
  for(let z=.58;z<=1.77;z+=.16)cmd.push(line(project([[center-1.30,.001,z],[center+1.30,.001,z]]),
    key==='A'?'#71637e':'#65848c',1));
  const support=[[-.68,.055,-.31],[.68,.055,-.31],[.68,.055,.31],[-.68,.055,.31]].map(([a,b,c])=>[a+center,b,c]);
  cmd.push(poly(project(support),'#466269'),line(project([...support,support[0]]),'#7b9d97'));
  const positions=pose(frame.points), rows=[];
  for(const {ids,group} of outer.values()){
    if(group!==key)continue;
    const points=ids.map(id=>positions.get(id)), n=V.norm(normal(...points));
    if(V.dot(n,camera)<1e-6)continue;
    const rank=Math.max(0,Math.min(4,Math.floor(2.5+V.dot(n,sunlight)*2.4)));
    rows.push({points:project(points),depth:points.reduce((n,p)=>n+V.dot(p,camera)/3,0),rank});
  }
  for(const row of rows.sort((a,b)=>a.depth-b.depth)){
    const tones=palette[key], [a,b,c]=row.points;
    cmd.push(poly(row.points,tones[row.rank]),line([a,b,c,a],tones[Math.max(0,row.rank-1)],.75));
  }
  const p=frame.surfaces['press-'+key], level=p[1]-.07, z0=p[2]-.65,z1=p[2]+.65, left=center-1.10,right=center+1.10;
  const front=project([[left,level,z1],[right,level,z1],[right,level+.065,z1],[left,level+.065,z1]]);
  cmd.push(poly(project([[left,level+.065,z0],[right,level+.065,z0],[right,level+.065,z1],[left,level+.065,z1]]),'#8babad'),
    poly(front,'#4b6e76'),line([front[0],front[1]],'#c8d5bc',1));
  const grains=frame.points.filter(row=>row.kind==='grain'&&row.id.startsWith(key+'-')).sort((a,b)=>
    V.dot(a.position,camera)-V.dot(b.position,camera));
  for(const row of grains){
    const [u,v]=locate(row.position), rp=row.radius*zoom*.82;
    if(u>=x+rp&&u<=x+w-rp&&v>=y+rp&&v<=y+h-rp){
      const [sx,sy]=locate([row.position[0],-.003,row.position[2]]);
      cmd.push(dot(sx,sy,rp*.58,'#43535a'),dot(u,v,rp,row.material==='glass'?'#e8dca8':'#e2a362'),
        dot(u-rp*.23,v-rp*.21,rp*.22,'#fff1c2'));
    }
  }
}

function volumeChart(cmd,frame){
  const x=32,y=440,w=632,h=135, left=x+41,right=x+w-15, top=y+14, bottom=y+h-22;
  const px=tick=>left+(right-left)*tick/report.ticks, py=value=>bottom-(bottom-top)*(value-.58)/.46;
  cmd.push(rect(x,y,w,h,panel));
  for(const n of [.6,.8,1]){
    const yy=py(n);
    cmd.push(rect(left,yy,right-left,1,grid),text(Math.round(n*100)+'%',x+8,yy-4,1,soft));
  }
  for(const key of ['A','B'])cmd.push(line(frames.map(row=>[px(row.tick),py(row.strain[key].ratio)]),laneColors[key].color,2));
  cmd.push(rect(px(frame.tick),top-4,1,bottom-top+7,'#a7b5ab'),text('0',left,y+h-13,1,soft),
    text('TICK '+report.ticks,right-44,y+h-13,1,soft));
}
function contactChart(cmd){
  const x=685,y=440,w=443;
  cmd.push(rect(x,y,w,135,panel));
  for(const [i,key] of ['A','B'].entries()){
    const spec=laneColors[key], yy=y+15+i*57, size=326;
    cmd.push(text('GRIT ON '+spec.surface,x+14,yy,1,soft),text(percent(slip[key]),x+339,yy+18,2,spec.color),
      rect(x+14,yy+19,size,10,'#314045'),rect(x+14,yy+19,size*slip[key],10,spec.color));
  }
}

function board(frame){
  const layers=[];
  const cmd=[rect(0,0,W,H,bg),rect(0,0,W,4,teal),text('BELLOWS & BEADS',32,24,4),text('MATCHED PLATEN MOTION / TETRAHEDRAL STRAIN AND GRAIN CONTACT',34,66,1,soft),
    text('TICK '+String(frame.tick).padStart(2,'0'),1040,56,2,pale),rect(32,87,1096,1,grid)];
  for(const [i,key] of ['A','B'].entries()){
    const x=32+i*555, w=541, spec=laneColors[key];
    cmd.push(rect(x,104,w,285,panel),rect(x,104,w,2,spec.color),text(spec.label,x+13,117,2,spec.color),
      text(percent(frame.strain[key].ratio)+' VOLUME',x+386,118,1,pale));
    const layer={x:x+6,y:145,w:w-12,h:215,commands:[]};
    bay(layer.commands,frame,key,0,0,layer.w,layer.h);
    layers.push(layer);
    cmd.push(text('GRAIN SURFACE  '+spec.surface,x+14,372,1,soft));
  }
  cmd.push(text('SOLID VOLUME / REST',32,413,2),text('GRIT SLIP REMAINING',685,413,2),
    text('INCOMING VS OUTGOING',948,420,1,soft));
  volumeChart(cmd,frame);
  contactChart(cmd);
  cmd.push(rect(32,598,1096,1,grid),text('PEAK WORK '+peak.toLocaleString('en-US')+' / '+working.perTickBudget.toLocaleString('en-US')+' PER TICK',32,615,1,soft),
    text('0 INVERTED CELLS',484,615,1,soft),text('FULL REPLAY + 4 CHECKPOINTS VERIFIED',858,615,1,soft));
  const render=(width,height,commands)=>K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  const drawn=render(W,H,cmd);
  for(const {x,y,w,h,commands} of layers){
    const panel=render(w,h,commands).data;
    for(let row=0;row<h;row++)drawn.data.set(panel.subarray(row*w*4,(row+1)*w*4),((y+row)*W+x)*4);
  }
  return drawn;
}
const image=board(held);
files.write(asset(receipt.still),PNG.encode(W,H,image.data,4));
const cycle=[...Array(6).fill(0),...frames.filter(row=>row.tick%2===0).map(row=>row.tick),...Array(8).fill(report.ticks)];
const cache=new Map();
const animation=cycle.map(tick=>{
  if(!cache.has(tick))cache.set(tick,PNG.packRGBA(board(frames[tick])));
  return cache.get(tick);
});
files.write(asset(receipt.loop),PNG.encodeAnimation(animation,24));
console.log(asset(receipt.still));
