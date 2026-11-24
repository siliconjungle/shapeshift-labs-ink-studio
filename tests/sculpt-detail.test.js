const assert=require('node:assert/strict');
const {test}=require('node:test');
const ink=require('..');
const {KIT:{procedural:P}}=ink.load();
const cell=.05, chart={origin:[0,0,0],normal:[0,0,1],tangent:[1,0,0],size:[35,15]};
const field=(base,pitch=cell)=>P.sparseBricks.create({cell:pitch,brickSize:6,base});
const slab=(z,bottom,top)=>Math.max(bottom-z,z-top);
const source=field((x,y,z)=>slab(z,-.55,0),.2);
const engraved=field((x,y,z)=>slab(z,-.55,-.075));

test('signed relief survives a coarse revision while folds, thin walls and lost surfaces stay clear',()=>{
  const layer=P.sculptDetail.capture(source,engraved,{chart,depth:.25,maxRelief:.15,object:'plate'});
  assert(layer.rows.every(row=>Math.abs(row.offset+.075)<.00005));
  const coarse=field((x,y,z)=>{
    if (x<-.55) return 1;
    if (x<-.2) return Math.min(slab(z,-.55,.10),slab(z,.24,.34));
    if (x<.35) return slab(z,.015,.13);
    return slab(z,-.45,.20);
  });
  const {snapshot,report}=P.sculptDetail.project(JSON.parse(JSON.stringify(layer)),coarse,{reach:.40,minWall:.12});
  const at=x=>report.rows.find(row=>row.x===x && row.y===7);
  assert.equal(at(2).status,'lost-correspondence');
  assert.equal(at(9).status,'fold');
  assert.equal(at(9).crossings,2);
  assert.equal(at(17).status,'thin-wall');
  assert(at(17).thickness<at(17).requiredWall);
  assert.equal(at(29).status,'applied');
  assert.equal(report.object,'plate');
  assert.equal(report.counts.applied+report.counts.edge+report.counts.fold+report.counts['thin-wall']+
    report.counts['lost-correspondence'],35*15);
  assert(report.changedSamples>0);
  assert(coarse.distance(.6,0,.16)<0 && snapshot.distance(.6,0,.16)>0);
  for(const p of [[-.75,0,.15],[-.4,0,.15],[0,0,.12],[.6,.5,.16],[.6,0,-.44]])
    assert.equal(snapshot.distance(...p),coarse.distance(...p));
  assert.equal(snapshot.attributes(.6,0,.16).material,coarse.attributes(.6,0,.16).material);
  assert.throws(()=>P.sculptDetail.project(layer,source),/at least as fine/);
});

test('a registered target frame transfers signed relief to a rotated surface',()=>{
  const layer=P.sculptDetail.capture(source,engraved,{chart});
  const coarse=field(x=>slab(x,-.48,.15));
  const targetFrame={origin:[0,0,0],normal:[1,0,0],tangent:[0,1,0]};
  const projected=P.sculptDetail.project(layer,coarse,{targetFrame,reach:.3});
  assert(projected.report.counts.applied>0);
  assert(coarse.distance(.12,0,0)<0 && projected.snapshot.distance(.12,0,0)>0);
  assert.equal(projected.snapshot.distance(-.47,0,0),coarse.distance(-.47,0,0));
  const empty=field(()=>1);
  const unavailable=P.sculptDetail.project(layer,empty);
  assert.equal(unavailable.snapshot,empty);
  assert.equal(unavailable.report.changedSamples,0);
  assert.equal(unavailable.report.counts['lost-correspondence'],35*15);
});

test('brick detail preview is revision-checked and remeshes only affected bricks',()=>{
  const base=P.sculptMasks.field({kind:'box',min:[-1.65,-.82,-.40],max:[1.65,.82,.12]});
  const bricks=field(base,.06);
  const panel=P.brickMeshes.create({bricks,objectId:'plate',
    bounds:{min:[-1.84,-1,-.55],max:[1.84,1,.47]},materials:[{id:'stone',color:0x887764}]});
  const axes=[[1,0,0],[0,1,0],[0,0,1]];
  const fine=panel.sculpt({mode:'crease',depth:.08,stamps:[{origin:[0,0,.12],axes,radius:.42}]});
  const layer=panel.captureDetail(bricks,{chart:{...chart,origin:[0,0,.12],size:[19,15]}});
  const target=bricks.edit({bounds:{min:[-.62,-.55,-.09],max:[.62,.55,.39]},operation:'union',smooth:.15,
    sdf:P.sculptMasks.field({kind:'sphere',center:[0,0,-.22],radius:.46})});
  const preview=panel.previewDetail(layer,target,{reach:.36});
  assert.equal(panel.current(),fine);
  assert(preview.report.changedSamples>0);
  panel.update(target);
  assert.throws(()=>panel.commitDetail(preview),{code:'stale-detail-preview'});
  const coarse=panel.current();
  const next=panel.previewDetail(layer,target,{reach:.36});
  const after=panel.commitDetail(next);
  assert(after.work.rebuilt.length>0 && after.work.rebuilt.length<after.chunks.length);
  assert(after.chunks.every((chunk,i)=>after.work.rebuilt.includes(chunk.key) || chunk===coarse.chunks[i]));
  assert(after.bricks.distance(0,0,.22)>target.distance(0,0,.22));
  assert.throws(()=>panel.commitDetail(next),{code:'stale-detail-preview'});
  const rawMasks={masks:[{id:'center',volumes:[{kind:'box',min:[-.35,-.31,-.4],max:[.35,.31,.40]}]}],
    faceSets:[{id:'center',mask:'center'}],controls:{locked:['center']}};
  panel.update(target);
  panel.setSculptMasks(rawMasks);
  const masked=panel.previewDetail(layer,target);
  assert(masked.report.counts.masked>0);
  assert.equal(panel.commitDetail(masked).bricks,target);
});

test('embossed relief raises the new front and capture rejects an ambiguous source',()=>{
  const raised=field((x,y,z)=>slab(z,-.55,.065));
  const layer=P.sculptDetail.capture(source,raised,{chart});
  const coarse=field((x,y,z)=>slab(z,-.4,.12));
  const {snapshot,report}=P.sculptDetail.project(layer,coarse,{reach:.3});
  assert(report.changedSamples>0);
  assert(coarse.distance(0,0,.16)>0 && snapshot.distance(0,0,.16)<0);
  const folded=field((x,y,z)=>Math.min(slab(z,-.55,0),slab(z,.13,.21)));
  const ambiguous=P.sculptDetail.capture(folded,raised,{chart,depth:.30});
  const blocked=P.sculptDetail.project(ambiguous,coarse);
  assert.equal(blocked.snapshot,coarse);
  assert.equal(blocked.report.counts.fold,35*15);
  assert(blocked.report.rows.every(row=>row.phase==='capture'));
});
