# Geometric caustic projection

`KIT.lightEmitters.caustic` builds a colored light cookie from authored
glass. The baker traces rays through the entry and exit surfaces, then
accumulates the transmitted light where those rays reach a reference
plane. Connect the result to an existing spot or area light. The CPU
and WebGL renderers use the same cookie bytes on splats, posed characters,
textured surfaces, and lit fog.

```js
const cookie = KIT.lightEmitters.caustic({
  width: 160, height: 128, samples: [156, 128],
  angle: 24, focus: 5.2, exposure: 1.2, period: 6,
  lens: {
    size: [1.8, 1.5], distance: 1.35, thickness: .65, sagLimit: .29,
    ior: [1.46, 1.49, 1.53],
    front: (x, y) => .084 * (x*x + y*y) + .041 * Math.cos(8*x + 3*y),
    back: (x, y) => -.048 * (x*x + y*y),
    rotation: time => .5 * Math.sin(2 * Math.PI * time / 6)
  }
});
world.volumeLighting = { spots: [{
  at: [0, 3.9, 2.4], direction: [0, -.54, -1],
  innerAngle: 25, outerAngle: 35, radius: 12,
  color: '#ffffff', intensity: .2, surfaceIntensity: 18, cookie
}] };
```

## Lens space

The emitter origin is `[0, 0, 0]` in the bake. Positive Z points along
the light. X and Y follow the cookie's image axes with Y up. Distances
use world units. For a visible glass mount, place the glass to match
the lens distance and the projector orientation in the scene.

| Lens option | Meaning |
| --- | --- |
| `size: [width, height]` | Rectangular domain of the two surfaces. Defaults to `[1, 1]`. |
| `distance`, `thickness` | Depth of the entry surface's reference plane and separation between the reference planes. Defaults are 1 and .32. |
| `front`, `back` | Constant signed depth offsets or `(x, y, time) => sag` functions, measured along +Z from each reference plane. Both default to zero. Use smooth profiles so exit intersections are well defined. |
| `sagLimit` | Bound on both offsets, below half the thickness and below the entry distance. Defaults to .45 of the thickness. |
| `aperture` | `'ellipse'` (default), `'rectangle'`, or `(x, y, time) => coverage` returning 0 through 1. |
| `ior`, `tint` | A refractive index or three RGB indices from 1 through 4. Distinct RGB indices give stylized dispersion. The default IOR is 1.5. Tint is a linear RGB multiplier, defaulting to white. |
| `center`, `rotation` | In-plane translation as `[x, y]` and in-plane rotation in radians. Each accepts a constant or a time function. The sag and aperture use coordinates local to this pose. |

## Projection and reuse

- `focus` is the reference-plane distance from the light and must lie
  beyond the lens. Choose it near the primary receiver. The rest of
  the scene receives the angular projection of the reference map.
- `incident: 'point'` aims rays from the light origin. `'parallel'`
  sends them along +Z for a collimated look. The bake uses single-pass
  transmission at both interfaces, including Fresnel loss and rejection
  of total internal reflection and rays that miss the exit aperture.
- `samples: [nx, ny]` controls the lens sampling grid. `width` and
  `height` control the output raster. Defaults are 128² samples and
  a 128² raster. The lens grid is capped at 65,536 samples and the
  raster at 131,072 texels. `blur` sets the Gaussian radius in texels
  (default 2). `exposure` maps accumulated light into the 8-bit cookie
  (default 1).
- Standard cookie `angle`, `up`, `roll`, `offset`, `repeat`, `wrap`,
  and `filter` still apply. `angle` is a vertical half-angle in degrees
  and defaults to 24. Filtering defaults to linear. Lens `rotation`
  happens inside the ray bake. Cookie `roll` rotates the baked projection.
- `period` wraps the time passed to the lens. `cookie.frame(time)`
  returns an ordinary RGB cookie for export or reuse. Serializing
  `cookie` alone exports its time-zero raster. `LightCookies.prepare`
  and `LightCookies.invalidate` also accept the animated cookie.
- Existing scene shadow tests clip the light with arches and other
  occluders. Apply it to a submerged receiver and the existing water
  optics shade and refract the lit surface. Set the water body's
  procedural `caustics` strength to zero when the lens supplies the
  entire projected effect.

The refraction and transmission terms follow [*Physically Based Rendering*,
Specular Reflection and Transmission](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission).
See [Wyman and Nichols on caustic maps](https://cwyman.org/papers/eg09_adaptiveCaustics_small.pdf)
for the reference-map technique.

## Render the studies

[Prism Arch and Glass Walker](../examples/geometric-caustic-studies.js)
show a rippled lens projecting through a stone opening into a shallow
water basin and a refracted RGB pattern falling across a moving rig.

```sh
node cli/ink-studio.js clip examples/geometric-caustic-studies.js --w 850 --h 520 --to 6.4 --fps 10 --out prism-arch.png
node cli/ink-studio.js clip examples/geometric-caustic-studies.js --params '{"study":"walker"}' --w 850 --h 520 --to 6.4 --fps 10 --out glass-walker.png
```
