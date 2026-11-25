/* Retained signal bypass and a service return with a saddle contact. */
const assert = require('node:assert/strict');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');
const { review } = require('../cli/cable-route.js');

function fixture(A) {
  const graph={nodes:{
    feed:{transform:{position:[-3,0,.64]},sockets:{signal:{position:[0,1.17,0]},return:{position:[0,-.03,.11]}}},
    drain:{transform:{position:[3,0,.64]},sockets:{signal:{position:[0,1.17,0]},return:{position:[0,-.03,.11]}}}
  }};
  const relay={id:'relay-box',min:[-.66,.46,.13],max:[.66,1.63,.85]};
  const support={id:'saddle',min:[-.42,-1,.38],max:[.42,-.89,1.1]};
  const socket=(node,pin,side)=>({node,socket:pin,axis:[side,0,0],lead:.29});
  const signal={format:A.format,version:1,id:'signal',from:socket('feed','signal',1),to:socket('drain','signal',-1),
    radius:.072,clearance:.084,bendRadius:.24,slack:.035,obstacles:[relay,support]};
  const lifted={...signal,waypoints:[
    {id:'left-lift',point:[-1.15,2.02,.64]},{id:'service-loop',point:[0,2.21,.64]},
    {id:'right-lift',point:[1.15,2.02,.64]}
  ]};
  const copper={...signal,id:'return',from:socket('feed','return',1),to:socket('drain','return',-1),
    slack:.07,radius:.064,waypoints:[{id:'rest',contact:{obstacle:'saddle',face:'y+',uv:[.5,.5],reach:2}}]};
  const views={format:'ink-studio/cable-gap-views',version:1,views:[
    {id:'front',w:240,h:146,camera:{target:[0,.66,0],dist:7.65,yaw:.01,pitch:.045,ortho:true}},
    {id:'quarter',w:240,h:146,camera:{target:[0,.64,0],dist:7.65,yaw:.48,pitch:.20,ortho:true}}
  ].map(view=>({...view,checks:[
    {id:'relay-air',between:['signal','relay-box'],rect:[99,21,42,82],minPixels:2},
    {id:'return-air',between:['signal','return'],rect:[94,15,52,115],minPixels:4}
  ]}))};
  return {graph,signal,lifted,copper,views};
}

function nativeWorld(kit, {signal,copper,graph}) {
  const {KIT:K,makeBuilder,makeSculpt}=kit;
  const palette=[0x11202c,0x182a38,0x253d4b,0x355361,0x567176,0x799496,0x2b5656,0x438e80,0x83b8a1,
    0x613d32,0x935941,0xce8e58,0xf3ba78,0xf7d49a,0xf6ecd0,0xba6c59];
  const B=makeBuilder(32,palette), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:K.V.norm([-.58,.82,1]),amb:.45,sky:.14,sunK:.47,wob:0});
  const box=(p,half,r,res,rd,objectId)=>S.box(p,half,{r},{res,rd,objectId});
  const rect=(spec,r,res,rd)=>box(spec.min.map((v,k)=>(v+spec.max[k])*.5),
    spec.min.map((v,k)=>(spec.max[k]-v)*.5),r,res,rd,spec.id);
  box([0,.64,-.14],[3.63,1.91,.14],[1,2,3,4],.078,.11,'backboard');
  for(const y of [-1.14,2.42])box([0,y,.05],[3.48,.023,.04],[2,3,4],.056,.015,'rails');
  for(const x of [-3.35,3.35])for(const y of [-1,2.31]){
    box([x,y,.07],[.07,.072,.036],[2,4,5],.038,.025,'rails');
    box([x,y,.103],[.040,.007,.009],[1,2,3],.026,.006,'rails');
  }
  const [relay,saddle]=signal.obstacles;
  rect(relay,[2,3,4,5],.045,.073);
  box([0,1.395,.856],[.49,.165,.035],[1,2,3],.04,.025,'relay-box');
  for(const x of [-.38,0,.38]){
    box([x,1.41,.89],[.072,.035,.026],[3,5,7,8],.031,.019,'relay-box');
    S.ball([x,1.42,.927],.034,{r:[13],em:true},{res:.022,objectId:'relay-box'});
  }
  for(let i=0;i<4;i++)box([0,.61+i*.095,.839],[.48,.022,.022],[2,3,4],.042,.015,'relay-box');
  rect(saddle,[9,10,11,12],.037,.018);
  box([0,-1.02,.66],[.48,.047,.24],[2,4,5],.044,.022,'saddle-base');
  for(const x of [-.345,.345])S.ball([x,-.891,.94],.037,{r:[6,7,8]},{res:.022,objectId:'saddle'});
  for(const [x,sign] of [[-3,-1],[3,1]])for(const [y,z] of [[1.17,.64],[-.03,.75]]){
    box([x+sign*.17,y,z-.16],[.217,.239,.16],[2,3,4,5],.053,.051,'connectors');
    box([x+sign*.035,y,z],[.071,.12,.12],[9,10,11,12],.031,.037,'connectors');
    box([x+sign*.012,y+.113,z+.056],[.043,.032,.045],[10,12,13],.027,.017,'connectors');
  }
  S.bake();
  const light={diffuse:.57,sheen:.42,roughness:.62,specular:.42,anisotropy:.35};
  K.curveSplats.draw(B,{kind:'socket-cable',document:signal,graph},{color:'#79d8be',edge:'hard',object:'signal',lighting:light,
    section:'elliptical',aspect:.77,caps:'blunt',along:{pigment:[[0,'#74cdb1'],[.24,'#92dbc0'],[.66,'#4ea699'],[1,'#7cd9bc']]}});
  const returnGuide={kind:'socket-cable',document:copper,graph};
  const braid=K.curveSplats.bundle({kind:'bundle',style:'twisted-cable',guide:returnGuide,count:3,separation:.025,
    radius:.039,turns:12,seed:13,samples:156});
  K.curveSplats.draw(B,braid,{edge:'hard',object:'return',lighting:light,caps:'blunt',
    color:({index})=>['#e8aa65','#9d603f','#efbd81'][index%3]});
  return B.finish({id:'cable-bench',radius:8,dither:0,cam:{target:[0,.64,0],dist:7.65,yaw:0,pitch:.045,ortho:true},
    liveSun:{direction:[-.58,.82,1],intensity:.75,shadows:false},look:{pixelSize:1}});
}

