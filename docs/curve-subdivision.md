# Projected-error curve subdivision

Enable `look.curveSubdivision` on a scene to adapt its authored finite curve spans to each camera. The WebGL renderer and the headless renderer use the same planner. At a close view the planner keeps additional spans for visible bends, tapered widths, twist, and changes in depth. A straight run with one appearance can use one span. A distant view can use longer spans because the same deviation covers fewer art pixels.

The planner starts from the source's baked curve spans. It tests a replacement chord against those samples and splits the interval when it exceeds the budget. Dense source samples provide detail for close views. Use the normal spline sampling and profile controls to raise the maximum available detail.

```js
renderer.render(world, {
  width: 320,
  height: 180,
  curveSubdivision: { pixels: 0.20, depthPixels: 0.15 },
  curveFrame: frame => console.log(frame.subdivision)
});
```

`true` sets both budgets to 0.25 art pixels. `pixels` controls projected centerline and section deviation, including width and roll. `depthPixels` controls the axial centerline deviation after conversion to art pixels at the local depth. It defaults to `pixels`. Both budgets accept values above zero and up to four. A frame can override the scene setting with `false` for the dense reference.

Contiguous spans share a chord only when their strand, opacity, pigment, and material agree. Caps with clip planes, timed windows, patterned spans, and gaps retain their authored samples. The planner also retains spans near camera and entry planes. Cutaways use dense spans. Headless rendering also retains the original spans for projected width rules, shutter samples, and probes. Subdivision leaves the authoring rows available for editing and reports. WebGL reports counts through `curveFrame`, and headless records them under `renderStats.curveSubdivision`.

The test bounds geometric error. A hard edge can still change which side of a pixel center it covers, so use matched captures to pick a budget for a shot.

## Review dense and adaptive renders

```sh
node scripts/build.js node
node cli/ink-studio.js curve-subdivision-review --hardware --out out/curve-subdivision-review
```

The [Ribbon Survey fixture](../examples/curve-subdivision-review.js) includes a straight lead, a tapered bend, a rolling compact ribbon, and an axial wave. The review saves dense and adaptive frames for both renderers at two distances. It also includes difference images, span counts, and WebGL tile references. To override subdivision on an existing CLI still or clip, use `--curve-subdivision on`, `off`, or a pixel value such as `0.20`.
