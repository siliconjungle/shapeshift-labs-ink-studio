const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const gallery = require('../examples/inkwell-rebirth/gallery.js');
const { attachRebirthDynamics } = require('../examples/inkwell-rebirth/motion.js')();

test('the Rebirth driver advances the underlying rig and retains player input', () => {
  const seen = [];
  const world = {
    anim: {
      bones: [],
      update(dt, time) { seen.push([dt, time]); }
    },
    dynamic: {
      update(dt, input, time) {
        assert.equal(input.move, 1);
        world.anim.update(dt, time);
        world.anim.warp = 'pose';
      }
    }
  };
  attachRebirthDynamics(world);
  world.rebirthInput.move = 1;
  world.anim.update(1 / 60, .5);
  assert.deepEqual(seen, [[1 / 60, .5]]);
  assert.equal(world.anim.stateful, true);
  assert.equal(world.anim.warp, 'pose');
  assert.deepEqual(world.anim.bones, []);
});

test('The Garden reuses the same authored geometry for both canopy materials', () => {
  const kit = ink.load(), entries = gallery(kit);
  assert.deepEqual(entries.map(({ scene }) => scene.id), [
    'grove', 'afterimage-harbor', 'circle7', 'angel', 'garden', 'transmission'
  ]);
  const scene = entries.find(({ file }) => file === 'garden').scene;
  function sample(controls) {
    const world = scene.animate(scene.build(scene.seed, { controls }), scene.seed);
    require('../cli/diarama-pose.js').pose(world, 2.7, { kit });
    return { world, image: ink.render(world, { w: 160, h: 100, px: 1, time: 2.7 }) };
  }
  const gold = sample(), rose = sample({ canopy: 'rose' });
  assert.equal(gold.world.count, rose.world.count);
  assert.deepEqual(gold.world.cam, rose.world.cam);
  assert.deepEqual(rose.world.pal.slice(0, gold.world.pal.length), gold.world.pal);
  assert.notDeepEqual(rose.image.rgb, gold.image.rgb);
});
