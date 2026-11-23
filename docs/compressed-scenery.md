# Compressed scenery delivery

An `.inkscenery` pack contains indexed scenery meshes, material slots, and base-color
textures. Meshoptimizer encodes Float32 positions and UVs and preserves index order
and face material assignments. Mesh, object, part, and material IDs survive loading
for scene assembly and picking.

## Pack and render the signal house

```sh
node cli/ink-studio.js scenery pack examples/compressed-scenery.js --out tern.inkscenery
node cli/ink-studio.js scenery inspect tern.inkscenery
node cli/ink-studio.js render tern.inkscenery --raw --w 320 --h 210 --px 1 --out tern.png
```

A JavaScript scene exposes `scenery(seed)`, returning inputs to
`KIT.sceneMeshes.create`. On each material texture choose a delivery mode.

| Texture input | Delivery | Retains |
| --- | --- | --- |
| RGBA8 with `delivery: 'ktx2'` | Opaque BC1 in a standard KTX2 container | Lossy scenery color |
| Byte indices with an RGB24 palette and optional byte coverage | Lossless indexed deflate | Exact palette, indices, and coverage |
| RGBA8 with `delivery: 'lossless'` or the default | Lossless RGBA deflate | Exact color and alpha, including decals |

Use KTX2 for opaque materials with dimensions divisible by four. This version
writes a single top-down BC1 sRGB level. It accepts the same KTX2 profile and
packs base color, material tint, and cutout coverage. Keep other material maps,
semantic mipmaps, and scene dressing in the authoring scene. The example uses
BC1 for roof, masonry, and quay stone and keeps lettering and the door decal
in their original byte formats.

## Load into a scene or look

On Node, use `await ink.readSceneryPack(file)` and add the returned `meshes`
to the world's `meshes`. For on-demand loading in the browser:

```js
import { decodeSceneryPack } from './webgl.mjs';

const response = await fetch('./tern.inkscenery');
if (!response.ok) throw new Error('Scenery request failed');
const pack = await decodeSceneryPack(new Uint8Array(await response.arrayBuffer()), { toolkit });
world.meshes = [...(world.meshes ?? []), ...pack.meshes];
```

Use the same toolkit as the renderer. The result also contains the decoded
`assets` and the size `receipt` printed by `scenery inspect`.

WebGL with S3TC uploads the KTX2 blocks and samples them in the existing native
mesh pass. If all triangles of a mesh use BC1, the renderer skips the full
RGBA color-atlas upload. Mixed meshes also upload their normal color atlas.
Headless renders, browsers without S3TC, and meshes with atlas paint edits or
UV remapping sample the decoded color atlas. Meshoptimizer geometry is decoded
before the renderer's regular vertex upload.

Pass `sceneryDeliveryFrame(row)` to the WebGL renderer to inspect a draw's
`blockMode`, `blockBytes`, `textureBytes`, and `geometryBytes`. Byte counters
report new transfers in that draw. Set `sceneryBlockTextures: false` to compare
the decoded RGBA path on the same hardware. The CLI reports file and decoded
payload sizes, independently of GPU upload sizes.

The file contains a versioned UTF-8 manifest followed by bounded payloads.
The two codec references are the
[Khronos KTX 2.0 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
and the [meshoptimizer JavaScript API](https://github.com/zeux/meshoptimizer/tree/v1.3.0/js).
