/* The Faraday hoist has a skinned fold and splat rivets controlled by the same elbow. */
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), R=require('../../cli/render.js'), PNG=require('../../cli/png.js');
const {KIT:K,makeBuilder}=ink.load(), {V}=K, T=K.meshTopology;
const directory=path.resolve(process.argv[2]??'shape-key-review');
const file=name=>path.join(directory,name);
fs.mkdirSync(directory,{recursive:true});
const save=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');

const palette={
  deep:0x243144, basalt:0x354754, blue:0x486d73, glaze:0x3a8b83, mint:0x86b7a2,
  shade:0x684c4c, oxblood:0x936153, copper:0xbc7956, bevel:0xe6ae71, gold:0xffd694, white:0xffeec4
};
const materials=Object.entries(palette).map(([id,color])=>({id,color}));
const vertices=[], faces=[];
function v(id,p,elbow=0) {
  vertices.push({id,position:p,weights:{mast:1-elbow,elbow}});
  return id;
}
function panel(id,points,material,weight=0) {
  const ids=points.map((p,i)=>v(id+'/'+i,p,weight));
  polygon(id,ids,material);
}
function polygon(id,ids,material) {
  faces.push({id,material,corners:ids.map((vertex,i)=>({id:id+'/c'+i,vertex,uv:[i%2,Math.floor(i/2)%2]}))});
}
function plate(id,xy,z,material) {
  panel(id,xy.map(([x,y])=>[x,y,z]),material);
}
const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const pivot=[.34,.75,.10];
plate('plinth-dark',rect(-1.97,-.97,-.70,-.82),.08,'deep');
plate('plinth',[[ -1.92,-.80],[-.76,-.80],[-.89,-.61],[-1.81,-.61]],.16,'basalt');
plate('plinth-highlight',rect(-1.86,-.71,-.83,-.65),.19,'blue');
plate('column',rect(-1.65,-.63,-1.14,1.24),.26,'basalt');
plate('column-lit',rect(-1.62,-.61,-1.44,1.24),.29,'blue');
plate('column-spine',rect(-1.20,-.62,-1.14,1.21),.30,'deep');
plate('collar',rect(-1.79,.31,-.96,.65),.34,'shade');
plate('collar-face',rect(-1.75,.35,-.98,.64),.38,'copper');
plate('collar-rivet',rect(-1.68,.43,-1.51,.54),.44,'gold');
plate('collar-window',rect(-1.40,.41,-1.06,.56),.44,'deep');
plate('collar-glass',rect(-1.37,.44,-1.10,.52),.46,'mint');
plate('crown',[[-1.74,1.19],[-1.05,1.19],[-.97,1.33],[-1.20,1.44],[-1.57,1.44],[-1.78,1.32]],.26,'bevel');
plate('crown-base',rect(-1.76,1.16,-1.02,1.24),.37,'shade');

const stations=[
  [-1.08,.75,.34,0],[-.81,.75,.34,0],[-.51,.76,.30,0],[-.24,.77,.29,0],
  [.01,.76,.27,.08],[.20,.75,.29,.28],[.36,.75,.27,.57],[.53,.75,.25,.83],
  [.71,.75,.225,.96],[.94,.75,.207,1],[1.18,.75,.22,1],[1.43,.75,.17,1],[1.62,.75,.11,1]
];
const profile=[-1,-.73,-.46,.54,.76,1];
const bands=stations.map(([x,y,d,w],i)=>profile.map((n,j)=>v('arm/'+i+'/'+j,[x,y+d*n,.11+(j%3)*.030],w)));
for (let i=1;i<bands.length;i++) for (let j=1;j<profile.length;j++) {
  const rib=i>=4&&i<=8;
  const material=[
    rib&&i%2===0?'bevel':'shade', rib&&i%2===1?'oxblood':'copper',
    rib?(i%2===0?'copper':'shade'):(i%2===0?'glaze':'blue'),
    rib&&i%2===0?'bevel':'glaze', i%2===0?'gold':'bevel'
  ][j-1];
  polygon('arm-band-'+i+'-'+j,[bands[i-1][j-1],bands[i][j-1],bands[i][j],bands[i-1][j]],material);
}
panel('head-brass',[[1.35,.60,.24],[1.61,.61,.24],[1.70,.75,.24],[1.62,.91,.24],[1.35,.92,.24]],'shade',1);
panel('head-face',[[1.37,.64,.28],[1.59,.65,.28],[1.64,.76,.28],[1.58,.86,.28],[1.37,.87,.28]],'bevel',1);
panel('head-slot',[[1.41,.69,.31],[1.55,.69,.31],[1.57,.76,.31],[1.55,.83,.31],[1.41,.83,.31]],'deep',1);
panel('head-glass',[[1.43,.73,.35],[1.54,.73,.35],[1.55,.78,.35],[1.43,.78,.35]],'mint',1);
const document=T.create({id:'faraday-hoist',vertices,faces,skin:{joints:['mast','elbow']}});
const view={w:216,h:148,materials,camera:{target:[-.19,.61,0],dist:5.0,yaw:.06,pitch:.10,ortho:true,fov:.68}};

