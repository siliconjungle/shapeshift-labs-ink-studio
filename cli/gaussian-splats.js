const fs = require('node:fs');
const zlib = require('node:zlib');
async function readGaussianSplat(file, options = {}) {
  const handle = await fs.promises.open(file, 'r');
  try {
    if ((await handle.stat()).size > 768 * 1024 * 1024) throw new RangeError('Gaussian file exceeds the byte limit');
    const { decodeGaussianSplat } = await import('../src/gaussian-splats.mjs');
    return await decodeGaussianSplat(await handle.readFile(), {
      decompress(codec, bytes, maxOutputLength) {
        if (codec === 'gzip') return zlib.gunzipSync(bytes, { maxOutputLength });
        if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(bytes, { maxOutputLength });
        return import('../src/zstd.mjs').then(({ decodeGaussianZstd }) => decodeGaussianZstd(bytes, maxOutputLength));
      },
      ...options
    });
  } finally {
    await handle.close();
  }
}
module.exports = { readGaussianSplat };
