const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, makeBuilder, makeSculpt } = require('..').load();
const { render } = require('../cli/render');

const front = { point: [0, 0, 0], normal: [1, 0, 0], velocity: [-9, 0, 0] };
const slide = { point: [0, 0, 0], normal: [-1, 1, 0], velocity: [8, 6, 0] };
const screen = { project: ([x, y, z]) => [x, -y, z] };
const cam = { target: [0, 0, 0], dist: 5, projection: 'orthographic', fov: .62, yaw: 0, pitch: 0, sway: 0 };
const view = { w: 101, h: 71, px: 1 };

test('contact velocity selects direct or glancing cels and the projected normal or tangent selects the angle', () => {
  const marks = K.contactMarks.create();
  const track = marks.track([front, { ...slide, strength: .22 }, { ...slide, velocity: undefined, heading: [1, 1, 0] }]);
  assert.deepEqual(track.hits.map(({ kind, size }) => [kind, size]),
    [['direct', 'large'], ['glancing', 'small'], ['direct', 'large']]);
  const [direct, glancing] = track.placements();
  assert.equal(direct.frame(.06, screen), 1);
  assert.equal(glancing.frame(.06, screen), 7 * 4 + 1);
  assert.equal(direct.frame(.06, { project: ([x, y, z]) => [-x, -y, z] }), 4 * 4 + 1);
  assert.throws(() => marks.track([{ ...front, normal: [0, 0, 0] }]), /nonzero normal/);
  assert.throws(() => marks.track([{ ...front, period: .15 }]), /full contact clip/);
});

test('native clip markers map through prior holds while contact cels run on presentation time', () => {
  const clip = K.anim.clip({ duration: 2,
    tracks: { 'tool.x': [[0, 0], [2, 2]] },
    cues: [
      K.anim.cue('first-stop', 'freeze', .25, { duration: .10 }),
      K.anim.cue('contact-stop', 'freeze', 1.10, { duration: .12 })
    ],
    events: [{ name: 'contact-mark', time: 1, data: front }, { name: 'other', time: 1.25 }] });
  const track = K.contactMarks.create().fromClip(clip, { period: 2 });
  const [card] = track.placements();
  assert.equal(track.hits.length, 1);
  assert(Math.abs(track.hits[0].time - 1.10) < 1e-7);
  assert.equal(card.visibleAt(1.09), false);
  assert.equal(card.visibleAt(1.11), true);
  assert.equal(clip.sample(1.11).tool.x, clip.sample(1.17).tool.x);
  assert.equal(card.frame(1.11, screen), 0);
  assert.equal(card.frame(1.17, screen), 1);
  assert.equal(card.visibleAt(1.6), false);
  assert.equal(card.frame(3.17, screen), card.frame(1.17, screen));
});

test('projected marks match camera-facing native texels and native cards respect world occlusion', () => {
  const mark = K.contactMarks.create({ lift: .02 }).track([slide]);
  const build = (overlay, block) => {
    const b = makeBuilder(4, [0x101724, 0x4f626f]);
    if (block) {
      const sculpt = K.sculpt(makeSculpt(b));
      sculpt.box([0, 0, .8], [1.5, 1.3, .12], { r: [1] }, { res: .08 });
      sculpt.bake();
    }
    return b.finish({ cam: { ...cam }, dither: 0,
      ...(overlay ? { look: { composite: { layers: [mark.layer()] } } } : { spriteAtlases: mark.placements() }) });
  };
  const native = build(false, false), overlay = build(true, false);
  const clip = K.pixelStamps.clip('contact-glancing-large-ne');
  const swatches = new Set(clip.palette.map(color => Number.parseInt(color.slice(1), 16)));
  function markPixels(image) {
    const points = [];
    for (let i = 0; i < image.rgb.length; i += 3) {
      const color = image.rgb[i] * 65536 + image.rgb[i + 1] * 256 + image.rgb[i + 2];
      if (swatches.has(color)) points.push([i / 3, color]);
    }
    return points;
  }
  for (const camera of [{ yaw: 0, pitch: 0 }, { yaw: 1.24, pitch: .32 }]) {
    const sample = { ...view, ...camera, t: .065 };
    const cpu = markPixels(render(native, sample));
    assert(cpu.length > 20);
    assert.deepEqual(markPixels(render(overlay, sample)), cpu);
  }
  assert.deepEqual(markPixels(render(native, { ...view, t: 0, interfaceTime: .065 })),
    markPixels(render(native, { ...view, t: .065 })));
  assert.notDeepEqual(markPixels(render(native, { ...view, t: 0 })),
    markPixels(render(native, { ...view, t: 0, interfaceTime: .065 })));
  assert.equal(markPixels(render(build(false, true), { ...view, t: .065 })).length, 0);
});
