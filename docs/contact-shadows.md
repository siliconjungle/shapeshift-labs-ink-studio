# Local contact shadows

Enable contact shadows with `look.contactShadows` in JavaScript or
`finish.look.contactShadows` in a JSON diorama. Ink casts short rays from
opaque receivers into the posed splat geometry. Nearby blockers darken the
surface with a smooth distance falloff. The shadow follows moving geometry
and uses world units, so it stays local during a camera pan or zoom.

```json
{
  "reach": 0.52,
  "strength": 0.76,
  "cast": { "include": [{ "tag": "grounding-prop" }], "exclude": [{ "material": "glass" }] },
  "receive": { "include": [{ "material": "paving" }] }
}
```

Set `reach` to the maximum distance in world units. Lower it to keep shadows
tight under boots, crates, or rail posts. Set `strength` between 0 and 1 to
limit the darkening. The defaults are 0.36 and 0.48. Cast and receive masks
use the same include/exclude selectors as the directional shadow controls.
Omit either mask to use all eligible surfaces. A value of `true` enables
the defaults and `false` disables the pass.

The headless Node renderer and CLI apply the shadow before palette resolve.
The pass uses opaque splats with surface normals. It leaves glass,
emissive effects, soft coverage, and particles out of the caster set. It
uses the traced receiver in SDF-assisted renders. Cast and receive masks
also limit the cost on dense scenes.

```sh
node cli/ink-studio.js render examples/local-contact-shadows.js \
  --w 210 --h 138 --px 1 --contact-shadows off --out harbor-off.png
node cli/ink-studio.js render examples/local-contact-shadows.js \
  --w 210 --h 138 --px 1 --out harbor-contact.png
```

Harbor Steps applies the pass to paving around the courier's boots, the
crate, the iron rail, and the plants. Use `--contact-shadows on` to preview
the defaults, or pass a settings JSON file. In Node, pass
`render(world, { contactShadows })` to override the scene setting.
