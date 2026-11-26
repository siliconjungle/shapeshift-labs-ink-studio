const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const kit=require('../..').load(), {KIT:K}=kit, {V}=K;
const {compile}=require('../../cli/character-rig-assembly.js');
const {open}=require('../../cli/skinned-crowd.js');
const PNG=require('../../cli/png.js'), files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'out/siltwatch-crew'), at=(...parts)=>path.join(out,...parts);
const save=(name,doc)=>files.json(at(name),doc);
const read=name=>JSON.parse(fs.readFileSync(at(name),'utf8'));
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
function run(...args){
  return JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:32*1024**2}));
}

const ball={type:'ball',angles:[[-110,110],[-85,85],[-110,110]]};
const hinge=(axis,angle)=>({type:'hinge',axis,angle});
const skeleton={format:'ink-studio/character-rig',version:1,id:'siltwatch',components:[],joints:[
  {id:'body.hips',parent:null,at:[0,1.01,0],limit:ball},
  {id:'body.chest',parent:'body.hips',at:[0,1.45,.01],limit:ball},
  {id:'body.head',parent:'body.chest',at:[0,1.73,.012],limit:ball},
  ...[-1,1].flatMap(sign=>{
    const suffix=sign<0?'left':'right', arm='arm-'+suffix,leg='leg-'+suffix;
    return [
      {id:arm+'.shoulder',parent:'body.chest',at:[sign*.34,1.47,.012],limit:ball},
      {id:arm+'.elbow',parent:arm+'.shoulder',at:[sign*.49,1.13,.02],limit:hinge([0,0,sign],[-22,135])},
      {id:arm+'.hand',parent:arm+'.elbow',at:[sign*.535,.86,.08],limit:ball},
      {id:leg+'.hip',parent:'body.hips',at:[sign*.172,1.01,0],limit:ball},
      {id:leg+'.knee',parent:leg+'.hip',at:[sign*.182,.55,.115],limit:hinge([-1,0,0],[-19,140])},
      {id:leg+'.foot',parent:leg+'.knee',at:[sign*.196,.12,.008],limit:ball}
    ];
  })
]};
const rig=compile(skeleton,K), j=id=>skeleton.joints.find(row=>row.id===id).at;
save('rig.json',skeleton);
const pigments=['#335963','#559992','#88c1ab','#d09953','#efcc86','#273e46','#6d604b','#b86d50','#506873'];
const points=[],faces=[],weights=[],tmat=[];
function patch(p,f,color,skin) {
  const base=points.length;
  points.push(...p); weights.push(...p.map((_,i)=>typeof skin==='function'?skin(i):{[skin]:1}));
  for(const [i,triangle] of f.entries()){
    faces.push(triangle.map(n=>n+base));tmat.push(typeof color==='function'?color(i):color);
  }
}
function sleeve(a,b,radii,color,joint,num=8) {
  const d=V.norm(V.sub(b,a)), x=V.perp(d), y=V.cross(d,x), n=12, p=[],f=[];
  for(let k=0;k<=num;k++)for(let i=0;i<n;i++){
    const u=k/num, angle=2*Math.PI*i/n, radius=K.mix(radii[0],radii[1],u)*(.88+.12*Math.sin(Math.PI*u));
    p.push(V.mad(V.mad(V.lerp(a,b,u),x,radius*Math.cos(angle)),y,radius*Math.sin(angle)));
    if(k) {
      const prev=(k-1)*n,cur=k*n,next=(i+1)%n;
      f.push([prev+i,cur+i,prev+next],[prev+next,cur+i,cur+next]);
    }
  }
  const cap=p.length;p.push(a,b);
  for(let i=0;i<n;i++){const q=(i+1)%n;f.push([cap,i,q],[cap+1,num*n+q,num*n+i]);}
  patch(p,f,i=>i%10<4?color[1]:color[0],joint);
}
function box(center,size,color,joint) {
  const p=[[-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]]
    .map(p=>p.map((n,i)=>center[i]+n*size[i]));
  patch(p,[[0,2,1],[1,2,3],[4,5,6],[5,7,6],[0,4,2],[2,4,6],[1,3,5],[3,7,5],
    [0,1,4],[1,5,4],[2,6,3],[3,6,7]],color,joint);
}
const hip=j('body.hips'),chest=j('body.chest'),head=j('body.head');
sleeve(V.add(hip,[0,-.04,0]),V.add(chest,[0,.09,0]),[.26,.31],[0,1],i=>
  i<48?{'body.hips':.75,'body.chest':.25}:{'body.hips':.08,'body.chest':.92});
