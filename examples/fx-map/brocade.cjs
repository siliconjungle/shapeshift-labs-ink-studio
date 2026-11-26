const art=require('./brocade-art.cjs');
const node=(op,inputs)=>({op,inputs}), input=input=>({input}), ref=(node,port='value')=>({node,port});
const p=name=>['param',name], get=name=>['get',name], lane=(v,i)=>['component',v,i], i=n=>['i32',n];
const a=(x,y)=>['add',x,y], m=(x,y)=>['mul',x,y], s=(x,y)=>['sub',x,y], d=(x,y)=>['div',x,y];
const v2=(x,y)=>['vec2',x,y], v4=(...v)=>['vec4',...v];
const prog=(parameters,outputs,result,body=[])=>({format:'ink-studio/value-processor',version:1,precision:'f32',
  parameters:Object.fromEntries(Object.entries(parameters).map(([name,type])=>[name,{type}])),outputs,result,body});
const letv=(name,value)=>({let:name,value});
const disc=(radius,center)=>({type:'disc',radius,...(center&&{center})});
const ring=(outer,inner)=>({type:'symbol',parts:[{shape:disc(outer)},{op:'subtract',shape:disc(inner)}]});
const star=(radius,innerRadius,tips=4)=>({type:'star',radius,innerRadius,tips});
const petal=()=>({type:'polygon',points:[[.5,.03],[.68,.20],[.81,.38],[.74,.62],[.5,.96],[.23,.66],[.16,.42],[.28,.19]]});
const shape=source=>({shape:source});
const make=(id,pattern,settings)=>({id,pattern,...settings});
const quadrant=(stamps,children)=>({kind:'quadrant',stamps,...(children&&{children})});
const settings={
  petals:{label:'Petals per bloom',type:'integer',default:8,min:3,max:12,step:1},
  drift:{label:'Seeded variation',type:'number',default:.52,min:0,max:1,step:.01},
  painted:{label:'Petal source',type:'boolean',default:true,choices:[['Painted image',true],['Signed shape',false]]},
  seed:{label:'Pattern seed',type:'integer',default:413,min:0,max:999,step:1}
};

