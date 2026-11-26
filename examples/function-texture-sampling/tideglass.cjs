const input=input=>({input});
const ref=(node,port='value')=>({node,port});
const op=(op,inputs,type)=>({op,inputs,...(type && {type})});
const paintSize={width:58,height:54};
const stencilSize={width:45,height:57};
const stroke=(points,width)=>({type:'stroke',points,width});
const disc=(center,radius)=>({type:'disc',center,radius});
const island={type:'polygon',points:[
  [.19,.58],[.23,.48],[.29,.45],[.29,.36],[.37,.29],[.49,.22],[.57,.25],[.66,.21],
  [.77,.28],[.78,.36],[.74,.41],[.81,.47],[.75,.55],[.66,.57],[.62,.68],[.49,.76],
  [.43,.71],[.36,.76],[.26,.69],[.25,.63]
]};
const land={type:'symbol',parts:[
  {shape:island},
  {shape:{type:'polygon',points:[[.12,.22],[.24,.13],[.31,.14],[.34,.21],[.22,.28],[.15,.26]]}},
  {shape:{type:'polygon',points:[[.70,.74],[.78,.65],[.87,.68],[.89,.76],[.83,.81],[.75,.83]]}},
  {shape:disc([.64,.86],.038)},{shape:disc([.86,.19],.047)},{shape:disc([.15,.78],.035)}
]};
const currents={type:'symbol',parts:[
  stroke([[.02,.40],[.15,.36],[.23,.36],[.29,.27],[.38,.21],[.53,.14],[.68,.14],[.8,.2]],.018),
  stroke([[.04,.47],[.12,.42],[.2,.44],[.24,.4]],.013),
  stroke([[.09,.62],[.15,.57],[.18,.65],[.22,.74],[.36,.82],[.48,.81],[.6,.77]],.017),
  stroke([[.81,.41],[.91,.47],[.9,.56],[.84,.62],[.8,.63]],.019),
  stroke([[.11,.87],[.23,.91],[.35,.91],[.5,.84]],.014),
  stroke([[.39,.91],[.55,.96],[.72,.92],[.85,.89],[.97,.81]],.013),
  disc([.92,.14],.024),disc([.09,.53],.018),disc([.66,.09],.021),disc([.15,.74],.02)
].map(shape=>({shape}))};

const stencil={type:'symbol',parts:[
  stroke([[.13,.74],[.36,.24],[.49,.18],[.69,.29],[.86,.75]],.027),
  stroke([[.18,.68],[.43,.40],[.58,.42],[.75,.63]],.022),
  stroke([[.25,.76],[.35,.61],[.47,.59],[.59,.66],[.75,.81]],.019),
  stroke([[.28,.30],[.19,.35],[.22,.45]],.019),
  stroke([[.69,.21],[.81,.25],[.84,.37]],.018),
  stroke([[.29,.50],[.44,.21]],.021),stroke([[.37,.52],[.55,.24]],.02),
  stroke([[.46,.55],[.64,.31]],.022),stroke([[.55,.59],[.71,.39]],.02),
  {type:'star',tips:4,center:[.49,.29],radius:.1,innerRadius:.032},
  {type:'star',tips:4,center:[.2,.21],radius:.055,innerRadius:.016},
  disc([.67,.57],.037),disc([.35,.77],.023),disc([.82,.53],.031),disc([.52,.83],.021)
].map(shape=>({shape}))};

const settings={
  filter:{label:'Texel filter',default:'linear',choices:['image','nearest','linear']},
  wrapU:{label:'Wrap U',default:'wrap',choices:['image','wrap','mirror','clamp','transparent']},
  wrapV:{label:'Wrap V',default:'mirror',choices:['image','wrap','mirror','clamp','transparent']},
  mipFilter:{label:'Mip filter',default:'linear',choices:['nearest','linear']},
  mip:{label:'Mip level',default:0,min:0,max:6,step:.05},
  offsetU:{label:'Stencil U offset',default:.08,min:-.5,max:.5,step:.01},
  offsetV:{label:'Stencil V offset',default:-.04,min:-.5,max:.5,step:.01}
};
const samplerKeys=['filter','wrapU','wrapV','mip','mipFilter'];
const view={width:66,height:60,span:1.27};
const {uvGrid}=require('./tideglass-preview.js');

