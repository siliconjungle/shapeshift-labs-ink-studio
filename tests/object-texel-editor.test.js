const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const {KIT:K,makeBuilder}=ink.load();
const api=import('../webgl.mjs');

const cube={
  points:[-1,-1,-1,-1,-1,1,1,-1,1,1,-1,-1,-1,1,-1,-1,1,1,1,1,1,1,1,-1],
  triangles:[0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7,0,2,1,0,3,2,4,5,6,4,6,7]
};
const amber=0xa26a37, mint=0x278e83;

test('cluster selection crosses real cube seams and counts only its connected pigment',async()=>{
  const {bakeObjectTexels,createObjectTexelEditor}=await api;
  const bake=bakeObjectTexels(cube,{resolution:6,material:({face,y})=>[0,1,4,5].includes(face)&&y===3?amber:mint});
  const editor=createObjectTexelEditor(bake,{KIT:K});
  const band=editor.execute({op:'select',at:[4,2,3]}).selection;
  assert.equal(band.length,24);
  assert.deepEqual([...new Set(band.map(id=>bake.cells[id].face))].sort(),[0,1,4,5]);
  assert.equal(editor.execute({op:'select',seed:band[0],mode:'surface'}).selection.length,216);

  // Off-axis clipping gives some edge segments to the fallback cell of
  // their source triangle. The cluster still follows the rendered surface.
  const angle=.26,c=Math.cos(angle),s=Math.sin(angle),points=[];
  for(let i=0;i<cube.points.length;i+=3) {
    const [x,y,z]=cube.points.slice(i,i+3);
    points.push(x*c+.74*z*s,y,.74*z*c-x*s);
  }
  const tilted=bakeObjectTexels({...cube,points},{resolution:8,origin:[.009,.02,-.018],material:()=>amber,fallback:amber});
  const tiltedEditor=createObjectTexelEditor(tilted,{KIT:K});
  const connected=tiltedEditor.execute({op:'select',seed:tilted.cells.find(row=>row?.face===4).id}).selection;
  assert.equal(connected.length,new Set(tilted.triangleCells).size);
  assert(connected.some(id=>tilted.cells[id].fallback));

  const split={points:[-.9,-.9,1,-.01,-.9,1,-.01,.9,1,-.9,.9,1,
    .01,-.9,1,.9,-.9,1,.9,.9,1,.01,.9,1],triangles:[0,1,2,0,2,3,4,5,6,4,6,7]};
  const pieces=bakeObjectTexels(split,{resolution:8,material:()=>amber});
  const separate=createObjectTexelEditor(pieces,{KIT:K});
  const first=separate.execute({op:'select',at:[4,1,3]}).selection;
  assert(first.length>4);
  assert(first.every(id=>pieces.cells[id].point[0]<0));
});

test('native tip previews exact bytes, respects protected cells, and survives undo, redo and reopen',async()=>{
  const {bakeObjectTexels,createObjectTexelEditor,editObjectTexels}=await api;
  const bake=bakeObjectTexels(cube,{resolution:6,material:({face,y})=>face===4&&y===3?amber:0x214e5d});
  const editor=createObjectTexelEditor(bake,{KIT:K});
  const selected=editor.execute({op:'select',at:[4,2,3]}).selection;
  const protectedCell=selected[2];
  editor.execute({op:'protect',ids:[protectedCell]});
  assert.throws(()=>editObjectTexels(editor.bake(),[{id:protectedCell,pigment:mint}]),/protected/);
  const tip=K.pixelBrushes.capture({width:1,height:2,pixels:[[0,0],[0,1]],read:(_,y)=>({color:y?'#4cafa0':'#278e83'})});
  const stroke={revision:editor.status().revision,face:4,points:[[1,3],[4,3]],tip,values:{roughness:.42,emission:0x114433}};
  const preview=editor.execute({op:'preview',...stroke});
  assert.equal(preview.changed.length,3);
  assert(preview.skipped.some(row=>row.id===protectedCell&&row.reason==='protected'));
  assert(preview.skipped.some(row=>row.reason==='outside-selection'));
  assert.deepEqual(editor.bake().rgba,bake.rgba);
  const receipt=editor.execute({op:'brush',...stroke});
  assert.deepEqual(receipt.changed,preview.changed);
  assert.equal(receipt.outputRevision,stroke.revision+1);
  assert.throws(()=>editor.execute({op:'brush',...stroke}),/different edit revision/);
  assert.deepEqual(editor.bake().rgba.subarray(protectedCell*4,protectedCell*4+4),bake.rgba.subarray(protectedCell*4,protectedCell*4+4));
  const reopened=createObjectTexelEditor(bake,{KIT:K,session:JSON.parse(JSON.stringify(editor.exportSession()))});
  assert.deepEqual(reopened.bake().rgba,editor.bake().rgba);
  assert.deepEqual(reopened.bake().roughness,editor.bake().roughness);
  assert.deepEqual(reopened.bake().emission,editor.bake().emission);
  const alternate=editObjectTexels(bake,[{id:protectedCell,pigment:mint}]);
  assert.throws(()=>createObjectTexelEditor(alternate,{KIT:K,session:editor.exportSession()}),/does not match/);
  const mesh=K.sceneMeshes.fromObjectTexels(bake,{id:'cube'});
  const layer=K.sceneMeshes.layer(mesh), revision=layer.geometryRevision;
  reopened.apply(mesh);
  assert(reopened.execute({op:'undo'}).changed);
  assert.deepEqual(reopened.bake().rgba,bake.rgba);
  assert.deepEqual(reopened.status().protected,[protectedCell]);
  reopened.apply(mesh);
  assert.equal(layer.geometryRevision,revision);
  assert(reopened.execute({op:'redo'}).changed);
  assert.deepEqual(reopened.bake().rgba,editor.bake().rgba);
});