function design(filter='nearest'){
  const scope=p('state'), r=p('random');
  const motion=prog({iteration:'i32',iterations:'i32',state:'vec4',random:'vec4',drift:'f32'},
    {offset:'vec2',rotation:'f32',opacity:'f32',color:'vec4'},{
      offset:v2(m(['sin',get('radians')],get('radius')),m(['neg',['cos',get('radians')]],get('radius'))),
      rotation:get('degrees'),opacity:a(.86,m(lane(r,1),.14)),
      color:v4(1,a(.79,m(lane(scope,2),.21)),a(.73,m(lane(r,2),.27)),1)
    },[
      letv('degrees',a(lane(scope,0),m(360,d(['toF32',p('iteration')],['toF32',p('iterations')])))),
      letv('radians',m(get('degrees'),Math.PI/180)),
      letv('radius',a(.247,m(m(s(lane(r,0),.5),.041),p('drift'))))
    ]);
  const initial=prog({random:'vec4',quadrant:'i32',petals:'i32'},
    {state:'vec4',count:'i32'},{
      count:p('petals'),
      state:v4(a(m(lane(r,0),46),m(['toF32',p('quadrant')],13)),.1,lane(r,2),0)
    });
  const step=prog({state:'vec4',random:'vec4',drift:'f32',iteration:'i32'},{state:'vec4'},
    {state:v4(a(lane(scope,0),m(m(s(lane(r,1),.45),12),p('drift'))),lane(scope,1),lane(scope,2),['toF32',p('iteration')])});
  const pick=prog({painted:'bool'},{select:'bool'},{select:p('painted')});
  const detail=prog({position:'vec2',random:'vec4'},{rotation:'f32',opacity:'f32'},
    {rotation:a(m(lane(p('position'),1),27),m(lane(r,3),25)),opacity:a(.46,m(lane(r,0),.33))});
  const feather=prog({iteration:'i32',state:'vec4',random:'vec4',iterations:'i32',drift:'f32'},
    {offset:'vec2',rotation:'f32',opacity:'f32',color:'vec4'},{
      ...motion.result,color:v4(.55,a(.62,m(lane(r,2),.25)),.72,1)
    },motion.body);
  return {
    format:'ink-studio/fx-map',version:1,root:'cloth',mode:'color',
    images:{petal:'colorImage'},
    parameters:{petals:{type:'i32',default:8},drift:{type:'f32',default:.52},painted:{type:'bool',default:true}},
    patterns:{
      brocade:{image:'petal',filter,alpha:'source',wrapU:'clamp',wrapV:'clamp'},
      cut:shape(petal()),base:shape(disc(.467)),rim:shape(ring(.484,.459)),etch:shape(ring(.44,.425)),
      halo:shape(ring(.395,.388)),bezel:shape(disc(.159)),bezelRing:shape(ring(.153,.128)),
      filigree:shape(star(.465,.156)),flare:shape(star(.46,.26,8)),dot:shape(disc(.48)),
      seedLeaf:shape({type:'polygon',points:[[.50,.03],[.74,.36],[.69,.62],[.50,.98],[.26,.67],[.24,.37]]})
    },
    nodes:{
      cloth:quadrant([
        ...[[-.5,-.5],[.5,0],[0,.5],[0,0]].flatMap(([x,y],k)=>[
          make('seam'+k,'filigree',{offset:[x,y],size:[.137,.137],rotation:45,color:'#573e5a'}),
          make('foil'+k,'filigree',{offset:[x,y],size:[.091,.091],color:'#a77873'}),
          make('center'+k,'dot',{offset:[x,y],size:[.019,.019],color:'#e3b68c'})
        ])
      ],'bloom'),
      bloom:{kind:'iterate',base:'medallion',body:'choose',limit:12,program:initial,stepProgram:step},
      medallion:quadrant([
        make('shadow','base',{offset:[.02,.026],size:[1.015,1.015],color:'#12172b',opacity:.88}),
        make('bed','base',{color:'#30243b'}),
        make('outer-foil','rim',{color:'#af7b77'}),
        make('etched-seam','etch',{color:'#6d536b',opacity:.88}),
        make('inner-foil','halo',{color:'#9e6979',opacity:.75}),
        make('center-shadow','bezel',{size:[1.12,1.12],offset:[.01,.016],color:'#21192f'}),
        make('button','bezel',{color:'#5d4156'}),
        make('button-foil','bezelRing',{color:'#d69a84'}),
        make('sun','flare',{size:[.213,.213],color:'#ebb78c'}),
        make('spark','dot',{size:[.032,.032],color:'#f6dcb0'})
      ],'leaves'),
      leaves:quadrant([
        make('sprig','seedLeaf',{offset:[-.016,.018],size:[.105,.21],rotation:44,color:'#ae7a82',program:detail}),
        make('stitch','dot',{offset:[.09,.045],size:[.035,.035],color:'#eebd91',opacity:.73})
      ],[null,'floss','floss',null]),
      floss:quadrant([make('cross','filigree',{size:[.099,.099],color:'#b7868b',program:detail})]),
      choose:{kind:'switch',program:pick,whenFalse:'engrave',whenTrue:'painted'},
      painted:quadrant([make('petal','brocade',{size:[.204,.325],program:motion})]),
      engrave:quadrant([
        make('rim','cut',{size:[.217,.331],program:motion}),
        make('cobalt','cut',{size:[.155,.279],program:feather}),
        make('gilt','halo',{size:[.046,.232],program:motion})
      ])
    }
  };
}

function graph(filter='nearest'){
  const {width,height,petalWidth,petalHeight,petal,base}=art, rgba={intent:'color',colorSpace:'srgb',precision:'unorm8'};
  return {format:'ink-studio/graph-project',version:1,
    inputs:Object.fromEntries(Object.entries(settings).map(([name,{type,default:value}])=>[name,{type,default:value}])),
    nodes:{
      backdrop:node('draw.render',{width,height,commands:base,edges:'hard'}),
      background:node('image.declare',{source:ref('backdrop'),descriptor:rgba}),
      paint:node('draw.render',{width:petalWidth,height:petalHeight,commands:petal,edges:'hard'}),
      petal:node('image.declare',{source:ref('paint'),descriptor:rgba}),
      options:node('data.record',{seed:input('seed'),samples:1,wrap:[true,true]}),
      weave:node('image.fxMap',{map:design(filter),width,height,background:ref('background'),petal:ref('petal'),
        options:ref('options'),petals:input('petals'),drift:input('drift'),painted:input('painted')}),
      preview:node('image.toDisplay',{source:ref('weave')})
    },
    outputs:{preview:ref('preview'),petal:ref('paint'),coverage:ref('weave','coverage'),
      stampId:ref('weave','stampId'),layout:ref('weave','layout')},
    exports:{preview:{output:'preview',format:'png'},layout:{output:'layout',format:'json'}}};
}
module.exports={graph,design,settings};
