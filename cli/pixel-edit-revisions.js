'use strict';

const { createHash } = require('node:crypto');
const { signature } = require('./render-row-assets.js');
const { conflict } = require('./pixel-edit-preview.js');

const revisionPattern = /^[a-f0-9]{64}$/;
const isRevision = value => typeof value === 'string' && revisionPattern.test(value);

function digest(value) {
  const json = JSON.stringify(value,(_key,item) => {
    if (!ArrayBuffer.isView(item)) return item;
    const bytes = Buffer.from(item.buffer,item.byteOffset,item.byteLength);
    return [item.constructor.name,item.byteLength,createHash('sha256').update(bytes).digest('hex')];
  });
  return createHash('sha256').update(json).digest('hex');
}

function observe({ destination,binding }, context, { guard = true } = {}) {
  const { id,kind,chart,channel } = destination;
  const scope = ['ink-studio/pixel-source-v1',id,kind,chart,channel,
    binding.id,binding.scene,binding.object,binding.part,binding.frame,binding.layer,binding.revision];
  if (kind === 'shot-correction' || kind === 'splat-attributes') {
    const world = context.world(binding);
    const revision = signature(world,{ fresh:true });
    if (!guard) return { world,revision };
    const posed = world.rest && world.data !== world.rest ? world.data.subarray(0,world.count*16) : undefined;
    // Row order and ownership both matter even when packed colors and geometry match.
    const sourceRevision = digest([scope,revision,posed,world.cam,world.spec,world.splatIds,world.renderMetadata,
      world.splatFootprints,world.surfaceData,world.opticalSplats,world.anim?.geometryOwned,
      world.anim?.physicsOwned,world.anim?.rig?.bid,
      kind === 'shot-correction' ? world.look?.shotCorrections : world.look?.splatFit]);
    return { world,revision,sourceRevision };
  }
  const { editor,revision } = context.scene(binding);
  if (!guard) return { editor,revision };
  const dependencies = editor.sourceDependencies?.();
  if (editor.sourceDependencies && dependencies === undefined)
    throw conflict('unverifiable-source','Cannot verify the scene dependencies for binding ' + binding.id,{ binding:binding.id });
  const sourceRevision = digest([scope,editor.snapshot(),dependencies]);
  return { editor,revision,sourceRevision };
}

module.exports = { isRevision, observe, digest };
