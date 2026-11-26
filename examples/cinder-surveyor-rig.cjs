const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const files=require('../cli/asset-files.js');

const out=path.resolve(process.argv[2]??'cinder-surveyor'), file=name=>path.join(out,name);
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'character-rig',...args],{encoding:'utf8'}));
const save=(name,data)=>files.json(file(name),data), load=name=>JSON.parse(fs.readFileSync(file(name)));
const {KIT:K}=ink.load(), {V}=K;
const color={bg:'#142530',ink:'#162832',cloth:'#263e4c',clothMid:'#405b62',clothLight:'#65766c',
  tealD:'#216473',teal:'#378893',tealL:'#68b2ac',light:'#b1dfc1',
  goldD:'#804939',gold:'#ca8053',goldL:'#f7be77',glass:'#ffe6ac',rim:'#304d5b'};
const fmt={format:'ink-studio/character-rig-plan',version:1,id:'cinder-surveyor'};
const plan={...fmt,components:[
  {id:'body',template:'torso',offset:[0,1.13,0],joints:{head:[0,1.1,.015]}},
  {id:'arm-r',template:'arm',attach:'body.chest',offset:[.399,.085,0]},
  {id:'arm-l',template:'arm',attach:'body.chest',offset:[-.399,.085,0],mirror:'x'},
  {id:'leg-r',template:'leg',attach:'body.hips',offset:[.204,0,0],scale:1.04},
  {id:'leg-l',template:'leg',attach:'body.hips',offset:[-.204,0,0],scale:1.04,mirror:'x'}
]};
save('rig-plan.json',plan);
const rig=run('assemble',file('rig-plan.json'),'--out',file('rig.json'));
const joints=Object.fromEntries(rig.joints.map(joint=>[joint.id,joint.at])), at=id=>joints[id];

const carriers=[];
function add(type,id,asset,properties={}){
  const assetFile=id+'.json';
  save(assetFile,asset);
  carriers.push({id,type,file:assetFile,...properties});
}
function prism(polygon,z0,z1){
  const n=polygon.length,points=[...polygon.map(([x,y])=>[x,y,z1]),...polygon.map(([x,y])=>[x,y,z0])];
  const faces=[],tmat=[];
  for(let i=1;i<n-1;i++){
    faces.push([0,i,i+1],[n,n+i+1,n+i]);
    tmat.push(0,1);
  }
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    faces.push([i,i+n,j],[j,i+n,j+n]);
    tmat.push(1,1);
  }
  return {points,faces,tmat};
}
function shaped(at,sx,sy,chamfer){
  const [x,y]=at, c=chamfer;
  return [[x-sx+c,y-sy],[x+sx-c,y-sy],[x+sx,y-sy+c],[x+sx,y+sy-c],
    [x+sx-c,y+sy],[x-sx+c,y+sy],[x-sx,y+sy-c],[x-sx,y-sy+c]];
}
function armor(id, joint, rect,z0,z1,front,edge){
  const mesh=prism(rect,z0,z1);
  add('mesh',id,{...mesh,mats:[{name:'face',rgb:front},{name:'rim',rgb:edge}]},{joint});
}
const chest=at('body.chest'), spine=at('body.spine'), hips=at('body.hips');
const chestPlate=prism([[-.28,hips[1]+.145],[.28,hips[1]+.145],[.365,chest[1]-.14],[.365,chest[1]+.13],
  [.265,chest[1]+.23],[-.265,chest[1]+.23],[-.365,chest[1]+.13],[-.365,chest[1]-.14]],-.22,.261);
const torso=K.meshTopology.create({id:'enamel-harness',skin:{joints:['body.hips','body.spine','body.chest']},
  vertices:chestPlate.points.map((position,i)=>({id:'v'+i,position,
    weights:position[1]<spine[1]?{'body.spine':.26,'body.hips':.74}:
      position[1]<chest[1]?{'body.spine':.37,'body.chest':.63}:{'body.chest':1}})),
  faces:chestPlate.faces.map((face,i)=>({id:'f'+i,material:chestPlate.tmat[i]?'edge':'enamel',
    corners:face.map((v,j)=>({id:'f'+i+'c'+j,vertex:'v'+v,uv:[(chestPlate.points[v][0]+.4)/.8,
      (chest[1]+.24-chestPlate.points[v][1])/.8]}))}))});