box([0,1.26,.219],[.20,.166,.062],3,'body.chest');
box([0,1.26,.283],[.13,.013,.006],4,'body.chest');
box([0,1.03,.17],[.255,.069,.03],5,'body.hips');
sleeve(V.add(head,[0,-.05,0]),V.add(head,[0,.258,0]),[.231,.210],[3,4],'body.head',5);
box([0,head[1]+.105,.177],[.205,.054,.044],5,'body.head');
box([.067,head[1]+.108,.223],[.057,.015,.006],4,'body.head');
box([-.09,head[1]+.108,.223],[.043,.015,.006],4,'body.head');
for(const side of ['left','right']){
  const arm='arm-'+side,leg='leg-'+side;
  sleeve(j(arm+'.shoulder'),j(arm+'.elbow'),[.127,.141],[1,2],arm+'.shoulder',8);
  sleeve(j(arm+'.elbow'),j(arm+'.hand'),[.109,.090],[0,8],arm+'.elbow',5);
  box(j(arm+'.hand'),[.103,.105,.102],3,arm+'.hand');
  sleeve(j(leg+'.hip'),j(leg+'.knee'),[.142,.118],[5,8],leg+'.hip',5);
  sleeve(j(leg+'.knee'),j(leg+'.foot'),[.104,.098],[0,8],leg+'.knee',5);
  box(V.add(j(leg+'.knee'),[0,0,.089]),[.089,.080,.039],7,leg+'.knee');
  box(V.add(j(leg+'.foot'),[0,-.055,.059]),[.115,.059,.145],5,leg+'.foot');
  box(V.add(j(leg+'.foot'),[0,-.067,.173]),[.109,.046,.045],3,leg+'.foot');
}
save('skin.json',{points,faces,mats:pigments.map((rgb,i)=>({name:'ink-'+i,rgb})),tmat});
save('bind-plan.json',{format:'ink-studio/character-bind-plan',version:1,carriers:[{id:'shell',type:'mesh',file:'skin.json',weights}]});
run('character-rig','bind',at('rig.json'),at('bind-plan.json'),'--out',at('binding.json'));

const A=j('arm-right.shoulder'), B=j('arm-right.elbow'), T=V.norm(V.sub(B,A)), R=V.perp(T), S=V.cross(T,R);
const nodes={},nodeId=(i,x,y)=>'n'+i+x+y;
for(let i=0;i<3;i++)for(let x=0;x<2;x++)for(let y=0;y<2;y++){
  const at=V.mad(V.mad(V.lerp(A,B,[-.06,.5,1.06][i]),R,x?.185:-.185),S,y?.185:-.185);
  nodes[nodeId(i,x,y)]={at,weights:{'arm-right.shoulder':1},pin:i===0,follow:i===2?.009:.015};
}
const cells=[];
for(let i=0;i<2;i++){
  const p=(b,x,y)=>nodeId(i+b,x,y);
  const [a,b,c,d,e,f,g,h]=[p(0,0,0),p(1,0,0),p(0,1,0),p(1,1,0),p(0,0,1),p(1,0,1),p(0,1,1),p(1,1,1)];
  for(const row of [[a,b,d,h],[a,d,c,h],[a,c,g,h],[a,g,e,h],[a,e,f,h],[a,f,b,h]])cells.push({nodes:row});
}
const muscles=[0,1].flatMap(x=>[0,1].map(y=>({id:'fiber-'+x+y,from:nodeId(0,x,y),to:nodeId(2,x,y),
  contraction:.31,compliance:.0000006,driver:{joint:'arm-right.elbow',axis:0,range:[14,83]}})));
