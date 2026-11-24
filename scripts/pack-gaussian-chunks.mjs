#!/usr/bin/env node
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ink from '../index.js';
import { gaussianSplatWorld } from '../src/gaussian-splats.mjs';
import { gaussianRecordFloats, inspectGaussianChunkManifest, packGaussianChunks } from '../src/gaussian-chunks.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0,20);
const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

export async function writeGaussianPack(world, output, { splatFit,...settings } = {}) {
  const manifestPath=path.join(output,'manifest.json');
  const previous=await readFile(manifestPath,'utf8').then(value=>inspectGaussianChunkManifest(JSON.parse(value)),
    error=>{if (error.code!=='ENOENT') throw error;});
  const packed = packGaussianChunks(ink.bakeSplatFit(world,splatFit),{...settings,previousFootprints:previous?.footprints});
  let lastRevision=previous?.epoch??0;
  for (const chunk of previous?.chunks??[]) {
    for (const level of chunk.levels) lastRevision=Math.max(lastRevision,level.revision);
  }
  const epoch=lastRevision+1;
  if (!Number.isSafeInteger(epoch)) throw new RangeError('Gaussian pack revision limit reached');
  const manifest = { schema: packed.schema, world: packed.world, chunks: [],epoch,
    ...(packed.footprints&&{footprints:packed.footprints}) };
  const oldChunks=new Map(previous?.chunks.map(chunk=>[chunk.id,chunk]));
  await mkdir(output, { recursive: true });
  async function publish(name, bytes) {
    const temporary = path.join(output, '.' + name + '-' + randomUUID());
    await writeFile(temporary, bytes);
    await rename(temporary, path.join(output, name));
  }
  for (const {layer,cell,bounds,levels:source,footprints} of packed.chunks()) {
    const id='chunk-'+hash(JSON.stringify([layer,cell])), old=oldChunks.get(id), levels=[];
    let footprintRevision;
    if (footprints) {
      const slots=new Set(), finest=source.at(-1).data;
      for (let i=11;i<finest.length;i+=gaussianRecordFloats) if (finest[i]) slots.add(finest[i]);
      footprintRevision=hash(JSON.stringify([...slots].sort((a,b)=>a-b).map(slot=>[slot,packed.footprints[slot-1]])));
    }
    for (const {data,id:lod,splats,error} of source) {
      const bytes = Buffer.allocUnsafe(data.length * 4);
      if (littleEndian) bytes.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
      else for (let i=0;i<data.length;i++) bytes.writeFloatLE(data[i],i*4);
      const file=id+'-'+lod+'-'+hash(bytes)+'.bin', prior=old?.levels.find(level=>level.id===lod);
      const existing=await stat(path.join(output,file)).catch(error=>{if(error.code!=='ENOENT') throw error;});
      if (!existing || existing.size!==bytes.length) await publish(file,bytes);
      const unchanged=prior?.file===file && prior.error===error && old.footprints===footprints &&
        old.footprintRevision===footprintRevision &&
        JSON.stringify(old.bounds)===JSON.stringify(bounds);
      levels.push({id:lod,file,splats,error,revision:unchanged ? prior.revision : epoch});
    }
    manifest.chunks.push({id,layer,cell,bounds,levels,...(footprints&&{footprints,footprintRevision})});
  }
  inspectGaussianChunkManifest(manifest);
  await publish('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2), option=args.indexOf('--splat-fit');
    let splatFit;
    if (option>=0) {
      const [,file]=args.splice(option,2);
      if (!file) throw new Error('--splat-fit needs an edit asset path');
      splatFit=JSON.parse(await readFile(file,'utf8'));
    }
    const [file, out, cell, voxels, size, up] = args;
    if (!file || !out || args.length>6)
      throw new Error('Usage: node scripts/pack-gaussian-chunks.mjs scan.(ply|spz|gsz) output [cellSize] [voxels] [worldSize] [up] [--splat-fit fit.json]');
    const cloud = await ink.readGaussianSplat(file);
    const world = gaussianSplatWorld(cloud, { size: size === undefined ? undefined : Number(size), up,
      objectId:'gaussian-cloud',colorMode:splatFit ? 'rgb' : 'baked' });
    const manifest = await writeGaussianPack(world, out, {
      cellSize: cell === undefined ? undefined : Number(cell),
      voxelSizes: voxels === undefined ? undefined : voxels.split(',').map(Number),splatFit
    });
    console.log(`${manifest.chunks.length} chunks → ${path.join(out, 'manifest.json')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
