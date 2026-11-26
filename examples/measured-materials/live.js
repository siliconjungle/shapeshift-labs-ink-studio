const el = id => document.getElementById(id);
const captions = {
  front: 'Warm key light and a camera color cast are baked into this exposure.',
  port: 'An oblique capture under a different light. The graph fits six landmarks onto the common material grid.',
  starboard: 'Raking illumination and a specular flare. One relief patch disagrees with the other observations.',
  pigment: 'Calibrated diffuse pigment after registration and de-lighting.',
  height: 'Signed millimeters above or below the common reference plane.',
  normals: 'Tangent normals from the recovered relief and physical pixel spacing.',
  'relief-confidence': 'Confidence falls where observed depths disagree or measurements are missing.',
  'pigment-confidence': 'Confidence falls where glare, clipping, or weak light reduces agreement.'
};
function showMap() {
  const map = el('map'), name = map.value, label = map.selectedOptions[0].textContent;
  const image = el('map-preview');
  image.src = 'views/' + name + '.png';
  image.alt = label;
  const capture = review.report.captures.find(row => row.id === name);
  el('map-label').textContent = name.endsWith('confidence') ? 'Measurement evidence' :
    (capture?.width ?? review.width) + ' × ' + (capture?.height ?? review.height) + (capture ? ' capture pixels' : ' tile samples');
  el('caption').textContent = captions[name];
  el('legend').hidden = !name.endsWith('confidence');
}
function relight() {
  const index = Number(el('light').value), azimuth = review.angle[index];
  el('render-preview').src = 'views/light-' + index + '.png';
  el('angle').value = (azimuth > 0 ? '+' : '') + azimuth + '°';
  el('light').setAttribute('aria-valuetext', azimuth + ' degrees');
}
el('error').textContent = review.error.captured.toFixed(4) + ' → ' + review.error.recovered.toFixed(4);
el('disagreements').textContent = review.report.reliefDisagreements.toLocaleString('en-US') + ' texels';
el('probe').textContent = Math.round(review.probe.confidence * 100) + '% at (' + review.probe.at.join(', ') + ')';
el('map').onchange = showMap;
el('light').oninput = relight;
showMap();
relight();
