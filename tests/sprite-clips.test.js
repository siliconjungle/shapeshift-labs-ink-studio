const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { schedule } = require('../cli/sprite-clips.js');
const { writeAtlas } = require('../cli/sprite-atlas.js');
const { KIT, makeBuilder } = ink.load();

const clips = [
  { id: 'drill', range: [0.3, 0.72], fps: 5 },
  { id: 'call', playback: 'once', cels: [{ at: .6, duration: .12 }, { at: .3, duration: .4 }] }
];

test('sprite clips sample a range and keep explicit holds and backwards seeks', () => {
  const { samples, tracks } = schedule(clips, 12);
  assert.deepEqual(samples.map(s => s.sourceTime), [.3, .5, .7, .6, .3]);
  assert.deepEqual(samples.map(s => s.reset), [true, false, false, true, true]);
  assert.deepEqual(tracks.map(c => c.frames), [[0, 1, 2], [3, 4]]);
  assert(Math.abs(samples[2].duration - .02) < 1e-12);
  assert.equal(samples[4].duration, .4);
  assert.throws(() => schedule([clips[0], clips[0]], 12), /unique/);
  assert.throws(() => schedule([{ id: 'empty', cels: [] }], 12), /nonempty/);
  assert.throws(() => schedule([{ id: 'hold', cels: [{ at: 0, duration: 0 }] }], 12), /exposure/);
  assert.throws(() => schedule([{ id: 'long', range: [0, 600] }], 12), /512/);
});

test('clip atlases bake registered directions from source time, round trip and play by name', t => {
  const B = makeBuilder(7, [0x111822, 0xcc5521]);
  B.iso(.12, 0, 0, .19, B.P[1], 2, { em:true });
  const world = B.finish({ cam: { target: [0,0,0], yaw: 0, pitch: 0, dist: 3 }, radius: 4, dither: 0 });
  world.anim = {};
  const poses = [];
  const options = { width:24, height:24, directions:2, maps:['normal','silhouette'],
    normalSpace:'view', clips, pose(asset, time) {
      poses.push(time);
      asset.data[1] = time;
      asset.cam.dist = 10 * time + 1;
      asset.anim.zoom = 4 - time;
      asset.anim.kick = [0, 1, 0];
    } };
  const output = ink.spriteAtlas(world, options);
  const { metadata, images } = output;
  assert.deepEqual(poses, [.3, .5, .7, .6, .3]);
  assert.deepEqual(metadata.clips.map(c => c.frames), [[0, 1, 2], [3, 4]]);
  assert(metadata.frames.every(f => f.unitsPerPixel === metadata.frames[0].unitsPerPixel &&
    f.depthOrigin === metadata.frames[0].depthOrigin && f.pivot.x === 12 && f.pivot.y === 12));
  const tile = ({ x, y, width, height }) => Array.from({ length: height }, (_, row) => {
    const p = ((row + y) * metadata.width + x) * 4;
    return images.color.slice(p, p + width * 4);
  });
  assert.deepEqual(tile(metadata.frames[0].rect), tile(metadata.frames[8].rect));
  assert.notDeepEqual(tile(metadata.frames[0].rect), tile(metadata.frames[2].rect));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sprite-clips-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  writeAtlas(dir, output);
  const atlas = ink.readSpriteAtlas(dir);
  assert.deepEqual(atlas.snapshot().metadata.clips, metadata.clips);
  const drill = atlas.playback({ clip:'drill' }), call = atlas.playback({ clip:'call' });
  assert.deepEqual([drill(0), drill(.2), drill(.41), drill(.42)], [0, 1, 2, 0]);
  assert.deepEqual([call(-1), call(.12), call(4)], [3, 4, 4]);
  assert.equal(KIT.sprite.placeAtlas({ atlas, at:[0,0,0], playback:{ clip:'call', mode:'loop' } }).frameAt(.52), 3);
  assert.equal(atlas.select(call(.15), 'impostor', [0,0,-1]).direction, 1);
  assert.throws(() => atlas.playback({ clip:'missing' }), /Unknown/);
  assert.throws(() => ink.spriteAtlas(world, { ...options, times:[0] }), /own timing/);
  world.anim.stateful = true;
  assert.throws(() => ink.spriteAtlas(world, options), /seekable/);
});