save('tissue.json',{format:'ink-studio/tissue-model',version:1,id:'lifting-arm',nodes,cells,muscles,
  edgeCompliance:.00036,volumeCompliance:.000001,damping:6,skin:{gain:1.12,maxOffset:.20},substeps:8,volumePasses:3});

const key=(time,value)=>({time,value,ease:'smooth'});
const keys=(...value)=>value.map(([t,v])=>key(t,v));
const l='leg-left.',r='leg-right.', al='arm-left.',ar='arm-right.';
const sole=[0,-.109,.119];
const contact=(name,start,end)=>({id:name+'-stance',joint:'leg-'+name+'.foot',start,end,offset:sole,
  at:V.add(j('leg-'+name+'.foot'),sole),weight:8,tolerance:.028});
const walk={type:'curves',duration:1.12,contacts:[contact('left',.05,.54),contact('right',.60,1.10)],joints:{
  [l+'hip']:keys([0,[6,0,0]],[.31,[-6,0,0]],[.70,[-3,0,0]],[.91,[24,0,0]],[1.12,[6,0,0]]),
  [r+'hip']:keys([0,[-4,0,0]],[.29,[23,0,0]],[.56,[8,0,0]],[.91,[-6,0,0]],[1.12,[-4,0,0]]),
  [l+'knee']:keys([0,[4]],[.45,[3]],[.85,[27]],[1.12,[4]]),
  [r+'knee']:keys([0,[5]],[.31,[27]],[.56,[6]],[1.12,[5]]),
  [al+'shoulder']:keys([0,[-21,0,-13]],[.57,[17,0,-8]],[1.12,[-21,0,-13]]),
  [ar+'shoulder']:keys([0,[17,0,11]],[.57,[-21,0,12]],[1.12,[17,0,11]])}};
const brace={type:'curves',duration:2,contacts:[contact('left',0,2),contact('right',0,2)],
  root:keys([0,[0,-.045,0]],[.75,[0,-.083,.065]],[2,[0,-.067,.055]]),joints:{
    [ar+'shoulder']:keys([0,[-16,0,18]],[.68,[-36,-11,48]],[2,[-29,-8,40]]),
    [ar+'elbow']:keys([0,[12]],[.64,[91]],[2,[84]]),
    [al+'shoulder']:keys([0,[-14,0,-17]],[.7,[-30,7,-38]],[2,[-20,5,-28]]),
    [al+'elbow']:keys([0,[8]],[.73,[64]],[2,[48]]),
    'body.head':keys([0,[0,0,0]],[.75,[2,19,-3]],[2,[0,11,4]])}};
save('motion.json',{format:'ink-studio/character-motion',version:1,id:'porter-cycle',rigHash:rig.hash,
  clips:{walk,brace,lift:{type:'mix',duration:2,layers:[{id:'brace',clip:'brace',at:0}]}}});

const hill=(x,z)=>.31*Math.exp(-(((x-1.6)/2.25)**2+((z+.4)/2.6)**2))+.15*Math.sin(x*.54+1.1)*Math.cos(z*.41);
const tileGrid={origin:[-8,-5],cell:.5,tileCells:32,size:[1,1]};
const hills=K.procedural.terrainSet.bake({format:'ink-studio/terrain-set',version:1,id:'silt-steps',grid:tileGrid,
  tiles:[{at:[0,0],heights:Array.from({length:33**2},(_,i)=>hill(-8+(i%33)*.5,-5+Math.floor(i/33)*.5))}]}).tiles[0];
save('terrain.json',hills);
const actor=(id,x,z,phase,extra={})=>({id,template:'porter',at:[x,0,z],yaw:7+x*4,
  clip:'walk',phase,velocity:[.08,0,.06],...extra});
