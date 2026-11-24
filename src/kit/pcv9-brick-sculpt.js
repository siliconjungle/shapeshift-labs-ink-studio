// Surface labels and display views derived from immutable brick geometry.
const brickSculpt = (function (K) {
  const P = K.procedural;
  const xyz = point => Array.isArray(point) && point.length === 3 && Array.from(point).every(Number.isFinite);

  function label(chunk, sites, compiled) {
    const crossings = sites.keys.map((_, i) => Object.freeze(compiled.membership(sites.points.subarray(i * 6, i * 6 + 3))));
    return Array.from(sites.triangleSites, (site, triangle) => ({
      id: sites.keys[site >>> 1] + ':' + (site & 1), faceSets: crossings[site >>> 1], chunk: chunk.key, triangle
    }));
  }

  function view(chunks, sites, compiled, previous, publish, padding) {
    const { document, visibilityActive } = compiled;
    const classifier = JSON.stringify([document.masks.map(({ id, volumes }) => [id, volumes]), document.faceSets]);
    const filter = JSON.stringify([document.controls.hidden, document.controls.isolate]);
    const relabeled = [], displayChanged = [];
    const rows = chunks.map((chunk, i) => {
      const old = previous?.rows[i], source = sites[i];
      const retainLabels = old?.sites === source && previous.classifier === classifier;
      const faces = retainLabels ? old.faces : label(chunk, source, compiled);
      if (!retainLabels && faces.length) relabeled.push(chunk.key);
      if (old?.chunk === chunk && retainLabels && previous.filter === filter) return old;
      const kept = visibilityActive ? faces.flatMap((row, i) => compiled.visible(row.faceSets) ? [i] : []) :
        null;
      let display;
      if (!kept || kept.length === chunk.triangles) display = chunk;
      else if (old?.chunk === chunk && old.kept?.length === kept.length && kept.every((n, i) => n === old.kept[i]))
        display = old.display;
      else display = publish(chunk, kept);
      if (old?.display !== display) displayChanged.push(chunk.key);
      return { chunk, sites: source, faces, kept, display };
    });
    const counts = new Map(document.faceSets.map(({ id, mask }) => [id, { id, mask, faces: 0, visible: 0,
      locked: document.controls.locked.includes(id), hidden: document.controls.hidden.includes(id) }]));
    const byKey = new Map(), byMesh = new Map();
    for (const row of rows) {
      byKey.set(row.chunk.key, row);
      if (row.display.mesh) byMesh.set(row.display.mesh.id, row);
      for (const face of row.faces) for (const id of face.faceSets) {
        const count = counts.get(id);
        count.faces++;
        if (!visibilityActive || compiled.visible(face.faceSets)) count.visible++;
      }
    }
    function face(key, triangle) {
      const row = Number.isInteger(triangle) && byKey.get(key)?.faces[triangle];
      return row && Object.freeze({ ...row, visible: compiled.visible(row.faceSets) });
    }
    function describeHit(hit) {
      const row = hit && byMesh.get(hit.mesh);
      if (!row) return hit;
      const tagged = row.faces[row.display === row.chunk ? hit.triangle : row.kept[hit.triangle]];
      return tagged ? { ...hit, faceId: tagged.id, faceSets: tagged.faceSets, brick: tagged.chunk,
        sourceTriangle: tagged.triangle } : hit;
    }
    function sample(point, { masks } = {}) {
      if (!xyz(point)) throw new TypeError('A sculpt sample needs a finite rest-space point');
      return { ...compiled.sampler(masks, padding)(point), faceSets: compiled.membership(point) };
    }
    return { classifier, filter, rows, relabeled, displayChanged, describeHit,
      display: rows.map(row => row.display),
      inspection: Object.freeze({ document, visibilityActive, faceSets: P.data.freeze([...counts.values()]), face, sample }) };
  }

  function verifyLocks(next, previous, locked) {
    if (!previous || !locked.length) return [];
    const changed = next.rows.flatMap((row, i) => {
      const before = previous.rows[i];
      return row.chunk !== before.chunk || row.faces !== before.faces ? [[before, row]] : [];
    });
    const checked = [];
    for (const id of locked) {
      let matched = false;
      for (const [before, after] of changed) {
        const keys = ({ chunk, faces }) => faces.flatMap(row => row.faceSets.includes(id) ?
          [row.id + ':' + P.sdfProtection.faceKey(chunk, row.triangle)] : []).sort();
        const a = keys(before), b = keys(after);
        if (!a.length && !b.length) continue;
        matched = true;
        P.sdfProtection.retainFaces({ id, kind: 'face-set' }, a, b);
      }
      if (matched) checked.push(id);
    }
    return checked;
  }

  return { view, verifyLocks };
})(KIT);