add('mesh','enamel-harness',torso,{materials:[{id:'enamel',color:color.teal},{id:'edge',color:color.tealD}]});
armor('chest-mount','body.chest',shaped([0,chest[1]-.026],.235,.137,.036),.247,.289,color.goldD,color.ink);
armor('belt','body.hips',shaped([0,hips[1]+.045],.307,.105,.046),-.25,.244,color.cloth,color.ink);

for(const side of ['r','l']){
  const shoulder=at('arm-'+side+'.shoulder'), knee=at('leg-'+side+'.knee'), foot=at('leg-'+side+'.foot');
  armor('shoulder-'+side,'arm-'+side+'.shoulder',shaped([shoulder[0],shoulder[1]+.005],.184,.168,.06),
    -.185,.217,color.tealL,color.tealD);
  armor('knee-'+side,'leg-'+side+'.knee',shaped([knee[0],knee[1]+.02],.115,.11,.03),
    knee[2]+.08,knee[2]+.164,color.goldD,color.cloth);
  armor('boot-'+side,'leg-'+side+'.foot',shaped([foot[0],foot[1]-.034],.128,.107,.035),
    -.113,.289,color.clothMid,color.ink);
  armor('toe-'+side,'leg-'+side+'.foot',shaped([foot[0],foot[1]-.083],.114,.041,.02),
    .273,.312,color.gold,color.goldD);
}

let state=5381;
const rand=()=>((state=Math.imul(1664525,state)+1013904223>>>0)/4294967296);
function dot(at,normal,radius,lit,thickness=.012,opacity=1.35){
  return {at,normal,radius,color:lit,thickness,opacity};
}
function thread(a,b,radius,group){
  const rows=[], n=Math.ceil(V.dist(a,b)/.046), axis=V.norm(V.sub(b,a)), u=V.perp(axis), v=V.cross(axis,u);
  for(let j=0;j<=n;j++)for(let i=0;i<15;i++){
    const fraction=j/n, angle=(i+(j%2)*.42)*Math.PI*2/15;
    const point=V.lerp(a,b,fraction), normal=V.add(V.mul(u,Math.cos(angle)),V.mul(v,Math.sin(angle)));
    const value=radius*(.9+.16*Math.sin(Math.PI*fraction));
    const shade=V.dot(normal,[-.3,.52,.76])+.18*rand(), stripe=(j+group)%8===0;
    const pigment=shade>.42?(stripe?color.tealL:color.clothLight):shade>.03?color.clothMid:color.cloth;
    rows.push(dot(V.mad(point,normal,value),normal,.039+rand()*.008,pigment));
  }
  return rows;
}
function ellipsoid(center,axes,count,shade){
  const rows=[];
  for(let i=0;i<count;i++){
    const y=1-2*(i+.5)/count, a=i*2.39996323, radius=Math.sqrt(1-y*y), p=[radius*Math.cos(a),y,radius*Math.sin(a)];
    const point=p.map((n,k)=>center[k]+axes[k]*n), normal=V.norm(p.map((n,k)=>n/axes[k]));
    rows.push(dot(point,normal,.033+rand()*.01,shade(p,normal,i),.011,1.5));
  }
  return rows;
}
function splats(id,list,options){add('splats',id,{format:'ink-studio/character-splats',version:1,splats:list},options);}
for(const side of ['r','l']){
  let id='arm-'+side;
  const arm=['shoulder','elbow','hand'].map(name=>id+'.'+name);
  splats('sleeve-'+side,thread(at(arm[0]),at(arm[1]),.132,1).concat(thread(at(arm[1]),at(arm[2]),.103,3)),
    {joints:arm,influences:2,falloff:.066});
  const p=at(arm[2]);
  splats('glove-'+side,ellipsoid(p,[.103,.111,.101],110,(n,v)=>v[2]>.52?color.goldL:v[2]>.15?color.gold:color.goldD),{joint:arm[2]});
  id='leg-'+side;
  const leg=['hip','knee','foot'].map(name=>id+'.'+name);
  splats('trouser-'+side,thread(at(leg[0]),at(leg[1]),.14,3).concat(thread(at(leg[1]),at(leg[2]),.103,5)),
    {joints:leg,influences:2,falloff:.064});
}
const helmet=V.add(at('body.head'),[0,.145,0]);
splats('helmet',ellipsoid(helmet,[.277,.266,.247],585,(p,n,i)=>{
  if(p[2]>.6&&p[1]<.42&&p[1]>-.25){
    if(p[1]>.25||p[1]<-.15||Math.abs(p[0])>.66)return color.goldD;
    if(p[1]>.07&&p[1]<.24&&(p[0]<-.18||p[0]>.16))return i%3===0?color.glass:color.goldL;
    return color.ink;
  }
  const light=V.dot(n,[-.4,.7,.7])+.19*rand();
  return light>.75?color.light:light>.44?color.tealL:light>.05?color.teal:color.tealD;
}),{joint:'body.head'});

