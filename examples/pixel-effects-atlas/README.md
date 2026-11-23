# Ink Effects Atlas

Fifteen procedural studies built from Ink's raster, signed-field, and
simulation tooling. The studies render directly on 96 × 96 art grids.
Quiet Lattice uses 192 × 192 so small stamens and overlapping petals
remain distinct. The gallery plays from local files and links each scene
to its reference.

```sh
node examples/pixel-effects-atlas/export.cjs ./atlas
```

Open `atlas/index.html`. The exporter uses FFmpeg to encode 24 fps MP4s
with an integer enlargement to 768 × 768. The generators and scene
recipes run in Ink. Sample a native frame directly with Node.

```js
const ink = require('@shapeshift-labs/ink-studio')
const { KIT } = ink.load()
const effects = require('./examples/pixel-effects-atlas')({ KIT })
const globe = effects.find(study => study.id === 'planet')
const rgba = globe.render(.25)
```

The argument to `render` is normalized time. Looping studies wrap at 1.
Soft Type clamps at the ends and uses two fixed-tick simulations, so
the cut and both shots are deterministic regardless of seek order.

The short studies have distinct beats you can inspect at their native size.
Try the quill at `.18`, `.31`, and `.58` for the drawn vane, ignition, and
wake. Try the rocket at `.24`, `.37`, and `.72` for the pressure rings,
white core, and receding exhaust. For the lightning, compare `.42` with
`.66` and `.79` to see the tracer, impact, and refracted afterimage.

| Study | Authoring technique | Reference |
| --- | --- | --- |
| Ember Quill | Indexed feather ridges and dark contours conceal part of the advecting flame field | [Phoenix Feather](https://x.com/MakhamDev/status/2124299350847127697) |
| Quiet Lattice | Two layers of unfolding petals, separate facets, lily pads and golden-angle stamens | [Lotuses](https://x.com/MakhamDev/status/2123574760038674682) |
| The Sluice | Beveled iron, irregular moss coverage, turning drips and distorted water highlights | [Sewer](https://x.com/MakhamDev/status/2115239816858136914) |
| Below the Glass | Stepped caustic fields, small reef silhouettes and a fixed bright rim | [Underwater View](https://x.com/MakhamDev/status/2113427746294501766) |
| Soft Type | Separate elastic and fluid pigment ramps on fixed-tick material points, with a second fluid-only shot | [MPM experiment](https://x.com/MakhamDev/status/2106542346875584592) |
| Fault Heat | A wave lifts stable Voronoi tile IDs and exposes the glowing layer beneath | [Lava Floor](https://x.com/MakhamDev/status/2105092801297842180) |
| Rose Engine | Hollow, advecting compression rings precede a white flash and a changing exhaust envelope | [Rocket Thrust](https://x.com/MakhamDev/status/2104730473058480142) |
| Periapsis | A near disk crosses the dark silhouette, with a stylized secondary disk above it | [Black Hole](https://x.com/MakhamDev/status/2103643286288166921) |
| Signal Shatter | A tapered tracer fires a radial flash that warps the backdrop and breaks into colored arcs and chips | [Spark Bolt](https://x.com/MakhamDev/status/2102918511773323608) |
| Updraft | Projected helical sheets and sparse embers wrap a taper with an open crown | [Fire Tornado](https://x.com/MakhamDev/status/2101831310478020776) |
| Copper Cooper | Signed-field staves, bevels, rivets and end grain rotate under a fixed direction of light | [Barrel](https://x.com/MakhamDev/status/2097482661455384834) |
| Storm Glass | Branching discharge lights the ruby glass where filaments reach its edge | [Plasma Ball](https://x.com/MakhamDev/status/2095670712530854308) |
| The Green Return | A perspective ring projects different beam heights and an extruded, rotating cross | [Healing](https://x.com/MakhamDev/status/2084436719517012186) |
| Wind Between Stems | A height-anchored bend carries the joint collars, fine branches and individual leaves | [Bamboo](https://x.com/MakhamDev/status/2081175189996331096) |
| The Pelagic Globe | Authored continental masses, separately rotating cloud belts and a banded atmospheric rim | [Planet](https://pixel-composer.com/projects/Planet/) |

[Tool and graph API](../../docs/headless-authoring.md#procedural-pixel-effects)
