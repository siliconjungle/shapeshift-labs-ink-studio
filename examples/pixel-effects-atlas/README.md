# Ink Effects Atlas

Fifteen procedural studies built from Ink's raster, signed-field, and
simulation tooling. Each study is sampled on a fixed pixel grid chosen for
its silhouette and motion. The gallery links to the references and the
rendered clips. It runs from local files.

```sh
node examples/pixel-effects-atlas/export.cjs ./atlas
```

Open `atlas/index.html`. The exporter uses FFmpeg to encode MP4s and scales
the original art pixels by an integer factor. The generators and scene
recipes run in Ink. A dependency-free Node example can also sample a frame
directly.

```js
const ink = require('@shapeshift-labs/ink-studio')
const { KIT } = ink.load()
const effects = require('./examples/pixel-effects-atlas')({ KIT })
const globe = effects.find(study => study.id === 'planet')
const rgba = globe.render(.25)
```

| Study | Authoring technique | Reference |
| --- | --- | --- |
| Ember Quill | Tapered ribbons, layered vane silhouettes, turbulent heat and sparks | [Phoenix Feather](https://x.com/MakhamDev/status/2124299350847127697) |
| Quiet Lattice | Golden-angle petal placement, painted facets, pad shadows and water motion | [Lotuses](https://x.com/MakhamDev/status/2123574760038674682) |
| The Sluice | Angular radial masonry, a recessed grate, suspended drops and reflected streaks | [Sewer](https://x.com/MakhamDev/status/2115239816858136914) |
| Below the Glass | Layered underwater silhouettes, broad displaced caustic patches and an illuminated rim | [Underwater View](https://x.com/MakhamDev/status/2113427746294501766) |
| Soft Type | Shared fixed-tick material points. Liquid and elastic glyphs drop, deform and collide | [MPM experiment](https://x.com/MakhamDev/status/2106542346875584592) |
| Fault Heat | Voronoi boundary distances supply hot seams and cold tile faces | [Lava Floor](https://x.com/MakhamDev/status/2105092801297842180) |
| Rose Engine | Independently layered exhaust envelopes, pressure bands and particle streaks | [Rocket Thrust](https://x.com/MakhamDev/status/2104730473058480142) |
| Periapsis | Animated accretion bands and stylized bent arcs around a masked silhouette | [Black Hole](https://x.com/MakhamDev/status/2103643286288166921) |
| Signal Shatter | Branching discharge, offset color, a disturbed backdrop and lingering particle chips | [Spark Bolt](https://x.com/MakhamDev/status/2102918511773323608) |
| Updraft | Layered rotating contour packets, a moving taper and rising cinders | [Fire Tornado](https://x.com/MakhamDev/status/2101831310478020776) |
| Copper Cooper | Signed-field profile with physical hoops, a turning camera and surface-mapped grain | [Barrel](https://x.com/MakhamDev/status/2097482661455384834) |
| Storm Glass | Curved branching discharge, separate core and halo, glowing glass rim | [Plasma Ball](https://x.com/MakhamDev/status/2095670712530854308) |
| The Green Return | Perspective floor rings, a rising sigil and independently timed light pillars | [Healing](https://x.com/MakhamDev/status/2084436719517012186) |
| Wind Between Stems | Height-anchored tapered ribbons, joint collars and foliage carried by bent branches | [Bamboo](https://x.com/MakhamDev/status/2081175189996331096) |
| The Pelagic Globe | Seamless 3D-noise terrain maps, separate cloud rotation, banded sphere lighting and limb color | [Planet](https://pixel-composer.com/projects/Planet/) |

[Tool and graph API](../../docs/headless-authoring.md#procedural-pixel-effects)
