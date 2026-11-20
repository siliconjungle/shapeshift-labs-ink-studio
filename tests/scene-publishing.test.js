const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const studio = require('..');
const PNG = require('../cli/png.js');

const cli = path.join(__dirname, '../cli/ink-studio.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function folder(t) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-publishing-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  return out;
}

function chunks(bytes) {
  const result = {};
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    (result[type] ??= []).push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return result;
}

function capture({ width, height, moving }) {
  let previous = -Infinity;
  return { scene: 'relay', title: 'Relay', sample(time) {
    assert(time >= previous);
    previous = time;
    return { w: width, h: height, rgb: new Uint8Array(width * height * 3).fill(time * 100),
      alpha: new Uint8Array(width * height).fill(moving ? 160 : 255) };
  } };
}

test('one publication shares compressed frame bytes across PNG sequence, APNG, recording and embed', t => {
  const out = folder(t), settings = { title: 'Relay </script> & "glow"', accent: '#efbe76', autoplay: true, fit: 'cover' };
  const { file, manifest } = studio.exportScene(capture, { out, width: 11, height: 7, from: 1, to: 1.6, fps: 4,
    stillTime: .25, stillScale: 3, embed: settings });
  assert.deepEqual(json(file), manifest);
  const { still, loop, replay, embed, sequence } = manifest;
  assert.deepEqual([still.width, still.height, still.time], [33, 21, .25]);
  assert.deepEqual([PNG.raster(path.join(out, still.file)).w, PNG.raster(path.join(out, still.file)).h], [33, 21]);
  assert.deepEqual(sequence, { width: 11, height: 7, start: 1, fps: 4, frameCount: 3, duration: .75 });
  assert.deepEqual(loop.frames.map(frame => frame.time), [1, 1.25, 1.5]);
  const recording = studio.readSceneReplay(path.join(out, replay));
  const sequencePngs = loop.frames.map(frame => fs.readFileSync(path.join(out, frame.file)));
  assert.deepEqual(recording.frames.map(base64 => Buffer.from(base64, 'base64')), sequencePngs);
  assert.equal(PNG.raster(sequencePngs[1]).data[3], 160);
  const apng = chunks(fs.readFileSync(path.join(out, loop.file)));
  assert.deepEqual(apng.acTL.map(data => [data.readUInt32BE(0), data.readUInt32BE(4)]), [[3, 0]]);
  assert.deepEqual(apng.fcTL.map(data => [data.readUInt16BE(20), data.readUInt16BE(22)]), [[1, 4], [1, 4], [1, 4]]);
  assert.deepEqual([apng.IDAT[0], ...apng.fdAT.map(data => data.subarray(4))],
    sequencePngs.map(data => chunks(data).IDAT[0]));
  const sample = studio.sampleSceneReplay(recording, .25);
  assert.deepEqual([sample.index, sample.time, sample.png], [1, 1.25, sequencePngs[1]]);
  assert.equal(studio.sampleSceneReplay(recording, .75).index, 2);
  assert.equal(studio.sampleSceneReplay(recording, .75, { loop: true }).index, 0);
  const html = fs.readFileSync(path.join(out, embed), 'utf8');
  const data = html.match(/<script id="ink-scene-recording" type="application\/json">(.*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(data), { fps: 4, frames: recording.frames });
  assert.match(html, /<title>Relay &lt;\/script&gt; &amp; &quot;glow&quot;<\/title>/);
  assert.match(html, /--scene-accent: #efbe76/);
});

test('selected formats skip unused captures and a failed publish preserves the previous manifest', t => {
  const out = folder(t), kinds = [];
  const original = studio.exportScene(spec => {
    kinds.push(spec.moving);
    return capture(spec);
  }, { out, formats: ['still'], width: 13, height: 9 });
  assert.deepEqual(kinds, [false]);
  assert.equal(original.manifest.sequence, undefined);
  const before = fs.readFileSync(original.file);
  assert.throws(() => studio.exportScene(spec => {
    if (!spec.moving) throw new Error('interrupted still');
    return capture(spec);
  }, { out, width: 10, height: 8, to: .2 }), /interrupted still/);
  assert.deepEqual(fs.readFileSync(original.file), before);
  assert.equal(fs.readdirSync(out).filter(file => file.startsWith('take-')).length, 1);
  assert.throws(() => studio.exportScene(capture, { out, width: 32, height: 24, to: 90 }), /sequence budget/);
});

test('CLI publishes a common scene and replays it after the scene source is removed', t => {
  const out = folder(t), scene = path.join(out, 'scene.js');
  fs.writeFileSync(scene, `module.exports = ({ makeBuilder }) => ({
    id: 'portable', name: 'Portable scene', seed: 1, build(seed) {
      const b = makeBuilder(seed, [0x111c24, 0x78c6a9]);
      b.disc(.7, 0, 0, [0, 0, 1], .4, .03, b.P[1], 2);
      return b.finish({ cam: { target: [0,0,0], dist: 4, yaw: 0, pitch: 0 }, radius: 2 });
    }
  });`);
  run('export-scene', scene, '--w', '75', '--h', '43', '--px', '3', '--from', '1', '--to', '1.5', '--fps', '4',
    '--t', '.1', '--camera-orbit', '30', '--transparent', '--out', out);
  const publication = json(path.join(out, 'export.json')), recording = path.join(out, publication.replay);
  const sequence = publication.loop.frames.map(frame => fs.readFileSync(path.join(out, frame.file)));
  assert.deepEqual(sequence.map(bytes => [PNG.raster(bytes).w, PNG.raster(bytes).h]), [[75, 43], [75, 43]]);
  assert.notDeepEqual(sequence[0], sequence[1]);
  fs.rmSync(scene);
  const replay = path.join(out, 'replay.png'), embed = path.join(out, 'clean.html'), config = path.join(out, 'style.json');
  fs.writeFileSync(config, JSON.stringify({ controls: false, autoplay: true, loop: false, background: 'transparent' }));
  run('scene-replay', recording, '--at', '.25', '--out', replay);
  run('scene-replay', recording, '--embed', '--out', embed, '--embed-config', config);
  assert.deepEqual(fs.readFileSync(replay), sequence[1]);
  const markup = fs.readFileSync(embed, 'utf8');
  assert.doesNotMatch(markup, /<nav/);
  assert.match(markup, /--scene-background: transparent/);
});

test('offline embed seeks, pauses and plays under native browser controls',
  { skip: !process.env.INK_TEST_CHROME }, t => {
    const out = folder(t), publication = studio.exportScene(capture, { out, formats: ['replay', 'embed'],
      width: 20, height: 12, from: .25, to: 1, fps: 4 });
    const { replay, embed } = publication.manifest, file = path.join(out, embed);
    const expected = json(path.join(out, replay)).frames;
    const probe = `<script>
      const button = document.querySelector('button'), slider = document.querySelector('input');
      const image = document.querySelector('img'), data = ${JSON.stringify(expected)};
      const first = image.src.endsWith(data[0]) && window.inkScene.paused;
      button.click();
      const started = !window.inkScene.paused && button.textContent === 'Pause';
      slider.value = 1;
      slider.dispatchEvent(new Event('input'));
      const sought = window.inkScene.paused && window.inkScene.currentTime === .25 && image.src.endsWith(data[1]);
      window.inkScene.seek(99);
      document.body.dataset.playback = first && started && sought && image.src.endsWith(data[2]) ? 'verified' : 'failed';
    </script>`;
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</body>', probe + '</body>'));
    const output = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
      '--user-data-dir=' + path.join(out, 'chrome'), '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8' });
    assert.match(output, /data-playback="verified"/);
  });
