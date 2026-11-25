/* The tide semaphore carries its lamp, a signal braid, and a glass-bead patch through a panel split. */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const ink=require('../..'), R=require('../../cli/render.js'), PNG=require('../../cli/png.js');
const {KIT:K,makeBuilder}=ink.load(), T=K.meshTopology, {V,M}=K;
const directory=path.resolve(process.argv[2]??'attachment-review');
const file=name=>path.join(directory,name);
fs.mkdirSync(directory,{recursive:true});
const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const colors={
  shadow:0x263241, steel:0x3d5965, rail:0x658486, teal:0x398981, darkTeal:0x265763,
  mint:0x79b09b, bronze:0x966345, copper:0xc78958, brass:0xebba77, light:0xffdea0, glass:0x88e0c5
};
const materials=Object.entries(colors).map(([id,color])=>({id,color}));
const vertices=[], faces=[], cornerId=(id,i)=>id+'/c'+i;
function vertex(id,position,flex=0) {
  vertices.push({id,position,weights:{mast:1-flex,blade:flex}});
  return id;
}
function face(id,ids,material) {
  return {id,material,corners:ids.map((vertex,i)=>({id:cornerId(id,i),vertex,uv:[i%2,(i>>1)%2]}))};
}
function plate(id,xy,z,material) {
  faces.push(face(id,xy.map(([x,y],i)=>vertex(id+'/'+i,[x,y,z])),material));
}

plate('plinth',[[-1.92,-.79],[-.74,-.79],[-.62,-.95],[-2.03,-.95]],.15,'shadow');
plate('stone',[[-1.88,-.64],[-.78,-.64],[-.71,-.8],[-1.94,-.8]],.18,'rail');
plate('mast',[[-1.57,-.66],[-1.18,-.66],[-1.15,.72],[-1.55,.72]],.23,'steel');
plate('mast-light',[[-1.55,-.65],[-1.41,-.65],[-1.39,.66],[-1.53,.66]],.24,'rail');
plate('base-band',[[-1.65,-.63],[-1.08,-.63],[-1.08,-.48],[-1.65,-.48]],.30,'bronze');
plate('hinge-housing',[[-1.61,-.12],[-1.74,.12],[-1.62,.38],[-1.26,.38],[-1.12,.12],[-1.26,-.12]],.33,'bronze');
plate('hinge-ring',[[-1.54,-.07],[-1.65,.12],[-1.54,.29],[-1.31,.29],[-1.21,.12],[-1.31,-.07]],.37,'brass');
plate('hinge-pin',[[-1.51,.04],[-1.56,.14],[-1.48,.22],[-1.37,.22],[-1.30,.13],[-1.38,.04]],.40,'darkTeal');
plate('hinge-shine',[[-1.49,.138],[-1.45,.184],[-1.37,.184],[-1.41,.138]],.43,'light');
plate('mast-cap',[[-1.63,.66],[-1.09,.66],[-1.09,.79],[-1.23,.91],[-1.47,.91],[-1.63,.79]],.26,'bronze');

const stations=[[-1.26,.12,.22,0],[-.78,.19,.27,.14],[-.23,.24,.30,.35],[.36,.25,.30,.58],[.94,.23,.27,.78],[1.48,.17,.19,.93],[1.86,.10,.05,.97]];
const bands=stations.map(([x,y,d,w],i)=>[-1,-.57,.6,1].map((n,j)=>vertex('s'+i+'/'+j,[x,y+d*n,.12+j*.025],w)));
for (let i=1;i<bands.length;i++) for (let j=1;j<4;j++) faces.push(face('blade-'+i+'-'+j,
  [bands[i-1][j-1],bands[i][j-1],bands[i][j],bands[i-1][j]],
  j===1 ? i%2===0?'bronze':'copper' : j===3 ? 'brass' : i%2===0?'darkTeal':'teal'));
const before=T.create({id:'tide-semaphore',skin:{joints:['mast','blade']},vertices,faces});
const moved=before.vertices.filter(row=>['s4/1','s4/2'].includes(row.id)).map(row=>({...row,
  position:[row.position[0],row.position[1]+.025,row.position[2]+.018]}));
