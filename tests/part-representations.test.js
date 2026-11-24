const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');

function fixture({KIT:K,makeBuilder}) {
  const B=makeBuilder(8,[0x101725,0xe6ad76,0x6acfca,0xb493bd,0x9b64d8]);
  const api=K.sprite.reconstruction, object='signal';
  const atlas=colors=>({metadata:{width:8,height:8,unitsPerPixel:.1,
    frames:[{frame:0,yaw:0,pitch:0,rect:{x:0,y:0,width:8,height:8}}]},
    images:{color:Array.from({length:64},()=>[...colors,255]).flat()}});
  const sprite=(at,colors,range)=>({asset:api.asset({atlas:atlas(colors),range}),at,lighting:false});
  const mesh=K.sceneMeshes.create({id:'signal-shell-draw',objectId:object,partId:'shell',
    positions:[-1.52,.4,0,-.72,.4,0,-1.52,-.4,0,-.72,-.4,0],uvs:[0,0,1,0,0,1,1,1],
    indices:[0,1,2,2,1,3],materials:[{id:'enamel',color:0x6acfca}]});
  K.curveSplats.draw(B,{id:'coil',points:[[-.36,-.16,0],[.02,.14,0],[.36,-.10,0]]},
    {width:.22,edge:'hard',color:'#e6ad76',object,material:'copper',target:{part:'coil'}});
  const start=B.count();
  B.disc(1.12,0,0,[0,0,1],.27,.05,B.P[3],3);
  B.describeSplats(start,B.count(),{object,material:'felt',target:{entity:object,part:'hood'}});
  const world=B.finish({meshes:[mesh],cam:{target:[0,0,0],dist:7,yaw:0,pitch:0,sway:0},
    fog:{c:0,start:1,max:0},dither:0,look:{splatCoverage:'continuous'}});
  const rows=[
    {object,part:'shell',material:'enamel',representation:'mesh',mesh,sprite:sprite([-1.12,0,0],[155,100,216],[5,9])},
    {object,part:'coil',material:'copper',representation:'curves',sprite:sprite([0,0,0],[239,112,64],[6,10])},
    {object,part:'hood',material:'felt',representation:'splats',sprite:sprite([1.12,0,0],[239,152,187],[4,8])}
  ];
  api.bindParts(world,rows);
  return {world,rows,api};
}

const kit=ink.load();
const w=164,h=90, view={w,h,raw:true,px:1,passes:['opaque-surface','partId','strands']};
const named=(passes,part)=>passes.parts.findIndex(row=>row?.object==='signal'&&row.part===part);

test('mesh, curve and splat parts keep their object, material, and part IDs through the distance handoff',()=>{
  const {world}=fixture(kit);
  const near=ink.render(world,{...view,dist:3});
  const far=ink.render(world,{...view,dist:13});
  const mid=ink.render(world,view);
  for(const {part,material,kind} of [
    {part:'shell',material:'enamel',kind:1},{part:'coil',material:'copper',kind:3},{part:'hood',material:'felt',kind:3}
  ]) {
    const index=named(near.passes,part);
    assert(index>0 && named(far.passes,part)===index);
    for(const [frame,expected] of [[near,kind],[far,4]]) {
      const p=frame.passes, at=p.partId.findIndex((id,q)=>id===index&&p.surfaceKind[q]===expected);
      assert(at>=0,JSON.stringify({part,expected,parts:p.parts,pixels:p.partId.filter(n=>n===index).length}));
      assert.equal(p.objectId[at],near.passes.objects.indexOf('signal'));
      assert.equal(p.materialId[at],near.passes.materials.indexOf(material));
      const hit=ink.pickSurface(p,at%w,Math.floor(at/w));
      assert.deepEqual([hit.object,hit.part,hit.material],['signal',part,material]);
    }
    assert(mid.passes.partId.some((id,q)=>id===index&&mid.passes.surfaceKind[q]===kind));
    assert(mid.passes.partId.some((id,q)=>id===index&&mid.passes.surfaceKind[q]===4));
  }
  assert(near.passes.strandId.some(Boolean));
  assert(!far.passes.strandId.some(Boolean));
  assert.deepEqual(near.passes.parts,far.passes.parts);
  assert.deepEqual(near.passes.materials,far.passes.materials);
});

