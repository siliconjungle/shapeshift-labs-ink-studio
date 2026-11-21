const ArtDirection = require('../src/art-direction.js');

// put the world at time t. A diorama that says it remembers the past (anim.stateful) is walked there a sixtieth of a second at a time
function pose(w, t, { kit, artDirection, tap = () => {}, maxSteps = Infinity } = {}) {
  if (!w.anim) return;
  const direction = ArtDirection.prepare(w.look?.artDirection, artDirection);
  if (w.anim.motionSettings) w.anim.motionDirection = direction;
  const sceneTime = ArtDirection.time(direction,t);
  if (w.anim.stateful) {
    w.clock ??= 0;
    if (sceneTime < w.clock) throw new RangeError('This diorama cannot run backwards. Sample times in order.');
    if ((t - Math.min(w.clock, w.clothClock ?? w.clock)) * 60 > maxSteps)
      throw new RangeError('Graph scene pose exceeds its fixed-step budget');
    const separateCloth = direction?.cadence.scene && direction.cadence.cloth !== undefined && w.anim.hasIndependentCloth?.();
    function advanceScene(to) {
      while (w.clock < to - 1e-9) {
        const dt = Math.min(1 / 60, to - w.clock), before = w.clock;
        w.clock += dt;
        tap(w, before, w.clock);
        if (separateCloth) w.anim.update(dt,w.clock,{ separateCloth });
        else w.anim.update(dt,w.clock);
      }
    }
    if (separateCloth) {
      // Interleave fixed steps so cloth sees the held scene pose at each step.
      let at = w.clothClock ?? w.clock;
      while (at < t - 1e-9) {
        const dt = Math.min(1 / 60,t-at);
        at += dt;
        advanceScene(ArtDirection.time(direction,at));
        w.anim.advanceCloth(dt,at);
      }
      w.clothClock = t;
    } else advanceScene(sceneTime);
  } else w.anim.update(1 / 60, sceneTime);
  w.clock = sceneTime;
  /* splats carried by bones on the graphics card stay at rest in the data: the tools look at a copy with them put in place */
  if (w.anim.bones) {
    if (!w.rest) w.rest = w.data;
    w.data = kit.KIT.bones.posed({
      data: w.rest,
      anim: w.anim,
      get posedBuf() {
        return w.posedBuf;
      },
      set posedBuf(v) {
        w.posedBuf = v;
      }
    });
  }
}

module.exports = { pose };
