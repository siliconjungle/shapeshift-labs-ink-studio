# Material-aware secondary emission

A primary particle can hit a receiving surface and emit whatever that material's response recipe defines. A basin can launch a projected ripple while a stone landing produces a short burst of sparks. The hit position and time come from the flight, and the renderers sample the same recorded impact when playing, scrubbing, or exporting.

## Author portable particle flights

Put the launch track next to the recipe and any manually authored contacts in a JSON diorama at `finish.materialResponse`.

```json
{
  "recipe": {
    "format": "ink-studio/material-response",
    "version": 1,
    "materials": {
      "water": {
        "chart": { "bounds": [-4, -1, 0, 1] },
        "ripple": { "color": "#a9e5d6", "speed": 1.25 }
      },
      "stone": {
        "particles": { "color": "#ffcb78", "count": 22, "duration": 0.64 }
      }
    }
  },
  "particleImpacts": {
    "receivers": [
      { "id": "basin", "material": "water", "y": 0, "bounds": [-4, -1, 0, 1] },
      { "id": "paving", "material": "stone", "y": 0, "bounds": [0, -1, 4, 1] }
    ],
    "particles": [
      { "id": "left", "time": 0.3, "point": [-2, 1.6, 0], "velocity": [0, -2, 0] },
      { "id": "right", "time": 0.3, "point": [2, 1.6, 0], "velocity": [0, -2, 0] }
    ]
  }
}
```

Each receiver is a bounded horizontal plane in world units. Align its Y height and XZ bounds with the visible geometry, and use the material ID from the response recipe. A particle hits when the bottom of its radius crosses a plane from above and its center lands inside the XZ bounds. The minimum bounds are inclusive and the maximum bounds are exclusive. The first eligible crossing wins. Equal-time hits use the first receiver in the list.

Authored particles take the launch time, XYZ point and velocity, and optional downward `gravity` (default 9.81), `radius` (default 0.035), `life` (default 2 seconds) and `color`. The primary disappears at impact or expiry. Ink supports up to 512 launches and 32 receiver planes per track. A receiver can have no response rule, which lets it catch a primary without spawning a secondary. Sparks are depth tested and ripples stay on the selected receiver material.

`KIT.particleImpacts.compile` gives hosts the same collision receipts and seekable primary frames. `track.impacts(time)` lists the material-response impacts through that time. Each receipt identifies the particle and receiver. `track.snapshot()` stores the authored launches and manual contacts, so editing the launch track causes hits to be recalculated when reopening. The [effect pixel inspector](material-response.md#inspect-a-pixel) traces a visible secondary back to its primary collision.

## Connect live splat particles

```js
const track = KIT.materialResponse.create(recipe);
track.bind(world);
const particles = stage.add(KIT.particles(stage, pool, {
  impacts: { track, receivers, source: 'runoff' }
}));
particles.emit({ p: [-2, 1.6, 0], v: [0, -2, 0], life: 2, size: 0.06 });
```

The live system sweeps the moving particle across the same receiving planes during each update and records the first impact at its time within the update. Use a distinct `source` for independent emitters whose pools may share an ID. Set `materialImpact: false` on an emission to keep it on the ordinary particle path. Material-response secondaries have their own renderer lifetime and do not feed back into the collision system. The material response track retains up to 2,048 contacts, including live impacts.

## Kiln Runoff

The [editable recipe](../examples/secondary-emission/scene.cjs) drops matching particles over a basin and a stone deck.

```sh
node -e 'console.log(JSON.stringify(require("./examples/secondary-emission/scene.cjs")()))' > kiln-runoff.json
node cli/ink-studio.js effect impacts kiln-runoff.json --t 0.99
node cli/ink-studio.js render kiln-runoff.json --w 336 --h 172 --px 1 --raw --t 0.99 --out kiln-runoff.png
```

Build and open the offline demo with a bundled WebGL renderer.

```sh
npm exec --yes --package=esbuild@0.25.12 -- esbuild examples/effect-recipes/preview.mjs --bundle --format=esm --minify --outfile=ink-renderer.mjs
node examples/secondary-emission/build-demo.cjs ink-renderer.mjs kiln-runoff.html
```
