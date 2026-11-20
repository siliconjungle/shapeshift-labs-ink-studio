# Directional camera impulses

`CameraImpulses` / `KIT.cameraImpulses` adds time-sampled positional and angular camera motion, spatial attenuation, wave travel time and layered handheld motion. It is dependency free and shares the same implementation between Node, classic browser scripts and browser ESM. Scene geometry remains SDF/splat based.

Try [Midnight midway](../examples/directional-camera-impulses.html). A working loop coaster uses the native route followers. Crash it to transfer the cars’ current geometry and momentum into native rubble, fire a recoil impulse, or flash a distant storm before its low-frequency rumble arrives. Move closer/farther, hold or scrub camera response, freeze the scene independently, and compare the six-axis response at the current viewpoint. The two primary colors are indigo and pale gold.

## Emit and bind

```js
const motion = K.cameraImpulses.create({
  seed:73, translationLimit:0.9, rotationLimit:0.24,
  handheld:[
    {id:'breathing',frequency:0.3,
      translation:[0.008,0.012,0.003],rotation:[0.001,0.0014,0.0008]},
    {id:'fine',frequency:1.7,
      translation:[0.003,0.005,0.002],rotation:[0.0005,0.0003,0.0006]}
  ]
});
const unbind = motion.bind(world);
motion.emit(K.cameraImpulses.preset('recoil',{time:cameraTime}));
motion.emit(K.cameraImpulses.preset('crash',{
  id:'bridge-impact',time:cameraTime,source:contact.point,weight:0.8
}));
renderer.render(world,{cameraTime});
```

A provider can live at `world.cameraImpulses`, `world.look.cameraImpulses`, or the render frame's `cameraImpulses` override. Pass a live sampler or a plain JSON definition. `false` disables it for that view. JSON definitions are compiled/cached by identity; replace the definition object after editing it, or use the live methods. `bind(world)` returns a cleanup function that restores the previous provider if this binding still owns the slot.

The effect runs after authored/free-camera resolution and legacy kick/zoom. Translation moves the eye in world space. Angular motion uses a rotation vector in radians and rotates the camera’s right/up/back basis around its physical eye. Lens values remain intact. Both renderers use the resulting full pose for projection, sorting, depth, inspection, surfaces and reflections. Probe cameras remain independent; portal views map the resolved pose. Orthographic source distances and rotation pivots exclude the legacy artificial camera setback.

Existing `K.anim.camera()` now accepts object impulses through `impulse(record)` and exposes `effects`, `emit`, `sample` and `bind`. Its numeric `impulse(amount,mode)`, `advance(dt)` return value and numeric `seek` behavior remain compatible. Object impulses are sampled through its directional `effects` provider; `advance` synchronizes that provider's clock. Existing `anim.kick` still composes with the new motion layer.

## Impulse records

```js
motion.emit({
  id:'right-side-hit',time:2,duration:1.3,
  space:'impact',source:[8,2,3],
  translation:[0,0,0.35],rotation:[0.01,0.02,0.015],
  lever:[0,0.5,0],angularGain:0.5,
  profile:'spring',frequency:5,damping:4,attack:0.015,
  falloff:{inner:2,outer:24,power:1.5}
});
```

| Field | Meaning |
| --- | --- |
| `id`, `time` | Optional unique ID and start seconds. Defaults are a generated ID and the provider's current time. Named IDs derive stable noise seeds, independent of record order. |
| `translation`, `rotation` | Three signed amplitude components, in world units and radians respectively. Both default to zero. |
| `space` | `camera` (default): X right, Y up, Z backward. `world`: global axes. `impact`: Z follows the normalized world `direction`, or points from `source` toward the listener; X/Y complete an orthonormal frame near world up. |
| `source`, `direction` | Optional world source point and explicit nonzero world direction. Impact space requires at least one. An explicit direction overrides radial direction. A coincident source uses the listener's back axis. |
| `falloff` | `{inner:0,outer:20,power:2}`. Gain is one inside the inner radius, zero outside the outer radius, and `((outer-distance)/(outer-inner))**power` between them. Requires a source. Omit or use `false` for no spatial attenuation. |
| `propagationSpeed` | World units/second; zero means immediate. A positive value requires a source and delays arrival by `distance/speed`. Choose the speed for the scene's unit scale. |
| `profile` | `spring` (default): a damped sine response. `shake`: smooth seeded value noise. `pulse`: a soft attack and squared decay. |
| `frequency`, `damping` | Frequency in Hz and exponential decay per second. Defaults 12 and 7. |
| `duration`, `attack`, `release` | Total life, attack smoothing and final taper in seconds. Defaults 0.7, 0.015 and 20% of duration. A positive attack fades from rest; spring starts at zero even with attack 0. Release tapers smoothly to zero. |
| `lever`, `angularGain` | Optional camera-local application lever and angular response coefficient. Adds `cross(worldLever,worldTranslation)*angularGain` to the angular vector, giving side impacts a signed rotational response. |
| `weight`, `seed`, `enabled` | Overall nonnegative contribution, deterministic seed and activation flag. Defaults 1, a derived seed and true. |

