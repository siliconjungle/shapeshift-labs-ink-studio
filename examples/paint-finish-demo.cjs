'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT } = ink.load();
const PNG = require('../cli/png.js');
const out = path.resolve(process.argv[2] ?? 'paint-finish-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
fs.mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' });
const put = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(path.join(out, name + '.json'), 'utf8'));

const style = { sun: [-.57,.58,.55], amb: .27, sky: .18,
  palette: [0x111b27,0x18333b,0x285155,0x3a7071,0x649c8b,0xb3c3a2,
    0x2e2b31,0x5b4a49,0x857067,0xb19a82,0xe0c1a1,
    0x2b3d4e,0x405d6e,0x587d88,0x82a6a1,0xd0c3a8],
  roles: { stone:[1,2,3,4,5], bone:[6,7,8,9,10], frame:[11,12,13,14,15] } };
const scene = { id: 'phosphor-seal', seed: 47, style,
  camera: { target: [.05,1.37,.28], dist: 5.28, yaw: -.12, pitch: .16, sway: 0 },
  finish: { detail: 17, dither: 0, look: { pbrMaterials: { materials: {
    jade: { baseColor:'#5ba491', roughness:.82, lightingRamp:{role:'stone',interpolation:'smooth'}, rampStrength:.31 },
    ceramic: { baseColor:'#b19785', roughness:.64, lightingRamp:{role:'bone',interpolation:'smooth'}, rampStrength:.22 },
    cabinet: { baseColor:'#4d7382', roughness:.72 }
  }, bindings: [{select:{material:'stone'},material:'jade'}, {select:{material:'bone'},material:'ceramic'},
    {select:{material:'frame'},material:'cabinet'}], lights: [
    {direction:[.74,.17,.65],intensity:2.3,color:'#fff0d7'},{direction:[-.62,.36,.57],intensity:.89,color:'#abcaff'}
  ], environment:{ intensity:.37 } } } },
  solids: [
    { id:'plinth',kind:'box',at:[0,1.35,-.25],half:[2.05,1.04,.18],round:.18,mat:'frame',res:.045 },
    { id:'inset',kind:'box',at:[-.70,1.38,-.09],half:[1.12,.87,.21],round:.17,mat:'bone',res:.046 },
    { id:'seal',kind:'ball',at:[-.71,1.38,.06],r:.82,mat:'stone',res:.036 },
    ...Array.from({length:3},(_,i)=>({ id:'cooling-fin-'+i,kind:'box',at:[.54+.32*i,1.38,.13],
      half:[.105,.67-.045*i,.26],round:.085,mat:'bone',res:.032 }))
  ] };
put('base', scene);
const record = { id:'lacquer', brush:{kind:'sphere',radius:.146}, step:.041, res:.026,
  poses: Array.from({length:22},(_,i)=>{
    const t=i/21;
    return { point:[-.35+.086*Math.cos((t-.05)*Math.PI*1.66),.87+1.02*t,1.01], pressure:.78+.20*Math.sin(Math.PI*t) };
  }),
  attachment:{kind:'surface',slot:'lens',snap:{mode:'surface',maxDistance:.62,direction:[0,0,1],spacing:.043}} };
const tint = { tint:{color:'#91c5ff',strength:.65}, hueShift:54 };
const rough = { roughness:.43 };
const gloss = {...rough,coating:{weight:.93,roughness:.28}};
const emission = {color:'#ff9839',strength:.81};
const glow = {...tint,...gloss,emission};
const spill = {...glow,emission:{...emission,spill:{intensity:17,radius:2.3,lift:.47,shadows:true}}};
const id='seal-finish', cmd='painting-3d';
put('placement', { id, bindings:{lens:'seal'}, painting:{id:'finish-study',format:KIT.authoring.paintings3d.format,
  version:1,marks:[{...record,finish:tint}]} });
const variants = [['base','BASE MATERIAL'],['tint-hue','TINT + HUE SHIFT'],['rough','ROUGHNESS'],
  ['coated','CLEAR COAT ADDED'], ['emission','EMISSION ONLY'], ['spill','EMISSION + LIGHT SPILL']];
const reports = { 'tint-hue':JSON.parse(run(cmd,'apply','base.json','placement.json','--out','tint-hue.json')) };
for (const [file, finish] of [['rough',rough],['emission',glow],['spill',spill]]) {
  put(file+'-edit',{ id, edits:[{op:'set',id:record.id,patch:{finish}}] });
  reports[file]=JSON.parse(run(cmd,'update','tint-hue.json',file+'-edit.json','--out',file+'.json'));
}
put('coated-edit',{ id, edits:[{op:'set-finish',id:record.id,patch:{coating:gloss.coating}}] });
reports.coated=JSON.parse(run(cmd,'update','rough.json','coated-edit.json','--out','coated.json'));
reports.reopened=JSON.parse(run(cmd,'inspect','spill.json'));
run(cmd,'extract','spill.json','--id',id,'--out','painting.json');
assert.deepEqual(read('painting').marks[0].poses,record.poses);
assert(!reports.emission.marks[0].finish.emission.spill);
assert.equal(reports.reopened[0].marks[0].finish.emission.spill.intensity,17);
put('finish-report',reports);

const w=392, h=235, gap=8, caption=32, width=3*w+4*gap, height=2*(h+caption)+3*gap;
const sheet=Buffer.alloc(width*height*3);
for(let i=0;i<sheet.length;i+=3)sheet.set([16,23,33],i);
for(const [i,[file,label]] of variants.entries()){
  run('render',file+'.json','--ortho','--raw','--px','1','--w',String(w),'--h',String(h),'--out',file+'.png');
  const frame=PNG.read(path.join(out,file+'.png')).rgb;
  const x=gap+(i%3)*(w+gap), y=gap+Math.floor(i/3)*(h+caption+gap);
  const text=KIT.procedural.drawing2d.text(label,{ color:'#f2dbb7',scale:2 }).value;
  for(let ty=0;ty<text.height;ty++)for(let tx=0;tx<text.width;tx++){
    const src=(ty*text.width+tx)*4;
    if(text.data[src+3])sheet.set(text.data.subarray(src,src+3),((y+8+ty)*width+x+12+tx)*3);
  }
  for(let row=0;row<h;row++)sheet.set(frame.subarray(row*w*3,(row+1)*w*3),((y+caption+row)*width+x)*3);
}
const image=path.join(out,'paint-finish-demo.png');
fs.writeFileSync(image,PNG.encode(width,height,sheet));
console.log(image);
