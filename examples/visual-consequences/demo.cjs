const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(process.env.INK_STUDIO_REPO ?? path.join(__dirname, '../..'));
const out = path.resolve(process.argv[2] ?? './clay-crossing-review');
const cli = path.join(repo, 'cli/ink-studio.js');
const PNG = require(path.join(repo, 'cli/png.js'));
const file = name => path.join(out, name);
fs.mkdirSync(out, { recursive: true });

function command(...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
}
function json(name) {
  return JSON.parse(fs.readFileSync(file(name), 'utf8'));
}
function render(source, name, ...options) {
  command('sim', 'render', source, ...options, '--colored', '--w', '640', '--h', '400', '--out', name + '.png');
}
function sheet(names, columns, destination) {
  const images = names.map(name => PNG.raster(file(name + '.png'))), { w, h } = images[0], gap = 8;
  const width = columns * (w + gap) - gap, height = Math.ceil(images.length / columns) * (h + gap) - gap;
  const rgb = Buffer.alloc(width * height * 3, 16);
  for (const [i, image] of images.entries()) {
    assert.deepEqual([image.w, image.h, image.max], [w, h, 255]);
    const ox = (i % columns) * (w + gap), oy = Math.floor(i / columns) * (h + gap);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4, dst = ((oy + y) * width + ox + x) * 3;
      for (let channel = 0; channel < 3; channel++) rgb[dst + channel] = image.data[src + channel];
    }
  }
  PNG.write(file(destination), width, height, rgb);
}

const world = 'clay-crossing.world.json';
for (const name of [world, 'repair.actions.json', 'cleaning.actions.json']) {
  const source = path.join(__dirname, name);
  if (source !== file(name)) fs.copyFileSync(source, file(name));
}
command('sim', 'run', world, '--ticks', '8', '--record', 'early.run.json', '--checkpoint', 'decision.json');
for (const [branch, actions] of [['damaged'], ['repaired', 'repair.actions.json'], ['resurfaced', 'cleaning.actions.json']]) {
  command('sim', 'fork', 'decision.json', '--branch', branch, ...(actions ? ['--actions', actions] : []),
    '--ticks', '620', '--record', branch + '.run.json', '--checkpoint', branch + '.checkpoint.json');
}

render('early.run.json', '01-before', '--ticks', '0');
render('early.run.json', '02-first-visit', '--ticks', '7');
render('repaired.run.json', '03-new-join', '--ticks', '13');
render('repaired.checkpoint.json', '04-reopened', '--recipe', 'reopened.shot.json');
sheet(['01-before', '02-first-visit', '03-new-join', '04-reopened'], 2, 'evidence-over-time.png');

render('damaged.checkpoint.json', '05-damaged');
render('resurfaced.checkpoint.json', '06-resurfaced');
sheet(['05-damaged', '04-reopened', '06-resurfaced'], 3, 'branch-comparison.png');

render('repaired.run.json', '07-from-recording');
assert(fs.readFileSync(file('04-reopened.png')).equals(fs.readFileSync(file('07-from-recording.png'))));
const report = json('04-reopened-consequences.json');
const marks = Object.fromEntries(report.active.map(row => [row.id, row]));
assert.deepEqual(Object.keys(marks), ['bridge-patch', 'kiln-char', 'worn-trail']);
assert.equal(marks['bridge-patch'].cause.branch, 'repaired');
assert.equal(marks['kiln-char'].cause.branch, 'main');
assert.equal(marks['worn-trail'].value, 5);
assert(report.active.every(row => row.status === 'painted'));
assert.equal(json('06-resurfaced-consequences.json').active.some(row => row.id === 'kiln-char'), false);
async function traceEvidence() {
  const W = require(repo).load().KIT.world, events = new Map();
  const tapes = [json('early.run.json'), json('repaired.run.json')];
  for (const tape of tapes) {
    await W.storySceneTimeline.scan(tape, event => events.set(event.branch + '/' + event.id, event));
  }
  const log = { format: W.storyEvents.envelopeFormat, version: 1, world: report.world, dt: tapes[0].origin.world.dt, from: 0, to: report.tick,
    coverage: 'complete', dropped: 0, events: [...events.values()] };
  W.storyEvents.readEnvelopes(log);
  fs.writeFileSync(file('recorded-evidence.json'), JSON.stringify(log, null, 2) + '\n');
  for (const [stem, beatId] of [
    ['bridge-cause', marks['bridge-patch'].cause.beatId],
    ['scorch-cause', marks['kiln-char'].cause.beatId],
    ['trail-visit', marks['worn-trail'].change.beatId]
  ]) {
    command('beat', beatId, 'recorded-evidence.json', '04-reopened-consequences.json', '--out', stem + '.json');
    assert.equal(json(stem + '.json').matches.length, 2);
  }
  console.log(out);
}

traceEvidence().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
