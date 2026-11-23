/* Lowbank floodgate. The same retained mesh reads committed surface state on every frame. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const {screenDrawing}=require('../src/frame-composite.js');

function lowbank({KIT:K,makeBuilder,makeSculpt}) {
  const width=192,height=124, pixels=new Uint8Array(width*height*4), seed=73;
  const ramp=(x,a,b)=>K.clamp((x-a)/(b-a),0,1);
  const curve=(x,a,b)=>{
    const t=ramp(x,a,b);
    return t*t*(3-2*t);
  };
  const mask=(fn,w=104,h=76)=>({space:'uv',kind:'raster',width:w,height:h,
    values:Array.from({length:w*h},(_,i)=>Math.round(255*K.clamp(fn((i%w)/(w-1),Math.floor(i/w)/(h-1)),0,1)))});
  const patch=(u,v,x,y,a,b)=>1-curve(Math.hypot((u-x)/a,(v-y)/b),.26,1);
  const noise=(u,v)=>.52+.27*Math.sin(u*83+v*221)*Math.cos(u*182-v*103)+.21*Math.sin(u*321-v*185);
  const scratches=Array.from({length:13},(_,i)=>({
    u:.26+i*.0329,v:.585+Math.sin(i*3.42)*.046,w:.025+(i%5)*.011
  }));
  const gate=[-1.92,.61,.50];
  const brush={kind:'rect',min:[0,0],max:[1,1]};
  const source=channel=>({source:'query',field:'rig/surface-state',
    args:{body:'gate',face:'+z',uv:[.5,.5]},path:['values',channel]});
  const doc={format:'ink-studio/simulation-material-layers',version:1,layers:[
    {id:'wetness',driver:source('wetness'),mask:mask((u,v)=>{
      const runoff=Math.max(...[.15,.38,.57].map((x,i)=>patch(u,v,x+Math.sin(v*9+i)*.022,.43,.03+i*.008,.38-i*.05)));
      const wash=curve(v,.43,.93)*(.53+.47*noise(u,v));
      return Math.max(wash,runoff);
    }),pigment:'#174859',roughness:.08,sheen:.72,relief:.005},
    {id:'abrasion',driver:source('wear'),mask:mask((u,v)=>{
      const scratchesHere=Math.max(...scratches.map(s=>patch(u,v,s.u,s.v+(u-s.u)*.64,s.w,.017)));
      return Math.max(scratchesHere,.42*patch(u,v,.47,.595,.30,.087)*noise(u,v));
    }),pigment:'#c78b61',roughness:.43,sheen:.54,relief:-.017},
    {id:'soot',driver:source('soot'),mask:mask((u,v)=>{
      const column=patch(u,v,.77+(v-.11)*.21,.19,.19,.30);
      const edge=patch(u,v,.82,.11,.13,.11);
      return Math.max(column*(.61+.39*noise(u,v)),edge);
    }),pigment:'#2c292f',roughness:.98,sheen:.025},
    {id:'moss',driver:source('moss'),mask:mask((u,v)=>{
      const edge=curve(v,.80+.062*Math.sin(u*17),.93);
      const pockets=Math.max(patch(u,v,.17,.94,.15,.19),patch(u,v,.65,.98,.20,.23),patch(u,v,.84,.89,.12,.13));
      return Math.max(edge*.74,pockets)*curve(noise(u,v),.18,.78);
    }),pigment:'#647f42',roughness:.93,sheen:.04,relief:.036},
    {id:'repairs',driver:source('repair'),mask:{space:'rest',min:[.73,1.08,.28],max:[1.40,1.49,.72],feather:.077},
      pigment:'#d0b186',roughness:.56,sheen:.38,relief:.038}
  ]};

  function shade(u,v){
    const p=noise(u,v), edge=Math.min(u,1-u,v,1-v), border=edge<.054;
    const rail=v>.68&&v<.752, recess=u>.71&&u<.91&&v>.08&&v<.31;
    const bronze=rail&&(v<.692||v>.741) || edge<.021;
    let base=border?[59,93,99]:[79,126,123];
    if(rail)base=bronze?[127,107,81]:[46,75,79];
    if(recess)base=(Math.floor(v*111)%7<3)?[44,66,70]:[66,92,93];
    if(u>.65&&v>.72&&v<.84)base=[69,103,102];
    const tile=(u>.053&&u<.946&&v>.05&&v<.933)&&((Math.floor(u*17)+Math.floor(v*11))%5===0);
    return base.map((c,k)=>Math.round(c+(p-.5)*(tile?14:7)+(k===1?4*v:0)));
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([...shade(x/(width-1),y/(height-1)),255],(y*width+x)*4);
  const line=(points,c,w)=>({type:'path',points,color:c,width:w});
  const label=(message,x,y,size,w,c)=>K.poly2.text(message,size,{width:w}).strokes
    .map(points=>line(points.map(([u,v])=>[x+u,y-v]),c,w));
  const marks=screenDrawing(width,height,[
    ...label('LOWBANK',70,48,16,2.25,'#d6ddaf'),
    ...label('FLOOD CONTROL',68,63,6.7,1.25,'#acc7b1'),
    ...label('26',154,96,8.4,1.35,'#d0ad80'),
    line([[23,71],[119,71],[127,64]],'#a8c6ab',1.1),
    line([[19,21],[30,21],[30,15]],'#cf9a71',1.4)
  ]);
  for(let i=0;i<pixels.length;i+=4){
    const w=marks.data[i+3]/255;
    if(w)for(let c=0;c<3;c++)pixels[i+c]=Math.round(pixels[i+c]*(1-w)+marks.data[i+c]*w);
  }

  const face=K.sceneMeshes.create({id:'lowbank-enamel',objectId:'gate',partId:'front',
    positions:[...gate,1.92,.61,.50,-1.92,2.99,.50,1.92,2.99,.50],uvs:[0,1,1,1,0,0,1,0],
    indices:[0,1,2,1,3,2],materials:[{id:'painted-steel',texture:{width,height,pixels},roughness:.71,
      mipmaps:{ambient:.65,light:[-.18,-.21,.96],specular:.10},simulationLayers:doc}]});
  const B=makeBuilder(seed,[0x182c3b,0x253f51,0x3e5a61,0x57716c,0x74867a,0xadb59b,0xd2b487,
    0x644a45,0x915d49,0xc38b66,0xf1cb94,0x294d56,0x3d676c,0x5f8985,0x8eb2a1]);
  const S=K.sculpt(makeSculpt(B)), stone={r:[1,2,3,4,5]}, brass={r:[7,8,9,10]}, dark={r:[0,1,2]};
  Object.assign(S,{sun:K.V.norm([-.55,.67,.57]),amb:.43,sky:.18,sunK:.57,wob:0});
  S.lathe([0,-.21,0],.26,[2.55,2.54,2.44,2.38],stone,{res:.076,objectId:'riverbase'});
  S.lathe([0,.037,0],.12,[1.76,1.77,1.75,1.70],{r:[11,12,13,14]},{res:.076,objectId:'riverbase'});
  S.box([0,1.80,-.095],[1.98,1.24,.51],stone,{rd:.11,res:.073,objectId:'gate-body'});
  for(const x of [-1.54,1.54]){
    S.box([x,.42,.02],[.23,.30,.60],stone,{rd:.08,res:.059,objectId:'foot'});
    S.box([x,3.00,-.11],[.20,.15,.32],brass,{rd:.053,res:.047,objectId:'mount'});
  }
  for(const x of [-1.77,1.77])for(const y of [.76,2.84])
    S.ball([x,y,.51],.045,brass,{res:.025,objectId:'fasteners'});
  S.box([-.19,1.58,.571],[.49,.050,.07],brass,{rd:.042,res:.036,objectId:'pull'});
  for(const x of [-.62,.24])S.box([x,1.57,.53],[.075,.09,.067],dark,{rd:.026,res:.036,objectId:'pull'});
  for(let y=1.04;y<2.72;y+=.21)S.box([1.985,y,-.08],[.027,.026,.31],dark,{rd:.015,res:.058,objectId:'side-vents'});
  S.bake();
  const world=B.finish({id:'simulation-material-layers',meshes:[face],radius:6,dither:0,fog:{c:0,start:1,max:0},
    cam:{target:[0,1.54,0],dist:7.1,ortho:true,pitch:.18,yaw:.16,fov:.63,sway:0},
    look:{splatCoverage:'continuous'},
    skyEnvironment:{defaults:{zenith:'#21354b',horizon:'#577a7c',ground:'#193041',sunStrength:0}}});
  const surfaceChannels=Object.fromEntries(['soot','moss','repair'].map(id=>[id,{type:'number',min:0,max:1,default:0}]));
  const spec={id:'lowbank-floodgate',dt:.22,systems:{rig:{kind:'mechanics',config:{surfaceChannels,bodies:{
    gate:{position:[0,1.8,0],half:[1.98,1.24,.58],material:'steel',mass:30,fixed:true,surfaceState:{faces:{}}}
  }}}}};
  const updates=[[3,'wetness',.48],[5,'wetness',.96],[9,'wear',.61],[11,'wear',.90],[12,'soot',.52],[14,'soot',.94],
    [17,'wetness',.61],[19,'moss',.52],[22,'moss',1],[26,'wetness',.35],[28,'repair',1],[31,'soot',.52]];
  const commands=updates.map(([tick,channel,value])=>({tick,id:channel+'-'+tick,action:'rig/surface-stamp',args:{
    body:'gate',face:'+z',stamp:{channel,value,brush}
  }}));
  const run=K.world.runtime.create(spec);
  run.schedule(commands);
  const use=source=>{
    const {tick,time}=source.view();
    world.lookSnapshot={time,tick,query:source.query()};
    return world;
  };
  return {world,run,use,doc,source:{...spec,commands}};
}

const factory=kit=>({
  id:'simulation-material-layers',seed:73,name:'Lowbank floodgate',
  build(){const demo=lowbank(kit);demo.run.advance(33);return demo.use(demo.run);}
});

function demo(directory,animation=false) {
  const kit=ink.load(), {run,use,doc,source}=lowbank(kit), out=path.resolve(directory), w=424,h=300;
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'lowbank-world.json'),JSON.stringify(source,null,2)+'\n');
  fs.writeFileSync(path.join(out,'lowbank-material-layers.json'),JSON.stringify(doc)+'\n');
  function capture(snapshot,frame){
    let material;
    const picture=ink.render(use(snapshot),{w,h,px:1,raw:true,...frame,simulationMaterialLayersFrame:rows=>{[material]=rows;}});
    return {picture,material};
  }
  function write(file,im){PNG.write(path.join(out,file),im.w,im.h,im.rgb);}
  const checkpoints={0:'01-dry',6:'02-wet',15:'03-abraded-and-sooted',23:'04-moss',33:'05-repaired'};
  const report=[];
  if(animation)fs.mkdirSync(path.join(out,'frames'),{recursive:true});
  const states=[];
  for(let tick=0;tick<=33;tick++){
    run.advance(tick);
    const name=checkpoints[tick];
    if(name){
      const {picture,material}=capture(run);
      write(name+'.png',picture);
      report.push({tick,name,...material});
    }
    if(animation){
      const {picture,material}=capture(run,{yaw:.16+.10*Math.sin(tick/33*Math.PI*1.1),pitch:.18+.023*Math.sin(tick/33*Math.PI)});
      write('frames/'+String(tick).padStart(3,'0')+'.png',picture);
      states.push({tick,...material});
    }
  }
  assert(report.at(-1).layers.every(row=>row.amount>0));
  const end=run.checkpoint();
  const replay=kit.KIT.world.runtime.create(end.world,{checkpoint:JSON.parse(JSON.stringify(end))});
  assert.deepEqual(capture(replay).picture.rgb,capture(run).picture.rgb);
  fs.writeFileSync(path.join(out,'material-states.json'),JSON.stringify({report,states,replayMatches:true},null,2)+'\n');
  fs.writeFileSync(path.join(out,'lowbank.checkpoint.json'),JSON.stringify(end)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)demo(process.argv[2]??'lowbank-material-review',process.argv.includes('--frames'));
module.exports=factory;
