function attachRebirthDynamics(world) {
  const { dynamic, anim } = world;
  const input = { move: 0, mz: 0 };
  const host = Object.create(anim ?? null);
  Object.defineProperties(host, {
    stateful: { value: true },
    update: { value(dt, time) {
      // The Rebirth driver updates the underlying rig and loose splats itself.
      world.anim = anim;
      try { dynamic.update(dt, input, time); }
      finally { world.anim = host; }
    } }
  });
  world.anim = host;
  world.rebirthInput = input;
  return world;
}

function rebirthMotion() {
  return { attachRebirthDynamics };
}

if (typeof module !== 'undefined') module.exports = rebirthMotion;
