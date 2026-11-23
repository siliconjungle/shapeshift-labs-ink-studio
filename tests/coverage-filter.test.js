const assert = require('node:assert/strict');
const { test } = require('node:test');
const ink = require('..');
const CoverageFilter = require('../src/coverage-filter.js');

function scene({ KIT:K, SpriteSurface, makeBuilder }) {
  const colors = [0x101010,0x4c4c4c,0x888888,0xc4c4c4,0xffffff];
  const B=makeBuilder(3,colors);
  const mesh=K.sceneMeshes.create({id:'foil',positions:[-.68,.38,0,.68,.38,0,-.68,.42,0,.68,.42,0],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[{id:'foil',color:0xffffff}]});
  K.curveSplats.draw(B,{kind:'path',points:[[-.68,0,.1],[.68,0,.1]]},
    {edge:'hard',width:.04,color:'#ffffff',object:'wire',material:'wire'});
  const decals=SpriteSurface.make(8);
  decals.face([-.68,-.42,.1],[1.36,0,0],[0,.04,0],8,1,x=>x===3?null:0xffffff,
    {id:'stencil',materialId:'stencil'});
  const start=B.count();
  B.disc(0,-.82,0,[0,0,1],.072,.007,B.P[4],.92);
  B.describeSplats(start,B.count(),{object:'dab',material:'inks'});
  const world=B.finish({meshes:[mesh],spriteSurfaces:decals.finish(),dither:0,radius:5,
    cam:{target:[0,0,0],dist:5,fov:2*Math.atan(.32),yaw:0,pitch:0,ortho:true},
    fog:{ c:0,start:1,max:0 }});
  return {world,colors};
}

test('the CPU filters RGB before palette lookup and honors individual materials',()=>{
  const {world}=scene(ink.load()), view={w:64,h:64,px:1,dither:0,captureQuantization:true};
  const base=ink.render(world,view), filtered=ink.render(world,{...view,coverageFilter:true});
  const firm=ink.render(world,{...view,coverageFilter:{materials:{wire:1,foil:1,stencil:1}}});
  const pixel=(frame,x,y)=>frame.rgb[(y*64+x)*3];
  for(const y of [23,31,39]){
    assert.equal(pixel(base,26,y),16);
    assert(pixel(filtered,26,y)>16,JSON.stringify({y,actual:pixel(filtered,26,y)}));
    assert.equal(pixel(firm,26,y),pixel(base,26,y));
    const rgb=filtered.quantization.graded[(y*64+26)*3];
    assert(rgb>16 && rgb<255,JSON.stringify({y,rgb}));
  }
  assert.equal(pixel(filtered,19,31),pixel(filtered,28,31));
  assert.equal(pixel(filtered,29,39),16,'the cutout interior stays open');
  const passes=['depth','materialId'];
  assert.deepEqual(ink.render(world,{...view,passes,coverageFilter:true}).passes,
    ink.render(world,{...view,passes,coverageFilter:false}).passes);
  assert.deepEqual(ink.render(world,{...view,raw:true,coverageFilter:true}).rgb,ink.render(world,{...view,raw:true}).rgb);
  assert.throws(()=>CoverageFilter.prepare({materials:{wire:1.1}}),/between 0 and 1/);
});

test('transparent filtering averages alpha and premultiplied RGB on the native grid',()=>{
  const rgb=Float32Array.of(1,0,1), alpha=Uint8Array.of(0);
  CoverageFilter.filter(rgb,alpha,{color:Uint8Array.of(240,60,45,0,0,0,0,0,0,0,0,0),
    alpha:Uint8Array.of(0,0,255,0),w:2},1,1);
  assert.equal(alpha[0],64);
  assert.deepEqual(Array.from(rgb,channel=>Math.round(channel*255)),[240,60,45]);
});

test('WebGL covers thin mesh, finite curve, cutout, and splat samples in one palette frame',
  {skip:!process.env.INK_TEST_CHROME},()=>{
    const result=require('../cli/look-webgl')({},scene,(kit,build,backend)=>{
      const {world,colors}=build(kit), renderer=backend(64,64,{offscreen:true,colored:false,dither:0});
      const groups={foil:[22,25],wire:[30,33],stencil:[38,41],inks:[45,51]};
      const snapshots={};
      try {
        for(const [id,coverageFilter] of Object.entries({base:false,smooth:true,mix:{materials:{stencil:1,wire:1,foil:1}},
          onlyWire:{sharpness:1,materials:{wire:0}}})){
          renderer.draw(world,{coverageFilter});
          let bytes;
          try{bytes=atob(renderer.image());}catch(error){throw new Error(id+': '+error.message);}
          snapshots[id]=Object.fromEntries(Object.entries(groups).map(([group,[top,bottom]])=>{
            const values=[];
            for(let y=top;y<=bottom;y++)for(let x=20;x<=44;x++)values.push(bytes.charCodeAt((y*64+x)*3));
            return [group,values];
          }));
        }
        renderer.draw(world,{coverageFilter:{materials:{foil:.4}},stable:{dither:'object',spacing:.11},
          paletteConstraints:{targets:[{material:'wire',palette:['#4c4c4c','#ffffff']}]},dither:.4});
        renderer.image();
      } finally {renderer.close();}
      const differences={};
      for(const [key,base] of Object.entries(snapshots.base)){
        const smooth=snapshots.smooth[key];
        differences[key]={smooth:smooth.filter((n,i)=>n!==base[i]).length, firm:snapshots.mix[key].filter((n,i)=>n!==base[i]).length,
          onlyWire:snapshots.onlyWire[key].filter((n,i)=>n!==base[i]).length, palette:smooth.every(value=>colors.includes(0x010101*value))};
      }
      return {differences};
    });
    for(const [key,row] of Object.entries(result.differences)){
      assert(row.smooth>0,JSON.stringify({key,row}));
      assert.equal(row.firm>0,key==='inks',JSON.stringify({key,row}));
      if(key==='inks')assert(row.onlyWire<=row.smooth,JSON.stringify({key,row}));
      else assert.equal(row.onlyWire>0,key==='wire',JSON.stringify({key,row}));
      assert(row.palette);
    }
  });
