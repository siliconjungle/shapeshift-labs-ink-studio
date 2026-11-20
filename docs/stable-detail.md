# Stable detail levels

Set `look.stableDetail` to `true` to ease fine details in and out as their projected size changes. The renderer measures features in native art pixels and smooths their contribution before palette resolve. This uses the current camera and needs no frame history.

| Channel | Default fade range | Features |
| --- | --- | --- |
| `texture` | 0.55 to 1.65 pixels | Fine ink tiles blend toward their underlying color. Headless surface finishes also fade small projected motifs and layers with an authored detail size. |
| `geometry` | 0.35 to 1.45 pixels | Small static decorative splats marked `nd:true` fade by their projected diameter. Sculpt materials can set `fl:{nd:true}` for separate decorative geometry. Main opaque geometry retains its coverage. |
| `specular` | 0.50 to 1.60 pixels | The headless finish renderer fades glints using their cell size and radius. Other finish highlights can set a world-space `detailSize` on the layer. |

A two-element array sets the size at which a contribution is gone and the size at which it returns to full strength. Use `false` to disable one channel. Node and WebGL accept the same `stableDetail` frame option. WebGL applies the fine ink tile and splat geometry fades through its native shaders.

```js
const look = {
  stableDetail: { texture: [0.6, 1.8], geometry: [0.3, 1.4], specular: [0.5, 1.7] }
};
const finish = {
  layers: {
    polish: { type: 'specular', roughness: 0.26, strength: 0.45 },
    flakes: { type: 'specular', roughness: 0.09, strength: 0.3, detailSize: 0.085 }
  }
};
```

Use a layer's `detailSize` for custom small features such as a projected raster grain overlay. This lets larger painted shapes, broad specular highlights, and reflections keep their authored response. Keep silhouette-defining parts on the ordinary opaque geometry path.

Use [scale-aware previews](scale-aware-previews.md) when the camera should choose which generator level to build before applying these render-time fades.

## Review a camera move

```sh
node cli/ink-studio.js shimmer examples/stable-detail.js --mode pan \
  --frames 28 --step .014 --w 144 --h 88 --px 1 --raw --stable-detail off --out pan-off.gif
node cli/ink-studio.js shimmer examples/stable-detail.js --mode pan \
  --frames 28 --step .014 --w 144 --h 88 --px 1 --raw --stable-detail on --out pan-on.gif
```

For zoom, substitute `--mode zoom --step .012`. The command reports the share of pixels that change and then return to their previous color. Use `--stable-detail file.json` to compare custom ranges.
