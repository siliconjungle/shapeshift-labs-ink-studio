const {width,height,commands}=require('./copperwake-art.cjs');
const input=input=>({input}), link=(node,port='value')=>({node,port}), op=(op,inputs)=>({op,inputs});
const rgb={intent:'color',layout:'rgba',precision:'unorm8',colorSpace:'srgb'};
const relief={intent:'height',layout:'r',precision:'float32',units:'art-px'};
const drift={intent:'data',layout:'r',precision:'unorm16',sampling:'linear',tiling:{u:'wrap',v:'wrap'}};
const oxide={intent:'mask',layout:'r',precision:'unorm8'};
const settings={
  reach:{label:'Search radius',type:'integer',shader:'i32',default:4,min:0,max:10,step:1},
  oxidation:{label:'Oxidation',type:'number',shader:'f32',default:.58,min:0,max:1,step:.01},
  rake:{label:'Raking light',type:'number',shader:'f32',default:.74,min:.1,max:1,step:.01}
};

const get=name=>['get',name], param=name=>['param',name], letv=(name,value)=>({let:name,value}), assign=(set,value)=>({set,value});
const a=(...args)=>['add',...args], s=(...args)=>['sub',...args], m=(...args)=>['mul',...args];
const clip=value=>['clamp',value,0,1], i=n=>['i32',n], vec=(...args)=>['vec'+args.length,...args];
const x=['x'], y=['y'], here=['load','relief',x,y];
const xy=(dx,dy)=>['load','relief',a(x,i(dx)),a(y,i(dy))];
const near=(dx,dy)=>['load','relief',dx,dy];
const tone=hex=>vec(...[16,8,0].map(n=>((hex>>n)&255)/255));

const program={
  format:'ink-studio/pixel-processor',version:1,precision:'f32',resources:{relief,drift},
  parameters:Object.fromEntries(Object.entries(settings).map(([id,{shader,default:value}])=>[id,{type:shader,default:value}])),
  outputs:{value:{descriptor:rgb},oxide:{descriptor:oxide}},
  body:[
    letv('height',here),letv('groove',0),
    {for:'tap',count:param('reach'),limit:10,body:[
      letv('span',a(get('tap'),i(1))),
      letv('west',near(s(x,get('span')),y)),letv('north',near(x,s(y,get('span')))),
      letv('east',near(a(x,get('span')),y)),letv('south',near(x,a(y,get('span')))),
      letv('peak',['max',['max',get('west'),get('east')],['max',get('north'),get('south')]]),
      letv('falloff',a(1,m(.31,['toF32',get('tap')]))),
      assign('groove',['max',get('groove'),['div',s(get('peak'),get('height')),get('falloff')]])
    ]},
    letv('drift',['sample','drift',vec(['u'],['v'])]),
    letv('grain',['div',['toF32',['mod',a(m(x,i(179)),m(y,i(151))),i(31)]],30]),
    letv('slope',a(m(.7,s(xy(1,0),xy(-1,0))),s(xy(0,1),xy(0,-1)))),
    letv('wash',clip(a(m(get('groove'),1.37),a(m(s(get('drift'),.43),.72),m(param('oxidation'),.6))))),
    letv('patina',clip(m(s(get('wash'),m(get('height'),.47)),2.02))),
    letv('light',clip(a(a(m(get('height'),.76),.20),a(m(get('slope'),param('rake')),m(s(get('grain'),.5),.074))))),
    letv('band',['div',['floor',m(get('light'),12)],12]),
    letv('copper',['mix',tone(0x361f32),tone(0xf5bb79),get('band')]),
    letv('green',['mix',tone(0x142d35),tone(0x92ceae),get('band')]),
    letv('finish',['mix',get('copper'),get('green'),get('patina')]),
    {if:['lt',get('height'),.105],then:[assign('finish',tone(0x142031)),assign('patina',0)]}
  ],
  result:{
    value:vec(...[0,1,2].map(lane=>['component',get('finish'),lane]),1),
    oxide:get('patina')
  }
};

function graph(){
  const inputs=Object.fromEntries(Object.entries(settings).map(([name,{type,default:value}])=>[name,{type,default:value}]));
  return {format:'ink-studio/graph-project',version:1,seed:431,inputs,
    nodes:{
      sculpt:op('draw.render',{width,height,commands,edges:'hard'}),
      plate:op('image.declare',{source:link('sculpt'),descriptor:{...rgb,colorSpace:'srgb-linear'}}),
      cast:op('image.toHeight',{source:link('plate'),scale:1,channel:'r',units:'art-px'}),
      relief:op('image.convert',{source:link('cast'),descriptor:{intent:'height',precision:'float32'}}),
      drift:op('image.noise',{family:'fractal',width:51,height:43,options:{extent:[13,12],octaves:4,seed:322,precision:'unorm16'}}),
      process:op('image.pixelProcessor',{width,height,program,relief:link('relief'),drift:link('drift'),
        ...Object.fromEntries(Object.keys(settings).map(key=>[key,input(key)]))}),
      preview:op('image.toDisplay',{source:link('process')})
    },
    outputs:{value:link('process'),oxide:link('process','oxide'),preview:link('preview'),
      relief:link('relief'),drift:link('drift')},
    exports:{preview:{output:'preview',format:'png'},oxide:{output:'oxide',format:'json'}}
  };
}
module.exports={width,height,settings,program,graph};
