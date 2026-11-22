const fs = require('node:fs');
const path = require('node:path');
const WAV = require('./wav.js');
const {expressiveReed, expressivePlate} = require('./music-expressive-patches.js');
const {studyScores, kitPerformance} = require('../examples/native-sound-library/performances.cjs');

const root = path.resolve(__dirname, '../examples/native-sound-library');
const recordings = require('../examples/native-sound-library/recordings.json');
const rackRoot = path.resolve(__dirname, '../examples/audio-racks');
const recordingCredits = {
  vcsl: {
    credit: 'Versilian Studios, Versilian Community Sample Library',
    license: 'CC0-1.0',
    source: 'https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'
  },
  'ink-vcsl': {
    credit: 'Versilian Studios, edited for Ink Studio',
    license: 'CC0-1.0',
    source: 'https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'
  },
  amalialloren: {
    credit: 'Amalialloren, Glissando ascendent de l’harmònica',
    license: 'CC0-1.0',
    source: 'https://commons.wikimedia.org/wiki/File:Glissando_ascendent_de_l%27harm%C3%B2nica.wav'
  },
  mastermesh: {
    credit: 'mastermesh, Harmonica',
    license: 'LicenseRef-Public-Domain-Author',
    source: 'https://commons.wikimedia.org/wiki/File:Harmonica.ogg'
  },
  virtuosity: {
    credit: 'Versilian Studios and Karoryfer Samples, Virtuosity Drums, played by Austin McMahon',
    license: 'CC0-1.0',
    source: 'https://github.com/sfzinstruments/virtuosity_drums/tree/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc'
  },
  freepats: {
    credit: 'Andrea Biasior, Bass Guitar YR for FreePats',
    license: 'CC0-1.0',
    source: 'https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html'
  }
};

const catalog = Object.freeze([
  {
    id: 'breath-and-reed',
    title: 'Breath & Reed',
    description: 'A close-recorded harmonica with soft, normal and vibrato takes and paired key-up recordings.',
    patches: ['recorded-reed', 'breathing-reed', 'expressive-reed'],
    rack: 'porcelain-room'
  },
  {
    id: 'struck-and-scraped-metal',
    title: 'Struck & Scraped Metal',
    description: 'Brake drums, gong, cymbal and bell-tree scrapes, plus a playable modal metal voice.',
    patches: ['brake-drum', 'scraped-metal', 'tuned-metal', 'expressive-plate'],
    rack: 'pocket-repeater'
  },
  {
    id: 'drums-and-bass',
    title: 'Drums & Bass',
    description: 'A two-dynamic acoustic kick, snare and choking hats with fingered and picked electric bass.',
    patches: ['kick', 'snare', 'closed-hat', 'open-hat', 'electric-bass'],
    rack: 'steel-bus',
    kit: 'yard-kit'
  }
].map(entry => Object.freeze({...entry, patches: Object.freeze(entry.patches)})));

const sample = zones => ({type: 'sample', zones});
const hit = (samples, settings = {}) => ({samples, ...settings});
const gain = (input, amount) => ({type: 'gain', input, amount});
const mix = (...inputs) => ({type: 'mix', inputs});
const filter = (input, mode, cutoff, resonance) => ({type: 'filter', input, mode, cutoff, resonance});

function pitchedZones(names, [first, last], settings) {
  const rows = names.map(id => ({id, ...recordings[id]}));
  const bounds = rows.slice(1).map((row, index) => Math.floor((row.root + rows[index].root) / 2));
  return rows.map(({id, root, tune, loop, loopFade}, index) => ({
    samples: [id], root, low: bounds[index - 1] === undefined ? first : bounds[index - 1] + 1,
    high: bounds[index] ?? last,
    ...(tune !== undefined && {tune}), ...(loop && {loop, loopFade}), ...settings
  }));
}