function sceneFile(target,data,name) {
  const content='module.exports = kit => ({ id:'+JSON.stringify(name)+', name:'+JSON.stringify(name)+', seed:32,\n'+
    '  build() { return ('+nativeWorld.toString()+')(kit, '+JSON.stringify(data)+'); }\n});\n';
  files.write(target,content);
}

function board(K, captures, dir) {
  const width=1020,height=790,scale=2,draw=[];
  const rect=(x,y,w,h,fill)=>draw.push({type:'rect',rect:[x,y,w,h],fill});
  const label=(text,x,y,scale,color='#e9f0e7')=>draw.push({type:'text',text,at:[x,y],scale,color});
  rect(0,0,width,height,'#0e1923');
  rect(22,20,21,3,'#7adfc3');
  label('INK STUDIO / SOCKET CABLES',55,16,2,'#8ce0c7');
  label('Relay bypass',20,44,4);
  label('TWO APPROVED VIEWS AT 240 X 146 ART PIXELS',22,80,1,'#a8c1cd');
  const panels=[];
  for(const [c,{result,name}] of captures.entries()){
    const x=22+497*c;
    label(c===0?'Automatic bypass':'Pinned overhead route',x,104,2,c===0?'#f3ba77':'#8ce0c7');
    for(const [i,view] of result.views.entries()){
      const y=148+316*i, check=view.checks[0], color=check.status==='ok'?'#8ce0c7':'#f3ba77';
      rect(x-1,y-1,482,294,'#354e60');
      label(i===0?'FRONT':'QUARTER',x,132+316*i,1,'#aac1cd');
      label('RELAY GAP '+(check.gap===null?'MISSING':check.gap.toFixed(1)+' PX'),x+283,132+316*i,1,color);
      panels.push({image:PNG.raster(path.join(dir,name,view.preview)),x,y,check,color});
    }
  }
  rect(22,766,977,1,'#354e60');
  label('AMBER RETURN BRAID RESTS ON THE SADDLE',22,775,1,'#d8b985');
  label('MARKERS SHOW THE NEAREST VISIBLE PIXELS',644,775,1,'#aac1cd');
  const image=K.procedural.drawing2d.render({width,height,commands:draw,edges:'hard'});
  for(const panel of panels){
    const {image:source,x,y,check,color}=panel, rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    for(let j=0;j<source.h*scale;j++)for(let i=0;i<source.w*scale;i++){
      const from=(Math.floor(j/scale)*source.w+Math.floor(i/scale))*4,to=((y+j)*width+x+i)*4;
      image.data.set(source.data.subarray(from,from+4),to);
    }
    for(const [px,py] of check.pixels??[]){
      for(const [a,b] of [[-2,0],[3,0],[0,-2],[0,3],[1,-2],[1,3],[-2,1],[3,1]]){
        const xx=x+px*scale+a,yy=y+py*scale+b;
        if(xx>=x&&xx<x+source.w*scale&&yy>=y&&yy<y+source.h*scale)image.data.set(rgb,(yy*width+xx)*4);
      }
    }
  }
  return PNG.encodeFrame(PNG.packRGBA(image));
}

function run(dir) {
  const kit=ink.load(), K=kit.KIT, api=K.procedural.cableRoutes;
  const {graph,signal,lifted,copper,views}=fixture(api), captures=[];
  files.json(path.join(dir,'graph.json'),graph);
  files.json(path.join(dir,'views.json'),views);
  for(const [name,source] of [['automatic',signal],['pinned',lifted],['return',copper]]){
    const result=api.plan(source,{graph});
    assert.equal(result.report.status,'ok');
    files.json(path.join(dir,name+'.json'),result.source);
    files.json(path.join(dir,name+'-route.json'),{...result.report,points:result.route.points});
    if(name==='return')continue;
    const data={signal:source,copper,graph}, output=path.join(dir,name);
    sceneFile(path.join(dir,name+'-scene.js'),data,name+'-cable-bench');
    const measured=review(views,{api,kit,build:()=>nativeWorld(kit,data)},output);
    captures.push({name,result:measured});
    files.json(path.join(output,'report.json'),measured);
  }
  assert(captures[0].result.views.some(view=>view.checks[0].status==='tight'));
  assert(captures[1].result.views.every(view=>view.checks[0].status==='ok'));
  files.write(path.join(dir,'comparison.png'),board(K,captures,dir));
  console.log(dir);
}

module.exports={fixture,nativeWorld};
if(require.main===module)run(path.resolve(process.argv[2]??'studio/out/socket-cables'));
