# Shared time domains

`KIT.timeDomains` supplies independent simulation, animation, camera and interface clocks, plus named child clocks. It is dependency free and works in Node and browsers. SDFs, splats, rigs, pixel surfaces and the existing fixed-step runtime keep their existing roles.

Try [Clockwork pavilion](../examples/shared-time-domains.html): an articulated courier at 12 fps, a mechanism at 24 fps, a native simulation at 60 ticks per second, a continuously moving camera and an independent target ripple. Freeze any clock, freeze their animation parent, change pose cadence or trigger a one-second hit-stop. Drag to orbit.

## Own time once per display frame

```js
const clocks = K.timeDomains.create({domains:{
  simulation:{step:1/60,maxSteps:8,backlog:'retain'},
  hero:{parent:'animation',fps:12},
  machinery:{parent:'animation',fps:24}
}});
const stage = K.stage(world).useTimeDomains(clocks);
stage.add({update(dt,time){ poseCharacter(time); }},{domain:'hero'});
stage.add({update(dt,time){ animateMachine(time); }},{domain:'machinery'});

function frame(elapsedSeconds) {
  stage.update(elapsedSeconds, 0);
  renderer.render(world, {changedRows});
}
```

`useTimeDomains` makes the stage own advancement by default. Its second `update` argument no longer drives time; systems receive their domain's sampled local time. Do not also call `clocks.advance` in that mode. For several stages, advance the shared clocks once and use `stage.useTimeDomains(clocks,{advance:false})` on each. Each stage consumes the frame independently; rendering and timing queries never advance clocks.

