# Scene reels

Export an ordered set of Studio captures to one offline HTML file. A reel
uses the same headless renderer, scene looks and animation sampling as
`render` and `clip`. It works with Studio's demos and with a project's
`ink-studio.config.js` scene collection.

```json
{
  "format": "ink-studio/reel",
  "title": "Workshop studies",
  "width": 640,
  "height": 360,
  "pixelSize": 2,
  "fps": 12,
  "shots": [
    { "scene": "watcher", "label": "The watcher", "from": 1.2, "hold": 2 },
    { "scene": "burn", "label": "Slow burn", "from": 0, "to": 2,
      "camera": { "orbit": 16 } }
  ]
}
```

```sh
ink-studio reel studies.json --out studies.html
ink-studio reel studies.json --out clean-studies.html --clean
```

Run the command from the project whose scene IDs you want to use. Scene
files such as `./workshop.js` and `./harbor.json` resolve relative to the
manifest. A still samples `from` seconds (default zero) and holds for
`hold` seconds (default three). Add `to` for a motion capture at the reel's
FPS, with at least one frame interval between the two times. Each shot can set a `seed`, and its optional `camera` record accepts
`target` (XYZ), `yaw` and `pitch` in radians, and `zoom`. Motion captures
also accept `pan` (world XYZ offset) and `orbit` (degrees over the shot).
The canvas size is fixed across the reel. `pixelSize` sets the art pixel
scale and must divide both dimensions.

Open the file, pick a shot or use the arrow keys, and press Space to start
or stop the sequence. H or a double-click toggles the controls. Escape
restores them. `--clean` opens with just the capture view. The file embeds
the rendered stills and animated PNGs and can play without a server or the
source project. Camera motion is rendered into each shot.

For Studio engine changes that affect Rebirth, use its
[reference consumer checks](https://github.com/siliconjungle/inkwell-rebirth/blob/main/benchmarks/README.md).
That command runs the real game's chunk, portal and local rebake workloads
alongside its cast movement goldens against a supplied Studio checkout.
