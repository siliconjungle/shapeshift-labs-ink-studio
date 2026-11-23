const {production,row} = require('../../native-sound-library/performances.cjs');
const {dnbDrums,dubstepTempo,sub,reese,vowel,growl,saw,raveBass,drum} = require('./patches.cjs');

const sampleRate = 48000;
const highpass = hz => ({mode:'highpass',hz});
const lowpass = hz => ({mode:'lowpass',hz});
const bell = (hz,gainDb,q=1) => ({mode:'peak',hz,gainDb,q});
const shelf = (hz,gainDb) => ({mode:'high-shelf',hz,gainDb});
const eq = (...bands) => ({type:'eq',bands});
const transient = (attackDb,sustainDb,wet) => ({type:'transient',attackDb,sustainDb,wet,fast:.0028,slow:.052});
const sat = (driveDb,outputDb,toneHz,wet) =>
  ({type:'saturation',driveDb,outputDb,toneHz,wet,bias:.048});
const comp = (thresholdDb,ratio,attack,release,wet) => ({type:'compressor',thresholdDb,ratio,attack,release,wet});
const dynamic = (hz,thresholdDb,rangeDb) => ({type:'dynamic-eq',bands:[
  {hz,q:1.43,thresholdDb,rangeDb,ratio:3.2,attack:.004,release:.080}
]});
const keyed = processor => ({processor,sidechain:{strip:'kick',tap:'pre'}});
const duck = (hz,rangeDb,release) => ({type:'dynamic-eq',bands:[
  {mode:'low-shelf',hz,q:.74,detector:'wide',direction:'cut',thresholdDb:-26,
    ratio:4.3,rangeDb,attack:.0024,release}
]});
const send = (level,output='room') => ({[output]:{level,tap:'post'}});


function music(id,tempo,bars,patches,lanes,strips,processors,boost) {
  const score = production(patches,lanes,bars,{gain:0});
  score.arrangement.score.tempoMap = {tempo};
  for (const track of Object.values(score.tracks)) track.clips[0].timing = 'played';
  return {format:'ink-studio/music-edit-session',version:1,id,sampleRate,production:score,
    mixer:{output:'master',tail:'cut',peakPolicy:'error',strips:{...strips,master:{inserts:['finish','level']}},
      processors:{...processors,finish:eq(highpass(24),bell(342,-.63)),level:{type:'limiter',inputDb:boost,lookahead:.004,ceilingDbTP:-1.50,release:.067}}}};
}

const lane = (notes,gain,patch) => ({notes,gain,...(patch && {patch})});
const hits = (beat,offsets,midi,duration,velocities) => offsets.map((time,index)=>
  row(beat+time,midi,duration,velocities[index%velocities.length]));
const kickHits = (beat,offsets) => hits(beat,offsets,36,.15,[.98,.84,.91]);
const snareHits = (beat,offsets) => hits(beat,offsets,38,.16,[.90,1,.54]);
const hats = drum('hat',385,.098,0,.53,.76);

const dnbTempo = 174;
const focus = {range:{from:{beat:8},to:{beat:24}},pair:{anchor:'kick',track:'bass',within:.15},searchMs:100};
const dnbVariants = [
  {id:'tight-crack',title:'Tight kick / crack snare',kick:'tight-kick',snare:'crack-snare',kickDb:0,snareDb:0},
  {id:'long-crack',title:'Long kick / crack snare',kick:'long-kick',snare:'crack-snare',kickDb:-.65,snareDb:0},
  {id:'skin-crack',title:'Acoustic kick / crack snare',kick:'skin-kick',snare:'crack-snare',kickDb:.5,snareDb:0},
  {id:'tight-wood',title:'Tight kick / wood snare',kick:'tight-kick',snare:'wood-snare',kickDb:0,snareDb:2.7},
  {id:'tight-wide',title:'Tight kick / stereo flam snare',kick:'tight-kick',snare:'wide-snare',kickDb:0,snareDb:.8}
];
const breakZones = Array.from({length:4},(_,index)=>({samples:['break-'+(index+1)],root:60+index,low:60+index,high:60+index}));