Without a time-domain set, render sampling is continuous unless an authored cadence or explicit step requests otherwise. Both renderers resolve animation `time`, `cameraTime`, `interfaceTime` and `simulationTime` from `world.timeDomains` (or frame `timeDomains`). Explicit frame values override their individual clocks, and both renderers accept `t` as an alias for `time`. Native camera rigs and scene camera timelines use the camera clock. Target labels, glyph ripples, presentation tracks and render-graph/frame-composite effects use the interface clock. Geometry, water and afterimages retain animation time. Inspection and annotation anchors sample animation time independently of their interface effects. Explicit `sceneTime` can override anchor sampling. Set `stepAnimation: true` to enable legacy 10 fps stepping for pixel looks without an authored scene cadence. [Shared rendering contract](browser-renderer.md#shared-rendering-contract)

## Continuous clocks, held poses and fixed ticks

The four defaults are independent roots at rate 1, starting at zero. Simulation defaults to fixed `step:1/60`; the others are continuous. A child gets its parent's **continuous progression**, then applies its own rate and sampling. A 12 fps parent does not force its children to 12 fps. A fixed-step parent passes its completed tick progression.

`read(id)` returns an immutable, cached frame with `time` (continuous local time), `sampleTime` (held pose time), `dt`, `sampleDt`, `sampleIndex`, `tick`, `steps`, `backlogSeconds`, `droppedSeconds`, `limited`, `effectiveRate`, `activeCues`, settings and frame/epoch identifiers. For fixed clocks, `time` is completed scheduled tick time. `effectiveRate` describes the configured/cued rate, not backlog catch-up velocity.

A routed system's `update` runs when its sampled pose changes. A fixed route runs once for each unconsumed `{tick,time,dt}` in `steps`. Initialization runs once, even at time zero. Its `pre` and `post` hooks still run once per display frame, with aggregate domain delta (zero while held). This keeps attachment/visibility cleanup independent of simulation cadence. Unrouted systems run once per display frame at animation time, including zero-delta frames. Integrate stateful dynamics with fixed routes or the simulation adapter; use sampled routes for seekable poses. Reusing the same external frame does not replay fixed ticks. There is no interpolated simulation state or implicit time reversal.

```js
clocks.pause('hero');                    // camera and UI continue
clocks.pause('hero',false);              // resumes without jumping
clocks.pause('animation');               // pauses both animation children
clocks.rate('animation',0.25);           // inherited slow motion
clocks.fps('hero',24);                   // new cadence, preserved pose phase
clocks.fps('hero',null);                 // continuous pose sampling
stage.setTimeDomain(installedSystem,'hero'); // no duplicate installation
stage.setTimeDomain(installedSystem,null);   // restore per-frame behavior
stage.clockFor(installedSystem);
```

Native stage-bound puppets expose `puppet.system`, so `stage.setTimeDomain(puppet.system,'hero')` can route their existing animation wrapper. Rigid hierarchies can route the pose-generating system placed before the graph binding.

`create({domains,cues})`, `add(id,settings)` and `configure(id,patch)` accept `parent`, `rate`, `paused`, `fps`, `step`, `maxSteps`, `backlog` and `start`. Choose `fps` or `step`, not both. Fixed step/start can only change before that clock advances. Fixed starts must align to a tick. FPS changes anchor the next cadence at the currently displayed pose. Rates are 0–64, fps up to 240, fixed steps 1 microsecond–60 seconds, and budgets 1–240 ticks per advance. There are at most 256 clocks and 32 parent levels. Unknown fields, invalid values and cycles reject before edits commit.

## Native fixed-step simulation

```js
const run = K.world.runtime.create(worldDefinition);
const driver = K.timeDomains.simulation(clocks,run);
stage.add(driver); // unrouted: still runs while animation is held
```

The adapter aligns an untouched simulation clock's step/start with the native runtime, including a resumed checkpoint. It executes actual `run.step()` calls up to clock target time, with no skipped ticks. `driver.updateAsync()` uses the native asynchronous step and rejects concurrent updates. `status()` reports target and actual simulation times; a separate adapter budget (default 240 ticks) can leave the runtime behind its scheduled clock target until subsequent updates.

Clock `maxSteps` bounds scheduled work on each advance. Default `backlog:'retain'` preserves debt for later frames, including `advance(0)` drains; pausing a clock also pauses its debt drain. `backlog:'drop'` explicitly discards excess elapsed time and counts it in `droppedSeconds`; tick numbering remains sequential. Different budgets/rates can produce retained debt rather than pretending the simulation has caught up. Compensated accumulation and tick-index arithmetic avoid losing ticks during long 60 Hz runs.

## Freeze and slow cues

```js
clocks.cue(K.anim.cue('impact','freeze',clocks.wall,{
  domain:'hero',duration:0.12
}));
const cueId = clocks.hold('hero',1);
clocks.cancel(cueId);
clocks.cue(K.anim.cue('slow-field','slow',clocks.wall+2,{
  domain:'animation',duration:3,amount:0.25
}));
```

Cues reuse the existing presentation cue shape. Only `freeze` and `slow` change clocks; domain defaults to animation. Cue time/duration use **unpaused wall seconds**, so a frozen domain can resume itself. Cue boundaries split long advances before integration, and overlapping rates multiply, matching the existing freeze/slow time mapping. Expired cues are pruned. The maximum is 1024 active/future cues. Other presentation effects remain in their existing presentation systems.

## Checkpoints and diagnostics

```js
const saved = JSON.parse(JSON.stringify(clocks.snapshot()));
clocks.restore(saved);                  // atomic validation; invalidates stage cursors
const other = K.timeDomains.restore(saved);
clocks.reset();                         // original clock definitions/start state
const frameTimes = clocks.frame();      // no side effects
```

Snapshots retain clock settings, compensated times, fixed-step debt, pose phase and active/future cues. They do not roll back geometry or the native simulation. Save/restore the matching `run.checkpoint()` alongside them; an adapter rejects a runtime ahead of its clock. Restoring resets per-frame deltas/steps. Already scheduled simulation ticks can still be consumed by the native adapter when restoring a matching earlier runtime checkpoint. Reset returns clocks to their initial configuration, not unrelated scene state. Rewind/seek requires restoring corresponding scene state rather than advancing negative time.
