const {createHash} = require('node:crypto');

const signatures = new WeakMap();

function signature(world, { fresh = false } = {}) {
  const data=world.rest ?? world.data;
  const prior=signatures.get(data);
  if (!fresh && prior && prior.count===world.count) return prior.value;
  const hash=createHash('sha256');
  hash.update(Buffer.from(data.buffer,data.byteOffset,world.count*16*Float32Array.BYTES_PER_ELEMENT));
  const value=hash.digest('hex');
  signatures.set(data,{ count:world.count, value });
  return value;
}

function validate(world, asset, format) {
  if (!asset || asset.format!==format || asset.version!==1 || asset.rows!==world.count ||
      asset.signature!==signature(world)) throw new RangeError(format+' does not match this scene bake');
}

module.exports = {signature,validate};
