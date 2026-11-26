const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),{KIT:K}=kit;
const {compile}=require('../../cli/character-rig-assembly.js');
const {open,renderFrame}=require('../../cli/wardrobe.js');
const PNG=require('../../cli/png.js'), files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'out/storm-petrel'), at=(...parts)=>path.join(out,...parts);
const save=(name,value)=>files.json(at(name),value);
const read=name=>JSON.parse(fs.readFileSync(at(name),'utf8'));
const entry=path.resolve(__dirname,'../../cli/ink-studio.js');
const run=(...args)=>JSON.parse(execFileSync(process.execPath,[entry,'wardrobe',...args],{encoding:'utf8',maxBuffer:8*1024**2}));

const hinge=(axis)=>({type:'hinge',axis,angle:[-90,90]});
const skeleton={format:'ink-studio/character-rig',version:1,id:'petrel',components:[],joints:[
  {id:'body.root',parent:null,at:[0,1.7,0],limit:{type:'fixed'}},
  {id:'body.head',parent:'body.root',at:[0,2.45,.06],limit:hinge([0,1,0])},
  ...[-1,1].flatMap(sign=>{
    const side=sign<0?'left':'right';
    return [
      {id:side+'.wing',parent:'body.root',at:[sign*.48,2.20,-.13],limit:hinge([0,0,1])},
      {id:side+'.tip',parent:side+'.wing',at:[sign*1.17,2.35,-.18],limit:hinge([0,0,1])}];
  })
]};
save('rig.json',skeleton);
const actionKey=(time,value)=>({time,value:[value],ease:'smooth'});
const duration=2, fps=24, count=48;
const wingRow=(sign,tip=false)=>(tip?[[0,-13],[.56,1],[.99,28],[1.37,12],[2,-13]]:
  [[0,-29],[.54,-7],[.96,19],[1.32,5],[2,-29]]).map(([t,v])=>actionKey(t,v*sign));
const joint={
  'body.head':[actionKey(0,-8),actionKey(.83,18),actionKey(1.17,11),actionKey(2,-8)],
  'left.wing':wingRow(-1),'left.tip':wingRow(-1,true),
  'right.wing':wingRow(1),'right.tip':wingRow(1,true)
};
save('motion.json',{format:'ink-studio/character-motion',version:1,id:'petrel-spread',rigHash:compile(skeleton,K).hash,
  clips:{turn:{type:'curves',duration,joints:joint},spread:{type:'mix',duration,layers:[{id:'turn',clip:'turn',at:0}]}}});
const fog='#11232d', pale='#f6db9d', cyan='#70b6b6', gold='#e3a36a', soft='#9ab6b1', edge='#31555f';
const panels=[];
const panel=(id,size,layer,corners,color,trim,extra={})=>panels.push(
  {id,size,layer,side:-1,corners,color,trim,pins:[{edge:'top',joint:'body.root'}],...extra});
panel('lining',[12,13],0,[[-.54,2.11,.155],[.54,2.11,.155],[-.81,.26,.13],[.81,.26,.13]],
  '#225668','#54918f',{air:.22,bend:.0018,pins:[{edge:'top',joint:'body.root'},{vertices:[144,149,150,155],joint:'body.root'}]});
panel('outer-left',[7,13],1,[[-.56,2.075,.248],[-.025,2.105,.27],[-.67,.45,.235],[-.024,.51,.24]],
  '#925049','#cc805f',{thickness:.009,bend:.0013,air:1});
panel('outer-right',[7,13],1,[[.025,2.105,.27],[.56,2.075,.248],[.024,.51,.24],[.67,.45,.235]],
  '#ad5d4d','#df905f',{thickness:.009,bend:.0013,air:1});