function dnb() {
  const notes = {kick:[],snare:[],break:[],bass:[],reese:[],signal:[]};
  const roots = [29,29,29,29,27,32,29,29,29,36,27,29];
  const slices = [1,3,1,2,1,4,1,3,1,2,1,4];
  const turns = [[0,2.50],[0,2.50,3.48],[0,2.50],[0,2.72]];
  for (const [bar,root] of roots.entries()) {
    const at=4*bar;
    const kicks=bar===0 ? [] : bar===1 ? [2.50] : bar===11 ? [0] : turns[(bar-2)%turns.length];
    const bassPitches=[root,bar%4===2 ? root+7 : root,root+3];
    notes.kick.push(...kickHits(at,kicks));
    if (bar>0) notes.snare.push(...snareHits(at,bar===1 ? [2.992] : bar===11 ? [1.014] : [1.013,3.008]));
    if (bar>0 && bar<11) notes.break.push(row(at,slices[bar]+59,3.94,bar===1?.67:bar===7?.88:.97));
    if (bar===11) notes.break.push(row(at,60,1.75,.8,{offset:.695}));
    for (const [index,offset] of kicks.entries()) {
      const position=at+offset+(.079+(bar%3)*.009+(index%2)*.011);
      const duration=index===0 ? (bar===11?.68:1.46) : index===1 ? (kicks.length===3?.65:1.17) : .31;
      const velocity=index===0?.96:.85;
      notes.bass.push(row(position,bassPitches[index],duration,velocity));
      notes.reese.push(row(position,bassPitches[index]+12,duration,velocity,
        {curves:{pitchCents:[[0,index===0?-29:-12],[.18,0],[1,-4]]}}));
    }
    if ([0,2,6,8,10].includes(bar)) notes.signal.push(
      row(at+.16,77,.71,.7),row(at+1.74,80,.36,.51),row(at+2.26,75,.40,.63));
  }
  const signal={type:'fm',ratio:2,index:1.27,indexDecay:.13,body:.31,color:.53,drive:1.17,width:.44,
    env:{attack:.006,decay:.24,sustain:.21,release:.19}};
  const first=dnbVariants[0];
  return music('stairwell',dnbTempo,12,{
    kick:dnbDrums[first.kick],snare:dnbDrums[first.snare],break:{type:'sample',zones:breakZones},
    sub,reese,signal
  },{
    kick:lane(notes.kick,-8.6),snare:lane(notes.snare,-4.9),break:lane(notes.break,-7.4),
    bass:lane(notes.bass,-13.8,'sub'),reese:lane(notes.reese,-15.6),signal:lane(notes.signal,-19.7)
  },{
    kick:{output:'drums',inserts:['kick-shape']},snare:{output:'drums',inserts:['snare-shape'],sends:send(.105)},
    break:{output:'drums',inserts:['break-shape','break-spank','break-tape']},drums:{inserts:['drum-color']},
    bass:{inserts:['sub-filter',keyed('sub-space')]},reese:{inserts:['reese-filter','reese-grit',keyed('reese-space')]},
    signal:{inserts:['signal-shape'],sends:send(.44)},room:{inserts:['short-room','short-seat']}
  },{
    'kick-shape':eq(highpass(29),bell(229,-1.8),bell(2010,1.24)),
    'snare-shape':eq(highpass(117),bell(248,1.04),bell(988,-1.51)),
    'break-shape':eq(highpass(140),bell(366,-2.15),shelf(6720,1.52)),
    'break-spank':transient(2.3,-1.4,.76),'break-tape':sat(6.3,-3.6,11200,.6),
    'drum-color':sat(3.8,-2.0,14800,.8),
    'sub-filter':eq(highpass(29),lowpass(137)),'sub-space':duck(92,5.1,.081),
    'reese-filter':eq(highpass(112),bell(366,-1.7),lowpass(9230)),
    'reese-grit':sat(8,-4.8,8400,.69),'reese-space':duck(290,3.2,.067),
    'signal-shape':eq(highpass(330),bell(3140,-2.08),lowpass(7430)),
    'short-room':{type:'reverb',size:.83,decay:.57,damping:.65,wet:1},
    'short-seat':eq(highpass(405),lowpass(6300))
  },7.0);
}

const gestures = {
  open:[[0,.15],[.22,.30],[.49,.93],[.73,.85],[1,.12]],
  close:[[0,.93],[.14,.81],[.51,.29],[.78,.12],[1,.06]],
  stutter:[[0,.25],[.22,.82],[.42,.30],[.62,.68],[.82,.90],[1,.12]],
  under:[[0,.19],[.22,.29],[.56,.53],[.80,.38],[1,.12]],
  tear:[[0,.53],[.14,.76],[.44,.92],[.71,.39],[1,.16]]
};
function bend(id,pressure,contact,bendStart=0) {
  return {pressure,contact,curves:{breath:gestures[id],pitchCents:[[0,bendStart],[.18,0],[.8,0],[1,-18]]}};
}

