/* Native recipes share the named PCM asset paths used by Ink audio tools. */
const fs = require('node:fs');
const WAV = require('./wav.js');
const limit = 64 * 1024;

function isSoundRecipe(file) {
  return typeof file === 'string' && file.toLowerCase().endsWith('.sound.json');
}
function decodeSoundRecipe(bytes, P) {
  if (bytes.length > limit) throw new RangeError('Sound recipe exceeds 64 KiB');
  return P.mediaGraph.soundRecipe.render(JSON.parse(bytes.toString('utf8')));
}
function readSoundRecipe(file, P) {
  if (fs.statSync(file).size > limit) throw new RangeError('Sound recipe exceeds 64 KiB');
  return decodeSoundRecipe(fs.readFileSync(file), P);
}
function readAudioSource(file, P, options) {
  return isSoundRecipe(file) ? readSoundRecipe(file, P).value : WAV.read(file, options);
}
module.exports = { isSoundRecipe, decodeSoundRecipe, readSoundRecipe, readAudioSource, limit };
