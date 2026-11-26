# Font resources

Link or embed static TrueType faces in a material graph and keep the authored text editable. Ink reads family and style from the font’s typographic names, with its legacy family and subfamily as fallbacks. Set an explicit family or style on the resource to use a project-specific name. [OpenType naming table](https://learn.microsoft.com/en-us/typography/opentype/spec/name)

## Link and embed faces

A linked resource definition is `{"format":"ttf","file":"fonts/Serif-Regular.ttf"}`. Paths are relative to the material. An embedded definition uses `data` with the font bytes in Base64, plus an optional `origin` for reimport. Link one file per style and keep each resource’s stable ID.

```sh
ink-studio graph material-font sign.material.json title-regular
ink-studio graph material-font sign.material.json embed-font.json --out sign.material.json
```

The first command reports the family, style, storage, metrics, and SHA-256. The second command applies an edit request. Use `{"kind":"embed","id":"title-regular"}` to save the face bytes inside the material and retain its previous link as the origin. Other edit requests are `link` with `file` and optional `family`, `style`, or `label`, `replace` with a new resource `definition`, and `reimport` to refresh from the origin. `describeMaterialFont(document, id, options)` and `editMaterialFont(document, request, options)` expose the same workflow in Node. Use `baseDir` for relative links when operating on an in-memory document.

## Use text in a material graph

Wire a `fontAsset` node to a font resource by ID. It emits a typed `fontResource`. Use `data.record` and `font.stack` to collect several linked faces into the ordered array consumed by `draw.fontText`. The browser API `KIT.procedural.fontResources.create(bytes)` creates the same serializable face from a `Uint8Array`.

```json
{
  "family": "Source Serif 4",
  "style": "Italic",
  "fallback": [{ "family": "Night Marks", "style": "Regular" }],
  "size": 64,
  "tracking": 1.5,
  "lineHeight": 80,
  "kerning": true,
  "align": "center",
  "vertical": "top",
  "at": [380, 52],
  "maxWidth": 600,
  "wrap": "word",
  "width": 760,
  "height": 350,
  "color": "#f9d59a"
}
```

The options above select a face at a given size in pixels, add spacing between letters, and place a centered text block at a pixel anchor. Left and right alignment use the same anchor. Set `vertical` to `top`, `middle`, `bottom`, or `baseline`. Explicit line breaks remain in the text. When `maxWidth` is set, choose `word`, `character`, or `none` for soft wrapping. Use `edges: "hard"` for hard pixel coverage. The node returns a transparent raster on `value`, original text and effective settings with line and glyph metrics on `layout`, and baseline anchors on `anchors`.

Missing code points use the first fallback face that has a glyph. Layout uses the selected primary’s line metrics for a common baseline. Kerning applies between glyphs from the same font face. The glyph report identifies the face actually used and marks missing characters even when rendered with a replacement glyph. The renderer uses Ink’s horizontal TrueType layout for up to 2,048 code points. Bidirectional layout, script shaping, variable axes, and WOFF and CFF faces are outside this renderer’s scope.

Use `KIT.procedural.fontResources.layout(text, faces, options)` to get the same selected glyph run for use in [the typography APIs](typography.md). Use `render` for the same raster, metrics, and anchors as the graph node.

## Publish a text graph

```sh
ink-studio graph publish-subgraph sign.material.json --out sign.group.json --revision 1
```

Publishing a group pins linked and embedded font bytes from the material into the group. It replaces local font asset lookups with embedded lookups, including lookups in inline nested groups. The input defaults, links, and inspector controls continue to carry authored text and layout settings. Consumers can use the defaults or wire their own text and layout. Shared external groups can receive the font resources through typed inputs or be published independently with their own fonts. Other material resources and base settings still use the existing subgraph interface.

## Try The Night Atlas

```sh
node scripts/build.js node
node examples/font-resources/demo.cjs /tmp/ink-font-demo
```

Open the generated `index.html`. Choose Italic and adjust spacing, then turn off Glyph fallback to compare the moon and star with their replacements. Save a group and reopen it to get the same sign with the same faces. The companion material links to Adobe Source Serif 4 and embeds Night Marks, an original fallback font for the two symbols. [Adobe Source Serif release](https://github.com/adobe-fonts/source-serif/releases/tag/4.005R)
