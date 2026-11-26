# SVG and vector resources

Use a vector resource when a material needs editable curves and an SVG delivery file. A resource retains the ordered element tree, path endpoints and controls, elliptical arcs, presentation attributes, transforms, and the viewport. Import expands relative and shorthand path commands into absolute segments. SVG export normalizes the XML and keeps the curve geometry, paint order, and stable element keys. [SVG path grammar](https://www.w3.org/TR/SVG2/paths.html)

The importer supports passive SVG artwork. It accepts paths, basic shapes, nested viewports, groups, gradients, clip paths, and same-document references. Set paint with presentation attributes or supported inline properties. Convert text to paths and expand features such as stylesheet-based styling, filters, and embedded raster images before import. [SVG painting](https://www.w3.org/TR/SVG2/painting.html)

## Link and edit a material resource

Define a resource as `{"format":"svg","file":"art/night-ferry.svg"}` relative to the material file. An embedded resource uses `{"format":"svg","document":{...}}` and may keep its previous file path as `origin` for an explicit reimport. Point an `svgAsset` node at the resource ID. The node publishes a typed `vectorDocument`.

```sh
ink-studio graph material-vector material.json ferry
ink-studio graph material-vector material.json vector-edit.json --out material.json
```

The first command reports the resource origin, viewBox, and element keys for use in edits. The second applies a request. In Node, use `describeMaterialVector(document, id, { baseDir })` and `editMaterialVector(document, request, { baseDir })`. A successful edit creates an embedded document and retains the resource ID and its origin. Other requests are `link` with `file`, `embed`, `reimport`, and `replace` with a new `definition`.

```json
{
  "kind": "edit",
  "id": "ferry",
  "edits": [
    {
      "kind": "point",
      "key": "swell",
      "segment": 2,
      "handle": "c1",
      "at": [226, 267],
      "tangent": "mirrored"
    },
    {
      "kind": "attributes",
      "key": "compass-ring",
      "attrs": { "fill-rule": "evenodd", "stroke-width": "1.5" }
    },
    { "kind": "move", "key": "swell", "parent": "waterfront", "index": 0 }
  ]
}
```

Point edits use local coordinates and a zero-based segment index. Adjust an endpoint with `end`, cubic controls with `c1` or `c2`, or a quadratic control with `control`. Cubic handles default to `free`. Choose `aligned` to preserve the other handle’s length or `mirrored` to match it. Moving an endpoint carries neighboring cubic controls unless `translateHandles` is false. Use `path` with a new `d` or `segment` with a zero-based `segment` index and a replacement command in `value` to change topology. Use `attributes` for styles, transforms, geometry, or viewBox, and set a value to `null` to remove it. A `move` reparents the element in local coordinates and optionally sets its index in the destination group. Existing IDs and reference targets are validated as a batch. [SVG coordinate systems and viewBox](https://www.w3.org/TR/SVG2/coords.html)

## Use vectors in a graph

| Operation | Ports |
| --- | --- |
| `vector.import` | Parse SVG `svg` text into a `vectorDocument`. |
| `vector.edit` | Apply an ordered array of `edits` to a vector `source`. |
| `vector.export` | Encode a vector `source` as SVG text. For file delivery, declare an export with `format: "svg"` on a typed vector output. |
| `vector.path` | Sample one element `key` to a typed path and return all contours separately. Set `index`, `space`, `tolerance`, or `maxPoints` in `options`. |
| `vector.fillMask` | Sample the selected element’s filled geometry to a grayscale mask using `width`, `height`, optional `rule`, and 1, 2, or 4 samples per axis. |

Contour and mask extraction take a path or basic shape in document geometry. Use user units or px for geometry lengths. Fill masks apply transforms and the selected winding rule. They represent geometric coverage before styles, strokes, or clipping. The SVG output retains those presentation properties.

## Try Night Ferry

```sh
node scripts/build.js node
node examples/vector-resources/demo.cjs /tmp/ink-vector-demo
```

Open the generated `index.html` in a browser. Drag a handle on the swell, then select the compass ring and switch its winding rule to see how it changes the mask. The same session can save a portable material or export a standalone SVG.
