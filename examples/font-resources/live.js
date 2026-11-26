const $ = id => document.getElementById(id), Canvas = $('plate').getContext('2d');
const fields = ['family', 'style', 'size', 'tracking', 'lineHeight', 'maxWidth', 'align', 'wrap'];
const numbers = ['size', 'tracking', 'lineHeight', 'maxWidth'];
let group, graph, prepared, outputs, scheduled;

function install(document) {
  if (document?.format !== 'ink-studio/graph-group' || document.version !== 1 ||
      !document.inputs?.text || !document.inputs?.options)
    throw new TypeError('Choose an Ink Studio Night Atlas graph group');
  const { inputs, nodes, outputs: ports } = document;
  const compiled = KIT.procedural.graph.create({ inputs, nodes, outputs: ports });
  const result = compiled.evaluate().outputs;
  if (result.plate?.width !== 760 || result.plate?.height !== 350 ||
      typeof result.layout?.text !== 'string' || !Array.isArray(result.layout.glyphs))
    throw new TypeError('The group needs the Night Atlas graph outputs');
  [group, graph, outputs] = [document, compiled, result];
  prepared = { text: inputs.text.default, options: inputs.options.default };
  $('revision').value = 'Published group · Revision ' + (document.revision ?? 1);
  $('text').value = prepared.text;
  for (const name of fields) $(name).value = prepared.options[name];
  $('fallback').checked = !!prepared.options.fallback?.length;
  $('kerning').checked = prepared.options.kerning !== false;
  $('style').options[1].disabled = $('family').value === 'Night Marks';
  paint();
}
function proof() {
  const options = { ...group.inputs.options.default };
  for (const key of fields) {
    const field = $(key);
    if (numbers.includes(key) && (!field.value || !field.validity.valid)) return;
    options[key] = numbers.includes(key) ? field.valueAsNumber : field.value;
  }
  if (options.family === 'Night Marks') options.style = $('style').value = 'Regular';
  $('style').options[1].disabled = options.family === 'Night Marks';
  options.at = [{ left: 76, center: 380, right: 684 }[options.align], options.at[1]];
  options.fallback = $('fallback').checked ? [{ family: options.family === 'Night Marks' ? 'Source Serif 4' : 'Night Marks' }] : [];
  options.kerning = $('kerning').checked;
  const input = { text: $('text').value, options };
  outputs = graph.evaluate(input).outputs;
  prepared = input;
  paint();
}
function paint() {
  const { plate, layout } = outputs;
  Canvas.putImageData(new ImageData(new Uint8ClampedArray(plate.data), plate.width, plate.height), 0, 0);
  const counts = new Map(), missing = new Set();
  for (const glyph of layout.glyphs) {
    if (glyph.missing) missing.add(glyph.char);
    else if (glyph.char.trim()) {
      const key = glyph.family + ' ' + glyph.style;
      if (!counts.has(key)) counts.set(key, { fallback: glyph.fallback, chars: new Set() });
      if (glyph.fallback) counts.get(key).chars.add(glyph.char);
    }
  }
  const details = [...counts].map(([face, { fallback, chars }]) => fallback ? face + ' · ' + [...chars].join(' ') : face);
  if (missing.size) details.push('Missing · ' + [...missing].join(' '));
  $('used').replaceChildren(...details.map(text => {
    const item = document.createElement('span');
    item.className = 'badge';
    item.textContent = text;
    return item;
  }));
  $('message').textContent = '';
}
function refresh() {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    try { proof(); } catch (error) { $('message').textContent = error.message; }
  });
}
function save() {
  const snapshot = structuredClone(group);
  snapshot.inputs.text.default = prepared.text;
  snapshot.inputs.options.default = prepared.options;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.download = 'night-atlas.group.json';
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const key of [...fields, 'text', 'fallback', 'kerning']) $(key).addEventListener('input', refresh);
$('open').addEventListener('click', () => { $('file').value = ''; $('file').click(); });
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    if (file.size > 16 * 1024 ** 2) throw new RangeError('Choose a graph group within 16 MiB');
    install(JSON.parse(await file.text()));
  } catch (error) {
    $('message').textContent = error.message;
  }
});
$('reset').addEventListener('click', () => install(group));
$('save').addEventListener('click', () => {
  try { proof(); save(); } catch (error) { $('message').textContent = error.message; }
});
install(fontPublication);
