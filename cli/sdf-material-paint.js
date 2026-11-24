'use strict';

const GridBrush = require('./sdf-grid-brush.js');
const SdfPose = require('./sdf-pose.js');

function apply(editor,key,solid,frame,binding,layer,id,raw) {
  const { V,diorama,procedural:{sdfMaterialPaint:api} } = require('../index.js').load().KIT;
  if (!GridBrush.fields(raw,[...GridBrush.footprintKeys,'material','masks','thickness']) ||
      raw.thickness!==undefined && (!Number.isFinite(raw.thickness) || raw.thickness<.001 || raw.thickness>2))
    throw new TypeError('SDF paint needs a native footprint and optional contact thickness from .001 to 2');
  const { material,masks } = raw;
  api.values(raw,diorama.sceneMaterials(editor.snapshot()).roles);
  const strokes = solid.sdfPaint?.strokes ?? [];
  if (strokes.some(stroke=>stroke.id===id) || strokes.length>=api.maxStrokes)
    throw new RangeError('SDF paint needs a new stroke ID and supports up to '+api.maxStrokes+' strokes per solid');
  const footprint = GridBrush.prepareFootprint(raw,frame,binding,api.maxCells);
  const { projection,candidates,skipped } = GridBrush.captureFootprint(editor,solid,frame,binding,footprint,layer);
  const [first] = candidates;
  if (!first) return GridBrush.reject(binding,skipped,'No paint pixels hit a visible, editable SDF surface');

  const local = GridBrush.localProjection(projection,first.toLocal,V);
  const transform = SdfPose.affine(GridBrush.affineMatrix(first.toLocal,V));
  const hits = [], cells = [];
  for (const { at,sourceAt,surface,toLocal } of candidates) {
    const point = toLocal(surface.position), normal = transform.normal(...surface.geometricNormal);
    const pixelSize = V.len(projection.right)*(projection.perspective ? surface.depth : 1);
    const thickness = raw.thickness ?? Math.max(.002,pixelSize*.75);
    const band = Math.abs(V.dot(normal,V.sub(toLocal(V.mad(surface.position,surface.geometricNormal,thickness)),point)));
    cells.push([...sourceAt,point,normal,band]);
    hits.push({ at,sourceAt,rest:point,surfaceDepth:surface.depth });
  }
  const { grid,time } = footprint;
  const values = { ...(material!==undefined&&{material}),...(masks!==undefined&&{masks}) };
  const stroke = { id,grid,projection:local,cells,...values };
  editor.setSdfPaint({ version:1,strokes:[...strokes,stroke] },key);
  return { id,grid,time,...values,projectedPixels:hits.length,hits,skippedHits:skipped };
}

module.exports = { apply };
