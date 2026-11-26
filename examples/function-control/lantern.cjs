const art=require('./harbor-art.cjs');
const input=input=>({input});
const ref=(node,port='value')=>({node,port});
const op=(op,inputs,type)=>({op,inputs,...(type&&{type})});
const call=(op,group,inputs)=>({op,group,inputs});
const fn=(result,inputs,nodes,value)=>({result,inputs,nodes,outputs:{result:value}});
const math=(operation,a,b,type='number')=>op('fn.math',{operation,a,...(b!==undefined&&{b})},type);
const get=(scope,name,type='number')=>op('fn.get',{scope,name},type);
const set=(scope,name,value,type='number')=>op('fn.set',{scope,name,value},type);
const system=(name,key,type)=>op('fn.system',{name,...(key&&{key})},type);
const lane=(a,index)=>op('fn.vector',{operation:'component',a,index},'vec2');
const cast=(from,a,type,rounding)=>op('fn.cast',{from,a,...(rounding&&{rounding})},type);

const controls={
  storm:{label:'Signal route',type:'boolean',default:false,choices:[['Harbor beacon',false],['Storm warning',true]]},
  start:{label:'Starting charge',type:'number',default:12,min:0,max:30,step:1},
  gain:{label:'Charge per turn',type:'number',default:9,min:2,max:16,step:1},
  limit:{label:'Requested turns',type:'integer',default:10,min:0,max:12,step:1},
  target:{label:'Charge target',type:'number',default:68,min:25,max:95,step:1}
};
const defaults={time:1.7,seed:17,spot:[118,35]};
const {width,height}=art, state=input('state'), locals={state:'functionLocals'};
const loopInputs={...locals,index:'integer',target:'number',gain:'number'};
const chargeStage=(operation,b)=>fn('functionLocals',locals,{
  previous:get(state,'charge'), next:math(operation,ref('previous'),b),
  commit:set(state,'charge',ref('next'))
},ref('commit'));
const groups={
  warmFilament:chargeStage('add',6),
  windCoil:chargeStage('multiply',1.25),
  harborCircuit:chargeStage('add',0),
  stormCircuit:chargeStage('add',12),
  turnCrank:fn('functionLocals',loopInputs,{
    previous:get(state,'charge'), next:math('add',ref('previous'),input('gain')),
    mark:set(state,'turn',input('index'),'integer'), commit:set(ref('mark'),'charge',ref('next'))
  },ref('commit')),
  belowTarget:fn('boolean',loopInputs,{
    charge:get(state,'charge'), below:op('fn.compare',{operation:'lt',a:ref('charge'),b:input('target')},'number')
  },ref('below')),
  readPosition:fn('vec2',{}, {p:system('position')},ref('p')),
  readContext:fn('string',{}, {label:system('context','label','string')},ref('label')),
  readBeacon:fn('number',{},{
    at:system('time'), seed:system('seed'), extent:system('size'), channel:system('context','channel','number'),
    w:lane(ref('extent'),0), speed:math('divide',ref('w'),80), motion:math('multiply',ref('at'),ref('speed')),
    seedPhase:math('modulo',ref('seed'),31,'integer'),
    seedNumber:cast('integer',ref('seedPhase'),'number'), nudge:math('multiply',ref('seedNumber'),.21),
    bias:math('add',ref('nudge'),ref('channel')), phase:math('add',ref('motion'),ref('bias')),
    cycle:math('sin',ref('phase')), wave:math('multiply',ref('cycle'),.13), pulse:math('add',ref('wave'),.87)
  },ref('pulse'))
};

function graph(){
  const inputs=Object.fromEntries(Object.entries(controls).map(([name,{type,default:value}])=>[name,{type,default:value}]));
  inputs.spot={type:'vec2',default:defaults.spot};
  const nodes={
    local:op('fn.scope',{variables:{charge:'number',turn:'integer'},charge:input('start'),turn:-1}),
    sequence:op('fn.sequence',{initial:ref('local'),steps:['warmFilament','windCoil']}),
    primed:get(ref('sequence'),'charge'),
    route:op('fn.branch',{condition:input('storm'),state:ref('sequence'),whenTrue:'stormCircuit',whenFalse:'harborCircuit'}),
    routed:get(ref('route'),'charge'),
    turns:call('fn.loop','turnCrank',{initial:ref('route'),target:input('target'),gain:input('gain'),
      count:input('limit'),limit:12,while:'belowTarget'}),
    charge:get(ref('turns'),'charge'),
    lastTurn:get(ref('turns'),'turn','integer'),
    selected:op('fn.select',{condition:ref('route','taken'),whenTrue:1.3,whenFalse:0},'number'),
    routeLabel:op('fn.select',{condition:ref('route','taken'),whenTrue:'storm warning',whenFalse:'harbor beacon'},'string'),
    environment:op('data.record',{channel:ref('selected'),label:ref('routeLabel')}),
    spot:call('fn.withSystem','readPosition',{position:input('spot'),size:[width,height]}),
    pulse:call('fn.withSystem','readBeacon',{position:ref('spot'),size:[width,height],context:ref('environment')}),
    context:call('fn.withSystem','readContext',{position:ref('spot'),size:[width,height],context:ref('environment')}),
    size:system('size'),time:system('time'),seed:system('seed'),
    fraction:math('divide',ref('charge'),116), intensity:math('multiply',ref('fraction'),ref('pulse')),
    cold:op('fn.select',{condition:ref('route','taken'),whenTrue:0,whenFalse:ref('intensity')},'number'),
    warm:op('fn.select',{condition:ref('route','taken'),whenTrue:ref('intensity'),whenFalse:0},'number')
  };
  const add=(id,name,sockets)=>{nodes[id]=op(name,sockets);return ref(id);};
  const draw=(id,commands,w=width,h=height)=>add(id,'draw.render',{width:w,height:h,commands,edges:'hard'});
  const blend=(id,background,foreground,options)=>add(id,'raster.blend',{background,foreground,options});
  const background=draw('seaAndSky',art.background);
  const harbor=draw('harborBeam',art.beams.harbor), storm=draw('stormBeam',art.beams.storm);
  const cool=blend('coolLight',background,harbor,add('coldLayer','data.record',{opacity:ref('cold'),mode:'screen'}));
  const lit=blend('litSky',cool,storm,add('warmLayer','data.record',{opacity:ref('warm'),mode:'screen'}));
  const scene=blend('towerAndBoat',lit,draw('tower',art.foreground),{});
  nodes.x=lane(ref('spot'),0); nodes.y=lane(ref('spot'),1);
  nodes.pixelX=cast('number',ref('x'),'integer','round');
  nodes.pixelY=cast('number',ref('y'),'integer','round');
  nodes.offsetX=math('subtract',ref('pixelX'),2,'integer');
  nodes.offsetY=math('subtract',ref('pixelY'),2,'integer');
  const preview=blend('preview',scene,draw('reticle',art.spark,5,5),
    add('reticleLayer','data.record',{x:ref('offsetX'),y:ref('offsetY'),opacity:ref('pulse')}));
  const outputs={preview,brand:ref('route','taken'),iterations:ref('turns','iterations'),
    ...Object.fromEntries(['primed','routed','charge','lastTurn','spot','size','time','seed','context','pulse'].map(name=>[name,ref(name)]))};
  return {format:'ink-studio/graph-project',version:1,base:{size:{width,height,lock:false}},time:defaults.time,seed:defaults.seed,
    inputs,nodes,groups,outputs,exports:{preview:{output:'preview',format:'png'}}};
}
module.exports={graph,controls,defaults,width,height};
