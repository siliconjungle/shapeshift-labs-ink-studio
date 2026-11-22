/* Run with node examples/native-sound-library/demo.cjs output-directory. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ink = require('../..');
const {catalog, exportSoundPack} = require('../../cli/music-sound-library.js');
const {tempo, row, touch, production, reedPhrase, pocket, rhythmLanes, studyScores} = require('./performances.cjs');
const {KIT} = ink.load();
const music = KIT.music.production;
const audio = KIT.procedural.mediaGraph;

const output = path.resolve(process.argv[2] ?? 'native-sound-library');
const rate = 32000;
fs.mkdirSync(output, {recursive: true});
const file = name => path.join(output, name);
const json = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const wav = (name, value) => fs.writeFileSync(file(name), ink.encodeWav(value, {encoding: 'pcm24'}));

const packs = catalog.map(({id}) => ink.loadSoundPack(id));
const [reed, metal, rhythm] = packs;
const patches = Object.assign({}, ...packs.map(pack => pack.patches));
const assets = Object.assign({}, ...packs.map(pack => pack.assets));
const paths = {};
for (const {id} of catalog) {
  const folder = 'packs/' + id;
  const saved = JSON.parse(fs.readFileSync(exportSoundPack(id, file(folder)), 'utf8'));
  for (const [name, relative] of Object.entries(saved.assets)) paths[name] = folder + '/' + relative;
}
const results = {};
function printGroup(entries, bank, target = -20) {
  const options = {sampleRate: rate, tail: 1.1};
  const rendered = entries.map(([id, score]) => {
    const {value} = music.render(score, bank, options);
    const meter = audio.mixerMonitor.meter(value);
    assert.ok(Number.isFinite(meter.integratedLufs) && Number.isFinite(meter.truePeakDbTP), id + ' must produce audible audio');
    return {id, score, value, meter};
  });
  const sharedTarget = Math.min(target, ...rendered.map(({meter}) => meter.integratedLufs - 1.3 - meter.truePeakDbTP));
  const references = Object.fromEntries(Object.keys(bank).map(name => [name, paths[name]]));
  for (const {id, score, meter} of rendered) {
    let settings = {...score, gain: score.gain + sharedTarget - meter.integratedLufs};
    let {value} = music.render(settings, bank, options);
    let measured = audio.mixerMonitor.meter(value);
    // A post-gain measurement catches quiet passages entering the loudness gate.
    const correction = Math.min(sharedTarget - measured.integratedLufs, -1.3 - measured.truePeakDbTP);
    if (Math.abs(correction) > .06) {
      settings = {...settings, gain: settings.gain + correction};
      ({value} = music.render(settings, bank, options));
      measured = audio.mixerMonitor.meter(value);
    }
    wav(id + '.wav', value);
    json(id + '.json', {production: settings, assets: references, options});
    results[id] = {...measured, gainDb: settings.gain - score.gain};
  }
  if (entries.length > 1) {
    const levels = entries.map(([id]) => results[id].integratedLufs);
    assert.ok(Math.max(...levels) - Math.min(...levels) < .15, 'Comparison prints must match in loudness');
  }
  return rendered[0].value;
}

const lead = (patch, notes) => ({patch, notes, highpass: 125});
const recorded = printGroup(studyScores(reed.entry.id, reed.patches), reed.assets);
const metalStudies = studyScores(metal.entry.id, metal.patches);
const struck = printGroup(metalStudies.slice(0, 2), metal.assets, -24.5);
printGroup(metalStudies.slice(2), metal.assets);
const rhythmStudies = studyScores(rhythm.entry.id, rhythm.patches);
const drums = printGroup(rhythmStudies.slice(0, 1), rhythm.assets);
for (const solo of rhythmStudies.slice(1)) printGroup([solo], rhythm.assets);

function rackDemo(id, pack, value) {
  const rendered = audio.audioRack.audition(pack.rack, {main:value}, undefined,
    {sampleRate:rate, map:{tempo}, targetLufs:-20, ceilingDbTP:-1.2, tail:'cut'});
  wav(id + '-rack.wav', rendered.value);
  wav(id + '-bypass.wav', rendered.bypass);
}
rackDemo('reed', reed, recorded);
rackDemo('metal', metal, struck);
rackDemo('rhythm', rhythm, drums);

const cuePocket = rhythmLanes(pocket(10, 1));
const leadLine = [
  ...reedPhrase.slice(0, 4),
  row(7.84, 64, .83, .57), row(9.16, 62, .33, .50), row(9.68, 59, 1.82, .54),
  row(14.41, 64, .42, .55), row(15.13, 67, .44, .66), row(15.62, 69, 1.35, .70,
    touch([[0,.28],[.56,.97],[1,.37]], [[0,.39],[.56,.69],[1,.43]], [[0,-13],[.35,1],[1,-8]])),
  row(18.2, 71, .39, .62), row(18.79, 72, .97, .69, {articulation:'vib'}),
  row(20.58, 67, 1.31, .58), row(24.52, 62, .71, .42), row(25.79, 64, 1.18, .44,
    touch([[0,.13],[.64,.74],[1,.24]], [[0,.3],[1,.24]], [[0,-23],[.55,1],[1,-11]])),
  row(31.53, 64, .31, .49), row(32.25, 67, .47, .64), row(32.77, 69, .68, .73),
  row(34.06, 74, .37, .58), row(34.58, 72, .9, .7, {articulation:'vib'}),
  row(36.13, 67, .43, .66), row(36.78, 69, .51, .62), row(37.51, 67, .54, .53),
  row(39.12, 64, 1.41, .63, touch([[0,.55],[.51,.83],[1,.12]], [[0,.51],[.51,.67],[1,.18]],
    [[0,-22],[.39,2],[1,-32]], {articulation:'vib'})),
  row(42.53, 59, .38, .39), row(44.38, 64, 1.43, .36, {articulation:'soft'})
];
for (const lane of Object.values(cuePocket)) {
  lane.notes = lane.notes.filter(note => !(note.beat >= 24 && note.beat < 28) && note.beat < 44);
}
cuePocket.bass.notes.push(row(44.64, 28, 1.12, .56));
const score = production(patches, {
  reed: {...lead('breathing-reed', leadLine), gain: 1, pan: -.09, send: .26},
  ...cuePocket,
  plate: {patch:'tuned-metal',pan:.32,gain:2.5,send:.44,notes:[
    row(2.95,52,.34,.58,{contact:.23}), row(6.19,55,.37,.71),
    row(10.53,59,.23,.53,{damping:.49}), row(13.1,52,.51,.67),
    row(18.18,60,.92,.60), row(21.89,55,.33,.72,{contact:.38}),
    row(25.12,52,.45,.37), row(28.24,52,.45,.72,{contact:.21}),
    row(30.54,59,.36,.69), row(33.74,64,.61,.64), row(36.55,62,.36,.57),
    row(38.28,55,.37,.64), row(40.82,52,.53,.84), row(45.93,52,.75,.45)
  ]},
  scrape: {patch:'scraped-metal',pan:-.37,gain:-7,send:.29,notes:[
    row(0,48,.24,.52,{articulation:'bells'}), row(10.94,48,.42,.56),
    row(22.18,48,.77,.65,{articulation:'gong'}), row(27.04,48,.43,.71),
    row(39.08,48,.48,.62,{articulation:'bells'})
  ]}
}, 12, {gain:-5,sections:[
  {id:'call',bars:3,harmony:'home'}, {id:'pocket',bars:3,harmony:'home'},
  {id:'break',bars:2,harmony:'home'}, {id:'return',bars:4,harmony:'home'}
]});
printGroup([['night-shift', score]], assets, -16.5);
json('report.json', {sampleRate:rate, sampleCount:Object.keys(assets).length, prints:results});
fs.copyFileSync(path.join(__dirname, 'index.html'), file('index.html'));
process.stdout.write(output + '\n');