function dubstep() {
  const call = [
    [4.09,41,.62,.98,'open',.18,.30,-66],[4.96,41,.44,.88,'close',.19,.30,23],
    [8.10,41,.62,1,'open',.17,.27,-62],[9.02,44,.64,.85,'stutter',.55,.62,-26],
    [12.08,41,.55,.98,'close',.33,.38,-38],[12.85,41,.35,.85,'open',.24,.28,36],
    [13.39,46,.40,.77,'open',.42,.72,-51],
    [16.09,41,.68,1,'open',.36,.34,-56],[17.09,41,.53,.89,'stutter',.65,.81,0],
    [24.09,41,.67,1,'open',.30,.31,-60],[24.96,41,.54,.89,'close',.38,.29,20],
    [25.66,44,.28,.74,'open',.51,.77,-36],
    [28.11,41,.91,.96,'stutter',.75,.71,-53],[29.27,44,.47,.85,'close',.48,.44,18],
    [32.09,41,.51,1,'open',.32,.33,-60],[32.77,41,.54,.90,'close',.42,.40,13],
    [33.59,48,.38,.84,'open',.71,.86,-75],[36.09,41,.92,1,'open',.53,.51,-72]
  ];
  const answer = [
    [6.37,39,.85,.97,'under',.56,.26,-32],[7.43,41,.27,.89,'tear',.62,.69,-19],
    [10.41,36,1.01,1,'under',.59,.49,-24],
    [14.37,39,.49,.87,'tear',.45,.38,-41],[15.04,36,.62,.91,'under',.75,.88,-26],
    [18.32,36,.88,.99,'under',.54,.23,-24],[19.40,39,.28,.89,'tear',.68,.72,-17],
    [26.33,39,.97,1,'under',.50,.25,-24],[27.50,41,.24,.89,'tear',.62,.68,-20],
    [30.38,36,1.14,1,'under',.72,.52,-18],
    [34.31,39,.56,.97,'tear',.52,.50,-35],[35.06,36,.55,.92,'under',.84,.97,-26],
    [38.36,36,.86,.95,'under',.60,.36,-26]
  ];
  const play = sequence => sequence.map(([beat,midi,duration,velocity,...expression])=>
    row(beat,midi,duration,velocity,bend(...expression)));
  const lows = [...call,...answer].sort((a,b)=>a[0]-b[0]).map(([beat,midi,duration,velocity])=>
    row(beat,midi-12,duration,velocity*.94));
  const kick=[],snare=[],top=[];
  for (let bar=0;bar<10;bar++) {
    const at=bar*4;
    const offsets=bar===0?[0]:bar===5?[2.82]:bar%4===2?[0,1.57,3.23]:[0,1.55];
    kick.push(...kickHits(at,offsets));
    const snaps=bar===5?[]:[2.031, ...(bar===7?[3.724]:[])];
    snare.push(...snareHits(at,snaps));
    top.push(...hits(at,bar===5?[3.47,3.73]:bar===9?[.51,1.51,2.58]:[.48,1.46,2.58,3.45],
      42,.085,[.65,.47,.68,.51]));
  }
  return music('underbite',dubstepTempo,10,{
    kick:drum('kick',51,.221,141,.27,.54),snare:dnbDrums['wide-snare'],hat:hats,sub,vowel,growl
  },{
    kick:lane(kick,-8.5),snare:lane(snare,-3.4),'closed-hat':lane(top,-15.0,'hat'),
    bass:lane(lows,-12.0,'sub'),vowel:lane(play(call),-12.6),growl:lane(play(answer),-12.4)
  },{
    kick:{output:'drums',inserts:['kick-shape']},snare:{output:'drums',inserts:['snare-shape'],sends:send(.15)},
    'closed-hat':{output:'drums',pan:.17,inserts:['air-shape']},drums:{inserts:['drum-color']},
    bass:{inserts:['sub-shape',keyed('sub-duck')]},
    vowel:{inserts:['voice-shape','voice-grit','de-bite'],pan:-.11},
    growl:{inserts:['growl-shape','growl-grit','de-bite'],pan:.12},
    room:{inserts:['small-space','space-shape']}
  },{
    'kick-shape':eq(highpass(29),bell(228,-2.1),bell(2470,.9)),
    'snare-shape':eq(highpass(111),bell(196,2.21),bell(1070,-1.82),shelf(7250,1.3)),
    'air-shape':eq(highpass(2020),shelf(8200,-2.15)),
    'drum-color':sat(3.8,-2.0,14800,.83),
    'sub-shape':eq(highpass(27),lowpass(127)),'sub-duck':duck(94,5.2,.087),
    'voice-shape':eq(highpass(126),bell(920,.9),lowpass(8770)),'voice-grit':sat(8.1,-4.4,9090,.51),
    'growl-shape':eq(highpass(119),bell(257,-1.45),shelf(4010,-1.2)),'growl-grit':sat(9.4,-4.9,8350,.69),
    'de-bite':dynamic(2810,-27.5,3.9),
    'small-space':{type:'reverb',size:.80,decay:.48,damping:.71,wet:1},
    'space-shape':eq(highpass(438),lowpass(5860))
  },4.0);
}

