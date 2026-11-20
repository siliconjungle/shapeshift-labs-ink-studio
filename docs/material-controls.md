# Consistent material controls

`K.material` (also exported as `MaterialControls`) supplies a shared authoring
descriptor for roughness, metalness, IOR, transmission and coatings. It compiles
to existing surface finishes, optical slabs and model-export channels. SDFs and
splats remain the geometry; using the descriptor is optional. No packages,
external assets or runtime downloads are required.

```js
const bronze = K.material.apply({ r: [13,14,15,16,17,18] }, {
  roughness: [.12,.48], metalness: 1,
  coating: { weight: .2, roughness: .09, ior: 1.5 }
});
S.torus([0,1,0], .8, .2, bronze, { res: .05 });

// The same descriptor can be attached directly to a normal sculpt material.
S.box([2,1,0], [.8,.8,.04], {
  r: [7,8,9,10], controls: {
    roughness: .1, ior: 1.52, transmission: .9, thickness: .08
  }
}, { ghost: true, res: .06 });
```

The [material atelier](../examples/material-controls.html) compares porcelain,
brushed bronze, an optical slab and six fixed reference samples. Change a bound
material, move the key light or orbit freely. Its atlas labels remain independent
of the material controls.

## Descriptor

| Property | Default | Meaning |
| --- | --- | --- |
| `roughness` | `.45` | Scalar or `[along, across]`, each in 0–1. Zero maps to the existing finite minimum highlight width `.001`. |
| `metalness` | `0` | 0–1; suppresses diffuse response and tints the highlight and environment return with the authored material color. |
| `ior` | `1.5` | Dielectric index, 1–4. Facing reflection uses `((ior-1)/(ior+1))²`. |
| `transmission` | `0` | 0–1; intrinsic transmission through a carrier, reduced by `1-metalness`. |
| `thickness` | `.1` | Slab thickness in world units, `.0001`–1024. |
| `absorption` | `0` | Neutral volumetric extinction, 0–32 per world unit; thickness and view angle determine the path. |
| `color` | inferred | Optional `#rrggbb` or normalized RGB conductor tint. Otherwise use explicit albedo or the light end of the sculpt's palette ramp. |
| `coating` | disabled | A 0–1 weight, `false`, or `{weight, roughness, ior, color}`. Object defaults are weight 1, roughness `.12`, IOR `1.5`, white. |

Anisotropy uses the existing surface `direction`: an axis or XYZ vector sets
along/across orientation. Coating roughness and IOR are independent of the base.
Unknown properties, nonfinite values and out-of-range coefficients are rejected.
`describe(settings)` returns an immutable, JSON-portable descriptor. Applying
controls creates a new material rather than editing its input.

## How the mapping works

This is a stylized material model. The familiar coefficients author the existing
layer system; they do not enable a separate physically based renderer.

The compiler produces four named finish slots, in order:

1. `control-diffuse`: a diffuse reduction as metalness increases.
2. `control-reflection`: the existing three-color environment return, with a
   Fresnel boundary derived from IOR and a roughness-dependent contribution.
3. `control-specular`: the existing anisotropic highlight, with conductor tint
   and roughness-dependent strength.
4. `control-coating`: an independent specular highlight above the base finish.

Existing authored surface settings merge over those defaults. Additional sheen,
thin-film, diffraction, glint and other finish layers are preserved, in their
existing order. The headless renderer evaluates that complete finish stack.
The native GPU path evaluates the four control slots and preserves the existing
palette, pixel brushes and fine-detail rendering using the shared relative-light
table. It does not add native implementations of unrelated legacy finish types.
Native control-slot overrides support colors, roughness, strength, rotation and
steps. Put custom masks or signal-driven effects in separate authored layers;
the native control slots reject those features rather than silently ignoring them.

Metal tint comes from the authored ramp, not its shadowed display color. Scalar
roughness and metalness also map to existing `model.roughness` and
`model.metallic` export channels. An along/across pair exports its mean as scalar
roughness. The descriptor and finish settings remain available on the baked
surface binding and survive normal splat provenance joins and subsets.

Transmission reuses `OpticalMaterials` and the existing per-contribution depth
tests. A slab's new intrinsic `coverage` is `1-effectiveTransmission`. Facing
opacity is `F₀ + (1-F₀)*coverage` before additional Beer absorption. The covered
portion keeps its painted surface response; reflection uses the optical profile's
existing tint. This avoids representing a thin partially transmitting slab with
extremely large absorption coefficients. Legacy profiles default coverage to
zero and retain their previous coefficients and packed stride. Coverage is a
surface-slab property; volumetric water/fog profiles retain their existing model.

`thickness`/IOR use the existing stylized optical system. This descriptor does
not add Snell-law ray bending or colored spectral extinction. Keep using the
existing glass, water, scattering, refraction and reflection bindings where
those effects are wanted. An explicitly authored `optical` profile overrides
the corresponding generated optical fields.

## Live edits and inspection

```js
// Binding IDs are one-based, as in world.surfaceData; find a named surface.
const binding = world.surfaces.findIndex(s => s.settings.name === 'bronze') + 1;
K.material.update(world, binding, { roughness: [.08,.5], coating: {weight: .8} });
// Replace the whole descriptor, rather than patching current controls:
K.material.update(world, binding, { roughness: .8 }, { replace: true });
```

Updates validate first, then replace only that binding's finish/profile. They
preserve carrier geometry and unrelated optical records and increment
`world.materialRevision`. Replacing settings also invalidates the native cache;
for manual in-place edits, increment this revision or pass `frame.materialRevision`.
Use these edits on geometry baked for the required visibility: material changes
cannot recover surfaces culled from an earlier opaque bake. Bake a separate or
ghost pane when the scene behind it needs to remain available.

`resolve(material, {palette})` exposes the compiled material. Hex integer palettes
use ordinary `0xrrggbb`; the sculpt adapter also accepts its internal byte palette.
`inspect(descriptorOrMaterial, {palette})` reports normalized controls, dielectric
F₀, effective transmission, named layer settings, optical coefficients and export
channels. It does not mutate the supplied material.

```sh
ink-studio material-controls bronze.json --palette colors.json --out report.json
```

Diorama JSON accepts the same object as `solids[].mat.controls`. It validates
before building, reports the material path on failure, and uses the usual role
or ramp for color. Existing materials without controls use their existing path.

The browser finish pass is opt-in per controlled surface. It caches static
parameters and normals, follows CPU rig normals and native bone/orbit poses,
and computes view-dependent response on the GPU. It composes with existing
relative lighting and shaped emitters, including patterned pixels, and disposes
its resources with the renderer. It requires WebGL 2 and
`EXT_color_buffer_float`, like the native floating-point lighting passes.
`frame.materialLight` optionally supplies a nonzero XYZ key direction; otherwise
use `world.surfaceLight` or the sculpt's captured surface-light direction.
`frame.materialControls: false` disables this finish pass for comparison while
leaving baked geometry and optical profiles intact. Raw rendering retains the
surface lighting and skips palette/post processing, as with shaped lights.
