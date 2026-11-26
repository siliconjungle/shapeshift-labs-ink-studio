'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const files=require('../cli/asset-files.js');

const output=path.resolve(process.argv[2]??'paint-effects-demo');
const cli=path.resolve(__dirname,'../cli/ink-studio.js'), w=264,h=183,fps=8;
const style={sun:[-.45,.64,.64],amb:.37,sky:.24,palette:[
  0x101a26,0x1b2b3c,0x2c4858,0x527385,0x71939b,0xadc6bb,
  0x704135,0xba7250,0xe5a063,0xffd389,
  0x663952,0xb56473,0xf19994,0xffc6ad,
  0x215f66,0x3e968e,0x73d1ad,0xbef5cc
],roles:{frame:[1,2,3,4,5],stone:[0,1,2,3,4],copper:[6,7,8,9],rose:[10,11,12,13],mint:[14,15,16,17]}};
const box=(id,at,half,round,mat='frame')=>({id,kind:'box',at,half,round,mat,res:.040});
const mark=(id,mat,points,extra)=>({id,mat,brush:{kind:'sphere',radius:.07},step:.031,res:.032,
  poses:points.map(([x,y])=>({point:[x,y,.24]})),
  attachment:{kind:'surface',slot:'face',snap:{mode:'surface',direction:[0,0,1],maxDistance:.25}},...extra});
const water=(id,field,bounds)=>{
  const size=18,map=KIT.flowMap.create({width:size,height:size,bounds}).asset();
  const [x0,y0,x1,y1]=bounds;
  return [id,{...map,vectors:Array.from({length:size*size},(_,i)=>
    field(x0+(i%size+.5)*(x1-x0)/size,y0+(Math.floor(i/size)+.5)*(y1-y0)/size)).flat()}];
};
const clip=(id,kind,marks,range,effect,extra)=>({id,kind,painting:'ink',marks,range,effect,...extra});
const paint=(x,y,radius)=>({points:[[x,y,.19]],radius,feather:.45});

const tide={
  id:'tide-loom',title:'TIDE LOOM',camera:{target:[0,.12,.12],dist:4.25,yaw:-.08,pitch:.1,fov:.65,sway:0,projection:'orthographic'},
  markers:[{id:'lift',time:.125},{id:'burst',time:.375},{id:'done',time:1}],
  solids:[
    box('rim',[0,-.04,-.14],[1.41,.755,.20],.15),
    box('plate',[0,-.015,.018],[1.29,.643,.121],.10,'stone'),
    box('plinth',[0,-.78,-.12],[1.46,.105,.30],.065)
  ],
  marks:[
    mark('thread','mint',[[-.86,-.49],[-.82,-.28],[-.96,-.09],[-.78,.11],[-.92,.34],[-.78,.48]],{relief:{mode:'flat'}}),
    mark('ridge','copper',[[-.24,-.45],[.10,-.23],[-.26,.02],[.12,.26],[-.20,.45]],
      {relief:{mode:'volume',height:.12,castShadow:true}}),
    mark('signal','mint',[[.56,-.46],[.74,-.20],[.54,.03],[.91,.24],[.74,.47]],
      {finish:{tint:{color:'#66b9b4'},emission:{color:'#329d92',strength:1.9}}})
  ],
  flow:water('current',(x,y)=>[.29,.08+.07*Math.sin(x*7+y)],[-1.23,-.58,1.23,.58]),
  clips:[
    clip('drift','flow',['thread'],['lift','done'],{field:'current',spacing:.062},{fade:[.16,.15]}),
    clip('grain','boil',['thread'],['lift','done'],{amplitude:.067,scale:.26,seed:12,cadence:{fps:8,holds:[2,1]}},
      {mask:paint(-.80,.19,.55),weight:.8}),
    clip('sway','wave',['thread'],['lift','done'],{root:{at:[-.86,-.49,.24],axis:[0,1,0],length:1.02,lock:.19},
      amplitude:.26,frequency:1.38,base:{direction:[1,0,0]}},{fade:[.12,.16],weight:.9}),
    clip('height','throb',['ridge'],[0,'done'],{drivers:{cue:{type:'cue',duration:1,cues:{press:.375},keys:[
      {at:0,value:0},{cue:'press',value:1},{at:.82,value:0}]}},channels:{height:{driver:'cue',range:[.52,2.4]}}},
      {mask:paint(-.20,.17,.58)}),
    clip('takeoff','evaporate',['signal'],['burst','done'],{region:{points:[[.69,.30,.14]],radius:.40},start:0,end:.22,
      life:.61,spacing:.044,size:.024,velocity:[.36,.90,.23],spread:.43,seed:17},{after:'hold'})
  ],
  erase:['drift',{id:'pin',...paint(-.86,-.48,.27)}],
  inspect:[-.86,-.48,.19]
};
const arch=(radius,from,to)=>Array.from({length:11},(_,i)=>{
  const t=from+(to-from)*i/10;
  return [radius*Math.cos(t),radius*Math.sin(t)];
});
const cinder={
  id:'cinder-seal',title:'CINDER SEAL',camera:{target:[.03,.06,.10],dist:3.70,yaw:-.06,pitch:.12,fov:.62,sway:0,projection:'orthographic'},
  markers:[{id:'turn',time:.125},{id:'clear',time:.375},{id:'done',time:1}],
  solids:[
    box('foot',[0,-.68,-.07],[1.09,.105,.36],.076),
    box('rim',[0,-.04,-.13],[1.03,.64,.19],.20,'copper'),
    box('plate',[0,0,.01],[.94,.56,.145],.16,'stone')
  ],
  marks:[
    mark('lower','rose',arch(.39,Math.PI*.94,Math.PI*1.86),{relief:{mode:'flat'}}),
    mark('upper','copper',arch(.45,Math.PI*.13,Math.PI*.88),{relief:{mode:'flat'}}),
    mark('core','mint',[[-.29,-.06],[-.11,-.02],[.04,.06],[.22,.02],[.29,-.06]],
      {finish:{tint:{color:'#79beb3'},emission:{color:'#2cb59d',strength:1.8}}})
  ],
  flow:water('swirl',(x,y)=>[-.8*y,.48*x],[-.83,-.54,.83,.54]),
  clips:[
    clip('ring','flow',['upper','lower'],['turn','done'],{field:'swirl',spacing:.050},{fade:[.13,0],after:'hold'}),
    clip('grain','boil',['upper'],['turn','done'],{amplitude:.035,seed:31,cadence:{fps:8,holds:[1,2]}},
      {fade:[.10,.14]}),
    clip('signal','throb',['core'],[0,'done'],{drivers:{beat:{type:'oscillator',frequency:2}},
      channels:{emission:{driver:'beat',range:[.42,1.35]}}}),
    clip('clear','evaporate',['core'],['clear','done'],{region:{points:[[-.43,.01,.15],[.43,.01,.15]],radius:.22},
      start:0,end:.21,life:.62,spacing:.038,size:.021,velocity:[-.20,.95,.20],spread:.53,seed:41},
      {fade:[.15,0],after:'hold'})
  ],
  erase:['clear',{id:'keep-center',...paint(0,.03,.16)}],
  inspect:[0,.03,.19]
};

