# Material validation

Review a material before delivery. The validator checks physical samples, declared map conventions and target format constraints. An offline review shows the affected texels over each map. The report names the evaluated graph producer and includes brush layer IDs when paint evidence is available.

```sh
ink-studio graph validate-material copperleaf.material.json --output surface --profile validation.json --out review
```

Open `review/index.html`. Select a map and a finding to see its overlay, bounds, source and representative values. Click a flagged texel to see its source. Empty marker space means the selected issue did not affect that texel. Map-wide issues such as orientation show the contract comparison in the review and in `report.json`. Validation exits with status 2 on errors after writing the report. Warnings leave it at status 0.

## Choose a target and expectations

Omit `--output` when the graph has exactly one material packet output. Use `--node GROUP/NODE --port NAME` to review an intermediate, and `--channel NAME` to isolate a packet map or assign its material role to a standalone image. A named record of images can also be reviewed. Use `project.validateMaterial(target, profile, runOptions)` in Node. Use `material.validate` in a graph for the physical and encoding checks and a Boolean `passed` output.

```json
{
  "required": ["baseColor", "normal", "height", "roughness"],
  "aligned": true,
  "normalTolerance": 0.025,
  "displaySpace": "srgb",
  "maps": {
    "height": {"range": [-0.1, 0.8], "units": "mm", "delivery": {"format": "exr", "bitDepth": 32}},
    "normal": {"normalSpace": "tangent", "normalOrientation": "opengl"},
    "baseColor": {"delivery": {"format": "png", "bitDepth": 16}}
  }
}
```

The default physical checks constrain reflectance, roughness, metalness, AO, opacity, and masks to [0,1]. Linear emission can exceed one. Normals must have unit length within the requested tolerance, and a rear-facing tangent normal gets a warning. Height is signed and has no universal limit. Provide a measured range and units for the asset. Per-map expectations can also name `colorSpace`, `alpha`, and `precision`. Alignment is optional because some material packets deliberately mix map resolutions or UV domains.

A bounded output can clip a sample that is valid in its working color space. Named deliveries matching the selected output supply a default format, with bounded deliveries preferred when multiple rows use the same map. Set a per-map `delivery` to inspect a different target. Display clipping is a warning for an otherwise valid HDR or wide-gamut master. Set `displaySpace:null` to omit display gamut warnings. Delivery clipping and actual clipped samples in paint or explicit `image.convert` clamping are errors. Format checks include signed height storage, PFM component counts and half-float overflow.

## Follow the evidence

A material pack, unchanged map, or reusable group can pass an image through. The graph review follows that reference to the original producer. A node that generates new texels is reported as their producer. Validation collects last-changing brush ownership for painted samples and detects when a bounded paint canvas clamps values before storing them. It also records the rejected values when an explicit conversion clamps. If a brush or node fails during evaluation, the graph review records its path and the available layer ID.

The normal graph runner continues to enforce typed-image contracts. To inspect imports that have not passed a contract, supply a named record of raw or typed-shaped rasters to the Toolkit validator. This preserves evidence such as NaN, infinity or malformed sample encodings for review.

## Copperleaf demo

```sh
node examples/material-validation/demo.cjs /tmp/ink-copperleaf
```

Open `review/index.html` to inspect two clipped brush layers, the roughness boost in a reusable group, an encoded emission conversion and a normal convention mismatch. Open `approved/index.html` for the revised material.