const feathers=[];
for(const sign of [-1,1]) {
  const side=sign<0?'left':'right';
  const polar=(a,b)=>({axis:[0,0,1],stagger:.17,keys:[[0,-17],[.67,13],[1.19,35],[1.42,10],[2,-17]]
    .map(([time,value])=>({time,value:value*sign+(sign<0?b:a),ease:'smooth'}))});
  feathers.push({
    id:side+'-primaries',joint:side+'.tip',count:9,
    from:[sign*1.11,2.28,-.205],to:[sign*1.81,2.42,-.19],direction:[sign*.16,-1,-.15],normal:[0,0,1],
    length:[.80,1.07],width:[.17,.19],fan:[-7*sign,37*sign],curl:.08,asymmetry:.19*sign,
    colors:['#2f687a','#519294','#f0b87c'],samples:9,action:polar(0,0)
  },{
    id:side+'-secondaries',joint:side+'.wing',count:7,
    from:[sign*.47,2.17,-.095],to:[sign*1.14,2.31,-.089],direction:[sign*.11,-1,-.12],normal:[0,0,1],
    length:[.51,.80],width:[.145,.18],fan:[-5*sign,21*sign],curl:.08,asymmetry:.17*sign,
    colors:['#2d566b','#4c878d','#e0a674'],samples:9,action:polar(-5,5)
  },{
    id:side+'-coverts',joint:side+'.wing',count:7,
    from:[sign*.48,2.22,.002],to:[sign*1.23,2.35,.013],direction:[sign*.08,-1,.03],normal:[0,0,1],
    length:[.27,.44],width:[.12,.16],fan:[0,17*sign],curl:.11,asymmetry:.1*sign,
    colors:['#397b85','#71b0a7','#e9c885'],samples:7,action:polar(-8,8)
  });
}
const grooms=[
  {id:'crest',anchor:{joint:'body.head',point:[-.14,2.65,.04]},
    guide:[[0,0,0],[-.06,.17,.024],[-.20,.29,0],[-.35,.26,-.03]],up:[0,0,1],
    count:14,clumps:3,tightness:.78,frizz:.75,seed:713,separation:.029,radius:.008,samples:16,
    lengthVariation:.20,colors:['#75b2a4','#a4d5b8','#d9d39c']},
  ...[.23,.5,.78].map((u,i)=>({id:'fringe-'+i,anchor:{panel:'lining',uv:[u,.98]},
    guide:[[0,0,0],[.025,-.105,.07],[.025,-.23,.12],[.083,-.32,.148]],up:[0,0,1],
    count:11,clumps:3,tightness:.83,frizz:.6,seed:531+i*7,separation:.026,radius:.007,samples:12,
    lengthVariation:.20,colors:['#62aaab','#add5b4','#d3b38d']}))
];
const plan={format:'ink-studio/wardrobe-plan',version:1,id:'storm-petrel',seed:419,
  rig:{file:'rig.json',motion:'motion.json',clip:'spread'},panels,grooms,feathers,
  seams:[{id:'mantle-stitch',a:{panel:'outer-left',vertices:Array.from({length:12},(_,i)=>(i+1)*7+6)},
    b:{panel:'outer-right',vertices:Array.from({length:12},(_,i)=>(i+1)*7)},
    gap:.003,compliance:1e-6}],
  colliders:[{joint:'body.root',center:[0,1.60,-.22],radius:.31}],
  simulation:{fps,frames:count,substeps:5,gravity:[0,-9.8,-4.7],damp:3.5,wind:[1.7,.66,-3.3],gust:.83,
    clearance:.026,reach:.25,cell:.35}
};
save('wardrobe.json',plan);
save('without-contact.json',{...plan,simulation:{...plan.simulation,collision:false}});
const cold=run('bake',at('wardrobe.json'),'--cache',at('cache'),'--out',at('cold.json'));
const warm=run('bake',at('wardrobe.json'),'--cache',at('cache'),'--out',at('take.json'));
assert.equal(warm.artifactCache.status,'hit');
assert.equal(cold.takeSha256,warm.takeSha256);
assert(fs.readFileSync(at('cold.json')).equals(fs.readFileSync(at('take.json'))));
const off=run('bake',at('without-contact.json'),'--out',at('without-contact-take.json'));
const on=warm.collision.frames, maxSolvedPenetration=Math.max(...on.map(row=>row.maxPenetration));
assert(maxSolvedPenetration<.001);
const evidence=off.collision.frames.map((row,frame)=>({frame,on:on[frame].maxPenetration,off:row.maxPenetration}))
  .reduce((best,row)=>row.off-row.on>best.off-best.on?row:best);