function study(data) {
  const dir=path.join(output,data.id), at=name=>path.join(dir,name);
  const put=(name,value)=>files.json(at(name+'.json'),value);
  function run(...args) {
    const result=execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'}).trim();
    return JSON.parse(result);
  }
  put('source',{id:data.id,seed:40,style,camera:data.camera,finish:{detail:15,dither:0},
    solids:data.solids,timeline:{duration:1,markers:data.markers},paintings3d:[
      {id:'ink',bindings:{face:'plate'},painting:{format:KIT.authoring.paintings3d.format,version:1,id:'marks',
        flowMaps:Object.fromEntries([data.flow]),marks:data.marks}}
    ]});
  put('track',{format:KIT.procedural.paintEffects.format,version:1,id:data.id,clips:data.clips});
  run('paint-effects','apply','source.json','track.json','--out','unmasked.json');
  put('eraser',data.erase[1]);
  run('paint-effects','erase','unmasked.json',data.erase[0],'eraser.json','--out','scene.json');
  const detail=run('paint-effects','inspect','scene.json','--at','.625','--point',data.inspect.join(','));
  assert.equal(detail.clips.find(row=>row.id===data.erase[0]).influence,0);
  put('mask-report',detail);
  const baked=run('paint-effects','bake','scene.json','--out','flipbook','--fps',String(fps),'--frames','8',
    '--w',String(w),'--h',String(h),'--raw','--ortho','--flipbook');
  return [0,3,5,7].map(index=>PNG.raster(at('flipbook/'+baked.frames[index].file)));
}

const rows=[study(tide),study(cinder)], gap=10,W=4*w+5*gap,H=2*h+137;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#101a26'}];
const text=(text,x,y,scale=1,color='#f1e4cd')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('PAINT EFFECTS TRACK',gap,12,3);
for(const [i,label] of ['SOURCE','CUE','OVERLAP','TAIL'].entries()) text(label,gap+i*(w+gap),51,2);
text(tide.title,gap,73,1,'#8dd9c9');
text(cinder.title,gap,h+99,1,'#ffb689');
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for(const [row,images] of rows.entries()) for(const [col,image] of images.entries()) for(let y=0;y<h;y++)
  sheet.data.set(image.data.subarray(y*w*4,(y+1)*w*4),((y+86+row*(h+26))*W+gap+col*(w+gap))*4);
files.write(path.join(output,'painted-studies.png'),PNG.encode(W,H,sheet.data,4));
console.log(path.join(output,'painted-studies.png'));
