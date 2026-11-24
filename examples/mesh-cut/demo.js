/* global KIT, InkMeshCutExample */
(() => {
  'use strict';
  const api = KIT.meshTopology, example = InkMeshCutExample, $ = id => document.getElementById(id);
  const status = $('status'), tool = $('tool'), cap = $('cap'), split = $('split');
  const history = [], sourceCanvas = $('source'), previewCanvas = $('preview');
  let input, points, result, request, imported = false, serial = 1, sourceMap;

  function notify(value, error = false) {
    status.textContent = value;
    status.toggleAttribute('data-error', error);
  }
  function range(doc, axis) {
    let min = Infinity, max = -Infinity;
    for (const { position } of doc.vertices) {
      min = Math.min(min, position[axis]);
      max = Math.max(max, position[axis]);
    }
    return [min, max].map(n => Number.isFinite(n) ? n : 0);
  }
  function requestFor() {
    const base = { id: 'edit-' + serial, revision: api.revision(input), split: split.checked,
      cap: cap.value === 'none' ? { kind: 'none' } : { kind: cap.value, material: 'cut' } };
    if (tool.value === 'knife') return points.length < 2 ? null :
      { ...base, knife: { projection: example.projection, path: points.map(p => p.slice()) } };
    const axis = +$('axis').value, [min, max] = range(input, axis);
    const origin = [0, 0, 0], normal = [0, 0, 0];
    origin[axis] = min + (max - min) * (+$('position').value / 1000);
    normal[axis] = 1;
    return { ...base, plane: { origin, normal } };
  }
  function painter(canvas, models, oblique) {
    const ctx = canvas.getContext('2d'), rows = [], extent = [Infinity, Infinity, -Infinity, -Infinity];
    for (const { doc, offset } of models) {
      const vertices = new Map();
      for (const { id, position: [x, y, z] } of doc.vertices) {
        const p = [x + offset[0] + (oblique ? z * .48 : 0), y + (oblique ? z * .27 : 0),
          z + offset[1] - (oblique ? x * .28 + y * .15 : 0)];
        vertices.set(id, p);
        for (let i = 0; i < 2; i++) {
          extent[i] = Math.min(extent[i], p[i]);
          extent[i + 2] = Math.max(extent[i + 2], p[i]);
        }
      }
      for (const face of doc.faces) {
        const ring = face.corners.map(c => vertices.get(c.vertex));
        rows.push({ ring, depth: ring.reduce((sum, p) => sum + p[2], 0) / ring.length, material: face.material });
      }
    }
    if (!rows.length) extent.splice(0, 4, -1, -1, 1, 1);
    const scale = Math.min((canvas.width - 46) / (extent[2] - extent[0] || 1),
      (canvas.height - 38) / (extent[3] - extent[1] || 1));
    const cx = (extent[0] + extent[2]) / 2, cy = (extent[1] + extent[3]) / 2;
    const to = ([x, y]) => [(x - cx) * scale + canvas.width / 2, (cy - y) * scale + canvas.height / 2];
    const from = ([x, y]) => [(x - canvas.width / 2) / scale + cx, cy - (y - canvas.height / 2) / scale];
    ctx.fillStyle = '#182a33';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#223944';
    for (let i = 0; i < canvas.width; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke(); }
    for (let i = 0; i < canvas.height; i += 16) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke(); }
    for (const row of rows.sort((a, b) => a.depth - b.depth)) {
      ctx.beginPath();
      row.ring.forEach((p, i) => (i ? ctx.lineTo(...to(p)) : ctx.moveTo(...to(p))));
      ctx.closePath();
      ctx.fillStyle = example.colors[row.material] ?? '#778e8d';
      ctx.fill();
      ctx.strokeStyle = '#253841';
      ctx.lineWidth = .7;
      ctx.stroke();
    }
    return { ctx, to, from };
  }
  function draw() {
    const isKnife = tool.value === 'knife', one = [{ doc: input, offset: [0, 0] }];
    sourceMap = painter(sourceCanvas, one, !isKnife);
    if (isKnife && points.length) {
      const { ctx, to } = sourceMap;
      ctx.strokeStyle = '#ffe0a2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, i) => (i ? ctx.lineTo(...to(point)) : ctx.moveTo(...to(point))));
      ctx.stroke();
      ctx.fillStyle = '#ffe0a2';
      for (const point of points) {
        const [x, y] = to(point);
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    if (!isKnife && result) {
      const vertices = new Map(result.document.vertices.map(({ id, position: [x, y, z] }) => [id, [x + z * .48, y + z * .27]]));
      const { ctx, to } = sourceMap;
      ctx.strokeStyle = '#ffe0a2';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (const [a, b] of result.report.cutEdges) {
        ctx.moveTo(...to(vertices.get(a)));
        ctx.lineTo(...to(vertices.get(b)));
      }
      ctx.stroke();
    }
    const [min, max] = range(input, 0);
    const models = result && split.checked ? result.pieces.map(({ document }, i, all) => {
      const gap = (i - (all.length - 1) / 2) * Math.max(.26, (max - min) * (isKnife ? .14 : .74));
      return { doc: document, offset: [gap, 0] };
    }) : result ? [{ doc: result.document, offset: [0, 0] }] : one;
    painter(previewCanvas, models, !isKnife);
  }
  function refresh() {
    const isKnife = tool.value === 'knife';
    cap.disabled = !split.checked;
    for (const id of ['axis-control', 'position-control']) $(id).hidden = isKnife;
    for (const id of ['point', 'clear']) $(id).hidden = !isKnife;
    $('point').disabled = $('clear').disabled = !points.length;
    sourceCanvas.dataset.tool = tool.value;
    result = null;
    try {
      request = requestFor();
      result = request && api.planCut(input, request);
      notify(result ? result.report.cutEdges.length + ' cut edges · ' + result.pieces.length +
        ' pieces · ' + result.pieces.reduce((sum, piece) => sum + piece.caps.length, 0) + ' cap faces' :
        'Click the source view to lay down a knife path.');
    } catch (error) { notify(error.message, true); }
    $('apply').disabled = !result || !Object.keys(result.patch).length;
    $('request').disabled = !result;
    $('undo').disabled = !history.length;
    draw();
  }
  function fixture() {
    input = api.create(tool.value === 'knife' ? example.plaque() : example.housing());
    points = tool.value === 'knife' ? example.path.map(p => p.slice()) : [];
    history.length = 0;
  }
  tool.addEventListener('change', () => {
    if (!imported) fixture();
    else points = [];
    cap.value = tool.value === 'knife' || !split.checked ? 'none' : 'triangles';
    refresh();
  });
  for (const id of ['axis', 'position', 'cap']) $(id).addEventListener('input', refresh);
  split.addEventListener('change', () => { if (!split.checked) cap.value = 'none'; refresh(); });
  $('load').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      input = api.create(JSON.parse(await file.text()));
      imported = true;
      points = [];
      history.length = 0;
      refresh();
    } catch (error) { notify(error.message, true); }
  });
  sourceCanvas.addEventListener('pointerdown', event => {
    if (tool.value !== 'knife' || event.button !== 0 || points.length >= 65) return;
    const bounds = sourceCanvas.getBoundingClientRect();
    points.push(sourceMap.from([(event.clientX - bounds.left) * sourceCanvas.width / bounds.width,
      (event.clientY - bounds.top) * sourceCanvas.height / bounds.height]));
    refresh();
  });
  $('point').addEventListener('click', () => { points.pop(); refresh(); });
  $('clear').addEventListener('click', () => { points = []; refresh(); });
  $('apply').addEventListener('click', () => {
    history.push({ input, points });
    input = result.document;
    points = [];
    serial++;
    refresh();
  });
  $('undo').addEventListener('click', () => {
    ({ input, points } = history.pop());
    refresh();
  });
  function save(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  $('request').addEventListener('click', () => save(request, 'cut-request.json'));
  $('save').addEventListener('click', () => save(input, input.id.replace(/[^\w.-]/g, '-') + '.json'));
  fixture();
  refresh();
})();