const split='blade-4-2', old=before.faces.find(row=>row.id===split), ids=old.corners.map(row=>row.vertex);
const center=[.64,.24,.176];
const patch={vertices:[...moved,{id:'service-diamond',position:center}],removeFaces:[split],
  faces:ids.map((id,i)=>face('service-panel-'+(i+1),[id,ids[(i+1)%4],'service-diamond'],i===1||i===2?'mint':'teal')),
  lineage:{faces:ids.map((_,i)=>({from:split,to:'service-panel-'+(i+1)}))}};
const {document:replacement,correspondence}=T.editWithCorrespondence(before,patch);

const tri=T.triangulate(before).triangleSources;
function on(faceId,point) {
  const corners=new Map(before.faces.find(f=>f.id===faceId).corners.map(row=>[row.id,row.vertex]));
  const points=new Map(before.vertices.map(row=>[row.id,row.position]));
  let best;
  for (const row of tri.filter(row=>row.face===faceId)) {
    const [a,b,c]=row.corners.map(id=>points.get(corners.get(id)));
    const hit=K.procedural.geometry.closestTrianglePoint(point,{a,b,c,u:V.sub(b,a),v:V.sub(c,a)});
    const distance=V.dist(point,hit.at);
    if (!best||distance<best.distance) best={...row,weights:hit.weights.map(n=>Math.max(0,n)),distance};
  }
  const {distance,...anchor}=best;
  return anchor;
}
const members=Array.from({length:14},(_,i)=>'glass-bead-'+(i+1));
const attachments=T.attachments.create(before,[
  {id:'lamp-pivot',kind:'socket',node:'signal',socket:'lamp',anchor:on('blade-5-2',[1.12,.22,.17]),offset:[0,-.22,.13]},
  {id:'signal-braid-a',kind:'curve-root',anchor:on(split,[.49,.34,.17]),offset:[0,0,.028]},
  {id:'signal-braid-b',kind:'curve-root',anchor:on('blade-5-2',[1.28,.31,.17]),offset:[0,0,.028]},
  {id:'bead-inlay',kind:'splat-group',group:'glass-beads',members,anchor:on(split,[.76,.23,.17]),offset:[0,0,.075]}
]);
const I=M.id(), pivot=[-1.38,.12,0];
function matrices(angle) {
  const matrix=M.mul(M.rot([0,0,1],angle),M.rot([0,1,0],angle*.30));
  return {mast:[...I,0,0,0],blade:[...matrix,...V.sub(pivot,M.app(matrix,pivot))]};
}
const poses=[{id:'raise',matrices:matrices(.46)},{id:'lower',matrices:matrices(-.24)}];
const settings={poses,maxRestError:.06,maxPoseError:.08,maxAngle:15};
const view={w:216,h:132,materials,camera:{target:[-.08,.38,0],dist:5.55,yaw:.10,pitch:.11,ortho:true,fov:.65}};
save('source.json',before);save('replacement.json',replacement);save('map.json',correspondence);
save('attachments.json',attachments);save('settings.json',settings);save('view.json',view);
save('strict-settings.json',{...settings,maxPoseError:.012});
const cli=path.join(__dirname,'../../cli/ink-studio.js');
const args=[cli,'mesh-topology','transfer-attachments',file('source.json'),file('replacement.json'),file('map.json'),
  '--attachments',file('attachments.json')];
execFileSync(process.execPath,[...args,'--settings',file('settings.json'),'--view',file('view.json'),'--preview',file('diagnostics'),
  '--out',file('accepted.json'),'--report',file('report.json')],{stdio:'inherit'});
const denied=spawnSync(process.execPath,[...args,'--settings',file('strict-settings.json'),
  '--out',file('strict-candidate.json'),'--report',file('blocked.json')],{encoding:'utf8'});
if (denied.status!==1||!denied.stderr.includes('needs review')||fs.existsSync(file('strict-candidate.json')))
  throw new Error('The strict pose budget should block acceptance');