assert(evidence.off-evidence.on>.015);
assert(warm.collision.pushes>100);
assert(warm.seams[0].final<warm.seams[0].initial*.5);
const project=open(at('wardrobe.json'),kit), take=project.validate(read('take.json'));
const baseline=open(at('without-contact.json'),kit), free=baseline.validate(read('without-contact-take.json'));

const tiny=(p)=>parseInt(p.slice(1),16);
function attach(meshes,id,points,faces,color) {
  meshes.push(K.sceneMeshes.create({id,positions:points.flat(),indices:faces.flat(),
    uvs:points.flatMap(()=>[.5,.5]),materials:[{id:id+'-ink',color:tiny(color)}]}));
}
function ellipsoid(meshes,id,c,sz,color) {
  const rings=10,n=22, pts=[],faces=[];
  for(let j=1;j<rings;j++)for(let i=0;i<n;i++){
    const t=j*Math.PI/rings,a=i*2*Math.PI/n;
    pts.push([c[0]+sz[0]*Math.cos(a)*Math.sin(t),c[1]+sz[1]*Math.cos(t),c[2]+sz[2]*Math.sin(a)*Math.sin(t)]);
  }
  pts.push([c[0],c[1]+sz[1],c[2]],[c[0],c[1]-sz[1],c[2]]);
  for(let i=0;i<n;i++){
    const q=(i+1)%n,top=pts.length-2,bottom=top+1,end=(rings-2)*n;
    faces.push([top,q,i],[bottom,end+i,end+q]);
    for(let j=0;j<rings-2;j++){
      const a=j*n+i,b=j*n+q;
      faces.push([a,b,a+n],[b,b+n,a+n]);
    }
  }
  attach(meshes,id,pts,faces,color);
}
function mannequin(_,meshes) {
  ellipsoid(meshes,'waist',[0,1.30,-.34],[.43,.91,.16],'#2a4853');
  ellipsoid(meshes,'neck',[0,2.15,.004],[.215,.36,.2],'#a58161');
  ellipsoid(meshes,'hood',[0,2.43,.014],[.345,.355,.27],'#2b5960');
  ellipsoid(meshes,'face',[.02,2.43,.172],[.244,.252,.179],'#dec392');
  ellipsoid(meshes,'mask',[-.025,2.495,.288],[.227,.099,.09],'#27363e');
  ellipsoid(meshes,'eye',[.075,2.515,.368],[.039,.027,.024],'#f8cf83');
  ellipsoid(meshes,'eye-left',[-.14,2.501,.351],[.030,.024,.023],'#f8cf83');
  attach(meshes,'beak',[[.03,2.45,.322],[.16,2.434,.301],[.053,2.377,.33],[.12,2.381,.57],[.079,2.414,.306]],
    [[0,2,3],[0,3,1],[2,4,3],[4,1,3],[0,1,4],[0,4,2]],'#df9d5f');
  for(const [i,sign] of [-1,1].entries()){
    ellipsoid(meshes,'boot-'+i,[sign*.23,.20,.093],[.134,.19,.2],'#345969');
    ellipsoid(meshes,'toe-'+i,[sign*.23,.095,.215],[.135,.08,.14],'#b87854');
  }
}
const view={w:300,h:239,background:fog,camera:{target:[0,1.46,0],yaw:-.11,pitch:.10,dist:6.20,fov:.71,ortho:true}};
save('view.json',view);
run('sample',at('wardrobe.json'),at('take.json'),'--frame','23','--out',at('wing-open.json'));
run('preview',at('wardrobe.json'),at('take.json'),'--frame','23','--view',at('view.json'),'--out',at('outfit-preview.png'));
const pose=(p,baked,i)=>p.frame(baked,i);
const painted=(p,baked,i,opts=view,withBody=mannequin)=>renderFrame(kit,pose(p,baked,i),opts,withBody);
const folded=painted(project,take,0), spread=painted(project,take,23);
const detailView={w:232,h:106,background:fog,camera:{target:[0,1.08,.18],yaw:1.00,pitch:.13,dist:4.15,fov:.69,ortho:true}};
const contactOff=painted(baseline,free,evidence.frame,detailView,null), contactOn=painted(project,take,evidence.frame,detailView,null);
for(const [name,image] of [['folded',folded],['spread',spread],['layers-off',contactOff],['layers-on',contactOn]])
  files.write(at(name+'.png'),PNG.encodeFrame(PNG.packFrame(image)));