const dial=[];
for(let i=0;i<22;i++){
  const a=2*Math.PI*i/22;
  dial.push(dot([.086*Math.cos(a),chest[1]-.023+.084*Math.sin(a),.312],[0,0,1],.023,color.goldL));
}
for(let i=-2;i<=2;i++)dial.push(dot([i*.023,chest[1]-.021,.317],[0,0,1],.026,color.glass));
splats('dial-pigment',dial,{joint:'body.chest'});
const shield=prism(shaped([0,chest[1]-.024],.219,.123,.032),.266,.291);
add('proxy','dial-depth',shield,{joint:'body.chest'});
const returns=Array.from({length:46},(_,i)=>dot([.21*(rand()-.5),chest[1]-.027+.104*(rand()-.5),.223],[0,0,1],.022,
  i%3===0?color.goldL:color.goldD,.009,.92));
splats('rear-returns',returns,{joint:'body.chest'});

save('bind-plan.json',{format:'ink-studio/character-bind-plan',version:1,carriers,
  scene:{palette:Object.values(color),proxyTolerance:.042}});
const bind=run('bind',file('rig.json'),file('bind-plan.json'),'--out',file('binding.json'));
const ik={format:'ink-studio/character-ik',version:1};
save('rest-targets.json',{...ik,targets:[]});
const sole=[0,-.116,.115], direction={local:[0,1,0],at:[0,1,0],weight:1,tolerance:1};
const fixed=['r','l'].map(side=>{
  const joint='leg-'+side+'.foot';
  return {id:'plant-'+side,joint,at:V.add(at(joint),sole),offset:sole,weight:7,tolerance:.009,direction};
});
const targets=[...fixed,{id:'grip',joint:'arm-r.hand',at:[1.02,2.415,.35],weight:2,tolerance:.014},
  {id:'brace',joint:'arm-l.hand',at:V.add(at('arm-l.hand'),[-.04,.085,.14]),weight:1.4,tolerance:.014},
  {id:'gaze',joint:'body.head',direction:{local:[0,0,1],at:[.15,.13,1],weight:.45,tolerance:2}}];