function assembly(mesh) {
  const B=makeBuilder(42,[0x14232d,palette.gold,palette.bevel,palette.white]);
  B.disc(-1.67,.475,.44,[0,0,1],.021,.009,B.P[2],2);
  for (let i=0;i<7;i++) {
    const x=pivot[0]+(i-3)*.037, y=pivot[1]-.225+Math.cos(i*.94)*.011;
    B.disc(x,y,.214,[0,0,1],.025+(i%2)*.003,.012,B.P[1+i%3],1.8);
  }
  B.describeSplats(1,8,{object:'fold-rivets'});
  const world=B.finish({meshes:[mesh],cam:view.camera,radius:5,dither:0,fog:{c:0,start:1,max:0}});
  const actor=K.puppet(world,{parts:{mast:{ids:[0],pivot:[0,0,0]},
    elbow:{ids:[1,2,3,4,5,6,7],parent:'mast',pivot}}});
  function aim(angle) {
    actor.pose.elbow={rot:[0,0,angle]};
    actor.flush();
    world.rest??=world.data;
    world.data=K.bones.posed({data:world.rest,anim:world.anim,posedBuf:world.posedBuf});
    world.posedBuf=world.data;
  }
  return {world,actor,aim};
}

const angles=[['outside',12],['approach',58],['lock',82]];
const tracker=assembly(T.toSceneMesh(document,{materials}));
const captures=angles.map(([id,angle])=>{
  tracker.aim(angle);
  return {id,...tracker.actor.correctives.meshPose(document.skin.joints)};
});
const center=Array.from(tracker.world.data.subarray(16*4,16*4+3));
const corrective=tracker.actor.correctives.capture({id:'hinge-rivets',drivers:[{part:'elbow',radius:48}],
  select:{object:'fold-rivets'},strokes:[{at:center,radius:.38,move:[.15,.042,0]}]});
const moves=[];
for (const [i,strength] of [[4,.12],[5,.53],[6,1],[7,.91],[8,.55],[9,.16]]) {
  for (const [j,influence] of [[0,1],[1,.81],[2,.56],[3,.18]]) {
    const value=strength*influence;
    moves.push({vertex:'arm/'+i+'/'+j,move:[.35*value,.105*value,.014*value],
      ...(i===6&&j===0&&{keys:[{at:.5,move:[.204,.067,.009]}]})});
  }
}
const request={destination:'pose',id:'outer-fold',pose:captures.at(-1),revision:T.revision(document),
  corrective,moves};
const config={...view,poses:captures};
save('mesh.json',document);save('shape-request.json',request);save('splat-corrective.json',corrective);
save('view.json',config);
const cli=path.join(__dirname,'../../cli/ink-studio.js');
execFileSync(process.execPath,[cli,'mesh-topology','shape-keys',file('mesh.json'),file('shape-request.json'),
  '--view',file('view.json'),'--preview',file('diagnostics'),'--out',file('posed-revision.json'),
  '--report',file('pose-report.json')],{stdio:'inherit'});
const restRequest={destination:'rest',revision:T.revision(document),
  moves:bands[0].map(vertex=>({vertex,move:[-.14,0,0]}))};
save('rest-request.json',restRequest);
save('rest-view.json',view);
execFileSync(process.execPath,[cli,'mesh-topology','shape-keys',file('posed-revision.json'),file('rest-request.json'),
  '--view',file('rest-view.json'),'--preview',file('rest-diagnostics'),'--out',file('rest-revision.json'),'--report',file('rest-report.json')],{stdio:'inherit'});
const edit=JSON.parse(fs.readFileSync(file('posed-revision.json'),'utf8'));
const pictures=[], runtime=[];
function render(angle,apply) {
  const mesh=T.toSceneMesh(document,{materials}), {world,actor,aim}=assembly(mesh);
  const bound=T.shapeKeys.bind(mesh,{...edit.shapeKeys,keys:apply?edit.shapeKeys.keys:[]});
  actor.correctives.attachMesh(bound);
  if (apply) actor.correctives.set([corrective]);
  aim(angle);
  const image=ink.render(world,{w:view.w,h:view.h,px:1,t:0,raw:true,edges:false,
    lockCamera:true,shutter:false,renderGrid:false});
  return {image,...(apply&&{mesh:bound.state()[0].weight,splats:actor.correctives.state()[0].weight})};
}
for (const [id,angle] of [['rest',0],...angles]) {
  const source=render(angle,false), change=render(angle,true);
  for (const [lane,{image}] of [['source',source],['corrected',change]])
    PNG.write(file(id+'-'+lane+'.png'),image.w,image.h,image.rgb);
  let pixels=0;
  for (let i=0;i<source.image.rgb.length;i+=3)
    if ([0,1,2].some(k=>source.image.rgb[i+k]!==change.image.rgb[i+k])) pixels++;
  runtime.push({id,angle,mesh:change.mesh,splats:change.splats,changedPixels:pixels});
  pictures.push(source.image,change.image);
}
save('runtime-report.json',{views:runtime});
const sheet=R.grid(pictures,2);
PNG.write(file('comparison.png'),sheet.w,sheet.h,sheet.rgb);
