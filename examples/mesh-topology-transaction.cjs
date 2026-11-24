/* Commit, undo, and replay one mesh plus pixel transaction on the relay workbench. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const { grid, upscale } = require('../cli/render.js');
const { json } = require('../cli/asset-files.js');
const PNG = require('../cli/png.js');

const positions = {
  left: [-1.17, .39, .32], right: [.79, .39, .32], ridge: [.79, 1.32, .32],
  crown: [.50, 1.66, .32], cap: [-.89, 1.66, .32], chamfer: [-1.17, 1.38, .32],
  sill: [-.06, .39, .32], badgeA: [.90, .49, .32], badgeB: [1.35, .49, .32],
  badgeC: [1.35, 1.37, .32], badgeD: [.90, 1.37, .32]
};
const vertex = id => ({ id, position: positions[id] });
const polygon = (id, ring, material, bounds) => ({
  id, material, corners: ring.map(vertex => {
    const [x,y] = positions[vertex], [left,right,bottom,top] = bounds;
    return { id:id+'/'+vertex,vertex,uv:[(x-left)/(right-left),1-(y-bottom)/(top-bottom)] };
  })
});
const cover = (id, ring) => polygon(id,ring,'enamel',[-1.17,.79,.39,1.66]);
const badge = polygon('badge',['badgeA','badgeB','badgeC','badgeD'],'brass',[.90,1.35,.49,1.37]);

function pigment(baked, brass = false) {
  const width = 48, height = 32, pixels = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x,y,width-1-x,height-1-y);
    let color = brass ? 0xb78757 : baked ? (y < 16 ? 0x558c80 : 0x40706e) : (y < 16 ? 0x607482 : 0x4a606e);
    if (edge < 2) color = edge ? brass ? 0xd2a873 : 0x92b2ac : 0x273f50;
    if (!brass && x >= 6 && x <= 31 && y >= 7 && y < 25) {
      color = 0x182d3e;
      const r = Math.hypot(x - 18,(y - 23)*1.15);
      if (r > 8.5 && r < 11 && y < 20) color = baked ? (x < 18 ? 0x69b4a2 : 0xe8ba80) : 0x8297a1;
      if (y >= 12 && y <= 23 && Math.abs(x-18-(23-y)*.60) < 1) color = baked ? 0xf4deb0 : 0xabbcc4;
    }
    if (!brass && x > 36 && x < 44 && y > 7 && y < 25 && y % 6 < 3) color = baked ? 0xdba96d : 0x8094a0;
    if (brass && x > 10 && x < 38 && y > 7 && y < 25) color = (y % 5 < 2) ? 0x514747 : 0x88683b;
    pixels.push(color >> 16,color >> 8 & 255,color & 255,255);
  }
  return { width,height,pixels };
}

function fixture() {
  const scene = { id:'relay-workbench',name:'Relay workbench',style:'slate',
    camera:{target:[.04,.95,0],dist:3.95,yaw:.24,pitch:.14,projection:'orthographic',sway:0},
    solids:[
      {id:'stand',kind:'box',at:[0,.23,-.12],half:[1.57,.14,.49],mat:'stone',res:.048},
      {id:'housing',kind:'box',at:[.04,.92,-.03],half:[1.41,.56,.325],mat:'metal',res:.055}
    ], topologyMeshes:{relay:{
      document:{id:'relay-panel',vertices:Object.keys(positions).filter(id=>id!=='sill').map(vertex),
        edges:[{id:'sill-edge',vertices:['left','right']}],
        faces:[cover('cover',['left','right','ridge','crown','cap','chamfer']),badge]},
      part:'front',materials:[{id:'enamel',texture:pigment(false)},{id:'brass',color:0x9b7047}],
      bindings:[{id:'cover-mask',domain:'faces',element:'cover',data:{role:'paint-mask'}},
        {id:'fastener',domain:'corners',element:'cover/cap',data:{role:'attachment'}},
        {id:'serial-plate',domain:'faces',element:'badge'}],
      bakes:[{id:'cover-atlas',material:'enamel',maps:{texture:pigment(true)}},
        {id:'badge-atlas',material:'brass',maps:{texture:pigment(true,true)}}]
    }} };
  const pixel = {format:'ink-studio/pixel-art',version:2,width:144,height:108,pixelAspect:[1,1],
    palette:{gold:'#dda96e'},layers:[{id:'annotations'}],
    frames:[{id:'front',durationMs:100,cels:{annotations:{marks:[]}}}],
    sceneBindings:[{id:'relay',scene:scene.id,object:'relay',part:'front',frame:'front'}],
    destinations:[{id:'model',kind:'mesh-topology',binding:'relay'}]};
  const patch = {
    vertices:[vertex('sill'),{id:'cap',position:[-.89,1.80,.32]}],
    faces:[cover('cover',['left','sill','crown','cap','chamfer']),cover('access',['sill','right','ridge','crown'])]
  };
  return { scene,pixel,patch };
}

const command = (action,fields) => ({format:'ink-studio/pixel-command',version:1,action,...fields});
const editor = ({scene,pixel}) => ink.createPixelEditor(pixel,{sceneEditor:ink.createSceneEditor(scene)});

function requests(instance, patch) {
  return {
    model:command('apply',{patch:{id:'partition-cover',destination:'model',frame:'front',
      sourceRevision:instance.targets('model').sourceRevision,operation:{patch}}}),
    draw:command('draw',{patch:{id:'mark-review',frame:'front',operation:{
      tool:'pencil',layer:'annotations',swatch:'gold',points:[[4,4],[5,4],[6,4]]
    }}})
  };
}

function main(out) {
  const details = fixture(), writer = editor(details), {model,draw} = requests(writer,details.patch);
  const file = name => path.resolve(out,name);
  fs.mkdirSync(out,{recursive:true});
  json(file('scene.json'),details.scene);
  json(file('pixel.json'),details.pixel);
  const preview = writer.execute(command('preview',{edit:{...model,patch:{...model.patch,revision:writer.describe().revision}},options:{exact:true}}));
  assert.equal(preview.valid,true,JSON.stringify(preview.conflicts));
  const frames = [];
  function capture(session,tag) {
    const frame = ink.render(session.sceneEditor.build(),{w:144,h:108,px:1,raw:true,ortho:true});
    PNG.write(file(tag+'.png'),frame.w,frame.h,frame.rgb);
    frames.push(upscale(frame,2));
    return frame.rgb;
  }
  const before = capture(writer,'before');
  const request = command('batch',{label:'Partition the relay cover',revision:writer.describe().revision,commands:[model,draw]});
  const batch = writer.execute(request);
  const after = capture(writer,'after');
  const review = writer.exportReview({batch,out:file('review'),zoom:3});
  assert.equal(review.valid,true,JSON.stringify(review.conflicts));
  assert.equal(writer.undo(),true);
  assert.deepEqual(capture(writer,'undo'),before);
  assert.deepEqual(writer.snapshot(),details.pixel);
  const replay = editor(details);
  replay.replayBatch(batch);
  assert.deepEqual(capture(replay,'replay'),after);
  const sheet = grid(frames,2);
  PNG.write(file('comparison.png'),sheet.w,sheet.h,sheet.rgb);
  for(const [name,data] of Object.entries({preview,request,batch,
    'replay-command':command('replay-batch',{batch})})) json(file(name+'.json'),data);
}

if (require.main === module) main(process.argv[2] ?? 'mesh-topology-transaction-review');
module.exports = { fixture,editor,command,requests };