save('reach-targets.json',{...ik,root:{min:[-.27,-.21,-.26],max:[.32,.17,.27]},iterations:100,targets});
const rest=run('solve',file('rig.json'),file('rest-targets.json'),'--out',file('rest.json'));
const reach=run('solve',file('rig.json'),file('reach-targets.json'),'--out',file('reach.json'));
assert(reach.solve.passed,JSON.stringify(reach.solve));
assert(reach.maxBoneDrift<1e-8);
save('view.json',{w:218,h:246,camera:{target:[0,1.25,0],yaw:-.18,pitch:.11,dist:5.55,fov:.69,ortho:true}});
const variants=['rest','reach'].map(id=>{
  const row=run('preview',file('rig.json'),file('binding.json'),file(id+'.json'),'--view',file('view.json'),'--out',file(id));
  return {id,image:PNG.raster(file(path.join(id,row.image))),receipt:load(path.join(id,row.report)),path:path.join(id,row.report)};
});
assert(variants[1].receipt.depthProxyPixels>0);
assert(variants[1].receipt.carriers.some(row=>row.type==='proxy'&&row.moved>0));
assert(variants[1].receipt.carriers.some(row=>row.type==='mesh'&&row.moved>0));
assert(variants[1].receipt.carriers.some(row=>row.type==='splats'&&row.moved>0));

const W=737,H=361, rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color='#e9d6aa')=>({type:'text',text,at:[x,y],scale,color});
const cmds=[rect(0,0,W,H,'#101e2a'),text('CINDER SURVEYOR',24,17,3),text('SHARED CHARACTER RIG',506,25,1,'#9dc8be'),
  rect(23,51,691,1,'#41666f'),text('REST POSE',25,64),text('REACH WITH PLANTED BOOTS',263,64),
  text('SOLVED JOINTS',505,64),rect(503,84,208,246,'#172b37'),
  text(bind.carriers.length+' CARRIERS  /  '+rig.joints.length+' JOINTS',24,340,1,'#9ec9bd'),
  text('MESH / SPLATS / DEPTH PROXY',262,340,1,'#9ec9bd')];
const report=reach.solve.targets;
const colors=['#8bcebb','#8bcebb','#ffcb83','#db8b72','#a4c7e1'];
for(const [i,row] of report.entries()){
  const value=row.position?row.position.residual.toFixed(4):row.direction.residualDegrees.toFixed(2)+' DEG';
  cmds.push(rect(513,252+i*17,6,6,colors[i]),text(row.id.toUpperCase()+' '+value,525,251+i*17,1,'#9bc4bd'));
}
const sceneArt=K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:cmds});
const plot=(x,y,rgb)=>{if(x>=0&&x<W&&y>=0&&y<H)sceneArt.data.set(rgb,(y*W+x)*4);};
const inkAt=hex=>[...Array.from({length:3},(_,i)=>parseInt(hex.slice(1+2*i,3+2*i),16)),255];
function line(a,b,tint){
  const steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
  const color=inkAt(tint);
  for(let i=0;i<=steps;i++)plot(Math.round(a[0]+(b[0]-a[0])*i/Math.max(1,steps)),
    Math.round(a[1]+(b[1]-a[1])*i/Math.max(1,steps)),color);
}
const mark=p=>[609+p[0]*54,241-p[1]*59];
function drawPose(value,tint,dots){
  for(const joint of Object.values(value.joints)){
    const projected=mark(joint.position);
    if(joint.parent)line(mark(value.joints[joint.parent].position),projected,tint);
    if(dots)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)plot(Math.round(projected[0])+x,Math.round(projected[1])+y,inkAt(tint));
  }
}
drawPose(rest,'#3c5b65',false);
drawPose(reach,'#b1dfc1',true);
for(const [i,row] of report.entries()){
  if(!row.position)continue;
  const center=mark(row.position.at);
  for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)plot(Math.round(center[0])+x,Math.round(center[1])+y,inkAt(colors[i]));
}
for(const [i,{image}] of variants.entries())for(let y=0;y<image.h;y++)for(let x=0;x<image.w;x++){
  const a=(y*image.w+x)*4;
  plot(24+i*238+x,84+y,image.data.subarray(a,a+4));
}
files.write(file('cinder-surveyor.png'),PNG.encode(W,H,sceneArt.data,4));
save('demo-report.json',{rig:'rig.json',binding:'binding.json',pose:'reach.json',targets:reach.solve.targets,
  maxBoneDrift:reach.maxBoneDrift,proxies:variants[1].receipt.depthProxyPixels,views:variants.map(row=>row.path)});
console.log(file('cinder-surveyor.png'));
