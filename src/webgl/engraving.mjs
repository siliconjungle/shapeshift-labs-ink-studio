import { createAttachedData } from './attached-data.mjs';
export function createEngravingBinding(api) {
  const pack = createAttachedData();
  const emptyMeans = new Float32Array(8);
  let bag, frames, count, metadata, params, fields, styles;
  return (world, base, dirty, light) => {
    const b = api.validate(world),
      live = world.splatFootprints?.frames;
    if (b !== bag || live !== frames || world.count !== count) {
      api.validate(world);
      if (!live) throw new Error('Engraving needs retained surface axes');
      const sameRows =
        bag &&
        b.indices === bag.indices &&
        b.anchors === bag.anchors &&
        b.restFrames === bag.restFrames &&
        frames === live &&
        count === world.count;
      if (!sameRows) {
        metadata = new Float32Array(world.count * 16);
        for (let i = 0; i < b.indices.length; i++) {
          const id = b.indices[i];
          if (!id) continue;
          const k = i * 6,
            q = i * 16,
            a = i * 3;
          metadata.set(
            [
              id,
              ...b.anchors.subarray(a, a + 3),
              ...b.restFrames.subarray(k, k + 3),
              live[k],
              ...b.restFrames.subarray(k + 3, k + 6),
              live[k + 1],
              live[k + 2],
              live[k + 3],
              live[k + 4],
              live[k + 5]
            ],
            q
          );
        }
      }
      if (styles !== b.styles || count !== world.count) {
        fields = [...new Set(b.styles.map(s => (s.screenPrint ? api.print.pack(s.screenPrint) : api.maps(s).data)))];
        params = new Float32Array(16 * 9 * 4);
        let row =
          Math.ceil((world.count * 16) / 8192) + Math.ceil(metadata.length / 8192) + Math.ceil(params.length / 8192);
        const fieldRows = new Map();
        for (const field of fields) {
          fieldRows.set(field, row);
          row += Math.ceil(field.length / 8192);
        }
        b.styles.forEach((s, i) => {
          const field = s.screenPrint ? api.print.pack(s.screenPrint) : api.maps(s).data,
            means = s.screenPrint ? emptyMeans : api.maps(s).levels[2].means;
          params.set(
            [
              fieldRows.get(field) * (s.screenPrint ? -1 : 1),
              s.screenPrint ? +(s.screenPrint.space === 'screen') : s.resolution,
              ['plane', 'cylinder', 'sphere', 'triplanar'].indexOf(s.projection),
              ['normal', 'luminance', 'hybrid'].indexOf(s.tone),
              s.scale,
              s.density,
              s.contrast,
              s.bias,
              ...s.ink,
              s.strength,
              ...s.paper,
              s.ambient,
              ...s.origin,
              s.radius,
              ...s.along,
              s.lodBias,
              ...s.across,
              0,
              ...means
            ],
            i * 36
          );
        });
      }
      bag = b;
      frames = live;
      count = world.count;
      styles = b.styles;
    }
    const result = pack(base, world.count * 16, [metadata, params, ...fields], dirty);
    return {
      ...result,
      uniforms: {
        u_engravingRows: result.offsets[0],
        u_engravingSettings: result.offsets[1],
        u_engravingLight: api.light(light)
      }
    };
  };
}
