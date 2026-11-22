const blend = (from, to, position, law = 'linear', window) =>
  ({type:'blend',inputs:[from,to],position,law,...(window && {window})});
const gain = (input, amount) => ({type:'gain',input,amount});
const sample = (zones, settings = {}) => ({type:'sample',zones,...settings});
const curve = points => ({type:'curve',clock:'seconds',points});

const transitions = [
  {id:'slur-g4-c5',from:67,to:72,lead:.054,join:[.088,.121]},
  {id:'slur-c5-e5',from:72,to:76,lead:.065,join:[.092,.112]},
  {id:'slur-g4-c4',from:67,to:60,lead:.078,join:[.133,.175]}
];
// The VCSL file labels sit an octave below their sounding pitches. Match the
// slur recordings without moving the multisample key ranges.
const soundingOctave = zones => zones.map(zone=>({...zone,root:zone.root+12}));
const slice = ({id,to}) => sample([{samples:['reed-'+id],root:to}]);

function expressiveReed(sustains, releases) {
  const tone = {base:0,by:{pressure:1.08,breath:.12,velocity:.08}};
  const nodes = {
    tone:sample(soundingOctave(sustains),{env:{attack:.012,decay:.24,sustain:1,release:.068}}),
    keyUp:sample(soundingOctave(releases)),
    breeze:{type:'noise'},
    mouth:{type:'filter',mode:'bandpass',input:'breeze',resonance:1.35,
      cutoff:{base:980,by:{breath:1750,pressure:850}}},
    shape:{type:'envelope',env:{attack:.025,decay:.26,sustain:.94,release:.091}},
    air:gain('mouth',{base:0,from:{shape:.27}}),
    voiced:blend('air','tone',tone,'equal-power',[.13,.88]),
    transition:slice(transitions[0]),
    voicing:blend('air','transition',tone,'equal-power',[.13,.88]),
    splice:curve([[0,0],[.092,0],[.122,1]]),
    connected:blend('voicing','voiced',{base:0,from:{splice:1}})
  };
  const articulations = Object.fromEntries(transitions.map(row=>[row.id,{
    output:'connected',nodes:{
      transition:slice(row),
      tone:{startSeconds:row.join[0]-.006,offsetSeconds:.24},
      splice:curve([[0,0],[row.join[0],0],[row.join[1],1]])
    }
  }]));
  articulations['key-up']={output:'keyUp',tail:.25};
  return {type:'graph',tail:.19,controls:{pressure:.53,breath:.28},output:'voiced',nodes,articulations,
    performance:{connect:{gap:.038,interval:7,fade:.020,unmatched:'attack'},repeatGap:.07,rules:[
      ...transitions.map(row=>({when:'legato',keys:[row.to,row.to],interval:[row.to-row.from,row.to-row.from],
        articulation:row.id,attackLead:row.lead,recorded:true})),
      {when:'release',articulation:'key-up',level:.45}
    ]}};
}

function expressivePlate() {
  const nodes = {};
  const touch = {base:0,by:{velocity:1}};
  for (const [mic,source] of [['direct','mid'],['room','room']]) {
    for (const ch of ['left','right']) {
      for (const layer of ['soft','hard']) {
        nodes[mic+'-'+ch+'-'+layer]=sample([{
          samples:['a','b'].map(alternate=>'metal-plate-'+layer+'-'+alternate+'-'+source)
        }],{channel:ch});
      }
      nodes[mic+'-'+ch]=blend(mic+'-'+ch+'-soft',mic+'-'+ch+'-hard',touch,'linear',[.25,.80]);
    }
  }
  const perspective={base:0,by:{room:1}};
  nodes.left=blend('direct-left','room-left',perspective,'equal-power');
  nodes.right=blend('direct-right','room-right',perspective,'equal-power');
  return {type:'graph',output:{left:'left',right:'right'},controls:{room:.18},tail:2.83,nodes};
}

module.exports={expressiveReed,expressivePlate};