const plan={format:'ink-studio/skinned-crowd-plan',version:1,id:'siltwatch-crew',fps:24,frames:66,
  terrain:{tile:'terrain.json'},
  view:{w:480,h:254,background:'#172932',ground:'#596667',camera:{target:[0,.88,0],dist:9.6,yaw:-.045,pitch:.32,ortho:true,fov:.68}},
  budget:{visible:6,skinned:3,tissue:1,triangles:14000},
  templates:{porter:{rig:'rig.json',binding:'binding.json',motion:'motion.json',tissue:'tissue.json',
      rootAllowance:[.29,.49,.29],proxyRadius:.116,proxyColor:'#789493',feet:['left','right'].map(side=>
        ({joint:'leg-'+side+'.foot',offset:sole,weight:8,tolerance:.032}))}},
  actors:[
    actor('foreman',-.67,1.85,.15,{priority:10,velocity:[0,0,0],transitions:[{frame:11,clip:'lift',blend:9,loop:false}]}),
    actor('courier',1.55,1.15,.31,{priority:9,yaw:-8,velocity:[.11,0,.07],
      ragdoll:{frame:28,joint:'body.chest',velocity:[2.7,.18,.72]}}),
    actor('spotter',-2.28,-.74,.65,{priority:6,transitions:[{frame:16,clip:'lift',phase:.23,blend:7,loop:false}]}),
    actor('rear-left',-3.49,-1.75,.25),actor('rear-right',3.48,-1.55,.80),
    actor('ridge',.99,-2.50,.47),actor('spare',4.4,-2,.18,{priority:-2}),
    actor('out-of-shot',25,-1,.15,{priority:-9})
  ]};
save('crowd.json',plan);
const report=run('skinned-crowd','bake',at('crowd.json'),'--out',at('take.json'),'--require-contacts');
const project=open(at('crowd.json'),kit), take=project.validate(read('take.json'));
const find=(frame,id)=>take.frames[frame].actors.find(row=>row.id===id);
const observed=[6,20,60], last=observed[2];
const hero=take.frames.map(row=>row.actors[0]);
const muscle=hero.map(row=>row.tissue.muscles[0]);
const shorten=1-Math.min(...muscle.map(row=>row.length))/muscle[0].rest;
const handoff=report.handoffs[0];
assert(shorten>.10);
assert(report.invertedCells===0);
assert(handoff.snap===0 && handoff.inheritedSpeed>0);
assert(find(last,'courier').mode==='ragdoll' && report.maxRagdollBoneDrift<.015);
assert(report.maxVisibleAgents===6 && report.maxSkinnedAgents===3 && report.maxTissueAgents===1);
assert(report.contactSamples>100);
const frame=run('skinned-crowd','sample',at('crowd.json'),at('take.json'),'--frame',String(last),'--out',at('posed-meshes.json'));
run('skinned-crowd','preview',at('crowd.json'),at('take.json'),'--frame',String(last),'--out',at('native-preview.png'));

function marks(B,frame){
  const mark=(x,z,r,c)=>B.disc(x,hill(x,z)+.026,z,[0,1,0],r,.009,c,1.18);
  for(let i=0;i<27;i++){
    const x=-5+.37*i,z=-.3+Math.sin(i*.32)*.17;
    mark(x,z,.057,[173,156,110]);
    if(i%3===0)mark(x,z+.16,.035,[129,148,127]);
  }
  for(const actor of frame.actors){
    if(actor.tier==='culled')continue;
    const [x,,z]=actor.points;
    mark(x,z,.26,[46,62,62]);
  }
}
const views=observed.map(index=>project.preview(take,index,marks).image);
const idlabels=['APPROACH','BLENDING TO LIFT','RAGDOLL ON SLOPE'];
for(const [i,image] of views.entries()) files.write(at('view-'+observed[i]+'.png'),PNG.encodeFrame(PNG.packFrame(image)));
const skinOffset=frame.surfaces.find(row=>row.actor==='foreman').skinOffset;
assert(skinOffset>.025);
const frozen={...take,frames:take.frames.slice()};
frozen.frames[last]={...take.frames[last],actors:take.frames[last].actors.map(row=>row.id==='foreman'?{...row,tissue:undefined}:row)};
const rigidPose=project.preview(frozen,last,marks).image;
const deformed=views[2];
const cam=K.procedural.sceneGraph.camera(plan.view.camera);
const optics=kit.CameraLens.frame({cam,radius:14},{},480,254);
const projector=kit.CameraLens.rasterProjector({view:optics.view,ortho:true,width:480,height:254,
  focal:254/(2*optics.tangent*optics.dist)});