const W=960,H=450;
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=pale)=>({type:'text',text,at:[x,y],scale,color});
const parts=[
  rect(0,0,W,H,'#0b1923'),text('STORM PETREL',25,21,3),text('LAYERED FLIGHT MANTLE',767,29,1,soft),rect(25,60,910,1,edge),
  text('FOLDED',25,79),text('SPREAD',349,79),text('LAYER CONTACT',684,79),
  rect(25,348,910,1,edge),text(warm.panels+' PANELS   /   '+warm.seams[0].stitches+' SEAM STITCHES',25,367,1,soft),
  text(warm.grooms.reduce((n,row)=>n+row.strands,0)+' GROOM STRANDS   /   '+warm.feathers+' FEATHERS',349,367,1,soft),
  text('CACHE REPLAY MATCHED',684,367,1,soft),
  text('PEAK TEST FRAME '+evidence.frame,684,382,1,soft),text('LAYER OVERLAP',25,412,1,soft),
  text('CONTACT OFF  '+evidence.off.toFixed(3)+' U',146,411,1,gold),
  text('CONTACT ON  '+evidence.on.toFixed(3)+' U',349,411,1,cyan),
  text('SEAM ERROR '+warm.seams[0].final.toFixed(6)+' U',684,411,1,soft),
  text('CONTACT OFF',686,216,1,gold),text('CONTACT ON',686,337,1,cyan)
];
const sheet=K.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands:parts});
function paint(image,x0,y0) {
  for(let y=0;y<image.h;y++)for(let x=0;x<image.w;x++){
    const src=(y*image.w+x)*3,dst=((y+y0)*W+x+x0)*4;
    sheet.data.set(image.rgb.subarray(src,src+3),dst);
  }
}
paint(folded,25,96);
paint(spread,349,96);
paint(contactOff,684,103);
paint(contactOn,684,225);
files.write(at('storm-petrel.png'),PNG.encode(W,H,sheet.data,4));
const loop=[];
for(let i=0;i<count;i+=2)loop.push(PNG.packFrame(painted(project,take,i)));
files.write(at('storm-petrel-loop.png'),PNG.encodeAnimation(loop,fps/2));
assert.equal(PNG.readFullFrameAnimation(at('storm-petrel-loop.png'),{w:view.w,h:view.h,count:loop.length,fps:fps/2}).length,24);
save('demo-report.json',{image:'storm-petrel.png',animation:'storm-petrel-loop.png',take:'take.json',peak:evidence,
  bake:{hash:warm.takeSha256,panels:warm.panels,seams:warm.seams,grooms:warm.grooms,feathers:warm.feathers,
    layerCorrections:warm.collision.pushes,maxSolvedPenetration},frames:[0,23,evidence.frame],loopFrames:loop.length,cache:warm.artifactCache.status});
console.log(at('storm-petrel.png'));