test('parts choose independent ranges, with a complementary mesh mask and atomic settings',()=>{
  const {world,rows,api}=fixture(kit);
  let plan=api.resolve(world,{eye:[0,0,7],back:[0,0,1],focal:120});
  assert(new Set(plan.states.map(s=>s.geometry)).size===3);
  const shell=plan.rows.find(row=>row.part==='shell');
  const code=plan.mask.meshCodes.get('signal-shell-draw');
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.equal(api.geometry(code,x,y),!api.sprite(shell,x,y));
  const before=world.spriteReconstruction;
  assert.throws(()=>api.bindParts(world,[{...rows[0],material:'changed'}]),/matching object, part and material/);
  assert.throws(()=>api.bindParts(world,[{...rows[1],representation:'splats'}]),/disagrees/);
  assert.throws(()=>api.bindParts(world,[rows[2],rows[2]]),/unique/);
  assert.throws(()=>api.bindParts(world,[{...rows[1],part:'unknown'}]),/cannot find native splats/);
  assert.throws(()=>api.bind(world,[{object:'signal',...rows[1].sprite}]),/bind its parts separately/);
  assert.equal(world.spriteReconstruction,before);
  api.bindParts(world,[rows[0],{...rows[1],sprite:undefined},rows[2]]);
  plan=api.resolve(world,{eye:[0,0,13],back:[0,0,1],focal:120});
  assert.equal(plan.states.find(row=>row.part==='coil').geometry,1);
  assert.equal(plan.rows.length,2);
});

test('WebGL masks mesh parts on the same native grid and picks the same object and material in both views',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const {world}=fixture(kit), mid=ink.render(world,view).passes, index=named(mid,'shell');
    const pixel=kind=>{
      const p=mid.partId.findIndex((id,i)=>id===index&&mid.surfaceKind[i]===kind&&i%w>40&&i%w<66&&i/w>38&&i/w<50);
      assert(p>=0);
      return [p%w,Math.floor(p/w)];
    };
    const samples={native:pixel(1),sprite:pixel(4)};
    const result=require('../cli/look-webgl.js')({},fixture,(kit,make,backend,{w,h,samples})=>{
      const {world}=make(kit);
      const view=backend(w,h,{raw:true,dither:0});
      const ray={origin:[-1.12,0,7],direction:[0,0,-1]};
      try {
        view.draw(world,{spriteReconstruction:'geometry'});
        const native=view.pick(world,ray,{spriteReconstruction:'geometry'}).solid;
        view.draw(world,{spriteReconstruction:'sprite'});
        const distant=view.pick(world,ray,{spriteReconstruction:'sprite'}).solid;
        view.draw(world);
        const transition=view.sample(samples);
        return {native,distant,transition};
      } finally { view.close(); }
    },{w,h,samples});
    assert.deepEqual(result.transition.native,[106,207,202]);
    assert.deepEqual(result.transition.sprite,[155,100,216]);
    assert.equal(result.native.kind,'mesh');
    assert.equal(result.distant.kind,'sprite');
    for(const hit of [result.native,result.distant])
      assert.deepEqual([hit.target.object,hit.target.part,hit.target.material],['signal','shell','enamel']);
  });

test('edited splat parts stay live while unedited parts use their distant cards', () => {
  const { world, rows, api } = fixture(kit);
  const row = Array.from({ length: world.count }, (_, i) => i)
    .find(i => require('../src/target-selectors.js').index(world).row(i).part === 'hood');
  const id = kit.KIT.procedural.splatProvenance.identities(world).idAt(row);
  const splatFit = { format: 'ink-studio/splat-fit', version: 2, target: { object: 'signal', part: 'hood' },
    edits: [], attributes: [[id, { pigment: 0xb04050 }]] };
  let plan;
  const frame = ink.render(world, { ...view, dist: 13, splatFit, spriteReconstructionFrame: value => { plan = value; } });
  assert.equal(plan.states.find(state => state.part === 'hood').reason, 'source-edited');
  assert.equal(plan.states.find(state => state.part === 'shell').sprite, 1);
  const hood = named(frame.passes, 'hood');
  assert(frame.passes.partId.some((part, i) => part === hood && frame.passes.surfaceKind[i] === 3));
  assert(!frame.passes.partId.some((part, i) => part === hood && frame.passes.surfaceKind[i] === 4));

  const baked = ink.bakeSplatFit(world, splatFit);
  ink.render(baked, { ...view, dist: 13, spriteReconstructionFrame: value => { plan = value; } });
  assert.equal(plan.states.find(state => state.part === 'hood').reason, 'source-edited');

  const { spriteAtlas } = require('../cli/sprite-atlas.js');
  const atlas = spriteAtlas(world, { width: 24, height: 24, directions: 1, pivot: [1.12, 0, 0],
    view: { raw: true, splatFit, pixelSelection: { object: 'signal', part: 'hood', isolated: true } } });
  assert.match(atlas.metadata.splatFitRevision, /^[a-f0-9]{64}$/);
  rows[2].sprite.asset = api.asset({ atlas: require('../src/atlas-sprites.js').compile(atlas), range: [4, 8] });
  api.bindParts(world, rows);
  const fresh = ink.render(world, { ...view, dist: 13, splatFit, spriteReconstructionFrame: value => { plan = value; } });
  assert.equal(plan.states.find(state => state.part === 'hood').sprite, 1);
  assert(fresh.passes.partId.some((part, i) => part === hood && fresh.passes.surfaceKind[i] === 4));
});