function rave() {
  const tempo=150, roots=[29,25,32,27,29,25,32,27,29,27,25,29];
  const melody=[
    [[0,77,.98],[1.25,80,.53],[2.02,84,.87],[3.04,82,.64]],
    [[.02,80,.73],[.93,77,.53],[1.77,80,.56],[2.54,85,1.15]],
    [[.01,84,1.10],[1.41,87,.46],[2.04,89,.74],[3.04,84,.61]],
    [[.05,82,.88],[1.20,80,.46],[1.94,77,.56],[2.87,75,.89]]
  ];
  const response=[
    [[0,77,.98],[1.25,80,.55],[2.02,84,1.08],[3.20,85,.62]],
    [[0,87,1.22],[1.30,84,.50],[2.03,80,1.20]],
    [[.04,84,.74],[1.00,80,.42],[1.72,77,.58],[2.46,75,.62],[3.31,73,.42]],
    [[.02,77,1.85]]
  ];
  const kick=[],bass=[],lead=[],octave=[];
  for (const [bar,root] of roots.entries()) {
    const at=4*bar, hook=bar>=8 ? response[bar-8] : melody[bar%4];
    const offsets=bar===0?[]:bar===1?[0,1]:bar===11?[0,1]:[0,1,2,3];
    kick.push(...kickHits(at,offsets));
    if (bar>=2) bass.push(...offsets.map((beat,index)=>
      row(at+beat+.46,root,.42,[.98,.86,.94,.88][index])));
    for (const [index,[time,note,length]] of hook.entries()) {
      if (bar===0 && index%2===1 || bar===1 && index<2) continue;
      const velocity=(bar<2?.73:.92)+[.06,-.04,.04,-.03][index%4];
      lead.push(row(at+time,note,length,velocity,{breath:bar<2?.15:.70,
        curves:{pitchCents:[[0,index===0?-74:-32],[.16,0],[.72,1],[1,-7]]}}));
      if (bar>=4 && [0,2].includes(index)) octave.push(row(at+time+.014,note-12,length*.9,velocity*.48,
        {breath:.29,curves:{pitchCents:[[0,-43],[.16,0],[1,1]]}}));
    }
  }
  const kickPatch=drum('kick',55,.272,137,.18,.42);
  const session = music('arc-lamp',tempo,12,{kick:kickPatch,bass:raveBass,lead:saw},{
    kick:lane(kick,-9.1),bass:lane(bass,-11.7),lead:lane(lead,-13.4)
  },{
    kick:{inserts:['kick-seat','kick-color']},bass:{inserts:['bass-seat','bass-grit',keyed('pump')]},
    lead:{inserts:['lead-seat','de-bite','lead-control'],sends:{...send(.16),...send(.105,'echo')}},
    room:{inserts:['plate','space-seat']},echo:{inserts:['throw','echo-seat']}
  },{
    'kick-seat':eq(highpass(28),bell(226,-2.08),bell(1740,1.02)),
    'kick-color':sat(4.3,-2.2,14300,.86),
    'bass-seat':eq(highpass(28),bell(370,-1.6),lowpass(2320)),'bass-grit':sat(5.7,-3.22,5700,.54),
    pump:comp(-23,4.2,.003,.103,.78),
    'lead-seat':eq(highpass(185),bell(880,-1.15),shelf(7200,-1.41)),
    'de-bite':dynamic(2990,-28.4,3.92),'lead-control':comp(-20.7,2.2,.024,.112,.60),
    plate:{type:'reverb',size:1.05,decay:.99,damping:.67,wet:1},
    'space-seat':eq(highpass(384),lowpass(6050)),
    throw:{type:'tempo-delay',beats:{numerator:3,denominator:4},feedback:.38,lowHz:410,highHz:5530,
      crossfeed:.79,driveDb:1.4,wet:1},
    'echo-seat':eq(highpass(413),lowpass(5720))
  },7.4);
  session.production.tracks.lead.clips[0].voices.push({id:'octave',notes:octave.map((note,index)=>
    ({...note,id:'support-'+index}))});
  return session;
}

module.exports={dnbVariants,dnbDrums,focus,dnb,dubstep,rave};