function project(){
  const inputs={...Object.fromEntries(Object.entries(settings).map(([name,{default:value,choices}])=>
    [name,{type:choices?'string':'number',default:value}])),
    probe:{type:'vec2',default:uvGrid(view)[30*view.width+35]}};
  const nodes={};
  const add=(id,name,bindings,type)=>{nodes[id]=op(name,bindings,type);return ref(id);};
  const bake=(name,source,size)=>add(name,'image.shape',{...size,source,options:{samples:2}});
  const noise=(name,family,options)=>add(name,'image.noise',{...paintSize,family,options:{tiling:'wrap',...options}});
  const shade=(name,source,colors,range=[0,1])=>add(name,'image.gradientMap',{source,
    ramp:{interpolation:'smooth',stops:colors.map((value,i)=>[i/(colors.length-1),value])},options:{range,precision:'unorm8'}});
  const tone=(name,value)=>add(name,'image.uniform',{...paintSize,value,descriptor:{intent:'color',layout:'rgb',
    precision:'unorm8',sampling:'linear',tiling:{u:'wrap',v:'wrap'}}});
  const rgbaTone=(name,value)=>add(name,'image.uniform',{...paintSize,value,descriptor:{intent:'color',layout:'rgba',
    precision:'unorm8',sampling:'linear',tiling:{u:'wrap',v:'wrap'}}});
  const blend=(name,background,foreground,mask,opacity=1,mode='copy')=>add(name,'image.blend',
    {background,foreground,mask,opacity,mode});
  const sea=shade('deepWater',noise('tide','directional',{angle:21,extent:[8,19],wander:.34,seed:441}),
    ['#162140','#214461','#42788a','#6da89f']);
  const tideFoam=bake('tideLines',currents,paintSize);
  const foam=blend('inlaidCurrents',sea,tone('seafoam',[.52,.79,.75]),ref(tideFoam.node,'mask'),.57);
  const h=bake('archipelago',land,paintSize);
  const relief=add('shorelineRelief','image.bevel',{source:ref(h.node,'mask'),options:{width:6,height:1,profile:'round'}});
  const coast=shade('islandBands',relief,['#65505a','#da946b','#f1bc81','#e6b779','#8f705f']);
  const enamel=blend('landOnSea',foam,coast,ref(h.node,'mask'));
  const grain=shade('saltGrain',noise('glazeGrain','fractal',{extent:[24,24],octaves:3,seed:448}),
    ['#a7a5bb','#f0dec3','#fff4d5']);
  const glaze=blend('paintedChart',enamel,grain,null,.51,'multiply');
  const raw=blend('chartPixels',rgbaTone('clearChart',[0,0,0,0]),glaze,null);
  const dye=add('colorTexture','image.convert',{source:raw,descriptor:{intent:'color',layout:'rgba',precision:'unorm8'}});
  const resist=ref(bake('stencilTexture',stencil,stencilSize).node,'mask');
  const offset=add('stencilOffset','fn.vector',{x:input('offsetU'),y:input('offsetV')},'vec2');
  const shared={pigment:dye,stencil:resist,offset,...Object.fromEntries(samplerKeys.map(key=>[key,input(key)]))};

  const readers=Object.fromEntries(samplerKeys.map(key=>[key,input(key)]));
  const group={
    result:'srgb-linear',
    inputs:{item:'vec2',pigment:'colorImage',stencil:'grayImage',offset:'vec2',
      ...Object.fromEntries(samplerKeys.map(key=>[key,key==='mip'?'number':'string']))},
    nodes:{
      shifted:op('fn.vector',{operation:'add',a:input('item'),b:input('offset')},'vec2'),
      pigmentRead:op('fn.sampleColor',{source:input('pigment'),uv:input('item'),...readers}),
      stencilRead:op('fn.sampleGray',{source:input('stencil'),uv:ref('shifted'),...readers}),
      gilding:op('fn.math',{operation:'multiply',a:ref('stencilRead'),b:.76},'number'),
      ink:op('fn.color',{operation:'mix',a:ref('pigmentRead'),b:[.93,.47,.17,1],t:ref('gilding')},'srgb-linear'),
      ...Object.fromEntries(['r','g','b','alpha'].map((name,i)=>[name,op('fn.color',{operation:'component',
        a:ref(i===3?'pigmentRead':'ink'),index:i},'srgb-linear')])),
      chart:op('fn.color',{operation:'compose',r:ref('r'),g:ref('g'),b:ref('b'),alpha:ref('alpha')},'srgb-linear')
    },outputs:{result:ref('chart')}
  };
  nodes.map={op:'array.map',group:'glaze',inputs:{...shared,items:uvGrid(view)}};
  nodes.probe=op('glaze',{...shared,item:input('probe')});
  return {format:'ink-studio/graph-project',version:1,inputs,groups:{glaze:group},nodes,
    outputs:{colorSource:dye,graySource:resist,chart:ref('map'),probe:ref('probe','result')},
    exports:{chart:{output:'chart',format:'json'},probe:{output:'probe',format:'json'}}};
}
module.exports={project,settings,view};
