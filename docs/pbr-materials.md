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
| `lightingRamp`, `rampStrength`, `wrap` | Optional material light ramp, blend strength and terminator wrap. Strength and wrap default to 1 and 0. |
| `highlight` | Optional `lightingRamp` and `strength`, or a single `color` with `threshold` and `strength`. Both modes sample the linear direct specular response. |
| `lights` | Up to four directional lights in world space. `direction` points toward the light. `color` and `intensity` default to white and 1. |
| `environment`, `exposure` | Optional ambient and reflection colors and a linear exposure multiplier. |
| `projections` | Up to eight bounded world-space finish stamps. Place each with `origin`, full `u` and `v` spans and a two-sided `reach`. `feather` is a fraction of the projection width and height. Apply `opacity` and any combination of `baseColor`, `roughness`, `metalness`, `coating` and `emission` before lighting. |

## Material lighting ramps

Use Ink's [surface lighting ramp format](surface-materials.md#material-lighting-ramps) on every PBR carrier. Both ramp slots accept a palette `role` with optional `positions` or 2–256 explicit color stops, `step`, `linear` or `smooth` interpolation, and optional per-stop blend `weights`. A material can bind `paletteRoles` aliases to scene roles. An explicit stop can use a palette index, a named role stop, hex, or normalized sRGB.

```js
const tealCable = {
  roughness: 0.43,
  wrap: 0.2,
  lightingRamp: { role: 'teal-rubber', positions: [0, 0.2, 0.55, 0.81], interpolation: 'step' },
  highlight: {
    strength: 0.85,
    lightingRamp: {
      stops: [[0, '#24616a'], [0.38, '#58b6a5'], [1, '#cfffe6']],
      weights: [0, 0.15, 1],
      interpolation: 'smooth'
    }
  }
};
```

The diffuse ramp samples the strongest directional response, using wrapped incidence and light strength. It blends the exposed lit color toward the authored swatch and keeps emission additive. Lower `rampStrength` or set stop weights to retain more of the pigment, projected paint and physical shading. The highlight ramp samples the direct specular response, clamped to 0–1, and uses it as the default blend weight. Explicit highlight weights start at zero. A highlight ramp takes precedence over the single-swatch highlight controls.

Author scene or environment overrides with `look.surfaceLightRamps`. Use the PBR material name as the finish ID and `diffuse` or `specular` as the layer. These override entries accept explicit hex or RGB stops, just like legacy surface overrides. Pass `surfaceLightRamps: false` at render time to use the authored material definitions. To require exact swatches after a full-strength ramp, include them in the scene palette or bind a dedicated [target palette](pixel-look.md#target-palettes-and-dithering).

## Per-light shadows

Set `shadows: true` on any directional light in `pbrMaterials.lights` or `pbrLights`.
`mapSize` accepts 32–1024 pixels on the longer axis and defaults to 256.
`bias` defaults to 0.02 world units and `filter` is a radius of 0–2 shadow-map pixels, defaulting to 1.

```js
const lights = [
  { direction: [-0.7, 0.6, 0.7], color: '#ffe5c3', intensity: 2, shadows: true, filter: 1 },
  { direction: [0.8, 0.1, 0.5], color: '#82bdec', intensity: 0.35 }
];
renderer.render(world, { pbrLights: lights });
```

The browser and headless renderer use the same directional shadow map rasterizer. It reads opaque splats, retained mesh and texel geometry with texture cutouts, [painted shadow casters](painted-cutout-shadows.md), and finite curves authored with `shadow.cast`. Finite curves can transmit light through their authored `shadow.transmittance`. Use `look.shadowArt` to select casters and receivers by their geometry IDs and to apply the existing shadow gain steps.

Visibility scales the diffuse ramp's light response and the direct specular response separately for each light. A covered key can pick a shadow swatch while an unobstructed fill continues to illuminate the same receiver. Environment light and emission stay available in the shadow. Use `pbrShadows: false` or `--pbr-shadows off` to review the same shot with the caster geometry and light directions still visible.

## Carrier channels

- **Mesh and projected surface** sample the registered pigment and mapped normal. `KIT.sceneMeshes.create` accepts a scalar or a matching byte map for `roughness` and `metalness`. Projected atlas faces retain their projection settings and may bind by material, object, part or named surface.
- **Object texels** store pigment, normal, roughness, metalness and emission per cell. Pass `metalness` to `bakeObjectTexels` or `editObjectTexels` and apply the edit with `KIT.sceneMeshes.updateObjectTexels`. The same cell IDs and projected geometry remain available for subsequent edits.
- **Gaussian splats** use registered pigment when supplied and otherwise use baked row color. They prefer authored normals, then available capture normals, then the thin covariance axis. A round splat without a usable normal faces the view. Relighting a capture with baked highlights is approximate, so author a pigment swatch for materials where those highlights matter.
- **Finite curves** use the analytic intersection normal and the strand tangent, with authored along-strand roughness and emission available to the shared material. Gaussian carrier mode uses the row-level normal instead.

Ink shades before palette mapping, dithering and outlines. An explicit PBR binding supplies the finish for that receiver, including where the receiver previously used legacy per-pixel ramp lighting. Use full color to tune the look, then adjust the highlight swatches and palette on the target art grid. The analytic environment supplies smooth reflection color. Gaussian transparency remains coverage-based.

## Vesper Relay

The editable [demo scene](../examples/pbr-materials/scene.cjs) uses a machined collar, a Gaussian signal lens, a painted switchboard, an affine status badge and finite-curve wires. Move the overhead shutter to cast a shadow across the relay, or toggle Cast shadows while holding the light and shutter position fixed. The Headless view shows the same shadows in the exported still.

From the repository root, build a self-contained HTML demo and headless PNG.

```sh
npx --yes esbuild@0.25.12 examples/pbr-materials/preview.mjs --bundle --format=esm --minify --outfile=/tmp/ink-pbr-preview.mjs
node examples/pbr-materials/build-demo.cjs /tmp/ink-pbr-preview.mjs vesper-relay.html vesper-relay.png
```