function reed(modelled) {
  const instruments = Object.fromEntries(['soft', 'normal', 'vib'].map(color => {
    const names = ['c4', 'e4', 'g4', 'c5', 'e5'].map(note => 'reed-' + color + '-' + note);
    const tape = {
      ...sample(pitchedZones(names, [57, 79], {oneShot: false})),
      env: {attack: .008, decay: .12, sustain: 1, release: .11}
    };
    const release = sample(pitchedZones(names.map(id => id + '-off'), [57, 79]));
    const nodes = {tape, release};
    if (modelled) Object.assign(nodes, {
      cover: filter('tape', 'lowpass', {base: 1040, by: {breath: 2550, pressure: 1450}}, .78),
      air: {type: 'noise'},
      mouth: filter('air', 'bandpass', {base: 890, by: {breath: 2700, contact: 870}}, 1.35),
      shape: {type: 'envelope', env: {attack: .057, decay: .14, sustain: .84, release: .14}},
      heldAir: gain('mouth', {base: 0, from: {shape: .24}}),
      flow: gain('heldAir', {base: .02, by: {breath: .8, pressure: .12}}),
      bore: {type: 'resonator', input: 'flow', decay: .19, modes: [
        {ratio: 1, gain: .38, shape: 1},
        {ratio: 2, gain: .27, shape: 2, decay: .76},
        {ratio: 3, gain: .24, shape: 3, decay: .46}
      ]},
      airMix: mix('flow', 'bore'),
      color: gain('airMix', .39),
      voice: mix('cover', 'color')
    });
    return [color, {type: 'graph', tail: .21, output: modelled ? 'voice' : 'tape',
      controls: {breath: .42, pressure: .44, contact: .28}, nodes,
      articulations: {'key-up': {output: 'release', tail: .30}}}];
  }));
  return {type: 'zoned', instruments, zones: [
    {instrument: 'soft', low: 57, high: 79, velocity: [0, .53]},
    {instrument: 'normal', low: 57, high: 79, velocity: [.53, 1]},
    ...Object.keys(instruments).map(instrument => ({instrument, low: 57, high: 79,
      velocity: [0, 1], articulation: instrument}))
  ], performance: {connect: {gap: .028, interval: 5, fade: .023}, repeatGap: .09,
    rules: [{when: 'release', articulation: 'key-up', level: .86}]}};
}

const drumLayers = {
  kick: {
    soft: ['rhythm-kick-soft-a', 'rhythm-kick-soft-b'],
    hard: ['rhythm-kick-hard-a', 'rhythm-kick-hard-b']
  },
  snare: {soft: ['snare-ghost'], hard: ['snare-main', 'snare-alt'], rim: ['snare-rim']},
  'closed-hat': {hard: ['hat-closed', 'hat-closed-alt']},
  'open-hat': {hard: ['hat-open']}
};
const iron = {soft: ['metal-iron-soft-a', 'metal-iron-soft-b'], hard: ['metal-iron-hard-a', 'metal-iron-hard-b']};

function strike({soft, hard, rim}) {
  return sample([
    ...(soft ? [hit(soft, {velocity: [0, .5]}), hit(hard, {velocity: [.5, 1]})] : [hit(hard)]),
    ...(rim ? [hit(rim, {articulation: 'rim'})] : [])
  ]);
}

function tunedMetal() {
  return {type: 'graph', tail: 1.35, output: 'plate', controls: {contact: .26, damping: .15}, nodes: {
    strike: strike(iron),
    impulseWindow: {type: 'curve', clock: 'seconds', points: [[0, 1], [.024, .8], [.063, 0]]},
    hammer: gain('strike', {base: 0, from: {impulseWindow: 1}}),
    ring: {type: 'resonator', input: 'hammer', decay: {base: 1.29, by: {damping: -1.17}}, modes: [
      {ratio: 1, gain: 1.2, shape: 1},
      {ratio: 1.501, gain: .33, shape: 2, decay: .72},
      {ratio: 2.121, gain: .66, shape: 3, decay: .48},
      {ratio: 3.17, gain: .42, shape: 4, decay: .3},
      {ratio: 4.631, gain: .32, shape: 5, decay: .23}
    ]},
    impact: gain('hammer', .37),
    body: gain('ring', 2.15),
    plate: mix('impact', 'body')
  }};
}

function electricBass() {
  const notes = [28, 31, 33, 35, 36, 39];
  return {type: 'sample', env: {attack: .004, decay: .25, sustain: .95, release: .087}, zones: [
    ...pitchedZones(notes.map(note => 'bass-finger-' + note), [26, 44], {oneShot: false}),
    ...pitchedZones(notes.map(note => 'bass-pick-' + note), [26, 44], {oneShot: false, articulation: 'pick'})
  ]};
}

function rhythmKit() {
  const takes = samples => samples.map(asset => ({asset}));
  const layer = (id, samples, velocity) => ({id, takes: takes(samples), ...(velocity && {velocity})});
  const pads = Object.fromEntries(Object.entries(drumLayers).map(([name, {soft, hard, rim}], index) => {
    const note = [36, 38, 42, 46][index];
    const tuning = [{gain: -4}, {gain: 0, pan: .08}, {gain: -8, pan: -.22}, {gain: -9, pan: -.22}][index];
    return [name, {notes: [note, note], ...tuning, ...(index >= 2 && {choke: 'hats'}), articulations: {
      default: soft ? [layer('soft', soft, [0, 0, .38, .72]), layer('hard', hard, [.38, .72, 1, 1])] :
        [layer('hit', hard)],
      ...(rim && {rim: [layer('rim', rim)]})
    }}];
  }));
  return {id: 'yard-kit', pads};
}