const accepted=JSON.parse(fs.readFileSync(file('accepted.json'),'utf8'));

function lamp(transform) {
  const positions=[],uvs=[],indices=[],faceMaterials=[];
  function panel(x0,y0,x1,y1,z,material) {
    const n=positions.length/3;
    for (const p of [[x0,y0,z],[x1,y0,z],[x0,y1,z],[x1,y1,z]]) positions.push(...K.sceneGraph.point(transform,p));
    uvs.push(0,1,1,1,0,0,1,0);indices.push(n,n+1,n+2,n+2,n+1,n+3);
    faceMaterials.push(material,material);
  }
  panel(-.022,-.10,.022,.08,-.02,0);panel(-.18,-.40,.18,-.13,.01,0);
  panel(-.14,-.37,.14,-.15,.031,1);panel(-.09,-.34,.09,-.19,.05,2);
  panel(-.068,-.31,.065,-.21,.067,3);panel(-.048,-.24,.031,-.20,.076,4);
  panel(-.13,-.44,.13,-.40,.018,1);panel(-.16,-.135,.16,-.096,.027,1);
  return K.sceneMeshes.create({id:'signal-lamp',positions,uvs,indices,faceMaterials,
    materials:['shadow','copper','darkTeal','glass','light'].map(id=>({id,color:colors[id]}))});
}
const originalMesh=T.toSceneMesh(before,{materials}), originalSite=T.attachments.bind(originalMesh,attachments).frame('bead-inlay');

function render(doc,manifest,pose) {
  const mesh=T.toSceneMesh(doc,{materials});
  const site=T.attachments.bind(mesh,manifest);
  const graph=K.sceneGraph.create({nodes:{signal:{sockets:{lamp:{}}},prop:{parent:{node:'signal',socket:'lamp'}}}});
  const palette=[0x15232e,colors.glass,colors.mint,colors.light], B=makeBuilder(12,palette);
  for (const [i] of members.entries()){
    const center=K.sceneGraph.point(originalSite,[(i%7-3)*.042,(i<7?-.035:.02)+Math.sin(i*1.7)*.012,(i%3)*.005]);
    B.disc(...center,[0,0,1],.021+(i%3)*.005,.012,B.P[1+i%3],1.3);
  }
  B.describeSplats(0,B.count(),{object:'signal-inlay'});
  const grown=K.curveSplats.grow(B,{kind:'mesh',binding:site},{
    stitches:[{id:'signal-braid',from:{attachment:'signal-braid-a'},to:{attachment:'signal-braid-b'},lift:.16}],
    segments:11,offset:.006},{color:'#f2b980',width:.052,edge:'hard',caps:'blunt'});
  const world=B.finish({meshes:[mesh],cam:view.camera,radius:5,dither:0,fog:{c:0,start:1,max:0}});
  world.splatIds=members.concat(Array(world.count-members.length).fill(null));
  const moved=site.bindSplats(world);
  if (pose) T.skin.bind(mesh).pose(pose);
  site.poseSockets(graph);
  moved.pose();
  grown.pose(world);
  world.meshes.push(lamp(graph.frame('prop')));
  return ink.render(world,{w:view.w,h:view.h,px:1,raw:true,edges:false,lockCamera:true});
}

const pictures=[];
for (const pose of [{id:'rest'},...poses]) {
  const a=render(before,attachments,pose.matrices), b=render(accepted.document,accepted.attachments,pose.matrices);
  for (const [index,frame] of [a,b].entries()) PNG.write(file(pose.id+'-'+(index?'transferred':'source')+'.png'),frame.w,frame.h,frame.rgb);
  pictures.push(a,b);
}
const sheet=R.grid(pictures,2,['REST SOURCE','REST TRANSFER','RAISE SOURCE','RAISE TRANSFER','LOWER SOURCE','LOWER TRANSFER']);
PNG.write(file('comparison.png'),sheet.w,sheet.h,sheet.rgb);
