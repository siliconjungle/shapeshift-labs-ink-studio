const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('reel renders a project scene and a manifest-relative animated scene into an offline clean view', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-reel-test-'));
  t.after(() => fs.rmSync(project, { force: true, recursive: true }));
  const scene = `({ makeBuilder }) => ({
    id: 'dot', name: 'Dot', seed: 3,
    build(seed) {
      const B = makeBuilder(seed);
      B.iso(0, .5, 0, .25, B.P[4], 2.5);
      return B.finish({ cam: { target: [0,.5,0], dist: 3, pitch: .18, yaw: .3 }, background: [8,9,12] });
    }
  })`;
  fs.writeFileSync(path.join(project, 'dot.js'), 'module.exports = ' + scene);
  fs.writeFileSync(path.join(project, 'ink-studio.config.js'), `
    const studio = require(${JSON.stringify(path.resolve(__dirname, '..'))});
    module.exports = { load() {
      const kit = studio.load();
      return { ...kit, SCENES: [require('./dot.js')(kit)] };
    } };
  `);
  fs.mkdirSync(path.join(project, 'edit'));
  const manifest = path.join(project, 'edit', 'share.json'), file = path.join(project, 'reel.html');
  const spec = { title: 'Craft & light', width: 96, height: 64, fps: 8, shots: [
    { scene: 'dot', label: 'Still', from: .2, hold: .5 },
    { scene: '../dot.js', label: '</script><script>throw "bad"</script>', to: .4, camera: { orbit: 30 } }
  ] };
  fs.writeFileSync(manifest, JSON.stringify(spec));
  execFileSync(process.execPath, [cli, 'reel', manifest, '--out', file, '--clean'], { cwd: project });
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<title>Craft &amp; light<\/title>/);
  assert.match(html, /<nav id="controls" aria-label="Reel controls" hidden>/);
  assert(!html.includes(spec.shots[1].label));
  assert(!html.includes(project));
  assert(!/<(?:img|script)[^>]+src=/.test(html));
  const clips = JSON.parse(html.match(/<script id="reel" type="application\/json">(.*?)<\/script>/)[1]);
  assert.deepEqual(clips.map(row => [row.label, row.seconds]), [['Still', .5], [spec.shots[1].label, .375]]);
  const motion = Buffer.from(clips[1].animation, 'base64'), poster = PNG.raster(Buffer.from(clips[1].poster, 'base64'));
  assert.equal(motion.readUInt32BE(motion.indexOf('acTL') + 4), 3);
  assert.deepEqual([poster.w, poster.h], [96, 64]);
  assert.deepEqual(poster.data, PNG.raster(motion).data);

  spec.shots[1].scene = 'missing';
  fs.writeFileSync(manifest, JSON.stringify(spec));
  const failure = spawnSync(process.execPath, [cli, 'reel', manifest, '--out', file], { cwd: project, encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Reel shot 2.*no diorama called "missing"/);
  assert.equal(fs.readFileSync(file, 'utf8'), html);
});
