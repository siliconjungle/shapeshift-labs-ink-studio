import * as chunks from '../src/png-bytes.js';
import * as reader from '../src/png-raster.js';
import * as raster from '../src/pixel-raster-colors.js';

const png = chunks.default ?? globalThis[Symbol.for('ink-studio.png-bytes')];
const decode = (reader.default ?? globalThis[Symbol.for('ink-studio.png-raster')]).decode;
export const colors = raster.default ?? globalThis[Symbol.for('ink-studio.pixel-raster-colors')];

async function inflate(parts,maxBytes) {
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const bytes = new Uint8Array(maxBytes);
  let offset = 0;
  while (true) {
    const { done,value } = await stream.read();
    if (done) break;
    if (offset+value.length > bytes.length) {
      await stream.cancel();
      throw new Error('Invalid PNG scanline length');
    }
    bytes.set(value,offset);
    offset += value.length;
  }
  return bytes.subarray(0,offset);
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function openPNG(file) {
  const input = decode(new Uint8Array(await file.arrayBuffer()),'paint');
  const { parts,scanlineSize } = input.next().value;
  const source = input.next(await inflate(parts,scanlineSize)).value;
  if (source.ink) {
    const width = source.w ?? source.value.width, height = source.h ?? source.value.height;
    source.ink = await inflate([source.ink],colors.metadataLimit(width*height));
  }
  return colors.decode(source);
}

export async function savePNG(raster,mode) {
  const { width,height,channels,pixels,colors:palette,alpha,ink } = colors.encode(raster,mode);
  const scanlines = png.scanlines(width,height,pixels,channels);
  const [compressed,metadata] = await Promise.all([deflate(scanlines),deflate(ink)]);
  const parts = channels === 1 ? png.indexed(width,height,palette,alpha,compressed,metadata) :
    png.rgba(width,height,compressed,metadata);
  return new Blob(parts,{ type:'image/png' });
}
