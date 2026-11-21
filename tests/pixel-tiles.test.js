const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();

test('fork holds its crest before both branches fire and adjacent unlinked tracks stay idle', () => {
  const wave = K.pixelTiles.create({
    width: 4, height: 3, forkHold: .10,
    paths: [[[0, 1], [2, 1]], [[1, 1], [1, 0]], [[3, 0], [3, 2]]],
    cues: [{ at: [0, 1], time: 1, period: 2 }]
  });
  const frame = (x, y, t) => wave.sample(x, y, t).frame;
  assert.equal(frame(0, 1, .999), 0);
  assert.equal(frame(0, 1, 1), 1);
  assert.equal(frame(1, 1, 1.2), 1);
  assert.equal(frame(1, 1, 1.32), 2);
  assert.equal(frame(1, 1, 1.49), 2);
  assert.equal(frame(1, 0, 1.49), 0);
  assert.equal(frame(2, 1, 1.49), 0);
  assert.equal(frame(1, 1, 1.5), 3);
  assert.equal(frame(1, 0, 1.5), 1);
  assert.equal(frame(2, 1, 1.5), 1);
  assert.equal(wave.sample(1, 0, 1.5).from, 'S');
  assert.equal(wave.sample(2, 1, 1.5).from, 'W');
  assert.equal(wave.sample(3, 1, 1.7).age, null);
  assert.equal(wave.cells.find(cell => cell.x === 1 && cell.y === 1).ports, 'NEW');
  assert.deepEqual(wave.raster(3.49), wave.raster(1.49));
  assert.equal(frame(1, 1, 1.9), 0);
  assert.deepEqual(wave.raster(1.49), wave.raster(3.49));
});

test('rotated and mirrored cels meet on two exact pixels and a held wave stops revisiting a loop', () => {
  for (const style of ['copper', 'frost']) {
    const wave = K.pixelTiles.create({
      width: 3, height: 3, style, after: 'hold',
      paths: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[1, 0], [1, 2]], [[0, 1], [2, 1]]],
      cues: [{ at: [0, 0] }]
    });
    for (const t of [0, .12, .20, .33, .7, 2]) {
      const { w, rgba } = wave.raster(t);
      for (const { x, y, ports } of wave.cells) {
        const alpha = (u, v) => rgba[((y * 10 + v) * w + x * 10 + u) * 4 + 3];
        const edges = [i => alpha(i, 0), i => alpha(9, i), i => alpha(i, 9), i => alpha(0, i)];
        for (const [d, side] of [...'NESW'].entries()) for (let i = 0; i < 10; i++)
          assert.equal(edges[d](i), ports.includes(side) && (i === 4 || i === 5) ? 255 : 0);
      }
    }
    assert.equal(wave.sample(0, 0, 2).age, 2);
    assert.deepEqual(wave.raster(8), wave.raster(2));
  }
});

test('accepts an oriented workshop clip and rejects a frame with a broken socket', () => {
  const clip = K.pixelStamps.clip('tile-copper-straight', { swatches: { peak: '#ff00cc' } });
  for (const cel of clip.frames) cel.rows = cel.rows.map((_, y) =>
    cel.rows.map(row => row[y]).reverse().join(''));
  const config = { width: 3, height: 1, paths: [[[0, 0], [2, 0]]], cues: [{ at: [0, 0] }] };
  const wave = K.pixelTiles.create({ ...config, clips: { EW: clip } });
  const { rgba } = wave.raster(.35);
  assert([...Array(100).keys()].some(i => {
    const x = 10 + i % 10, y = Math.floor(i / 10), offset = (y * 30 + x) * 4;
    return rgba[offset] === 255 && rgba[offset + 1] === 0 && rgba[offset + 2] === 204;
  }));
  clip.frames[0].rows[4] = '.' + clip.frames[0].rows[4].slice(1);
  assert.throws(() => K.pixelTiles.create({ ...config, clips: { EW: clip } }), /must match the two center pixels/);
  assert.throws(() => K.pixelTiles.create({ ...config, height: 2, paths: [[[0, 0], [2, 1]]] }), /orthogonal/);
});
