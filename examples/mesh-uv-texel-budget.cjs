// A rest-space painted ferry sign, woven panel and approved badge share a fixed-size texture.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('../index.js');
const PNG = require('../cli/png.js');
const bake = require('../cli/glb-bake.js');
const Composite = require('../src/frame-composite.js');
const { capture } = require('../cli/mesh-uv-editor.js');

function fixture({ KIT: K }) {
  const vertices = [], faces = [];
  const texture = 128, atlas = [texture, texture];
  function vertex(id, position) { vertices.push({ id, position }); return id; }
  function face(id, ids, uvs) {
    faces.push({ id, material: 'painted', corners: ids.map((v, i) => ({ id: id + '/' + v, vertex: v, uv: uvs[i] })) });
  }
  function quad(id, [l, b, r, t], z, [u, v, a, c]) {
    face(id, [[l,b,z],[r,b,z],[r,t,z],[l,t,z]].map((p, i) => vertex(id + i, p)),
      [[u,c],[a,c],[a,v],[u,v]]);
  }
  const hull = [[-2.18,-.90], [2.18,-.90], [2.37,-.70], [2.37,.57], [2.15,.82], [-2.15,.82], [-2.37,.57], [-2.37,-.70]];
  face('hull', hull.map(([x,y],i) => vertex('body' + i, [x,y,-.04])),
    hull.map(([x,y]) => [.46 + .16 * x,.26 - .20 * y]));
  quad('route-sign', [-1.88,.03,1.88,.57], .034, [.81,.51,.86,.56]);
  const sign = faces.at(-1);
  sign.corners[1].uv = [.867,.565];
  sign.corners[2].uv = [.855,.508];
  quad('approved-badge', [1.16,-.63,1.83,-.18], .046, [.67,.68,.84,.88]);
  quad('stand-a', [-1.86,-1.23,-1.67,-.87], -.11, [.735,.46,.772,.49]);
  quad('stand-b', [1.67,-1.23,1.86,-.87], -.11, [.785,.46,.822,.49]);

  const grid = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    grid.push({ id: vertex('cloth' + x + y, [-1.87 + x * 1.31, -.65 + y * .245, .034]),
      uv: [.115 + x * .175 + (x === 1 && y === 1 ? .061 : 0),
        .86 - y * .095 + (x === 1 && y === 1 ? .037 : 0)] });
  }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const i = y * 3 + x, rows = [grid[i],grid[i+1],grid[i+4],grid[i+3]];
    face('woven-' + (y * 2 + x), rows.map(row => row.id), rows.map(row => row.uv));
  }
  const doc = K.meshTopology.create({ id: 'ferry-route-board', vertices, faces });
  const seam = K.meshTopology.uv.inspect(doc).edges.find(row =>
    row.vertices.includes('cloth00') && row.vertices.includes('cloth10')).id;
  const protect = { seams: [seam], painted: [{ id: 'approved-badge', faces: ['approved-badge'] }] };
  const request = { revision: K.meshTopology.revision(doc), protect, operations: [
    { op: 'unwrap', ids: ['route-sign'], atlas },
    { op: 'relax', ids: ['woven-0','woven-1','woven-2','woven-3'], atlas },
    { op: 'texel-budget', atlas, maxTexels: 5600, gutter: 2,
      features: [{ id: 'route-sign', islands: ['route-sign'], weight: 4 },
        { id: 'woven-panel', islands: ['woven-0'], weight: 1.3 },
        { id: 'cabinet', islands: ['hull'], weight: .7 },
        { id: 'approved-badge', islands: ['approved-badge'], weight: 1 }] }
  ] };
  const readability = { atlas, features: [
    { id: 'route-sign', faces: ['route-sign'], minPixels: [95, 10], minTexelsPerPixel: .58 },
    { id: 'woven-panel', faces: ['woven-0','woven-1','woven-2','woven-3'] },
    { id: 'approved-badge', faces: ['approved-badge'] }
  ] };
  const view = { w: 246, h: 164, camera: { yaw: .11, pitch: .07, dist: 5.65, ortho: true }, readability };
  return { doc, request, view, texture };
}

function paint(glyphs, face, x, y) {
  if (face === 'route-sign') {
    const u = Math.floor((x + 1.7) / 3.4 * 42), v = Math.floor((.50 - y) / .39 * 8);
    if (Math.abs(x) > 1.81 || y < .084 || y > .526) return [136,158,125];
    const label = 'PIER 07', { font, chars, per } = glyphs;
    if (u >= 0 && u < 42 && v >= 0 && v < 8) {
      const glyph = chars.indexOf(label[Math.floor(u / 6)]), a = glyph % per * 6 + u % 6, b = Math.floor(glyph / per) * 8 + v;
      if (font.data[b * font.w + a]) return [255,230,163];
    }
    return [22,47,55];
  }
  if (face === 'approved-badge') {
    const u = Math.abs((x - 1.495) / .335), v = Math.abs((y + .405) / .225);
    if (u + v < .55) return [252,198,108];
    if (Math.max(u, v) > .84) return [105,129,121];
    return [27,57,70];
  }
  if (face.startsWith('woven-')) {
    if (Math.abs(y + .409) > .205) return [126,144,127];
    const a = Math.floor((x + 2) * 40), b = Math.floor((y + .75) * 48);
    return (a + b * 2) % 7 < 2 ? [145,183,162] : [48,96,108];
  }
  if (face.startsWith('stand')) return [43,72,80];
  if (Math.abs(x) > 2.20 || y < -.79 || y > .69) return [123,148,124];
  if (Math.abs(x) > 1.98 || y < -.69 || y > .62) return [37,64,72];
  return [59 + Math.floor((y + .9) * 10),90,95];
}

