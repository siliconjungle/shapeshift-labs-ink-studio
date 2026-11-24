const {test}=require('node:test');
const assert=require('node:assert/strict');
const ink=require('..');
const {KIT}=ink.load(), P=KIT.procedural;
const [w,h]=[65,65], center=[32,32], sceneRef='panel.json';
const camera={target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'};
const guard=(id,kind,min,max)=>({id,kind,bounds:{min,max}});

function fixture(change={}) {
  const spec={id:'protection-panel',style:'slate',camera,
    solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.9,.72,.25],res:.04,mat:'stone',...change}]};
  const document={format:'ink-studio/pixel-art',version:2,width:w,height:h,pixelAspect:[1,1],
    palette:{ink:'#17222b'},layers:[{id:'ink'}],frames:[{id:'front',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:sceneRef,object:'plate'}],
    destinations:[{id:'sculpt',kind:'sdf-shape',binding:'plate'},{id:'paint',kind:'sdf-material',binding:'plate'}]};
  const scene=ink.createSceneEditor(spec), editor=ink.createPixelEditor(document,{sceneEditor:scene,sceneRef});
  const edit=(id,operation,destination='sculpt')=>{
    const {documentRevision:revision,sourceRevision}=editor.targets(destination);
    return {id,revision,sourceRevision,destination,frame:'front',operation};
  };
  return {scene,editor,edit,spec};
}

test('blind carving protects a thin wall while a deliberate through-cut still works',()=>{
  const {editor,edit,scene,spec}=fixture({half:[.9,.72,.04]});
  const pixels=[center], shallow=edit('thin',{brush:{mode:'carve',depth:.07,minWall:.02,pixels}});
  const preview=editor.previewEdit(shallow);
  assert.equal(preview.valid,false);
  const issue=preview.conflicts.find(row=>row.code==='thin-wall');
  assert(issue,JSON.stringify(preview.conflicts));
  assert.equal(issue.minimumWall,.02);
  assert(issue.availableDepth<issue.requiredDepth);
  assert.deepEqual(scene.snapshot(),spec);
  const blind=editor.previewEdit(edit('blind',{brush:{mode:'carve',depth:.12,pixels}}));
  assert(blind.conflicts.some(row=>row.code==='thin-wall'));
  const result=editor.apply(edit('through',{brush:{mode:'through-cut',depth:.15,pixels}}));
  assert(P.gridSculptBrush.check(result.solids[0].modifiers[0].brush,'through-cut'));
  assert(KIT.diorama.brushField(result).sdf(0,0,0)>0);
});

test('authored protection reports blocked brush pixels, follows the source and applies to retunes',()=>{
  const {scene,editor,edit}=fixture();
  const side=[39,32];
  const image=ink.render(scene.build(undefined,{retainRenderSdf:true}),{w,h,px:1,raw:true,
    passes:['opaque-surface'],sdfAssist:true});
  const x=ink.pickSurface(image.passes,...side).position[0];
  const protect=[
    guard('jamb','corner',[-.055,-.055,.16],[.055,.055,.27]),
    guard('clearance','opening',[x-.035,-.10,.255],[x+.035,.10,.42])
  ];
  editor.apply(edit('guards',{protection:protect}));
  assert.deepEqual(editor.targets('sculpt').protection,protect);
  const cut=edit('pair',{brush:{mode:'carve',depth:.1,pixels:[center,[39,32]]}});
  const reviewed=editor.previewEdit(cut);
  assert(reviewed.valid,JSON.stringify(reviewed.conflicts));
  assert.equal(reviewed.targets[0].brush.projectedPixels,1);
  assert.deepEqual(reviewed.targets[0].brush.skippedHits[0],
    {at:center,sourceAt:center,code:'protected-sdf-feature',feature:'jamb',kind:'corner'});
  editor.apply(cut);
  assert.equal(editor.receipts().at(-1).skippedHits[0].feature,'jamb');

  const raised=editor.previewEdit(edit('fill-air',{brush:{mode:'raise',depth:.3,pixels:[[39,32]]}}));
  assert(raised.conflicts.some(row=>row.feature==='clearance'));
  const deepGuard=guard('rest-wall','wall',[x-.035,-.12,-.03],[x+.035,.12,.05]);
  scene.setSdfProtection([...protect,deepGuard],'solid:plate');
  const retune=editor.previewEdit(edit('deeper',{updateBrush:{id:'pair',depth:.28}}));
  assert(retune.conflicts.some(row=>row.feature==='rest-wall'));
  scene.setTransform({translation:[1,0,0]},'solid:plate');
  const moved=editor.previewEdit(edit('moved',{brush:{mode:'carve',depth:.1,pixels:[center],camera:{target:[1,0,0]}}}));
  assert(moved.conflicts.some(row=>row.feature==='jamb'));
});

