const art=require('./dial-art.cjs');
const operation=(op,inputs,type)=>({op,inputs,...(type&&{type})});
const ref=(node,port='value')=>({node,port}), input=input=>({input});
const i=n=>['i32',n], get=name=>['get',name], param=name=>['param',name];
const a=(left,right)=>['add',left,right], s=(left,right)=>['sub',left,right];
const m=(left,right)=>['mul',left,right], div=(left,right)=>['div',left,right];
const float=n=>['toF32',n], integer=n=>['toI32',n];
const vec=(x,y)=>['vec2',x,y], lane=(v,index)=>['component',v,index];
const letv=(name,value)=>({let:name,value});
const radians=n=>m(n,Math.PI/180), cosine=n=>['cos',radians(n)];
const bearing=n=>vec(['sin',radians(n)],['neg',cosine(n)]);
const program=fields=>({format:'ink-studio/value-processor',version:1,precision:'f32',...fields});
const dimension={type:'i32',port:'pixelCount'};

const settings={
  requested:{label:'Requested width',type:'integer',valueType:'i32',default:146,min:72,max:216,step:1},
  heading:{label:'Heading',type:'number',valueType:'f32',default:-24,min:-180,max:180,step:1,unit:'°'},
  target:{label:'Target bearing',type:'number',valueType:'f32',default:42,min:-140,max:140,step:1,unit:'°'},
  tolerance:{label:'Tolerance',type:'number',valueType:'f32',default:24,min:4,max:48,step:1,unit:'°'}
};

const processor=program({
  parameters:Object.fromEntries(Object.entries(settings).map(([key,{valueType,default:value}])=>[key,{type:valueType,default:value}])),
  outputs:{width:dimension,height:dimension,score:{type:'f32',port:'unitScalar'},range:'vec2',
    direction:'vec2',inWindow:'bool',rotation:'f32'},
  body:[
    letv('steps',div(a(param('requested'),i(4)),i(9))),
    letv('heading',param('heading')),
    letv('sightline',cosine(s(get('heading'),param('target'))))
  ],
  result:{
    width:m(get('steps'),i(9)),height:m(get('steps'),i(8)),score:m(.5,a(1,get('sightline'))),
    range:vec(s(param('target'),param('tolerance')),a(param('target'),param('tolerance'))),
    direction:bearing(get('heading')),inWindow:['ge',get('sightline'),cosine(param('tolerance'))],rotation:get('heading')
  }
});

const markers=program({
  parameters:{width:{type:'i32'},height:{type:'i32'},range:{type:'vec2'},direction:{type:'vec2'}},
  outputs:{lowerX:'i32',lowerY:'i32',upperX:'i32',upperY:'i32',tipX:'i32',tipY:'i32',
    pivotX:'i32',pivotY:'i32',aspect:'f32',stampSize:'vec2'},
  body:[
    letv('w',float(param('width'))),letv('h',float(param('height'))),
    letv('cx',m(get('w'),.5)),letv('cy',m(get('h'),.5)),
    letv('radius',m(get('h'),.355)),
    letv('start',bearing(lane(param('range'),0))),letv('end',bearing(lane(param('range'),1)))
  ],
  result:{
    ...Object.fromEntries([['lower',get('start')],['upper',get('end')],['tip',param('direction')]].flatMap(([id,point])=>
      [0,1].map((axis)=>[id+(axis===0?'X':'Y'),integer(s(a(get(axis===0?'cx':'cy'),m(lane(point,axis),get('radius'))),2))]))),
    pivotX:s(div(param('width'),i(2)),i(2)),pivotY:s(div(param('height'),i(2)),i(2)),
    aspect:div(get('w'),get('h')),stampSize:vec(div(get('h'),get('w')),1)
  }
});

const polygon=(...points)=>({type:'polygon',points});
const silhouette=polygon([.50,.158],[.548,.307],[.519,.29],[.522,.585],[.50,.635],[.478,.585],[.481,.29],[.452,.307]);
const face=polygon([.50,.180],[.530,.287],[.509,.275],[.511,.56],[.50,.600],[.493,.55],[.491,.265],[.469,.284]);
const reflection=polygon([.50,.204],[.510,.267],[.50,.26],[.504,.491],[.50,.52],[.496,.46],[.495,.259],[.483,.273]);

function graph(){
  const dimensions={width:ref('solve','width'),height:ref('solve','height')};
  const nodes={
    solve:operation('fn.valueProcessor',{program:processor,
      ...Object.fromEntries(Object.keys(settings).map(key=>[key,input(key)]))}),
    markers:operation('fn.valueProcessor',{program:markers,...dimensions,range:ref('solve','range'),direction:ref('solve','direction')})
  };
  const add=(name,type,inputs,declared)=>{nodes[name]=operation(type,inputs,declared);return ref(name);};
  const draw=(name,commands,width=art.width,height=art.height)=>add(name,'draw.render',{commands,width,height,edges:'hard'});
  const record=(name,fields)=>add(name,'data.record',fields);
  const blend=(name,background,foreground,options={})=>add(name,'raster.blend',{background,foreground,options});
  const plate=add('scaledPlate','raster.resize',{source:draw('engraving',art.plate),
    options:record('resizeOptions',{...dimensions,filter:'nearest'})});
  const tint=add('alignedColor','fn.select',{condition:ref('solve','inWindow'),whenTrue:[.49,.87,.73,1],whenFalse:[.99,.69,.46,1]},'srgb');
  const glow=add('intensity','fn.color',{operation:'mix',a:[.59,.46,.47,1],b:tint,t:ref('solve','score')},'srgb');
  const turn={rotation:ref('solve','rotation'),size:ref('markers','stampSize'),aspect:ref('markers','aspect'),
    gutter:[0,0],wrap:[false,false],samples:1,seed:126};
  const stamp=(name,shape,color)=>add(name+'Pixels','image.toDisplay',{source:add(name,'image.tileGenerator',{
    ...dimensions,columns:1,rows:1,stamp:shape,options:record(name+'Options',{...turn,color})
  })});
  const dark=blend('outline',plate,stamp('needleOutline',silhouette,'#162137'));
  const fill=blend('paint',dark,stamp('needleFace',face,glow));
  const shine=blend('shine',fill,stamp('needleEdge',reflection,'#f4d39e'));
  const targetPin=draw('targetPin',art.windowPin,5,5);
  const at=(name,key)=>record(name,{x:ref('markers',key+'X'),y:ref('markers',key+'Y')});
  const lower=blend('lowerLimit',shine,targetPin,at('lowerPosition','lower'));
  const upper=blend('upperLimit',lower,targetPin,at('upperPosition','upper'));
  const dot=blend('bearingPoint',upper,draw('point',art.point,5,5),at('bearingPosition','tip'));
  const preview=blend('preview',dot,draw('cap',art.pivot,5,5),at('centerPosition','pivot'));
  const outputs={preview,...Object.fromEntries(Object.keys(processor.outputs).map(name=>[name,ref('solve',name)]))};
  return {format:'ink-studio/graph-project',version:1,
    inputs:Object.fromEntries(Object.entries(settings).map(([name,{type,default:value}])=>[name,{type,default:value}])),
    nodes,outputs,exports:{preview:{output:'preview',format:'png'}}};
}
module.exports={settings,processor,graph};
