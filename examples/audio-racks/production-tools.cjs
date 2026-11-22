const macro=(label,value,...targets)=>({label,default:value,targets:targets.map(([path,range])=>({path,range}))});
const control=(label,value,key,range)=>macro(label,value,[['processors','process',key],range]);
const base=(id,title,description)=>({format:'ink-studio/audio-rack',version:1,id,revision:1,title,description,
  inputs:{main:'source'},output:'master'});
const insert=(id,title,description,process,macros)=>({...base(id,title,description),
  strips:{source:{inserts:['process']},master:{}},processors:{process},macros});
const depth=(label,i,initial,max)=>macro(label,initial,[['processors','process','bands',i,'rangeDb'],[0,max]]);
const room=(id,title,description,level,preDelayMs,gainDb,highHz)=>({...base(id,title,description),
  assets:{impulse:'rooms/'+id+'.wav'},
  strips:{source:{sends:{space:{tap:'post',level}}},space:{inserts:['room','rumble','shade']},master:{}},
  processors:{
    room:{type:'convolution',impulse:'impulse',wet:1,rateCompensate:true,preDelayMs,gainDb},
    rumble:{type:'highpass',hz:85},shade:{type:'lowpass',hz:highHz}
  },
  taps:{room:{strip:'space'}},
  macros:{amount:macro('Room amount',level,[['strips','source','sends','space','level'],[0,1]])}
});

module.exports=[
  insert('dynamic-eq','Dynamic EQ','Make room for other parts during low-mid buildup or a forward upper midrange.',
    {type:'dynamic-eq',bands:[
      {mode:'peak',hz:310,q:1.15,thresholdDb:-35,ratio:4,rangeDb:6,attack:.008,release:.14},
      {mode:'peak',hz:2850,q:1.25,thresholdDb:-38,ratio:3,rangeDb:4,attack:.003,release:.09}
    ]},{'low-mid':depth('Low-mid cut',0,.60,10),'presence':depth('Presence cut',1,.40,10)}),
  insert('oversampled-clipper','Oversampled Clipper','Tame peaks on drums or a mix bus with a hard or soft knee.',
    {type:'clipper',oversample:4,driveDb:5,ceilingDb:-5,kneeDb:1.5,outputDb:-2},{
      drive:control('Drive',.55,'driveDb',[-6,14]),knee:control('Soft knee',.25,'kneeDb',[0,6]),
      ceiling:control('Clip point',.70,'ceilingDb',[-12,-2])
    }),
  insert('oversampled-saturation','Oversampled Saturation','Add harmonics and soften peaks with a biased, DC-blocked shaper.',
    {type:'saturation',oversample:4,driveDb:8,bias:.12,outputDb:-3,toneHz:9300},{
      drive:control('Drive',.5,'driveDb',[0,16]),tone:control('Tone',.75,'toneHz',[1500,11900]),
      bias:control('Bias',.3,'bias',[0,.4])
    }),
  room('typing-room','Terry’s Typing Room','A compact, bright stereo room with a short decay.',.34,0,-3,5500),
  room('factory-warehouse','Terry’s Factory Warehouse','A wide industrial space with dense early reflections.',.44,10,0,6200),
  room('lady-chapel','Lady Chapel','An airy stereo capture from St Albans Cathedral.',.43,14,0,7100)
];