const patchesFor = {
  'breath-and-reed': () => {
    const roots=['c4','e4','g4','c5','e5'].map(note=>'reed-normal-'+note);
    return {'recorded-reed':reed(false),'breathing-reed':reed(true),'expressive-reed':expressiveReed(
      pitchedZones(roots,[57,79],{oneShot:false}),pitchedZones(roots.map(name=>name+'-off'),[57,79]))};
  },
  'struck-and-scraped-metal': () => ({
    'brake-drum': strike(iron),
    'scraped-metal': sample([
      hit(['metal-cymbal-drag-a', 'metal-cymbal-drag-b']),
      hit(['metal-gong-drag'], {articulation: 'gong'}),
      hit(['metal-bells-drag-a', 'metal-bells-drag-b'], {articulation: 'bells'})
    ]),
    'tuned-metal': tunedMetal(),
    'expressive-plate': expressivePlate()
  }),
  'drums-and-bass': () => ({
    ...Object.fromEntries(Object.entries(drumLayers).map(([name, layers]) => [name, strike(layers)])),
    'electric-bass': electricBass()
  })
};

function describe(id) {
  const entry = catalog.find(item => item.id === id);
  if (!entry) throw new RangeError('Unknown sound pack. Choose ' + catalog.map(item => item.id).join(', '));
  const patches = patchesFor[id]();
  const wanted = Object.keys(recordings).filter(name => {
    if (id === 'breath-and-reed') return name.startsWith('reed-');
    if (id === 'struck-and-scraped-metal') return name.startsWith('metal-');
    return name.startsWith('bass-') || Object.values(drumLayers).some(row => Object.values(row).flat().includes(name));
  });
  const sources = Object.fromEntries(wanted.map(name => {
    const {file, source, original, sourceRange} = recordings[name];
    return [name, {file: path.resolve(root, file), credit: source, ...(original && {original}), ...(sourceRange && {sourceRange})}];
  }));
  const credits = Object.fromEntries([...new Set(Object.values(sources).map(row => row.credit))]
    .map(name => [name, {...recordingCredits[name]}]));
  return {entry, patches, sources, credits, ...(entry.kit && {kit: rhythmKit()})};
}

function loadSoundPack(id) {
  const {entry, patches, sources, credits, kit} = describe(id);
  const assets = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, WAV.read(source.file)]));
  const rack = JSON.parse(fs.readFileSync(path.join(rackRoot, entry.rack + '.json'), 'utf8'));
  return {entry, patches, assets, rack, credits, ...(kit && {kit})};
}

function exportSoundPack(id, directory) {
  const {entry, patches, sources, credits, kit} = describe(id);
  const folder = path.resolve(directory);
  const write = (name, data) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data, null, 2) + '\n');
  fs.mkdirSync(path.join(folder, 'assets'), {recursive: true});
  const assets = {}, provenance = {};
  for (const [name, {file, ...credit}] of Object.entries(sources)) {
    const relative = 'assets/' + name + '.wav';
    fs.copyFileSync(file, path.join(folder, relative));
    assets[name] = relative;
    provenance[name] = credit;
  }
  fs.copyFileSync(path.join(rackRoot, entry.rack + '.json'), path.join(folder, 'rack.json'));
  fs.mkdirSync(path.join(folder, 'phrases'), {recursive: true});
  const phraseAssets = Object.fromEntries(Object.entries(assets).map(([name, file]) => [name, '../' + file]));
  const phrases = studyScores(id, patches).map(([name, production]) => {
    const file = 'phrases/' + name + '.json';
    write(file, {production, assets: phraseAssets, options: {sampleRate: 32000, tail: 1.1}});
    return {id: name, file};
  });
  write('pack.json', {format: 'ink-studio/native-sound-pack', version: 1, id, title: entry.title,
    description: entry.description, patches, assets, rack: 'rack.json',
    credits, provenance, phrases, ...(kit && {kit: 'kit.json', kitPerformance: 'kit-performance.json'})});
  if (kit) {
    const names = new Set(Object.values(drumLayers).flatMap(row => Object.values(row).flat()));
    write('kit.json', {kit, assets: Object.fromEntries(Object.entries(assets).filter(([name]) => names.has(name)))});
    write('kit-performance.json', kitPerformance());
  }
  return path.join(folder, 'pack.json');
}

module.exports = {catalog, loadSoundPack, exportSoundPack};
