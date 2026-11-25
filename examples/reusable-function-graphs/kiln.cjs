const input = input => ({input});
const ref = (node,port='value') => ({node,port});
const op = (op,inputs,type) => ({op,inputs,...(type && {type})});
const math = (operation,inputs) => op('fn.math',{operation,...inputs},'number');
const compare = (type,operation,a,b) => op('fn.compare',{operation,a,b},type);
const choose = (type,condition,whenTrue,whenFalse) => op('fn.select',{condition,whenTrue,whenFalse},type);
const color = hex => hex.slice(1).match(/../g).map(pair=>parseInt(pair,16)/255);
const knobs = {
  heat:{type:'number',label:'Heat',min:0,max:1,step:.01},
  oxygen:{type:'number',label:'Oxygen',min:0,max:1,step:.01},
  passes:{type:'integer',label:'Firing passes',min:1,max:6,step:1},
  finish:{type:'string',label:'Finish',options:[{label:'Gloss',value:'gloss'},{label:'Satin',value:'satin'}]},
  reducing:{type:'boolean',label:'Reduction'}
};
const presets = {
  jade:{ label:'Jade Compass',group:'Jade',heat:.81,oxygen:.28,passes:4,finish:'gloss',reducing:true,
    raw:'#324356',fired:'#5697ac',reduced:'#6bc8a4',slip:'#eacf99',accent:'#c18c5e' },
  copper:{ label:'Copper Sun',group:'Copper',heat:.68,oxygen:.71,passes:3,finish:'gloss',reducing:false,
    raw:'#53334b',fired:'#e0a361',reduced:'#b96371',slip:'#ffdfac',accent:'#864f56' }
};
const shared = { type:'number',label:'Firing knee',min:.08,max:.64,step:.01,default:.24 };

const thermal = {
  result:'number',
  inputs:{energy:'number',knee:{type:'number',default:shared.default}},
  nodes:{rise:math('smoothstep',{a:input('energy'),min:input('knee'),max:.91})},
  outputs:{result:ref('rise')}
};
const firing = {
  result:'srgb', groups:{thermal},
  inputs:{...Object.fromEntries(Object.entries(knobs).map(([id,{type}])=>[id,type])),
    knee:{type:'number',default:shared.default},raw:'srgb',fired:'srgb',reduced:'srgb'},
  nodes:{
    conditions:op('fn.vector',{x:input('heat'),y:input('oxygen')},'vec2'),
    heatWeights:op('data.typed',{value:[.73,.27]},'vec2'),
    energy:op('fn.vector',{operation:'dot',a:ref('conditions'),b:ref('heatWeights')},'vec2'),
    firedAmount:op('thermal',{energy:ref('energy'),knee:input('knee')}),
    satin:compare('string','eq',input('finish'),'satin'),
    sheen:choose('number',ref('satin'),.72,1),
    mixWeight:math('multiply',{a:ref('firedAmount','result'),b:ref('sheen')}),
    oxygenLow:compare('number','lt',input('oxygen'),.46),
    longEnough:compare('integer','gte',input('passes'),2),
    canReduce:op('fn.logic',{a:ref('oxygenLow'),b:ref('longEnough')}),
    reduction:op('fn.logic',{a:input('reducing'),b:ref('canReduce')}),
    target:choose('srgb',ref('reduction'),input('reduced'),input('fired')),
    glaze:op('fn.color',{operation:'mix',a:input('raw'),b:ref('target'),t:ref('mixWeight')},'srgb')
  },
  outputs:{result:ref('glaze')}
};

const rectangle = (size,radius=0) => ({type:'rectangle',size,radius});
const disk = radius => ({type:'disc',radius});
const ring = (radius,inner) => ({
  type:'symbol',parts:[{shape:disk(radius)},{op:'subtract',shape:disk(inner)}]
});
const star = (tips,radius,innerRadius) => ({type:'star',tips,radius,innerRadius});
const marks = {
  jade:{type:'symbol',parts:[
    {shape:ring(.329,.308)}, {shape:star(4,.39,.113)},
    {op:'subtract',shape:disk(.041)}
  ]},
  copper:{type:'symbol',parts:[
    {shape:star(8,.383,.258)}, {op:'subtract',shape:disk(.238)},
    {shape:disk(.157)}, {op:'subtract',shape:disk(.051)}
  ]}
};