function texture(document, size, kit) {
  const { KIT: K } = kit, api = K.meshTopology, tri = api.triangulate(document).triangleSources;
  const vertices = new Map(document.vertices.map(({ id }, i) => [id, i]));
  const corners = new Map(document.faces.flatMap(row => row.corners.map(corner => [corner.id, corner])));
  const points = document.vertices.map(row => row.position);
  const faces = tri.map(row => row.corners.map(id => vertices.get(corners.get(id).vertex)));
  const uvs = tri.map(row => row.corners.map(id => corners.get(id).uv));
  const linear = n => {
    const v = n / 255;
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  };
  const glyphs = K.ascii.atlas();
  const source = { points, materials: [{ color: [1,1,1] }], sampleSurface([x,y], _normal, i) {
    return { color: paint(glyphs, tri[i].face, x, y).map(linear), roughness: .75, metallic: 0 };
  } };
  return bake(source, faces, uvs, points.map(() => [0,0,1]), size, 1, K, { registered: true }).textures.base;
}

function run(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const kit = studio.load(), { KIT: K } = kit, { doc, request, view, texture: size } = fixture(kit);
  const UV = K.meshTopology.uv, plan = UV.plan(doc, request);
  if (!plan.report.canCommit) throw new Error(JSON.stringify(plan.report.operations.at(-1)));
  const source = texture(doc, size, kit), result = texture(plan.document, size, kit);
  const material = bytes => [{ id: 'painted', texture: { width: size, height: size, pixels: Array.from(PNG.raster(bytes).data) } }];
  const initial = material(source), revised = material(result);
  view.materials = initial; view.afterMaterials = revised;
  const file = name => path.join(directory, name);
  function json(name, value) { fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n'); return file(name); }
  fs.writeFileSync(file('atlas-before.png'), source);
  fs.writeFileSync(file('atlas-after.png'), result);
  const input = json('mesh.json',doc), edit = json('request.json',request), camera = json('view.json',view);
  const report = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname,'../cli/ink-studio.js'),
    'mesh-uv','edit',input,edit,'--view',camera,'--preview',file('review'),'--out',file('fitted.json'),'--report',file('receipt.json')],
    { encoding: 'utf8', stdio: ['ignore','pipe','inherit'] }));
  const frames = [capture(doc, { ...view, materials: initial, raw: true, t: 0 }, kit).frame,
    capture(plan.document, { ...view, materials: revised, raw: true, t: 0 }, kit).frame];
  frames.forEach(({w,h,rgb},i) => PNG.write(file(i ? 'native-after.png' : 'native-before.png'),w,h,rgb));
  const width = 550, height = 382, layers = [], draw = [];
  const text = (text,x,y,size=9,color='#dbe9e8') => draw.push({type:'text',text,at:[x,y],size,color});
  text('Ferry route board', width/2, 15, 13);
  text('128 × 128 atlas   /   Same native camera', width/2, 32, 9, '#a4c0c1');
  const proof = [report.preview.readability.before,report.preview.readability.after];
  for (const [i, frame] of frames.entries()) {
    const x = 21 + i * 262;
    text(i ? 'Texels prioritized for sign' : 'Original allocation', x + frame.w/2, 52);
    layers.push({ source: frame, rect: [x,61,frame.w,frame.h] });
    const bytes = i ? result : source;
    layers.push({ source: { w:size,h:size,rgba: PNG.raster(bytes).data }, rect: [x+10,233,size,size] });
    const { id, pixels, bounds, texelsPerPixel, ready } = proof[i].features[0];
    text(id, x+194, 255, 9);
    text(bounds[2] + ' × ' + bounds[3] + ' art pixels', x+194, 273, 8);
    text(texelsPerPixel.p10.toFixed(2) + ' texels / px', x+194, 288, 8);
    text(ready ? 'Budget passes' : 'Under target', x+194, 308, 9, ready ? '#8fe0b4' : '#f6b397');
    text('Atlas ' + (i ? 'after' : 'before'), x+74, 371, 8, '#a4c0c1');
    if (!pixels) throw new Error('The sign needs to be visible on the approved native grid');
  }
  const cooked = K.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
  const sheet = Composite.compose({w:1,h:1,rgb:Uint8Array.of(11,23,29)},
    K.frameComposite.layers(cooked,{},0),width,height,'nearest');
  PNG.write(file('comparison.png'),width,height,sheet.rgb);
  console.log(directory);
}

module.exports = { fixture };
if (require.main === module) run(path.resolve(process.argv[2] ?? 'studio/out/mesh-uv-texel-budget'));