const armCenter=V.lerp(...['arm-right.shoulder','arm-right.elbow'].map(id=>{
  const index=rig.indices.get(id);
  return find(last,'foreman').points.slice(index*3,index*3+3);
}),.55);
const [cropX,cropY]=projector.project(projector.viewPoint(armCenter)).map(Math.round);
const W=1034,H=562, bg='#11252e', soft='#a3b5ad', paper='#eed6a2', pale='#82c0b5', grid='#41626b';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=paper)=>({type:'text',text,at:[x,y],color,scale});
const cmds=[
  rect(0,0,W,H,bg),text('SILTWATCH CREW',23,18,3),text('SKINNED CROWD / HEADLESS BAKE',799,25,1,soft),rect(23,56,988,1,grid),
  text(idlabels[0],23,72),text(idlabels[2],526,72),
  rect(23,353,988,1,grid),text('ACTUATED ARM FIBER',23,368),text('PLACEMENT AND SOLVER',555,368),
  text((100*shorten).toFixed(1)+'% SHORTER AT FULL ACTIVATION',23,386,1,soft),
  text('SKIN SHIFT  '+skinOffset.toFixed(3)+' UNITS',555,388,1,pale),
  text('RAGDOLL HANDOFF  FRAME '+handoff.frame,555,406,1,soft),
  text('POSE SNAP  '+handoff.snap.toFixed(3)+' UNITS',555,424,1,soft),
  text('TERRAIN CONTACTS  '+report.contactSamples+' / '+report.missedContacts+' MISSED',555,442,1,soft),
  text('MAX VISIBLE 6   /   SKINNED 3   /   TISSUE 1',555,460,1,soft),
  text('TISSUE CELLS INVERTED  '+report.invertedCells,555,478,1,soft),
  text('SAME POSE / DETAIL',833,369,1,soft),text('RIG SKIN',833,466,1,soft),
  text('TISSUE SKIN',927,466,1,pale),rect(23,520,988,1,grid),
  text('GOLD / FIBER LENGTH',23,536,1,paper),text('TEAL / ACTIVATION',219,536,1,pale)
];
const left=23,top=411,plotH=90,plotW=480;
cmds.push(rect(left,top,plotW,plotH,'#192f36'),rect(left,top+plotH-2,plotW,1,grid));
for(const [key,tint] of [['length',paper],['activation',pale]]){
  const values=muscle.map(row=>key==='length'?row.length/row.rest:row.activation);
  cmds.push({type:'path',points:values.map((value,i)=>[left+4+(plotW-8)*i/(values.length-1),top+plotH-8-68*value]),
    stroke:tint,width:2});
}
const sheet=K.procedural.drawing2d.render({width:W,height:H,commands:cmds,edges:'hard'});
for(const [index,image] of [[0,views[0]],[1,views[2]]])for(let y=0;y<image.h;y++)for(let x=0;x<image.w;x++){
  const from=(y*image.w+x)*3,dest=((y+89)*W+x+23+503*index)*4;
  sheet.data.set(image.rgb.subarray(from,from+3),dest);
}
for(const [i,image] of [rigidPose,deformed].entries())for(let y=0;y<72;y++)for(let x=0;x<72;x++){
  const from=((cropY-18+Math.floor(y/2))*image.w+cropX-18+Math.floor(x/2))*3;
  const dest=((y+387)*W+x+833+94*i)*4;
  sheet.data.set(image.rgb.subarray(from,from+3),dest);
}
files.write(at('siltwatch-crew.png'),PNG.encode(W,H,sheet.data,4));
const loop=[];
for(let i=0;i<take.count;i+=2)loop.push(PNG.packFrame(project.preview(take,i,marks).image));
files.write(at('siltwatch-crew-loop.png'),PNG.encodeAnimation(loop,12));
assert.equal(PNG.readFullFrameAnimation(at('siltwatch-crew-loop.png'),{w:480,h:254,count:loop.length,fps:12}).length,33);
save('demo-report.json',{image:'siltwatch-crew.png',loop:'siltwatch-crew-loop.png',take:'take.json',frames:take.count,
  animatedFrames:loop.length,observed,shorten,skinOffset,bake:report,detailedFrame:last});
console.log(at('siltwatch-crew.png'));