function display(name,preset,nodes) {
  const call=ref(name+'Call','result');
  const add=(id,type,config)=> {
    nodes[name+id]=op(type,config);
    return ref(name+id);
  };
  const raster={ width:144,height:144 };
  const tile = add('Body','image.tileGenerator',{...raster,columns:3,rows:3,stamp:rectangle([1,1],.13),
    options:add('Options','data.record',{ color:call,background:'#242434',gutter:[.088,.088],jitter:{color:.16},samples:2,seed:42 })});
  const coverage=ref(tile.node,'coverage');
  const ornament = add('Slip','image.tileGenerator',{...raster,columns:3,rows:3,stamp:marks[name],
    options:{ color:preset.slip, samples:2, gutter:[.07,.07],seed:46 } });
  const dots = add('CornerDots','image.tileGenerator',{...raster,columns:6,rows:6,
    stamp:{...disk(.11),center:[.492,.496]},options:{ color:preset.accent,gutter:[.08,.08],
      crop:[-.0833,-.0833,.9167,.9167],samples:2,seed:50 }});
  const decoration=add('Decoration','image.blend',{background:tile,foreground:ornament,mode:'copy',opacity:.94});
  const ink=add('Inlay','image.blend',{background:decoration,foreground:dots,mask:coverage,mode:'copy',opacity:.65});
  const relief=add('Relief','image.bevel',{source:coverage,options:{width:4.2,height:2.8,profile:'round',border:'wrap'}});
  const light=add('Light','image.emboss',{source:relief,options:{azimuth:-130,elevation:42,strength:.75,bias:.73,border:'wrap'}});
  const tone=add('LightColor','image.gradientMap',{source:light,ramp:{interpolation:'smooth',
    stops:[[0,'#392c58'],[.46,'#947d88'],[.73,'#eae3d5'],[1,'#fff4d4']]},options:{precision:'unorm8'}});
  const shadow=add('Shaded','image.blend',{background:ink,foreground:tone,mode:'multiply',opacity:.94});
  const grain=add('KilnMottle','image.noise',{...raster,family:'fractal',options:{extent:[16,16],octaves:3,seed:name==='jade'?53:61}});
  const glaze=add('GlazeTone','image.gradientMap',{source:grain,ramp:{interpolation:'linear',
    stops:[[0,'#7a7a8f'],[.55,'#f5e8c5'],[1,'#fff5df']]},options:{precision:'unorm8'}});
  const result=add('Swatch','image.blend',{background:shadow,foreground:glaze,mask:coverage,mode:'multiply',opacity:.26});
  return add('Display','image.toDisplay',{source:result});
}

function material() {
  const nodes={}, outputs={}, exports={}, inputs={ knee:{type:shared.type,default:shared.default} };
  function control(inputId, label, group, spec, order) {
    const {type,min,max,step,options}=spec;
    return {input:inputId,label,group,order,widget:type==='boolean'?'toggle':options?'select':'slider',
      ...(min!==undefined && {min,max,step}),...(options && {options})};
  }
  const controls={knee:control('knee',shared.label,'Shared function',shared,0)};
  for (const [name,preset] of Object.entries(presets)) {
    const sockets={ knee:input('knee'),raw:color(preset.raw),fired:color(preset.fired),reduced:color(preset.reduced) };
    for (const [key,spec] of Object.entries(knobs)) {
      const id=name+key[0].toUpperCase()+key.slice(1);
      inputs[id]={type:spec.type,default:preset[key]};
      controls[id]=control(id,spec.label,preset.group,spec,Object.keys(controls).length);
      sockets[key]=input(id);
    }
    const call=name+'Call';
    nodes[call]=op('firing',sockets);
    outputs[name+'Color']=ref(call,'result');
    outputs[name]=display(name,preset,nodes);
    exports[name]={output:name,format:'png'};
  }
  return {project:{format:'ink-studio/graph-project',version:1,inputs,groups:{firing},nodes,outputs,exports},controls};
}

module.exports = { material, firing, shared, knobs, presets };
