# Shared PBR materials

Bind one finish to an indexed mesh, object-local texels, projected surface, Gaussian splats or finite Spaghetti curve splats. Ink evaluates a metallic-roughness GGX response with dielectric Fresnel, a clear coating, emission and optional anisotropy. Native WebGL and headless use the same directional lights and analytic sky, horizon and ground colors.

Author the recipe in `finish.look.pbrMaterials` in a diorama or assign it to `world.look.pbrMaterials` when building a scene in code. Both renderers accept the same per-frame `pbrMaterials` override. Set it to `false` to compare against the scene's regular finish. Pass `pbrLights` to move the lights independently of the material bindings.

```js
const pbrMaterials = {
  materials: {
    brass: {
      baseColor: '#c78346', metalness: 0.82, roughness: 0.39,
      coating: { weight: 0.24, roughness: 0.27 },
      highlight: { color: '#ffe5ad', threshold: 0.48, strength: 0.7 }
    },
    enamel: { coating: 0.45 }
  },
  bindings: [
    { select: { material: 'collar' }, material: 'brass' },
    { select: { object: 'wire assembly' }, material: 'brass' },
    { select: { material: 'painted texels' }, material: 'enamel' }
  ],
  lights: [{ direction: [-0.7, 0.6, 0.7], color: '#ffe5c3', intensity: 2 }],
  environment: { sky: '#aecbf3', horizon: '#a096b1', ground: '#534869', intensity: 0.55 },
  projections: [{
    material: 'brass', origin: [-1, -0.5, 0.3], u: [2, 0, 0], v: [0, 0.25, 0],
    reach: 0.2, feather: 0.08,
    channels: { baseColor: '#355754', roughness: 0.8, metalness: 0.1, coating: 0 }
  }]
};

renderer.render(world, { width: 640, height: 360, pbrMaterials });
const frame = Ink.render(world, { w: 640, h: 360, px: 1, raw: true, pbrMaterials });
```

Use `ink-studio render scene.json --pbr-materials finish.json --raw --px1 --out still.png` to apply a recipe stored separately from the scene. Pass `--pbr-materials off` for a comparison render. Omit `--raw` to use Ink's normal art-grid, swatch and outline settings.

## Material and light controls

| Field | Meaning |
| --- | --- |
| `materials` | Up to 16 named finishes. |
| `bindings` | Standard Ink target selectors. The last match wins. Unmatched receivers use `default` if supplied. |
| `baseColor` | Optional sRGB swatch as `#rrggbb` or three numbers from 0 to 1. Omit it to shade source pigment. |
| `roughness`, `metalness` | Values from 0 to 1. Omit either one to read the carrier's channel when available. |
| `ior`, `anisotropy` | Dielectric index from 1 to 4 and specular anisotropy from −0.9 to 0.9. Meshes use the texture tangent and finite curves use their strand axis. |
| `coating` | Weight from 0 to 1 or an object with `weight` and `roughness`. |
| `emission`, `emissionStrength` | An sRGB swatch and an optional linear gain added to the carrier's emission. |
| `highlight` | Optional `color`, `threshold` and `strength`. The threshold tests the linear direct specular response. |
| `lights` | Up to four directional lights in world space. `direction` points toward the light. `color` and `intensity` default to white and 1. |
| `environment`, `exposure` | Optional ambient and reflection colors and a linear exposure multiplier. |
| `projections` | Up to eight bounded world-space finish stamps. Place each with `origin`, full `u` and `v` spans and a two-sided `reach`. `feather` is a fraction of the projection width and height. Apply `opacity` and any combination of `baseColor`, `roughness`, `metalness`, `coating` and `emission` before lighting. |

## Carrier channels

- **Mesh and projected surface** sample the registered pigment and mapped normal. `KIT.sceneMeshes.create` accepts a scalar or a matching byte map for `roughness` and `metalness`. Projected atlas faces retain their projection settings and may bind by material, object, part or named surface.
- **Object texels** store pigment, normal, roughness, metalness and emission per cell. Pass `metalness` to `bakeObjectTexels` or `editObjectTexels` and apply the edit with `KIT.sceneMeshes.updateObjectTexels`. The same cell IDs and projected geometry remain available for subsequent edits.
- **Gaussian splats** use registered pigment when supplied and otherwise use baked row color. They prefer authored normals, then available capture normals, then the thin covariance axis. A round splat without a usable normal faces the view. Relighting a capture with baked highlights is approximate, so author a pigment swatch for materials where those highlights matter.
- **Finite curves** use the analytic intersection normal and the strand tangent, with authored along-strand roughness and emission available to the shared material. Gaussian carrier mode uses the row-level normal instead.

Ink shades before palette mapping, dithering and outlines. An explicit PBR binding supplies the finish for that receiver, including where the receiver previously used legacy per-pixel ramp lighting. Use full color to tune the look, then adjust the highlight swatches and palette on the target art grid. The analytic environment supplies smooth reflection color. PBR lights illuminate independently of scene shadow maps and reflection captures, and Gaussian transparency remains coverage-based.

## Vesper Relay

The editable [demo scene](../examples/pbr-materials/scene.cjs) uses a machined collar, a Gaussian signal lens, a painted switchboard, an affine status badge and finite-curve wires. The copper finish is shared by the collar and the copper wires. Drag the key-light control, compare PBR with the Ink palette, or switch to the headless still.

From the repository root, build a self-contained HTML demo and headless PNG.

```sh
npx --yes esbuild@0.25.12 examples/pbr-materials/preview.mjs --bundle --format=esm --minify --outfile=/tmp/ink-pbr-preview.mjs
node examples/pbr-materials/build-demo.cjs /tmp/ink-pbr-preview.mjs vesper-relay.html vesper-relay.png
```
