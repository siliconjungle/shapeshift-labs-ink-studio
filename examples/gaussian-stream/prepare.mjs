import { fileURLToPath } from 'node:url';
import { decodeGaussianPly, gaussianSplatWorld } from '../../webgpu.mjs';
import { writeGaussianPack } from '../../scripts/pack-gaussian-chunks.mjs';
import { reefPly } from '../gaussian-gpu/reef.mjs';

const world = gaussianSplatWorld(decodeGaussianPly(reefPly()), { size: 40 });
const output = process.argv[2] ?? fileURLToPath(new URL('./pack/', import.meta.url));
const manifest = await writeGaussianPack(world, output, {
  cellSize: 5, voxelSizes: [.4, .2, .1, 0],
  layer: index => index < 4 * 4199 ? 'specimens' : 'shoal'
});
console.log(`Glasswater Transect · ${world.count} splats in ${manifest.chunks.length} chunks`);