test('native surface evidence follows one cell selection through a rigid pose and occlusion',async()=>{
  const {bakeObjectTexels,createObjectTexelEditor}=await api;
  const bake=bakeObjectTexels(cube,{resolution:6,material:({face})=>face===4?amber:mint});
  const mesh=K.sceneMeshes.fromObjectTexels(bake,{id:'lamp',objectId:'prop',partId:'case'});
  const occluder=K.sceneMeshes.create({id:'occluder',positions:[-1,-1,2,0,-1,2,0,1,2,-1,1,2],
    indices:[0,1,2,0,2,3],uvs:Array(8).fill(0),materials:[{id:'shade',color:0x151718}]});
  const build=makeBuilder(1,[0x182a38]);
  const world=build.finish({meshes:[mesh,occluder],cam:{target:[0,0,0],dist:6,yaw:0,pitch:0,ortho:true}});
  const editor=createObjectTexelEditor(bake,{KIT:K});
  editor.execute({op:'select',at:[4,2,3]});
  const render=()=>ink.render(world,{w:90,h:72,px:1,raw:true,passes:['sourceSurface']});
  const near=editor.watch(mesh,render());
  assert(near.hidden.length>0 && near.mask.some(Boolean));
  assert.equal(near.cellAt[36*90+32],-1);
  const rig=K.sceneMeshes.skin(mesh,Array(mesh.vertices).fill(0));
  rig.pose([-1,0,0,0,1,0,0,0,-1,0,0,0]);
  const far=editor.watch(mesh,render());
  assert(!far.mask.some(Boolean));
  assert.equal(far.hidden.length,36);
  assert.throws(()=>editor.watch(mesh,{w:90,h:72}),/source surface/);
});

test('pixel-art texels keeps selection, protection, brush receipts and undo on disk',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-object-texel-edit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(filename,data)=>{
    const out=path.join(dir,filename);
    fs.writeFileSync(out,JSON.stringify(data));
    return out;
  };
  const source=save('source.json',{format:'ink-studio/object-texel-source',version:1,id:'case',mesh:cube,resolution:6,
    material:{pigment:amber}});
  const session=path.join(dir,'session'), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(action,input,...flags)=>JSON.parse(execFileSync(process.execPath,[cli,'pixel-art','texels',action,session,
    ...(input?[input]:[]),...flags],{stdio:'pipe',maxBuffer:4e6}));
  run('init',source);
  const edit=(name,command)=>run('run',save(name+'.json',command));
  const {status}=edit('select',{op:'select',at:[4,3,3]});
  assert.equal(status.selection.length,216);
  edit('protect',{op:'protect',ids:[status.selection[0]]});
  const brush=edit('brush',{op:'brush',values:{pigment:mint}});
  assert.equal(brush.receipt.changed.length,215);
  const views=save('views.json',{format:'ink-studio/object-texel-watch',version:1,w:64,h:56,
    views:[{id:'front',camera:{yaw:0}},{id:'turned',poseYaw:Math.PI, camera:{yaw:0}}]});
  const review=path.join(dir,'review');
  run('watch',views,'--out',review);
  const evidence=JSON.parse(fs.readFileSync(path.join(review,'watch.json')));
  assert(evidence.views.every(row=>row.selectedPixels>100 && row.cellAt.length===64*56 && row.hidden.length>0));
  assert.notDeepEqual(evidence.views[0].visible,evidence.views[1].visible);
  assert(fs.existsSync(path.join(review,'turned-watch.png')));
  edit('undo',{op:'undo'});
  assert.equal(run('status').editedCells,0);
  edit('redo',{op:'redo'});
  assert.equal(run('status').editedCells,215);
});