`preset('recoil')` gives a short backward/pitch spring. `preset('crash',{source})` gives a larger source-oriented spring with spatial attenuation and leverage. `preset('thunder',{source})` gives delayed low-frequency noise with broader attenuation. Presets are JSON recipes; supply overrides or clone them to edit. Their amplitudes, radii and propagation speed are art controls rather than a calibrated physical camera model.

Spatial response is evaluated at the supplied base camera pose, before this motion layer. A moving listener therefore changes direction, attenuation and arrival time. Effects never use their own displaced eye as the next frame's input.

## Handheld layers

```js
motion.setLayer({id:'fine',weight:0.25}); // patches without reseeding/restarting
motion.setLayer({id:'wind',time:cameraTime,fadeIn:0.5,frequency:0.8,
  space:'world',translation:[0.01,0.005,0.008],rotation:[0,0.002,0.001]});
motion.removeLayer('wind');
```

Layers accept `id`, `translation`, `rotation`, `space:'camera'|'world'`, `frequency`, `octaves` (1–5), `persistence` (0–1), `weight`, `seed`, `time`, `fadeIn` and `enabled`. They use continuous seeded multi-octave noise sampled from absolute time. Contributions add without accumulated positional drift. Existing layer edits preserve unspecified settings, seed and phase. Explicitly changing a weight or activation applies that edit immediately; animate weights with the existing curve/timeline tools when a gradual change is desired.

## Clocks and seeking

Rendering never advances a provider. Explicit frame `cameraImpulseTime` takes precedence, followed by camera time, the world's shared camera clock, frame scene time, snapshot time and finally the provider's own time. This lets impulses hold while a free or authored camera continues moving:

```js
renderer.render(world,{
  cameraTime:clocks.read('camera').sampleTime,
  cameraImpulseTime:clocks.read('cameraFX').sampleTime
});
```

For a standalone host, `advance(dt,context)` advances the provider clock and returns a frame; `seek(time,context)` sets that clock and samples it. `sample(time,context)` is read-only and supports arbitrary sample order. Compensated clock accumulation keeps different display frame rates aligned. Emit events at the same clock used to sample them. Events from physics/animation can use their contact point and scale `weight` from the impact strength.

`context.pose` is `{eye,right,up,back}` with a right-handed orthonormal basis. Omit it for the identity camera at the origin. The browser renderer can supply a base pose with `renderer.cameraPose(world,{cameraImpulses:false})`. `CameraLens.applyMotion(pose,frame)` and `CameraLens.matrix(pose)` also support custom hosts; `listenerPose(pose,setback)` removes an artificial setback before spatial sampling.

## Inspect, checkpoint and manage history

`sample` returns an immutable frame with world `translation` and `rotation`, ordered `contributions`, future/pending arrival records, `activeCount`, and independent limit scale factors. Each impulse contribution reports age, arrival, delay, distance, spatial gain, envelope, profile and pre-limit vectors. Named contributions sum in deterministic time/ID order. `translationLimit` and `rotationLimit` independently cap final vector magnitude; zero disables that component. Defaults are one world unit and 0.35 radians.

```js
const saved = JSON.parse(JSON.stringify(motion.snapshot()));
motion.restore(saved);                   // same provider settings; atomic validation
const other = K.cameraImpulses.restore(saved);
motion.cancel('bridge-impact');
motion.prune(oldestTimeNeeded);
motion.clear();                         // remove impacts; keep handheld layers
motion.reset();                         // original definition, layers and clock
```

History is retained for seeking. Default capacity is 256 impulses, configurable up to 2048, plus 32 handheld layers. Capacity overflow rejects before mutation. `prune(before)` removes events whose entire response, including bounded propagation delay, is finished before that time. A propagating event without an outer falloff radius is retained because its listener distance is unbounded; cancel or clear it explicitly. Pruning changes how far backward the retained history can be inspected. Snapshots store normalized events, layers, settings, serial and compensated clock state, independently of scene/simulation checkpoints.

The software renderer's `cameraFrame({time,pose,motion})` callback exposes the actual resolved camera pose. `motion.time` distinguishes an independently sampled impulse clock. Browser `makeCamera` diagnostics include `cameraImpulse`; `renderer.cameraPose` returns the final pose. `lockCamera:true` suppresses both legacy camera kick/zoom and directional motion.

```sh
ink-studio camera-impulses motion.json --at 1.25 --eye 0,2,8 --yaw 0.2 --pitch 0.1
ink-studio render examples/directional-camera-impulses.js --t 3 --out midway.png
# Freeze only camera response at one instant while sampling scene time elsewhere:
ink-studio render scene.json --t 4 --camera-impulse-time 1.25 --out frame.png
```
