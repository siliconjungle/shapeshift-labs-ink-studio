#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ink from '../index.js';
import { gaussianSplatWorld } from '../src/gaussian-splats.mjs';
import { inspectGaussianChunkManifest, packGaussianChunks } from '../src/gaussian-chunks.mjs';

export async function writeGaussianPack(world, output, settings) {
  const packed = packGaussianChunks(world, settings);
  const manifest = { schema: packed.schema, world: packed.world, chunks: [] };
  await mkdir(output, { recursive: true });
  async function publish(name, bytes) {
    const temporary = path.join(output, '.' + name + '-' + randomUUID());
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(output, name));
  }
  for (const chunk of packed.chunks()) {
    const levels = [];
    for (const { data, ...level } of chunk.levels) {
      const bytes = Buffer.allocUnsafe(data.length * 4);
      if (new Uint8Array(Uint16Array.of(1).buffer)[0] === 1)
        bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      else for (let i = 0; i < data.length; i++) bytes.writeFloatLE(data[i], i * 4);
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const file = level.file.replace('.bin', '-' + hash + '.bin');
      await publish(file, bytes);
      levels.push({ ...level, file });
    }
    manifest.chunks.push({ ...chunk, levels });
  }
  inspectGaussianChunkManifest(manifest);
  await publish('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [file, out, cell, voxels, size, up] = process.argv.slice(2);
    if (!file || !out) throw new Error('Usage: node scripts/pack-gaussian-chunks.mjs scan.(ply|spz|gsz) output [cellSize] [voxels] [worldSize] [up]');
    const cloud = await ink.readGaussianSplat(file);
    const world = gaussianSplatWorld(cloud, { size: size === undefined ? undefined : Number(size), up });
    const manifest = await writeGaussianPack(world, out, {
      cellSize: cell === undefined ? undefined : Number(cell),
      voxelSizes: voxels === undefined ? undefined : voxels.split(',').map(Number)
    });
    console.log(`${manifest.chunks.length} chunks → ${path.join(out, 'manifest.json')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
