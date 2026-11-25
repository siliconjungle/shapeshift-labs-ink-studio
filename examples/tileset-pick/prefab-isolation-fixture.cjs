'use strict';

const ink = require('../..');
const PNG = require('../../cli/png.js');

function fixture() {
  const { KIT: K } = ink.load();
  const drawing = K.procedural.drawing2d;
  const rect = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
  const cells = [
    ['BAY','#417d74','#bde2b4'], ['||||','#766954','#e7c583'],
    ['NXT','#a95246','#ffcc98']
  ];
  const art = drawing.render({width:72,height:24,edges:'hard',commands:cells.flatMap(([label,color,light],i) => {
    const x = i*24;
    return [rect(x,0,24,24,'#263840'),rect(x+1,1,22,22,color),rect(x+1,1,22,2,light),
      rect(x+3,7,18,10,'#293f44'),{type:'text',text:label,at:[x+3,8],scale:1,color:light},
      rect(x+2,19,2,2,light),rect(x+20,19,2,2,light),rect(x+1,22,22,1,'#273941')];
  })});
  const image = PNG.encode(72,24,art.data,4);
  const sheet = ink.readTilesetImage(image);
  const source = {id:'prefab-sign-source',style:'slate',solids:[],tilesets:{enamel:sheet}};
  const editor = ink.createSceneEditor(source);
  const pick = cell => ink.pickTilesetRectangle(source,'enamel',{x:24*cell,y:0,width:24,height:24});
  for (const [id,x,width,cell] of [['sign',-.75,1,0],['grille',.25,.5,1]])
    editor.placeTilesetFace({object:'panel',face:id,origin:[x,0,0],worldSize:[width,.88],selection:pick(cell)});
  const base = editor.meshTopology('panel'), positions = new Map(base.document.vertices.map(row => [row.id,row.position]));
  const [sign,grille] = ['sign','grille'].map(id => base.document.faces.find(face => face.id === id));
  const merge = new Map();
  for (const { vertex } of grille.corners) {
    const at = positions.get(vertex);
    const shared = sign.corners.find(corner => positions.get(corner.vertex).every((value,i) => Math.abs(value-at[i]) <= 1e-10));
    if (shared) merge.set(vertex,shared.vertex);
  }
  const panel = {...base,document:K.meshTopology.edit(base.document,{removeVertices:[...merge.keys()],
    faces:[{...grille,corners:grille.corners.map(corner => ({...corner,vertex:merge.get(corner.vertex) ?? corner.vertex}))}]})};
  const vertices = [[-1.92,-.1,.36],[-1.48,-.1,.36],[-1.48,1.23,.36],[-1.92,1.23,.36]]
    .map((position,i) => ({id:'v'+i,position}));
  const pillar = {document:{id:'pillar',vertices,faces:[{id:'screen',material:'iron',
    corners:vertices.map(({id:vertex},i) => ({id:'c'+i,vertex,uv:[0,0]}))}]},materials:[{id:'iron',color:0x5b7380}]};
  const library = { bay: { revision: 3, solids: { body: { kind:'box',at:[0,.44,-.14],half:[.82,.50,.12],mat:'dark' } },
    topologyMeshes: {panel}, usesTilesets:['enamel'] } };
  const scene = {id:'station-bays',style:'slate',solids:[],tilesets:{enamel:sheet},prefabLibrary:'library.json',
    camera:{target:[0,.50,0],yaw:0,pitch:0,dist:4.5,projection:'orthographic',sway:0},
    topologyMeshes:{pillar},
    instances:{west:{prefab:'bay',transform:{translation:[-1.31,0,0]}},
      east:{prefab:'bay',transform:{translation:[1.31,0,0]}}} };
  const change = {member:'panel',reskin:{face:'sign',selection:pick(2)}};
  const request = {instance:'west',revision:3,faces:{panel:['sign']},hideSurroundings:true,edits:[change]};
  const view = {w:206,h:100,camera:{yaw:0,pitch:0,dist:4.5,target:[0,.50,0],ortho:true,zoom:1.60}};
  return {scene,library,panel,request,view,image,shared:[...merge.values()]};
}

module.exports = { fixture };
