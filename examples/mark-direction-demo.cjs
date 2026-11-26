'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const output = path.resolve(process.argv[2] ?? 'mark-direction-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(output, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: output, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const command = 'painting-3d';

const palette = [0x141d2a, 0x263447, 0x394d5d, 0x556b72, 0x899a89,
  0x103b3f, 0x215454, 0x316a66, 0x458580, 0x66a399,
  0x6e4a3d, 0x946d4d, 0xc29968, 0xe8c192, 0xffe7ad,
  0x534333, 0x81664e, 0xad8d5d, 0xd8b77d, 0xf6dba1,
  0x633d46, 0x9b5660, 0xbe7678, 0xe19893, 0xffba9d];
const roles = { stone: [1,2,3,4], face: [5,6,7,8,9], rim: [10,11,12,13,14], leaf: [15,16,17,18,19], coral: [20,21,22,23,24] };
const holder = (id, half, mat) => ({ id, kind:'box', at:[0,1.22,0], half, round:.20, mat, res:.053 });
const frame = holder('rim', [2.55,.93,.31], 'rim');
const face = { ...holder('face', [2.45,.83,.26], 'face'), at:[0,1.22,.104] };
const warp = solid => ({ id:solid.id, kind:'warp', bend:.34, centre:[0,1.22,0], mat:solid.mat, res:solid.res,
  of:{ ...solid, id:solid.id + '-stock' }, modifiers: [{ id:'twist', kind:'warp', twist:.41, centre:[0,1.22,0] }] });
function base(id, bend) {
  return { id, seed:39, style:{ palette, roles, amb:.27, sky:.29, sun:[-.51,.62,.59] },
    camera:{ target:[0,1.52,.08], dist:7.00, yaw:.085, pitch:.30, sway:0 }, finish:{ detail:16, dither:0 },
    solids:bend ? [warp(frame),warp(face)] : [frame,face] };
}
put('flat-base', base('woven-tile-flat', false));
put('bent-base', base('woven-tile-bent', true));
const asset = KIT.flowMap.create({ width:13, height:9, bounds:[-2.5,.35,2.5,2.10] }).asset();
for (let y = 0; y < asset.height; y++) for (let x = 0; x < asset.width; x++) {
  const s = (x + .5) / asset.width * 2 - 1, t = (y + .5) / asset.height * 2 - 1;
  const angle = .78 * Math.sin(s * 2.5 - t * .72) + .47 * t - .16 * s;
  const i = (y * asset.width + x) * 2;
  asset.vectors[i] = Math.cos(angle);
  asset.vectors[i + 1] = Math.sin(angle);
}
put('grain-flow', asset);
const profile = { silhouette: [[[-.145,-.019],[-.109,-.040],[.061,-.044],[.145,-.016],[.154,.008],
  [.085,.049],[-.049,.056],[-.124,.034]]], spacing:.37, coverage:{opacity:.98,feather:.006},
  grain:{amount:.12,scale:.020,seed:97}, depth:{back:.034,curve:[[0,.025],[.022,.052],[.047,.085]]} };
const field = { kind:'flow-map', map:'grain', u:[1,0,0], v:[0,1,0] };
const bind = { kind:'surface', slot:'tile', snap:{ mode:'surface', direction:[0,0,1], maxDistance:.48,
  offset:.022, minFacing:.18, spacing:.095 } };
const marks = Array.from({ length:7 }, (_, j) => {
  const y = .56 + j*.224, start = -2.04 + (j % 2)*.17;
  return { id:'tufts-' + j, brush:{kind:'mark-profile',profile:'tuft'}, direction:{ field, strength:1, ruffleDegrees:0, seed:77 + j*13 },
    mat:j === 2 || j === 5 ? 'coral' : 'leaf', attachment:bind, res:.026,
    poses:Array.from({length:11},(_,k)=> {
      const t = k/10, x = start + (2.10 - start - (j % 2)*.21)*t;
      return { point:[x,y + .029*Math.sin(k*.68 + j*.77),.61], pressure:.90 + .12*Math.sin(k*1.10+j*.71) };
    }) };
});
const placement = { id:'surface-weave', bindings:{tile:'face'}, painting:{ id:'tuft-paper', version:1,
  format:KIT.authoring.paintings3d.format, profiles:{tuft:profile}, flowMaps:{grain:asset}, marks } };
const edit = { id:placement.id, edits:marks.map(mark => ({ op:'set', id:mark.id, patch:{ direction:{ ...mark.direction, ruffleDegrees:63 } } })) };
put('placement', placement);
put('ruffle', edit);
const reports = {};
for (const pose of ['flat', 'bent']) {
  reports[pose + '-combed'] = JSON.parse(run(command,'apply',pose + '-base.json','placement.json','--out',pose + '-combed.json'));
  reports[pose + '-ruffled'] = JSON.parse(run(command,'update',pose + '-combed.json','ruffle.json','--out',pose + '-ruffled.json'));
}
run(command, 'extract', 'bent-ruffled.json', '--id', placement.id, '--out', 'painting.json');
const flat = reports['flat-ruffled'].marks[0].orientation, bent = reports['bent-ruffled'].marks[0].orientation;
if (!bent.warped || flat.samples !== bent.samples || !flat.frames.every((row,i) => row.ruffleDegrees === bent.frames[i].ruffleDegrees))
  throw new Error('The deformation changed the rest paint stations or seeded ruffle');
put('direction-report', { rest:flat, deformed:bent });

const w = 484, h = 270, gap = 9, heading = 34, width = w * 2 + gap * 3, height = 2 * (h + heading) + gap * 3;
const sheet = Buffer.alloc(width * height * 3);
for (let i = 0; i < sheet.length; i += 3) sheet.set([17,23,34], i);
function label(title, x, y) {
  const { data, width:tw, height:th } = KIT.procedural.drawing2d.text(title, { color:'#f5deb7', scale:2 }).value;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const p = (j*tw+i)*4;
    if (data[p+3]) sheet.set(data.subarray(p,p+3), ((y+j)*width+x+i)*3);
  }
}
for (const [i,[file, title]] of [
  ['flat-combed', 'COMBED'], ['flat-ruffled', 'RUFFLED / 63 DEG'],
  ['bent-combed', 'COMBED / BENT AND TWISTED'], ['bent-ruffled', 'RUFFLED / SAME SEED AFTER WARP']
].entries()) {
  run('render',file+'.json','--ortho','--raw','--px','1','--w',String(w),'--h',String(h),'--out',file+'.png');
  const pixels = PNG.read(path.join(output,file+'.png')).rgb;
  const x = gap + (i%2)*(w+gap), top = (i > 1 ? 1 : 0)*(h+heading+gap) + gap;
  label(title,x+12,top+7);
  for (let y = 0; y < h; y++) sheet.set(pixels.subarray(y*w*3,(y+1)*w*3),((top+heading+y)*width+x)*3);
}
const demo = path.join(output,'mark-direction-demo.png');
fs.writeFileSync(demo, PNG.encode(width,height,sheet));
console.log(demo);
