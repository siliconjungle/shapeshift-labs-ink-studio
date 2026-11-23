/* Native instruments for the drop studies. Numeric pitches are MIDI; times in envelopes are seconds. */
const oscillator = (wave, options = {}) => ({type:'oscillator',wave,...options});
const gain = (input, amount) => ({type:'gain',input,amount});
const mix = (...inputs) => ({type:'mix',inputs});
const filter = (input, mode, cutoff, resonance) => ({type:'filter',input,mode,cutoff,resonance});
const envelope = (attack, decay, sustain, release) => ({type:'envelope',env:{attack,decay,sustain,release}});
const motion = points => ({type:'curve',points});
const drive = (input, amount) => ({type:'drive',input,amount});
const graph = (nodes, output, tail, controls) => ({type:'graph',nodes,output,tail,...(controls && {controls})});
const held = (input, shape = 'shape') => gain(input,{base:0,from:{[shape]:1}});
const breath = (base, depth) => ({base,by:{breath:depth}});
const samples = (names, settings={}) => ({type:'sample',zones:[{samples:names,...settings}]});
const drum = (kind,tune,decay,sweep,click,color) => ({type:'drum',kind,tune,decay,sweep,click,color});
const tap = name => ({type:'sample',zones:[{samples:[name]}]});

const sub = graph({
  fundamental:oscillator('sine'), harmonic:oscillator('sine',{ratio:2,phase:.15}),
  weight:gain('harmonic',.11), sum:mix('fundamental','weight'),
  shape:envelope(.009,.20,.88,.071), voice:held('sum')
},'voice',.081);

const reese = graph({
  center:oscillator('saw',{phase:.19}), a:oscillator('saw',{detune:-.206,phase:.46}),
  b:oscillator('saw',{detune:.224,phase:.72}), chest:oscillator('pulse',{width:.35,phase:.28}),
  c:gain('center',.63), l:gain('a',.55), r:gain('b',.54), body:gain('chest',.24),
  sweep:motion([[0,.50],[.18,.94],[.65,.33],[1,.18]]),
  leftSum:mix('c','l','body'), rightSum:mix('c','r','body'),
  leftTone:filter('leftSum','lowpass',{base:405,from:{sweep:1700}},1.32),
  rightTone:filter('rightSum','lowpass',{base:455,from:{sweep:1590}},1.26),
  leftEdge:drive('leftTone',1.7), rightEdge:drive('rightTone',1.7),
  shape:envelope(.020,.22,.81,.092), left:held('leftEdge'), right:held('rightEdge')
},{left:'left',right:'right'},.11);

const dnbDrums = {
  'tight-kick':drum('kick',52,.174,132,.24,.56),
  'long-kick':drum('kick',44,.31,99,.13,.45),
  'skin-kick':samples(['kick-hard-a','kick-hard-b'],{gain:4}),
  'crack-snare':graph({
    wire:tap('snare-main'), shell:oscillator('sine',{hz:184,phase:.13}),
    ring:envelope(.001,.070,0,.024), body:gain('shell',{base:0,from:{ring:.27}}),
    snap:filter('wire','highpass',128,.75), sum:mix('snap','body'), hit:drive('sum',1.6)
  },'hit',.13),
  'wood-snare':samples(['snare-rim','snare-alt'],{gain:3}),
  'wide-snare':graph({
    center:tap('snare-alt'), leftTap:{...tap('snare-main'), startSeconds:.013},
    rightTap:{...tap('snare-rim'), startSeconds:.026},
    low:filter('center','highpass',147,.73),
    leftEdge:gain('leftTap',.44), rightEdge:gain('rightTap',.54),
    left:mix('low','leftEdge'), right:mix('low','rightEdge')
  },{left:'left',right:'right'},.15)
};