test('smooth skips a material seam and a visible hard corner by default',()=>{
  const {editor,edit,scene}=fixture();
  editor.apply(edit('inlay',{paint:{pixels:[[33,32]],material:'ember'}},'paint'));
  const seam=editor.previewEdit(edit('smooth-seam',{brush:{mode:'smooth',depth:.1,pixels:[center]}}));
  assert(seam.conflicts.some(row=>row.code==='smooth-material-seam'),JSON.stringify(seam.conflicts));

  const yaw=.55, pitch=.14, image=ink.render(scene.build(undefined,{retainRenderSdf:true}),{w,h,px:1,yaw,pitch,
    raw:true,passes:['opaque-surface'],sdfAssist:{epsilon:.0005,steps:256}});
  let corner;
  for (let y=15;y<50 && !corner;y++) for (let x=15;x<50 && !corner;x++) {
    const row=ink.pickSurface(image.passes,x,y);
    const neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].map(([a,b])=>ink.pickSurface(image.passes,a,b));
    if (row?.kind==='sdf' && row.material==='stone' && neighbors.every(p=>p?.kind==='sdf'&&p.material==='stone') &&
        neighbors.some(p=>KIT.V.dot(row.geometricNormal,p.geometricNormal)<.4)) corner=[x,y];
  }
  assert(corner);
  const blocked=editor.previewEdit(edit('smooth-corner',{brush:{mode:'smooth',depth:.1,pixels:[corner],camera:{yaw,pitch}}}));
  assert(blocked.conflicts.some(row=>row.code==='smooth-hard-corner'),JSON.stringify(blocked.conflicts));
});

function box(point,half,at=[0,0,0]) {
  const a=point.map((n,i)=>Math.abs(n-at[i])-half[i]);
  return Math.hypot(...a.map(n=>Math.max(0,n)))+Math.min(0,Math.max(...a));
}

function brickOptions(base,protection,cell=.10) {
  return {bricks:P.sparseBricks.create({cell,brickSize:cell<.05 ? 10 : 4,base}),protection,
    bounds:{min:[-.9,-.9,-.5],max:[.9,.9,.5]},objectId:'gate',
    materials:[{id:'stone',color:0x847272},{id:'trim',color:0x67a298}]};
}

test('brick remeshing detects unresolved solid cores and clear passages at the extraction resolution',()=>{
  const wall=guard('leaf','wall',[-.2,-.2,.048],[.2,.2,.052]);
  const sheet=(...point)=>box(point,[.55,.55,.023],[0,0,.05]);
  assert.throws(()=>P.brickMeshes.create(brickOptions(sheet,[wall])),error=>
    error.feature==='leaf' && /lattice resolution/.test(error.reason));
  const resolved=P.brickMeshes.create(brickOptions(sheet,[wall],.025));
  assert.deepEqual(resolved.current().work.checkedFeatures,['leaf']);

  const opening=guard('slot','opening',[.045,-.10,-.30],[.055,.10,.30]);
  const slotted=(...point)=>Math.max(box(point,[.55,.55,.27]),-box(point,[.024,.19,.45],[.05,0,0]));
  assert.throws(()=>P.brickMeshes.create(brickOptions(slotted,[opening])),error=>
    error.feature==='slot' && /lattice resolution/.test(error.reason));
});

test('brick edits and snapshot swaps preserve named corners, seams, walls and openings atomically',()=>{
  const shape=(...p)=>Math.max(box(p,[.65,.65,.28]),-box(p,[.24,.24,.56]));
  const protection=[
    guard('arch','opening',[-.10,-.1,-.4],[.10,.1,.4]),
    guard('pier','wall',[.37,-.16,-.19],[.55,.16,.19]),
    guard('cap-corner','corner',[.59,.59,.23],[.70,.70,.32]),
    guard('join','seam',[.38,-.08,.24],[.52,.08,.32])
  ];
  const mesh=P.brickMeshes.create(brickOptions(shape,protection)), before=mesh.current();
  assert.deepEqual(before.work.checkedFeatures,protection.map(row=>row.id));
  assert.throws(()=>mesh.edit({bounds:{min:[.3,-.17,.2],max:[.6,.17,.39]},material:'trim'}),
    error=>error.feature==='join');
  const sealed=before.bricks.edit({operation:'union',bounds:{min:[-.4,-.4,-.4],max:[.4,.4,.4]},
    sdf:(...p)=>box(p,[.20,.20,.32])});
  assert.throws(()=>mesh.update(sealed),error=>error.feature==='arch');
  const pierCut={operation:'subtract',bounds:{min:[.22,-.22,-.4],max:[.63,.22,.4]},
    sdf:(...p)=>box(p,[.2,.19,.32],[.45,0,0])};
  assert.throws(()=>mesh.edit(pierCut),error=>error.feature==='pier');
  assert.throws(()=>mesh.edit({operation:'subtract',bounds:{min:[.43,.43,.08],max:[.85,.85,.49]},
    sdf:(...p)=>box(p,[.12,.12,.13],[.63,.63,.25])}),error=>error.feature==='cap-corner');
  assert.equal(mesh.current(),before);
  const okay=mesh.edit({bounds:{min:[-.57,.30,.20],max:[-.36,.49,.36]},material:'trim'});
  assert(okay.work.rebuilt.length<okay.chunks.length);
  assert(okay.work.changed.length>0);
});
