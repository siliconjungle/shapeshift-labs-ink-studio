/* Native recipes share the named PCM asset paths used by Ink audio tools. */
const fs = require('node:fs');
const WAV = require('./wav.js');
const limit = 64 * 1024;

function isSoundRecipe(file) {
  return typeof file === 'string' && file.toLowerCase().endsWith('.sound.json');
}
function decodeSoundDocument(bytes) {
  if (bytes.length > limit) throw new RangeError('Sound document exceeds 64 KiB');
  return JSON.parse(bytes.toString('utf8'));
}
function readSoundDocument(file) {
  if (fs.statSync(file).size > limit) throw new RangeError('Sound document exceeds 64 KiB');
  return decodeSoundDocument(fs.readFileSync(file));
}
function decodeSoundRecipe(bytes, P) {
  return P.mediaGraph.soundRecipe.render(decodeSoundDocument(bytes));
}
function readSoundRecipe(file, P) {
  return P.mediaGraph.soundRecipe.render(readSoundDocument(file));
}
function readAudioSource(file, P, options) {
  return isSoundRecipe(file) ? readSoundRecipe(file, P).value : WAV.read(file, options);
}
module.exports = { isSoundRecipe, decodeSoundRecipe, readSoundDocument, readSoundRecipe, readAudioSource, limit };