const dubstepTempo = 142;
function rhythm() {
  // Contact sweeps 2–6 cycles per beat; pressure changes tremolo depth.
  return {
    lfo:oscillator('sine',{hz:dubstepTempo/60,phase:.25,ratio:{base:2,by:{contact:4}}}),
    wet:gain('lfo',{base:.026,by:{pressure:.36}}),
    pulse:{type:'gain',input:'tone',amount:{base:.974,by:{pressure:-.36},from:{wet:1}}}
  };
}
const dubControls = {breath:.38, contact:.5, pressure:.18};

const vowel = graph({
  operator:oscillator('sine',{ratio:2.03}), carrier:oscillator('sine',{phaseInput:'operator',index:breath(.20,.31)}),
  edge:oscillator('saw',{phase:.23}), harmonics:gain('edge',.57), teeth:mix('carrier','harmonics'),
  throat:drive('teeth',1.88),
  first:filter('throat','bandpass',breath(298,673),4.8), second:filter('throat','bandpass',breath(796,1330),4.3),
  air:filter('throat','bandpass',breath(2300,782),5.8), floor:filter('throat','lowpass',405,.88),
  airNorm:gain('air',.22), floorNorm:gain('floor',.31), resonances:mix('first','second','airNorm','floorNorm'),
  tone:drive('resonances',2.4), ...rhythm(),
  shape:envelope(.006,.11,.92,.045), voice:held('pulse')
},'voice',.057,dubControls);

const growl = graph({
  operator:oscillator('sine',{ratio:3.99}), carrier:oscillator('sine',{phaseInput:'operator',index:breath(.32,.68)}),
  blade:oscillator('pulse',{width:breath(.28,.14),phase:.32}), teeth:oscillator('saw',{detune:-.24,phase:.63}),
  upper:gain('teeth',.40), core:mix('carrier','blade','upper'), grind:drive('core',2.12),
  open:filter('grind','lowpass',breath(650,2590),2.2),
  grit:filter('grind','bandpass',breath(375,395),3.25),
  whine:filter('grind','bandpass',breath(1170,860),3.8),
  edge:gain('whine',.45), dark:gain('open',.81), layers:mix('grit','dark','edge'),
  tone:drive('layers',1.9), ...rhythm(),
  shape:envelope(.012,.14,.84,.057), voice:held('pulse')
},'voice',.069,{...dubControls,contact:.25});

const saw = graph({
  center:oscillator('saw',{phase:.16}), l1:oscillator('saw',{detune:-.105,phase:.19}),
  r1:oscillator('saw',{detune:.12,phase:.38}), l2:oscillator('saw',{detune:.231,phase:.67}),
  r2:oscillator('saw',{detune:-.242,phase:.83}), l3:oscillator('saw',{detune:-.39,phase:.54}),
  r3:oscillator('saw',{detune:.412,phase:.31}),
  anchor:gain('center',.73), a:gain('l1',.35), b:gain('r1',.35), c:gain('l2',.27),
  d:gain('r2',.27), e:gain('l3',.16), f:gain('r3',.16),
  leftSum:mix('anchor','a','c','e'),rightSum:mix('anchor','b','d','f'),
  attack:motion([[0,.46],[.11,1],[.52,.74],[1,.49]]),
  leftTone:filter('leftSum','lowpass',{base:1650,by:{breath:3850},from:{attack:2740}},.84),
  rightTone:filter('rightSum','lowpass',{base:1530,by:{breath:3620},from:{attack:2590}},.88),
  shape:envelope(.012,.22,.88,.134), left:held('leftTone'), right:held('rightTone')
},{left:'left',right:'right'},.15,{breath:.66});

const raveBass = graph({
  root:oscillator('sine'), chest:oscillator('saw',{detune:-.038,phase:.18}),
  pluck:motion([[0,.91],[.20,.65],[1,.07]]),
  edge:filter('chest','lowpass',{base:112,from:{pluck:700}},1.26),
  rootLevel:gain('root',.72), edgeLevel:gain('edge',.51), source:mix('rootLevel','edgeLevel'),
  shape:envelope(.008,.12,.82,.074), voice:held('source')
},'voice',.085);

module.exports={dnbDrums,dubstepTempo,sub,reese,vowel,growl,saw,raveBass,drum};
