const tempo = 94;
const drumTracks = ['kick', 'snare', 'closed-hat', 'open-hat'];
const row = (beat, midi, duration, velocity, play) => ({beat, midi, duration, velocity, ...(play && {play})});
const touch = (breath, pressure, pitchCents, extra) => ({curves: {breath, pressure, pitchCents}, ...extra});

function production(patches, lanes, bars, options = {}) {
  const parts = {}, tracks = {}, used = {};
  for (const [name, {notes, patch = name, gain = 0, pan = 0, send = 0, ...settings}] of Object.entries(lanes)) {
    const percussion = drumTracks.includes(name) || ['strike', 'scrape', 'plate'].includes(name);
    parts[name] = {role: percussion ? 'percussion' : name === 'bass' ? 'bass' : 'lead'};
    tracks[name] = {patch, gain, pan, send, ...settings, clips: [{id: name + '-phrase', beat: 0,
      length: bars * 4, ...(percussion && {mode: 'layer'}),
      voices: [{id: 'phrase', notes: notes.map((note, i) => ({id: 'note-' + i, ...note}))}]}]};
    used[patch] = patches[patch];
  }
  return {seed: 714, gain: options.gain ?? -2, patches: used, tracks,
    arrangement: {score: {tempoMap: {tempo}, key: {root: 'E3', mode: 'minor'},
      harmonies: {home: {root: 'E3', quality: 'minor', voicing: {}}}}, parts, motifs: {},
      sections: options.sections ?? [{id: 'study', bars, harmony: 'home'}]},
    room: {gain: -16, size: 1.05, decay: .91, damping: .72}};
}

const reedPhrase = [
  row(.26, 64, .62, .42, touch([[0,.2],[.37,.64],[1,.31]], [[0,.22],[.62,.40],[1,.26]], [[0,-27],[.4,0],[1,5]])),
  row(1.16, 67, .45, .57, touch([[0,.38],[.8,.62],[1,.46]], [[0,.42],[1,.59]], [[0,-10],[1,1]])),
  row(1.65, 69, 1.18, .68, touch([[0,.48],[.62,.92],[1,.39]], [[0,.34],[.48,.68],[1,.34]], [[0,-19],[.37,2],[1,-13]])),
  row(3.56, 67, .2, .58),
  row(3.93, 67, .26, .63, {articulation: 'vib'}),
  row(4.42, 62, 1.13, .48, touch([[0,.21],[.64,.76],[1,.38]], [[0,.39],[1,.28]], [[0,-32],[.24,0],[1,-12]])),
  row(5.91, 64, 1.32, .64, touch([[0,.37],[.43,.67],[1,.18]], [[0,.38],[.73,.53],[1,.20]], [[0,-8],[.68,3],[1,-28]], {articulation: 'vib'}))
];
const strikes = [
  row(.26, 52, .26, .37, {contact:.18,damping:.28}),
  row(.99, 52, .24, .39, {contact:.29,damping:.32}),
  row(1.78, 59, .46, .69, {contact:.22,damping:.03}),
  row(3.42, 55, .27, .62, {contact:.52,damping:.72}),
  row(4.66, 62, .38, .76, {contact:.34,damping:.12}),
  row(6.23, 52, .46, .62, {contact:.25,damping:.07})
];
const scrapes = [
  row(.23, 48, .43, .62, {articulation:'bells'}),
  row(1.58, 48, .55, .75),
  row(3.2, 48, .55, .7),
  row(4.98, 48, .65, .7, {articulation:'gong'})
];

