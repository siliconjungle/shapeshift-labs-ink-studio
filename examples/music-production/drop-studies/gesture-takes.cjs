/* Authored controller performances for the first drop in Underbite. */
const lane = 'vowel';
const phrase = 'drop-call';
const fromBeat = 3.75, toBeat = 20.125;
const takeNames = ['bloom','bite','coil'];
const labels = {reference:'Original',bloom:'Bloom',bite:'Bite',coil:'Coil',kept:'Comp',
  hollow:'Hollow',brass:'Folded Brass'};

// Delay (ms), gate ratio, accent, and played breath, bend and pulse-depth curves per attack.
const performances = {
  bloom:[
    [19,1.23,1.02, [.07,.92,1,.19], [-64,7,4,-33], [.17,.21,.30,.21]],
    [21,.81,.90, [.87,1,.34,.13], [24,3,-6,-25], [.20,.26,.30,.24]],
    [23,1.19,.99, [.06,.63,1,.24], [-94,-7,7,-42], [.12,.18,.30,.23]],
    [10,.86,.89, [.40,.88,.52,.12], [23,9,-4,-48], [.21,.33,.45,.25]],
    [17,1.11,1.01, [.16,.47,1,.26], [-34,5,10,-18], [.10,.14,.29,.22]],
    [15,.80,.87, [.26,.77,.59,.15], [-15,5,1,-16], [.24,.29,.40,.32]],
    [22,.74,.88, [.18,.61,.83,.15], [-39,18,7,-37], [.22,.40,.44,.18]],
    [31,1.12,.98, [.05,.58,1,.19], [-94,-2,9,-51], [.10,.17,.35,.20]],
    [16,.87,.88, [.23,.93,.62,.16], [-21,9,-2,-41], [.15,.30,.38,.21]]
  ],
  bite:[
    [4,.63,1.12, [.83,1,.27,.09], [18,-4,-21,-60], [.28,.59,.94,.78]],
    [-11,.92,1.04, [.73,.32,1,.11], [-20,26,10,-29], [.80,.45,.85,.65]],
    [4,.65,1.13, [1,.80,.22,.10], [32,5,-20,-72], [.35,.67,.95,.78]],
    [19,1.02,1.01, [.14,.91,.35,.09], [-61,-12,17,-22], [.78,.42,.89,.40]],
    [3,.95,1.12, [.91,1,.26,.11], [23,0,-21,-70], [.43,.67,.82,.69]],
    [-10,.74,.99, [.36,.81,.53,.12], [-36,7,-8,-40], [.74,.48,.90,.60]],
    [9,.77,1.04, [.86,.26,.68,.08], [26,-7,-15,-61], [.49,.67,.92,.60]],
    [6,.74,1.12, [.89,1,.21,.13], [26,13,-26,-85], [.32,.73,.90,.56]],
    [11,.85,.97, [.37,.92,.52,.14], [-47,-9,14,-38], [.81,.44,.85,.60]]
  ],
  coil:[
    [11,.99,.98, [.23,.46,.86,.29], [-22,43,5,-76], [.43,.68,.58,.38]],
    [-8,.76,.93, [.59,.33,.83,.18], [37,-12,17,-27], [.57,.31,.68,.43]],
    [16,1.11,1.01, [.12,.82,.58,.27], [-35,66,29,-92], [.31,.68,.71,.33]],
    [6,.89,.91, [.62,.28,.95,.24], [-17,26,69,-35], [.52,.70,.36,.52]],
    [10,1.18,1.00, [.18,.30,.91,.25], [-42,28,62,-89], [.48,.69,.62,.39]],
    [5,.80,.96, [.65,.26,.87,.23], [28,-12,30,-37], [.61,.48,.78,.42]],
    [15,.94,1.04, [.24,.66,1,.15], [-83,42,48,-45], [.35,.36,.67,.37]],
    [22,1.23,1.05, [.08,.53,.92,.38], [-56,-5,94,-115], [.19,.48,.76,.65]],
    [7,.99,.88, [.63,.18,.85,.08], [31,-37,54,-68], [.61,.35,.65,.48]]
  ]
};

const selections=[
  {take:'bloom',to:7.82},
  {take:'bite',to:12.40,blend:.10},
  {take:'coil',blend:.17}
];

function controllers(notes,take,clock,sampleRate,from,to) {
  const rows=performances[take];
  if (notes.length!==rows.length) throw new RangeError('Underbite call changed and needs new controller passes');
  const gesture={breath:[],pitchCents:[],pressure:[],contact:[]};
  const frame=beat=>Math.round(clock.timeAt({beat})*sampleRate);
  const quantize=value=>Math.round(value*127)/127;
  const rest={breath:0,pitchCents:0,pressure:.2,contact:.27};
  const set=(name,at,value)=>{
    if (at<0 || at>to-from || at<=(gesture[name].at(-1)?.[0] ?? -1))
      throw new RangeError('Controller gestures must be ordered and inside the captured drop');
    gesture[name].push([at,name==='pitchCents' ? Math.round(value*8192/200)*200/8192 : quantize(value)]);
  };
  for (const [name,value] of Object.entries(rest)) set(name,0,value);
  const edits=notes.map((note,index)=>{
    const [delayMs,gate,accent,breath,bend,pressure]=rows[index], delay=delayMs/1000;
    const start=frame(note.beat)-from+Math.round(delay*sampleRate);
    const gateFrames=Math.round((frame(note.beat+note.duration)-frame(note.beat))*gate);
    const contact=take==='bite' ? [.57,.74,.94,.31] : take==='coil' ? [.12,.33,.72,.40] : [.18,.22,.35,.20];
    for (const [name,values] of Object.entries({breath,pitchCents:bend,pressure,contact})) {
      const head=gesture[name].at(-1)[0];
      const settle=Math.max(head+1,start-Math.round(sampleRate*.012));
      set(name,settle,values[0]);
      for (const [i,phase] of [.11,.31,.68,.96].entries()) set(name,start+Math.round(gateFrames*phase),values[i]);
    }
    return {clip:'vowel-phrase',voice:'phrase',note:note.id,delay,gate,accent};
  });
  for (const [name,value] of Object.entries(rest)) set(name,to-from,value);
  return {gesture,edits};
}

function sounds(base) {
  const hollow=structuredClone(base), brass=structuredClone(base);
  Object.assign(hollow.nodes.operator,{ratio:1.503});
  Object.assign(hollow.nodes.first,{cutoff:{base:260,by:{breath:470}},resonance:6.2});
  Object.assign(hollow.nodes.second,{cutoff:{base:1160,by:{breath:895}},resonance:5.1});
  hollow.nodes.harmonics.amount=.87;
  hollow.nodes.tone.amount=2.9;

  Object.assign(brass.nodes.edge,{wave:'pulse',width:{base:.19,by:{breath:.29}}});
  Object.assign(brass.nodes.operator,{ratio:3.01});
  Object.assign(brass.nodes.carrier,{index:{base:.15,by:{breath:.47}}});
  Object.assign(brass.nodes.first,{cutoff:{base:470,by:{breath:560}},resonance:2.7});
  Object.assign(brass.nodes.second,{cutoff:{base:895,by:{breath:2000}},resonance:2.8});
  brass.nodes.airNorm.amount=.35;
  brass.nodes.tone.amount=1.8;
  return {hollow,brass};
}

module.exports = {lane,phrase,fromBeat,toBeat,takeNames,labels,selections,controllers,sounds};
