/* SPZ v4 stores one Zstandard frame per attribute stream. */
function validateFrame(bytes, expected) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 9 || data.getUint32(0, true) !== 0xfd2fb528)
    throw new Error('Invalid Zstandard frame');
  const descriptor = bytes[4], single = Boolean(descriptor & 32), sizeCode = descriptor >> 6;
  const dictionaryBytes = [0, 1, 2, 4][descriptor & 3];
  if (dictionaryBytes || descriptor & 8) throw new Error('Unsupported Zstandard frame dictionary or flags');
  let offset = 5;
  if (!single) {
    const window = bytes[offset++];
    const base = 2 ** (10 + (window >> 3));
    const size = base + base / 8 * (window & 7);
    if (size > Math.max(expected, 8 * 1024 * 1024)) throw new RangeError('Zstandard window exceeds the SPZ stream limit');
  }
  const sizeBytes = sizeCode ? 2 ** sizeCode : single ? 1 : 0;
  if (offset + sizeBytes > bytes.length) throw new Error('Truncated Zstandard frame header');
  if (sizeBytes) {
    let size = 0;
    for (let i = sizeBytes - 1; i >= 0; i--) size = size * 256 + bytes[offset + i];
    if (sizeBytes === 2) size += 256;
    if (size !== expected) throw new Error('Zstandard frame size does not match the SPZ stream');
    offset += sizeBytes;
  }
  let last = false;
  while (!last) {
    if (offset + 3 > bytes.length) throw new Error('Truncated Zstandard block header');
    const header = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    last = Boolean(header & 1);
    const kind = header >> 1 & 3, blockSize = header >> 3;
    if (kind === 3 || blockSize > 128 * 1024) throw new Error('Invalid Zstandard block');
    offset += 3 + (kind === 1 ? 1 : blockSize);
  }
  if (descriptor & 4) offset += 4;
  if (offset !== bytes.length) throw new Error('Invalid Zstandard frame extent');
}

export async function decodeGaussianZstd(bytes, expected) {
  validateFrame(bytes, expected);
  const { Decompress } = await import('./vendor/fzstd/index.mjs');
  const output = new Uint8Array(expected);
  let offset = 0;
  const stream = new Decompress(chunk => {
    if (offset + chunk.length > expected) throw new RangeError('Zstandard output exceeds the SPZ stream size');
    output.set(chunk, offset);
    offset += chunk.length;
  });
  stream.push(bytes, true);
  if (offset !== expected) throw new Error('Zstandard output does not match the SPZ stream size');
  return output;
}