function pocket(bars, start = 0) {
  const drums = Object.fromEntries(drumTracks.map(id => [id, []]));
  const bass = [];
  const roots = [28, 28, 36, 31, 33, 33, 36, 35];
  for (let bar = 0; bar < bars; bar++) {
    const b = (bar + start) * 4, pattern = bar % 4, root = roots[bar % roots.length];
    const kicks = [[[0,.86],[2.78,.61]], [[.005,.81],[1.68,.59],[3.51,.75]],
      [[0,.9],[2.52,.76]], [[.46,.65],[2.03,.78],[3.56,.56]]][pattern];
    kicks.forEach(([beat, velocity]) => drums.kick.push(row(b + beat, 36, .14, velocity)));
    drums.snare.push(row(b + 1.043, 38, .11, pattern === 3 ? .52 : .75,
      pattern === 3 ? {articulation:'rim'} : undefined), row(b + 3.029, 38, .17, .81));
    if (pattern % 2 === 1) drums.snare.push(row(b + 2.52, 38, .09, .27));
    const hats = pattern === 2 ? [[.5,.48],[1.5,.26],[3.49,.47]] :
      [[.485,.48],[1.02,.27],[1.54,.37],[2.038,.49],[2.55,.29],[3.05,.34],[3.52,.5]];
    hats.forEach(([beat, velocity]) => drums['closed-hat'].push(row(b + beat, 42, .1, velocity)));
    if (pattern % 2 === 0) drums['open-hat'].push(row(b + 2.89, 46, .21, .54));
    const groove = [
      [[.026,0,.87,.82],[1.59,7,.24,.48],[2.84,0,.53,.71],[3.55,3,.24,.56]],
      [[.21,0,.95,.76],[1.74,3,.31,.62],[2.53,0,.28,.58],[3.56,7,.26,.66]],
      [[.033,0,1.42,.86],[2.55,0,.48,.72],[3.47,-2,.30,.69]],
      [[.49,0,.82,.78],[2.07,0,.47,.74],[3.59,-2,.30,.63]]
    ][pattern];
    groove.forEach(([beat, interval, duration, velocity], index) => {
      bass.push(row(b + beat, root + interval, duration, velocity,
        (pattern === 3 && index !== 0) || (pattern === 1 && index === 3) ? {articulation:'pick'} : undefined));
    });
  }
  for (const notes of Object.values(drums)) notes.sort((a,b) => a.beat - b.beat);
  return {drums, bass};
}

function rhythmLanes({drums, bass}) {
  return {
    kick: {notes: drums.kick, gain: -5, highpass: 28, lowpass: 3300},
    snare: {notes: drums.snare, gain: 3, pan: .04, highpass: 115, send: .14},
    'closed-hat': {notes: drums['closed-hat'], gain: -8, pan: -.26, choke: 'hats', highpass: 640},
    'open-hat': {notes: drums['open-hat'], gain: -9, pan: -.26, choke: 'hats', highpass: 640, send: .08},
    bass: {patch: 'electric-bass', notes: bass, gain: -2, highpass: 38, lowpass: 4100}
  };
}

function studyScores(id, patches) {
  const score = (lanes, bars = 2) => production(patches, lanes, bars);
  if (id === 'breath-and-reed') return [
    ['reed-recorded', score({reed: {patch:'recorded-reed',notes:reedPhrase,highpass:125}})],
    ['reed-modelled', score({reed: {patch:'breathing-reed',notes:reedPhrase,highpass:125}})]
  ];
  if (id === 'struck-and-scraped-metal') return [
    ['metal-recorded', score({strike: {patch:'brake-drum',notes:strikes}})],
    ['metal-modelled', score({plate: {patch:'tuned-metal',notes:strikes}})],
    ['metal-scrapes', score({scrape: {patch:'scraped-metal',notes:scrapes,pan:.25}})]
  ];
  return [['rhythm-study', score(rhythmLanes(pocket(4)), 4)]];
}

function kitPerformance(sampleRate = 32000) {
  const {drums} = pocket(4);
  const events = drumTracks.flatMap(pad => drums[pad].map((note, i) => ({
    id:pad+'-'+i, pad, time:{beat:note.beat}, velocity:note.velocity,
    ...(note.play?.articulation && {articulation:note.play.articulation})
  })));
  return {options:{sampleRate,map:{tempo},duration:16 * 60 / tempo},events};
}

module.exports = {tempo, row, touch, production, reedPhrase, pocket, rhythmLanes, studyScores, kitPerformance};
