// One enamel case, with independent pigment, normal, lettering and wear layouts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');
const { fixture: fieldCase } = require('./mesh-uv-workshop.cjs');

const bindings = { pigment: 0, bake: 1, decal: 2, 'mask/wear': 3 };
const edit = { uvSet: 'decal', operations: [{ op: 'transform', ids: ['faceplate'], translate: [.043, .016] }] };

function fixture(kit) {
  const { doc, view } = fieldCase(kit);
  const UV = kit.KIT.meshTopology;
  const document = UV.create({ ...doc, uvBindings: bindings, faces: doc.faces.map((face, i) => ({
    ...face, corners: face.corners.map(corner => {
      const [u,v] = corner.uv;
      const low = Math.min(...face.corners.map(c => c.uv[0]));
      const top = Math.min(...face.corners.map(c => c.uv[1]));
      const width = Math.max(...face.corners.map(c => c.uv[0])) - low;
      const height = Math.max(...face.corners.map(c => c.uv[1])) - top;
      return { ...corner, attributes: { ...corner.attributes,
        'uv/1': [.10+.78*v,.08+.82*(1-u)],
        'uv/2': [.035+.25*(i%4)+.139*(u-low)/width,.09+.46*Math.floor(i/4)+.255*(v-top)/height],
        'uv/3': [.08+.84*(1-u),.08+.81*v]
      }};
    })
  })) });
  return { document, view, kit };
}

function bake({ document, view, kit }, directory, options = {}) {
  const source = view.materials[0].texture;
  const model = kit.KIT.model.fromTopology(document);
  model.materials = [{ name:'enamel', texture:{...source,pixels:Uint8Array.from(source.pixels)}, color:[1,1,1], roughness:.42, metallic:.25 }];
  model.maskNames = ['wear'];
  model.sampleSurface = ([x,y,z]) => {
    const ridge = Math.sin(x*18+y*2)*.55+Math.sin(y*23-z*3)*.36;
    const wear = Math.max(0,Math.min(1,.26+ridge*.63+Math.abs(y)*.21));
    // The retained texture remains the source for pigment when the bake lands in another layout.
    return { roughness:.23+wear*.46, metallic:.23,
      normal:[.16*Math.sin(y*29),.17*Math.cos(x*20+z),1], masks:{wear} };
  };
  const exported = ink.exportGlb(model, { out:path.join(directory,'case.glb'), bakeDir:directory, textureSize:256,
    uvMargin:.018, ...options });
  return JSON.parse(fs.readFileSync(exported.materialBake,'utf8')).meshes[0];
}

const lettering = { min:[.090,.235], max:[.164,.323] };

function decalDrawing(K) {
  const word = (text,y,size,width,color)=>K.poly2.text(text,size,{width}).strokes.map(stroke=>({
    type:'path',points:stroke.map(([u,v])=>[46+u,y-v]),color,width
  }));
  return [
    { type:'rect', rect:[0,0,92,48], color:'#281e20' },
    { type:'rect', rect:[2,2,88,44], color:'#b86a42' },
    { type:'rect', rect:[3,3,86,3], color:'#f7cb83' },
    { type:'rect', rect:[3,42,86,2], color:'#773f31' },
    ...word('RELAY 29',21,14,2,'#fff0b8'),
    ...word('FIELD UNIT',38,8,1,'#ffe3ab')
  ];
}

function render(data, directory, baked) {
  const { document, view, kit } = data, { KIT: K } = kit;
  const { w: width, h: height, data: pixels } = PNG.raster(path.join(directory,baked.maps.pigment.file));
  const object = 'field-case';
  const mesh = K.meshTopology.toSceneMesh(document,{objectId:object,
    materials:[{id:'enamel',texture:{width,height,pixels:Uint8Array.from(pixels)}}]});
  const world = kit.makeBuilder(29,[0x131d29]).finish({meshes:[mesh]});
  const image = Composite.screenDrawing(92,48,decalDrawing(K));
  const bound = K.surfaceDecals.bind(world,{
    format:K.surfaceDecals.format, version:1, decals:[{ id:'relay-badge',kind:'lettering',
      anchor:{object,uv:lettering,bias:.008},image:{width:92,height:48,pixels:Array.from(image.data)} }]
  },{receivers:[{object,representation:'mesh',mesh}]});
  const decal = bound.sample(0).report[0];
  assert(decal.triangles > 0);
  const frame = ink.render(world,{ ...view, camera:{...view.camera,dist:5.65}, w:336,h:210,t:0,px:1,raw:true, edges:false });
  PNG.write(path.join(directory,'native-view.png'),frame.w,frame.h,frame.rgb);
  return { frame, decal };
}

