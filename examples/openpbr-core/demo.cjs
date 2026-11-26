const path = require('node:path');
const fs = require('node:fs');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const directory = path.resolve(process.argv[2] ?? 'studio/out/openpbr-core');
const samples = Number(process.argv[3] ?? 40), width = Number(process.argv[4] ?? 416);
const at = name => path.join(directory, name);
const toolkit = Ink.load(), P = toolkit.KIT.procedural;
const tau = 2 * Math.PI;

function turned(name, profile) {
  const sides = 96, stride = sides + 1, rows = [];
  for (const [j,[z,r]] of profile.entries()) {
    const [z0,r0] = profile[Math.max(0,j-1)], [z1,r1] = profile[Math.min(profile.length-1,j+1)];
    for (let i = 0; i <= sides; i++) {
      const u = i / sides, a = u * tau, x = Math.cos(a), y = Math.sin(a);
      rows.push('v ' + [r*x,r*y,z].map(n => n.toFixed(7)).join(' '));
      rows.push('vt ' + u + ' ' + j / (profile.length - 1));
      rows.push('vn ' + [x*(z1-z0),y*(z1-z0),r0-r1].join(' '));
    }
  }
  const token = n => n + '/' + n + '/' + n;
  for (let j = 1; j < profile.length; j++) for (let i = 0; i < sides; i++) {
    const a = (j - 1) * stride + 1 + i, b = a + 1;
    if (profile[j - 1][1]) rows.push('f ' + [a,b,b+stride].map(token).join(' '));
    if (profile[j][1]) rows.push('f ' + [a,b+stride,a+stride].map(token).join(' '));
  }
  files.write(at(name), rows.join('\n') + '\n');
  return name;
}

const bezel = turned('bezel.obj', [[-.24,0],[-.24,1.03],[-.203,1.11],[.09,1.11],[.18,1.085],
  [.234,1.026],[.234,.942],[.197,.913],[.13,.913],[.13,0]]);
const foot = turned('foot.obj', [[-.172,0],[-.172,.76],[-.13,.87],[.025,.87],[.082,.82],[.094,.71],[.094,0]]);
const hub = turned('hub.obj', [[-.037,0],[-.037,.095],[.01,.095],[.035,.072],[.035,0]]);

const font = {
  F:['111','100','110','100','100'], M:['101','111','101','101','101'],
  N:['101','111','111','111','101'], O:['111','101','101','101','111'],
  R:['110','101','110','101','101'], S:['111','100','111','001','111'],
  T:['111','010','010','010','010'], W:['101','101','101','111','101'],
  '0':['111','101','101','101','111'], '2':['111','001','111','100','111'],
  '6':['111','100','111','101','111'], '-':['000','000','111','000','000']
};
const lettering = new Set();
function type(text, y, scale = 2, center = 128) {
  const left = Math.round(center - (text.length * 4 - 1) * scale / 2);
  for (const [i, char] of [...text].entries()) if (font[char])
    for (const [j, row] of font[char].entries()) for (let k = 0; k < row.length; k++) if (row[k] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++)
        lettering.add((y + j * scale + dy) * 256 + left + (i * 4 + k) * scale + dx);
}
type('STORM',69,3); type('F-026',154,2); type('N',41,2); type('W',113,2,45);

const size = 256, pixels = size * size;
const rgb = new Uint8Array(pixels * 3);
const opacity = new Uint8Array(pixels), metal = new Uint8Array(pixels), rough = new Uint8Array(pixels);
const luminance = new Float32Array(pixels), relief = new Float32Array(pixels), varnish = new Float32Array(pixels);
for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p++) {
  const px = (x + .5 - 128) / 128, py = (y + .5 - 128) / 128;
  const r = Math.hypot(px, py), a = (Math.atan2(px,-py) + tau) % tau;
  const tick = Math.abs(Math.sin(a * 24)) < .12 && r > (Math.abs(Math.sin(a * 6)) < .05 ? .69 : .76) && r < .823;
  const ring = Math.abs(r - .846) < .006 || Math.abs(r - .67) < .006;
  const arc = r > .53 && r < .57 && a > .31 && a < 1.31;
  const warning = py > .41 && py < .54 && Math.abs(px) < .17;
  const vent = warning && Math.floor((x - 1) / 8) % 2 === 1 && Math.abs(px) < .154 && py > .42 && py < .515;
  const stamp = lettering.has(p), gold = stamp || tick || arc || r > .884;
  const grain = Math.round(1.5*Math.sin(x * 1.812 + y * .43) * Math.sin(y * .857 - x * .391));
  const wash = (1 - r) * 11 + (1 - py) * 4;
  const color = stamp ? [224,187,114] : arc ? [176,105,52] : tick ? [197,151,85] :
    ring || warning ? [84,131,126] : gold ? [132,82,49] : [12 + wash,46 + wash,51 + wash];
  rgb.set(color.map(n => Math.max(0, Math.min(255, Math.round(n + grain)))),p * 3);
  opacity[p] = r < .924 && !vent ? 255 : 0;
  metal[p] = gold ? 225 : 0;
  rough[p] = gold ? 115 : 116 + grain * 3;
  luminance[p] = arc ? 240 : 0;
  relief[p] = (stamp ? .035 : tick || ring ? .025 : arc ? -.025 : 0) +
    .002 * Math.sin(y * .26 + 1.8 * Math.sin(x * .037)) * Math.sin(x * .19);
  varnish[p] = .009 * Math.sin(x * .1 + .6 * Math.cos(y * .052)) + .0075 * Math.sin(y * .13);
}

