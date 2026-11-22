# Painted materials for imported Gaussian splats

Open the [material workshop](../examples/gaussian-materials/index.html) after
running `npm run build` and starting the [gallery's local server](webgpu-graphs.md#run-the-gallery).
Pelagic opens with shell, fabric and tissue already assigned. Open your own PLY,
SPZ or GSZ file to start with empty assignments.

1. Choose a part and the **Assign** brush, then paint its visible splats.
   Rotate to paint the other sides. Painting a splat gives it the new material.
   **Erase** affects the selected material, and **Undo stroke** restores the
   previous assignment, including a material the stroke replaced.
2. Edit the swatches in shadow-to-light order. Move the key light and adjust the
   part's ambient, diffuse, specular and roughness sliders.
3. Adjust **Captured color** to blend back the view-dependent part of the
   original spherical harmonics. Orbit to compare with the captured appearance.
   **Indexed palette** chooses from the visible part's own ramp.
4. Save the material JSON alongside your scan. Reopen the same file before
   loading the JSON. The workshop checks a fingerprint of the imported bytes.

## WebGL API

Use the existing imported-world and brush APIs. The render assignment stays on
source splat IDs, so it follows the cloud as the camera turns.

```js
import {
  decodeGaussianSplat, gaussianSplatWorld, createGaussianMaterialPainter,
  compileGaussianMaterials
} from './webgl.mjs';

const world = gaussianSplatWorld(await decodeGaussianSplat(bytes), { colorMode: 'rgb' });
const brush = createGaussianMaterialPainter(renderer, world, { width, height }, { slots: 2 });

// Points are normalized to the art grid. Use the same camera as the visible frame.
brush.stroke(0, [[0.42, 0.46], [0.45, 0.47]], frame, { radius: 8 });
brush.stroke(1, [[0.5, 0.76]], frame, { radius: 5 });

const materials = [
  { id: 'shell', mask: brush.masks[0], ramp: [0x123544, 0x237976, 0x6cc5ae, 0xcff6ce],
    captured: 0.55, lighting: { ambient: 0.22, diffuse: 0.58, specular: 0.32, roughness: 0.34 } },
  { id: 'tissue', mask: brush.masks[1], ramp: [0x33213e, 0x814a75, 0xc67da3, 0xfbd7b2],
    captured: 0.7, lighting: { ambient: 0.43, diffuse: 0.46, specular: 0.09, roughness: 0.7 } }
];
const assigned = compileGaussianMaterials(world, materials);

renderer.render(world, {
  ...frame, gaussianColor: 'palette', gaussianMaterials: assigned,
  gaussianLight: { direction: [-0.65, 0.85, 0.55], strength: 1 }
});
```

Compile again after changing the masks or material settings. You can store the
handle on `world.gaussianMaterials`. A frame override of `false` shows the
original import. A plan accepts one to six materials and one to eight swatches
per ramp. The input material objects are plain JSON. Compilation checks mask
membership and binds the result to the imported world.

In live RGB, the shader interpolates the ordered ramp using the light response
and adds the captured RGB shift relative to the SH base color. `captured: 0`
mutes that shift and `captured: 1` uses its full strength before color clamping.
`detail` optionally preserves a fraction of the SH base luminance variation.
In palette mode, the visible contributions select which ramp can supply the
art pixel. Indexed turntable exports include those ramps.

The material pass uses the shortest Gaussian axis as a two-sided normal.
Round splats, or splats with two similarly short axes, fade toward ambient
response. This is an artist-authored approximation of relighting. It retains
captured color shifts and does not estimate physical albedo, remove baked
shadows, or ray trace light visibility. A replacement geometry proxy uses its
own appearance settings.