function atlas(kit, doc, set, image, tint) {
  const extent = 135, size = 147, layout = kit.KIT.meshTopology.uv.inspect(doc,set);
  const point = ([u,v]) => [6+u*extent,6+v*extent];
  const draw = [{type:'rect',rect:[5,5,extent+2,extent+2],color:'#27394c'}];
  const outlines = [], corners = new Map(layout.corners.map(row=>[row.id,row.uv]));
  for (const face of layout.faces) {
    const points = face.corners.map(id=>point(corners.get(id)));
    if (!image) outlines.push({type:'polygon',points,fill:face.id==='faceplate'?'#64523f':'#233545'});
    outlines.push({type:'path',points:[...points,points[0]],width:1,color:face.id==='faceplate'?tint:'#688194'});
  }
  if (set===2) {
    const [x,y] = point(lettering.min), [right,bottom] = point(lettering.max);
    outlines.push({type:'rect',rect:[x,y,right-x,bottom-y],color:'#f2b96d'});
  }
  const layers = [{draw}];
  if (image) layers.push({source:{w:image.w,h:image.h,rgba:image.data},rect:[6,6,extent,extent]});
  return compose(kit,size,size,[...layers,{draw:outlines}]);
}

function compose(kit, width, height, layers) {
  const { KIT: K } = kit;
  const plan = K.frameComposite.prepare({layers},width,height,1);
  return Composite.compose({w:1,h:1,rgb:Uint8Array.of(13,22,33)},K.frameComposite.layers(plan,{},0),width,height,'nearest');
}

function run(directory) {
  const initial = fixture(ink.load()), { kit, document } = initial;
  const UV = kit.KIT.meshTopology.uv, change = UV.plan(document,edit);
  assert(change.report.canCommit);
  for (const set of [0,1,3]) assert.deepEqual(UV.inspect(document,set).corners,UV.inspect(change.document,set).corners);
  const moved = {...initial, document:change.document};
  fs.mkdirSync(directory,{recursive:true});
  const beforeDir = path.join(directory,'before'), afterDir = path.join(directory,'after');
  const before = bake(initial,beforeDir);
  const after = bake(moved,afterDir,{rebakeFrom:path.join(beforeDir,'material-bake.json')});
  const file = (dir,row)=>fs.readFileSync(path.join(dir,row.file));
  for (const [a,b] of [[before.maps.pigment,after.maps.pigment],[before.maps.normal,after.maps.normal],
    [before.masks.wear,after.masks.wear]]) assert(file(beforeDir,a).equals(file(afterDir,b)));
  const first = render(initial,beforeDir,before), second = render(moved,afterDir,after);
  assert.notDeepEqual(first.frame.rgb,second.frame.rgb);
  const layers = [], draw = [];
  const text = (label,x,y,size,color='#eef4f0')=>draw.push({type:'text',text:label,at:[x,y],size,color});
  const rect = (x,y,w,h,color)=>draw.push({type:'rect',rect:[x,y,w,h],color});
  const width = 708, height = 526;
  text('RELAY FIELD CASE',width/2,23,18);
  text('ONE PART   /   FOUR MATERIAL UV LAYOUTS',width/2,47,9,'#9cb4c6');
  for (const [i,{frame}] of [first,second].entries()) {
    const x=14+i*344;
    text(i?'DECAL ISLAND MOVED':'ORIGINAL',x+168,72,10,i?'#f7c281':'#c2ddda');
    layers.push({source:frame,rect:[x,84,336,210]});
  }
  rect(15,314,678,1,'#314355');
  const descriptors = [after.maps.pigment,after.maps.normal,null,after.masks.wear];
  for (const [set,label] of ['PIGMENT','BAKED NORMAL','DECAL','WEAR MASK'].entries()) {
    const x=24+set*172, tint=set===2?'#f4bd75':'#9cd5cb';
    const source=descriptors[set] && PNG.raster(path.join(afterDir,descriptors[set].file));
    text(label+'  /  UV '+set,x+73.5,335,9,tint);
    layers.push({source:atlas(kit,moved.document,set,source,tint),rect:[x,348,147,147]});
  }
  text('PIGMENT, NORMAL, AND WEAR BAKE PIXELS MATCH BYTE FOR BYTE',width/2,510,8,'#91aab9');
  const sheet=compose(kit,width,height,[...layers,{draw}]);
  PNG.write(path.join(directory,'comparison.png'),width,height,sheet.rgb);
  for (const [name,value] of Object.entries({
    'case-topology.json':document,'move-decal.json':edit,'case-edited.json':moved.document,
    'review.json':{bindings,edit:change.report,unchangedBakes:['pigment','normal','wear'],
      decalTriangles:[first.decal.triangles,second.decal.triangles]}
  })) fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
  console.log(directory);
}

module.exports = { fixture, bake, render, edit, lettering, bindings };
if (require.main===module) run(path.resolve(process.argv[2] ?? 'studio/out/material-channel-uvs'));