const typed = (data, settings) => P.graphImages.declare({width:size,height:size,channels:1,data}, settings);
const heightSpec = {intent:'height',units:'mm'};
const assets = {}, nodes = {};
const ref = (node, port = 'value') => ({node,port});
function source(name, encoding, bytes, interpretation) {
  const member = name + '.' + encoding;
  files.write(at(member),bytes);
  assets[name] = {format:'bitmap',interpretation,source:{file:member}};
  nodes[name] = {op:'bitmapAsset',inputs:{name}};
}
source('pigment','png',PNG.encode(size,size,rgb),{intent:'color',sampling:'linear'});
for (const [name,data] of [['opacity',opacity],['metal',metal],['rough',rough]])
  source(name,'png',PNG.encodeGray(size,size,data),{intent:'mask',sampling:'linear'});
for (const [name,data,settings] of [['relief',relief,heightSpec],['varnish',varnish,heightSpec],
  ['luminance',luminance,{intent:'data',units:'nits'}]])
  source(name,'exr',Ink.encodeTexture(typed(data,settings),{encoding:'exr',bitDepth:32}),{...settings,sampling:'linear'});
nodes.base = {op:'image.heightToNormal',inputs:{source:ref('relief'),options:{method:'sobel',spacing:[.1,.1],strength:1.5}}};
nodes.clear = {op:'image.heightToNormal',inputs:{source:ref('varnish'),options:{method:'sobel',spacing:[.1,.1],strength:3.0}}};

const inputs = {
  base_color:ref('pigment'), base_metalness:ref('metal'), specular_roughness:ref('rough'),
  geometry_opacity:ref('opacity'), geometry_normal:ref('base'), geometry_coat_normal:ref('clear'),
  emission_luminance:ref('luminance')
};
const parameters = {
  base_diffuse_roughness:.26, specular_weight:.84, specular_roughness_anisotropy:.47,
  coat_weight:1, coat_color:[.88,.97,.98], coat_roughness:.24, coat_roughness_anisotropy:.45,
  coat_ior:1.63, coat_darkening:.8, geometry_coat_tangent:[0,1,0], emission_color:[1.1,.32,.06],
  geometry_thin_walled:true
};
const variants = [
  {id:'finish',label:'Finished',note:'Warm backlight through the vents, engraved relief, and a separate glaze highlight.'},
  {id:'bare',label:'Glaze off',note:'Same light rig. The broader substrate highlight remains as the glaze reflection drops away.',
    values:{coat_weight:0}},
  {id:'flat',label:'Relief off',note:'Both normal maps are removed. The printed marks stay while the relief and glaze ripples flatten.',
    skip:['geometry_normal','geometry_coat_normal']},
  {id:'solid',label:'Vents sealed',note:'Only the vent holes are filled. The silhouette and emissive arc stay in place.',
    bindings:{geometry_opacity:ref('sealed')}},
  {id:'unlit',label:'Power off',note:'The luminance map is disconnected and the dial loses its emissive arc and vent lighting.',
    skip:['emission_luminance'],lamp:false}
];

const sealed = opacity.slice();
for (let y = 173; y < 196; y++) sealed.fill(255,y * size + 105,y * size + 151);
source('sealed','png',PNG.encodeGray(size,size,sealed),{intent:'mask',sampling:'linear'});
const outputs = {};
for (const {id,values,skip,bindings} of variants) {
  const maps = {...inputs,...bindings};
  for (const key of skip ?? []) delete maps[key];
  nodes[id + '-maps'] = {op:'data.record',inputs:maps};
  nodes[id] = {op:'material.openPbr',inputs:{parameters:{...parameters,...values},maps:ref(id+'-maps')}};
  outputs[id] = ref(id);
  outputs[id + '-inputs'] = ref(id,'report');
}
const graph = {format:'ink-studio/graph-project',version:1,assets,nodes,outputs};
const editable = Ink.openMaterialGraph(graph,{id:'storm-dial',baseDir:directory});
editable.label = 'Storm dial enamel';
const graphFile = 'storm-dial.material.json';
Ink.writeMaterialGraph(at(graphFile),editable);

