const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const gallery = require('./gallery.js');

const [, , target = 'rebirth-review', ...selected] = process.argv;
const output = path.resolve(target);
const cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const scenes = gallery(ink.load());
const edited = { ...scenes.find(entry => entry.file === 'garden'), id: 'garden-rose', controls: { canopy: 'rose' } };
const shots = [...scenes, edited];
if (selected.some(id => !shots.some(shot => id === (shot.id ?? shot.file)))) throw new Error('Choose a scene file stem or garden-rose');

for (const { file, scene, from, view, id = file, controls } of shots) {
  if (selected.length && !selected.includes(id)) continue;
  const folder = path.join(output, id);
  fs.mkdirSync(folder, { recursive: true });
  const camera = Object.entries(view).flatMap(([key, value]) => ['--' + key, String(value)]);
  execFileSync(process.execPath, [
    cli, 'export-scene', path.join(__dirname, file + '.js'),
    '--w', '192', '--h', '120', '--px', '1', '--fps', '8', '--still-scale', '1',
    '--from', String(from), '--to', String(from + 1.25), '--t', String(from),
    '--formats', 'still,loop,replay,embed', '--out', folder, ...camera,
    ...(controls ? ['--params', JSON.stringify(controls)] : [])
  ], { stdio: 'inherit' });
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'export.json'), 'utf8'));
  if (manifest.scene !== scene.id || manifest.sequence.frameCount !== 10) throw new Error('Incomplete export for ' + id);
}
