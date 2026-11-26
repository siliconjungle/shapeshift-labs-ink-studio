# Material lighting room

Open a material graph under reusable HDR environments with an independent camera and backdrop.

```sh
ink-studio graph lighting-room material.material.json room.plan.json --out room
```

Open `room/index.html` in a WebGL 2 browser. Drag to orbit, scroll to dolly, or set the angle, distance, focal length, sensor height, normalized framing point, and projection in the camera controls. A room can offer a sphere, plane, or cube. **Reset camera** restores the lens and framing of the selected rig.

**Rotation** turns the light and reflections around the vertical axis. **Light exposure** scales the incoming radiance in stops. **Camera exposure** applies to the final view before tone mapping. **Show panorama** controls the backdrop alone, so the same reflection and diffuse response can be judged against neutral charcoal. The room shades base color, tangent normals, roughness, metalness, emission, and cutout opacity using diffuse irradiance and roughness-filtered environment reflections.

## HDR environments and rigs

Start with neutral softboxes, an even field, or a raking strip. The browser imports equirectangular Radiance `.hdr` or `.rgbe` files directly. In a plan or rig file, use `environment.file` to import Radiance RGBE, flat scanline RGB OpenEXR, or RGB PFM. Room panoramas use a 2:1 aspect ratio and are stored as linear RGBE at up to 1024 × 512. The importer brings declared color primaries into linear sRGB. RGBE scanline and pixel conventions follow the [Radiance picture format](https://radsite.lbl.gov/radiance/refer/Notes/picture_format.html). Diffuse irradiance uses [nine spherical-harmonic coefficients](https://graphics.stanford.edu/papers/invlamb/).

**Save rig** keeps a named version in the active room and downloads its JSON. **Load rig** recalls a JSON in any room. The rig holds the HDRI or neutral preset, its rotation, lighting exposure and backdrop state, plus the camera. The preview carrier is selected independently. Files generated in `room/rigs` have the same portable format. Any external paths in a rig resolve relative to that rig's file. Inline rig paths resolve relative to the plan.

## Example room plan

```json
{
  "format": "ink-studio/lighting-room",
  "version": 1,
  "label": "Ceramic study",
  "source": { "output": "ceramic" },
  "selected": "porcelain",
  "rigs": [
    {
      "format": "ink-studio/lighting-room-rig",
      "version": 1,
      "id": "porcelain",
      "label": "Porcelain daylight",
      "environment": { "file": "studio.hdr", "rotation": 35, "exposureEV": 0.5, "background": false },
      "camera": { "focalLength": 36, "sensorHeight": 24, "distance": 4, "framing": [0.52, 0.45] }
    }
  ],
  "carriers": ["sphere", "plane", "cube"],
  "view": { "width": 600, "height": 440, "textureSize": 512 }
}
```

A source can reference a material packet or a base-color image. To assemble individual maps, use a `maps` object in place of `source`. Each key names a supported lighting channel and each value is a watch such as `{"output":"clay-normal"}` or `{"map":"glaze-roughness"}`. Use the graph command's input, instance, base context, time, and seed options for material variants. Node exposes `createLightingRoom` for the assembled data and `writeLightingRoom` for the offline room.

## Lightwell demo

```sh
node scripts/build.js node
node examples/lighting-room/demo.cjs /tmp/ink-lightwell
```

Pass a local 2:1 HDR panorama as the third command-line argument to include the photo studio rig. The demo's example panorama is [Studio Small 09 by Sergej Majboroda, CC0](https://polyhaven.com/a/studio_small_09).