const body = (id,file,material,position,scale,rotation) => ({id,kind:'mesh',file,material,position,scale,rotation});
const plane = (id,material,position,scale,rotation) => ({id,kind:'plane',material,position,scale,rotation});
const block = (id,material,position,scale,rotation) => ({id,kind:'cube',material,position,scale,rotation});
const centered = [0,1.34,0];
const shell = {base_color:[.38,.20,.086],base_metalness:.98,specular_roughness:.32,specular_roughness_anisotropy:.62};
const setting = {format:'ink-studio/physical-reference',version:1,
  view:{width,height:Math.round(width*.71)},
  settings:{quality:'final',samples,bounces:4,batch:samples,seed:271402,exposure:.32,denoise:'strong'},
  camera:{target:[0,1.23,.03],yaw:17,pitch:12,distance:6.8,focalLength:55},
  environment:{color:[.27,.42,.52],strength:.34,background:false},
  materials:{
    floor:{baseColor:[.022,.056,.066],roughness:.44}, wall:{baseColor:[.024,.050,.075],roughness:.8},
    shell:{openPbr:shell}, foot:{openPbr:{base_color:[.027,.065,.074],specular_roughness:.41,coat_weight:.38,coat_roughness:.36}},
    pointer:{openPbr:{...shell,base_color:[.74,.43,.17],base_metalness:.75,specular_roughness:.28}},
    cavity:{baseColor:[.009,.014,.016],roughness:.9},
    key:{baseColor:[0,0,0],emission:[10.0,8.1,5.9]},
    side:{baseColor:[0,0,0],emission:[4.8,7.5,11.6]},
    rim:{baseColor:[0,0,0],emission:[5.9,9.2,11.6]}
  },
  meshes:[
    plane('floor','floor',[0,0,0],[7,8,1],[-90,0,0]),
    plane('back','wall',[0,2.65,-2.75],[8,6,1]),
    body('foot',foot,'foot',[0,.18,-.06],[1,.75,1],[90,0,0]),
    block('mount','shell',[0,.255,-.07],[.22,.26,.17]),
    body('bezel',bezel,'shell',centered),
    plane('face','dial',[0,1.34,.209],[1.02,1.02/.72,1]),
    block('cavity','cavity',[0,.861,.149],[.168,.12,.018]),
    plane('vent-light','lamp',[0,.861,.169],[.13,.113,1]),
    body('hub',hub,'pointer',[0,1.34,.314]),
    block('hand','pointer',[.175,1.515,.301],[.026,.261,.012],[0,0,-45]),
    block('hand-heel','pointer',[-.048,1.292,.301],[.043,.081,.013],[0,0,-45]),
    plane('key','key',[-2.19,3.39,2.47],[1.35,1.13,1],[149,-34,8]),
    plane('side','side',[2.95,2.0,1.16],[.48,1.56,1],[16,-115,0]),
    plane('rim','rim',[-.4,3.73,-1.04],[1.1,.85,1],[75,0,0])
  ]
};

async function main() {
  const receipts = {};
  const only = new Set(process.argv.slice(5));
  for (const {id,label,lamp} of variants) {
    if (only.size && !only.has(id)) continue;
    const plan = {...setting,label:'Storm dial / '+label,materials:{...setting.materials,
      dial:{graph:{file:graphFile,output:id}},lamp:{openPbr:{
        base_weight:0,specular_weight:0,emission_color:[1,.27,.045],emission_luminance:lamp === false ? 0 : 170,
        geometry_thin_walled:true
      }}
    }};
    const filename = at(id + '.plan.json');
    files.json(filename,plan);
    const report = await Ink.writePhysicalReference(filename,{directory:at(id),toolkit});
    receipts[id] = report.openPbr.materials.dial.fields;
    console.log(label + ' · ' + report.totalSamples + ' spp · ' + report.stats.cameraRays + ' camera rays');
  }
  const template = fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  files.write(at('index.html'),template.replace('/*REVIEW_DATA*/',()=>
    JSON.stringify({variants,samples,width,receipts}).replaceAll('<','\\u003c')));
}
main().catch(error => { console.error(error); process.exitCode=1; });
