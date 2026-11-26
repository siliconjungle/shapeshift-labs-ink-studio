const input=input=>({input});
const ref=(node,port='value')=>({node,port});
const op=(op,inputs,type)=>({op,inputs,...(type&&{type})});
const vector=(type,operation,inputs)=>op('fn.vector',{operation,...inputs},type);
const cast=(from,to,a,rounding)=>op('fn.cast',{from,a,...(rounding&&{rounding})},to);

const controls={
  x:{ label:'X',default:.58,min:-1,max:1,step:.01 },
  y:{ label:'Y',default:-.24,min:-1,max:1,step:.01 },
  z:{ label:'Z',default:-.35,min:-1,max:1,step:.01 },
  w:{ label:'W',default:.82,min:-1,max:1,step:.01 },
  scale:{ label:'Gain',default:.8,min:0,max:1,step:.01 },
  cells:{ label:'Cell count',default:3.46,min:2,max:7,step:.01 },
  rounding:{ label:'Rounding',default:'round',options:[
    {label:'Round',value:'round'},{label:'Floor',value:'floor'},{label:'Ceil',value:'ceil'},{label:'Truncate',value:'trunc'}
  ]},
  rim:{ label:'Rim signal',default:1,min:-1,max:1,step:.1 }
};
const patterns=['xy','yx','xz','zx','zw','wz','xx','yy'];
const rect=(size,radius)=>({type:'rectangle',size,radius});
const disc=(center,radius)=>({type:'disc',center,radius});
const stem={type:'stroke',points:[[.48,.26],[.48,.72]],width:.081};
const star={type:'star',tips:4,center:[.48,.31],radius:.22,innerRadius:.09};
const needle={type:'symbol',parts:[{shape:stem},{shape:star},{shape:disc([.48,.69],.11)},
  {op:'subtract',shape:disc([.48,.31],.045)}]};
const curve=(points,width)=>({type:'stroke',points,width});
const frame={type:'symbol',parts:[
  {shape:curve([[.53,.06],[.77,.14],[.91,.32],[.93,.54],[.85,.74],[.68,.89],[.48,.94],[.29,.86]],.035)},
  {shape:curve([[.38,.12],[.23,.22],[.15,.39],[.14,.55]],.027)},
  {shape:disc([.18,.69],.038)},{shape:disc([.56,.08],.036)},{shape:disc([.78,.18],.026)}
]};

function graph(pattern='xy'){
  if(!patterns.includes(pattern))throw new RangeError('Unknown Signal Press swizzle');
  const inputs=Object.fromEntries(Object.entries(controls).map(([name,{default:value,options}])=>
    [name,{type:options?'string':'number',default:value}]));
  const nodes={
    inputXY:vector('vec2','compose',{x:input('x'),y:input('y')}),
    inputZW:vector('vec2','compose',{x:input('z'),y:input('w')}),
    packed:vector('vec4','append',{a:ref('inputXY'),b:ref('inputZW'),operands:['vec2','vec2']}),
    route:vector('vec4','swizzle',{a:ref('packed'),pattern}),
    scaled:vector('vec2','multiply',{a:ref('route'),b:input('scale'),operands:['vec2','number']}),
    widthHeight:vector('vec2','multiply',{a:ref('scaled'),b:.27,operands:['vec2','number']}),
    stampSize:vector('vec2','add',{a:ref('widthHeight'),b:.91,operands:['vec2','number']}),
    rotation:vector('vec2','dot',{a:ref('scaled'),b:[72,-51]}),
    firstLane:vector('vec2','component',{a:ref('route'),index:0}),
    carriers:cast('number','integer',input('cells'),input('rounding')),
    rimGate:cast('number','boolean',input('rim')),
    rimOpacity:cast('boolean','number',ref('rimGate'))
  };
  const add=(id,name,sockets)=>{nodes[id]=op(name,sockets);return ref(id);};
  const width=168,height=168, cells=ref('carriers');
  const tileSpace={width,height,columns:cells,rows:cells};
  const body=add('enamel','image.tileGenerator',{...tileSpace,stamp:rect([1,1],.145),
    options:{palette:['#23464c','#28555d','#20434d','#355b68','#254d5c'],background:'#232333',
      gutter:[.103,.103],jitter:{color:.14},samples:2,seed:618}});
  const coverage=ref(body.node,'coverage');
  const sub=add('needleOptions','data.record',{
    color:'#ffce91',rotation:ref('rotation'),size:ref('stampSize'),samples:2,seed:621,gutter:[.13,.13]});
  const glyph=add('needles','image.tileGenerator',{...tileSpace,stamp:needle,options:sub});
  const rim=add('ringInlay','image.tileGenerator',{...tileSpace,stamp:frame,
    options:{color:'#9dd1c0',size:[.93,.93],gutter:[.13,.13],samples:2,seed:610}});
  const etched=add('etching','image.blend',{background:body,foreground:rim,mask:coverage,opacity:ref('rimOpacity'),mode:'copy'});
  const pigment=add('signalColor','image.blend',{background:etched,foreground:glyph,mask:coverage,mode:'copy',opacity:.97});
  const heightMap=add('raisedPlate','image.bevel',{source:coverage,options:{width:4,height:2.4,profile:'round',border:'wrap'}});
  const light=add('grazingLight','image.emboss',{source:heightMap,
    options:{azimuth:-131,elevation:38,strength:.72,bias:.72,border:'wrap'}});
  const lit=add('lightRamp','image.gradientMap',{source:light,
    ramp:{interpolation:'smooth',stops:[[0,'#403451'],[.5,'#a398aa'],[.72,'#f3eadb'],[1,'#fff2d7']]},
    options:{precision:'unorm8'}});
  const shaded=add('litSurface','image.blend',{background:pigment,foreground:lit,mode:'multiply',opacity:.97});
  const grain=add('enamelGrain','image.noise',{width,height,family:'fractal',options:{extent:[18,18],octaves:3,seed:813}});
  const stain=add('stain','image.gradientMap',{source:grain,
    ramp:{interpolation:'smooth',stops:[[0,'#686f8a'],[.5,'#f1d8b0'],[1,'#ffe7c9']]},options:{precision:'unorm8'}});
  const surface=add('finish','image.blend',{background:shaded,foreground:stain,mask:coverage,mode:'multiply',opacity:.39});
  const preview=add('display','image.toDisplay',{source:surface});
  const diagnostics=['packed','route','scaled','stampSize','rotation','firstLane','carriers','rimGate','rimOpacity'];
  return {format:'ink-studio/graph-project',version:1,inputs,nodes,
    outputs:{preview,...Object.fromEntries(diagnostics.map(name=>[name,ref(name)]))},
    exports:{preview:{output:'preview',format:'png'}}};
}
module.exports={graph,controls,patterns};
