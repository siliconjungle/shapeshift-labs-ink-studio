# Gaussian glTF import

Ink can draw ordinary triangles and [KHR_gaussian_splatting](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md) ellipse primitives from the same glTF 2.0 scene. Both use the selected scene's node hierarchy. Meshes use Ink's indexed surface pass and occlude the Gaussians where they overlap. The importer keeps glTF coordinates and frames the combined bounds.

## Tidal Beacon demo

```sh
node examples/gaussian-gltf/tidal-beacon.js /tmp/tidal-beacon.glb
node cli/ink-studio.js render /tmp/tidal-beacon.glb \
  --w 840 --h 504 --px 3 --yaw .16 --pitch .16 --dist 4.5 --out /tmp/tidal-beacon.png
node cli/ink-studio.js inspect-gltf /tmp/tidal-beacon.glb --out /tmp/tidal-parts.json
node cli/ink-studio.js inspect-gltf /tmp/tidal-beacon.glb --ray -.42,-.9,4,0,0,-1
```

The file contains two instances of one mesh with native painted housing, brass trim, and three Gaussian signal coils per instance. Inspect the parts for node and mesh names, the world matrix, source primitive index, and the emitted mesh or splat range. `--scene N` selects a glTF scene by index.

An inspection ray reports the visible contributions along a world-space ray. The mesh and Gaussian hits use the same object and part IDs as the part manifest. For opaque art-pixel inspection, use `surface-pixel` with the same camera and grid as the render. A translucent coil can contribute color above an opaque part, so the opaque owner and strongest ray contribution can differ.

## API

```js
const ink = require('@shapeshift-labs/ink-studio');
const world = await ink.readGaussianGltf('./tidal-beacon.glb');
const frame = ink.render(world, { w: 840, h: 504, px: 3 });
console.log(world.gltfParts.parts);
```

`readGaussianGltf` accepts a GLB or a `.gltf` file with embedded or local companion files. Headless texture decoding supports PNG by default. Supply `decodeImage(bytes, mime)` returning `{ width, height, pixels }` for JPEG input.

```js
import { createRenderer, gaussianGltfWorld } from './webgl.mjs';

const bytes = await (await fetch('./tidal-beacon.glb')).arrayBuffer();
const world = await gaussianGltfWorld(bytes, { toolkit });
const renderer = createRenderer(canvas, { toolkit });
renderer.render(world);
```

The browser API also accepts a self-contained `{ document, binary }` or a retained `toolkit.KIT.authoring.gltfAssets` asset. To sample a retained rigid animation pose, pass `{ clip, time }` when building the world. Part IDs use the original node and primitive indices so repeated names and instances stay distinct.

Ink reads ellipse scale directly, expands the authored covariance through the node's world matrix, and handles sparse, interleaved and permitted normalized accessors. The WebGL path evaluates spherical harmonics through degree three with their basis rotated with the node. Headless uses the diffuse coefficient. Both convert linear display colors for Ink's display-space art composite. Ink's hybrid preview can therefore differ from reference glTF viewers that composite linear Gaussian layers in their source space.

This path supports the ratified uncompressed Gaussian extension and rigid triangle mesh previews with base color, PNG or JPEG texture data, and opaque or cutout coverage. Mesh UVs use Ink's normalized atlas coordinates. SPZ-in-glTF compression, mesh skinning, morph targets, and full glTF PBR material shading are outside this import path.
