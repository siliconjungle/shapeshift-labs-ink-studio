const assert = require('node:assert/strict');
const { test } = require('node:test');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ KIT:K, makeBuilder }) {
  const B = makeBuilder(11,[0x151a21,0x747474,0x929292]);
  const mark = { style:'hatching',projection:'plane',tone:'luminance',scale:.27,
    ink:'#263244',paper:'#f7e3ad',density:.85,strength:1 };
  const base = { positions:[-2.65,-.71,0,-1.10,-.71,0,-2.65,.71,0,-1.10,.71,0],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3] };
  const mesh = K.sceneMeshes.create({ id:'plate',...base,materials:[{ id:'copper',color:0x828282,engraving:mark }] });
  const curve = K.curveSplats.bind(B,{ points:[[-.65,0,.05],[.65,0,.05]] },
    (rest,{ shift })=>rest.points.map(([x,y,z])=>[x+shift,y,z]),
    { width:.53,edge:'hard',color:'#828282',object:'cord',material:'thread',engraving:mark });
  const first = B.count();
  for (let y=-5; y<=5; y++) for (let x=-5; x<=5; x++) {
    B.disc(1.875+x*.13,y*.13,0,[0,0,1],.152,.007,[130,130,130],1);
  }
  B.describeSplats(first,B.count(),{object:'cloth',material:'canvas'});
  B.describeEngraving(first,B.count(),mark);
  const w=128,h=64,dist=5,fov=2*Math.atan(.32),unit=2*dist*Math.tan(fov/2)/h;
  const world = B.finish({ meshes:[mesh],dither:1,radius:6,cam:{ target:[0,0,0],dist,fov,yaw:0,pitch:0,ortho:true },
    fog:{ c:0,start:1,max:0 },look:{ stable:{ dither:'object',spacing:.093,origin:[.011,.017,.029],
      targets:[{object:'plate',spacing:.103},{material:'thread',spacing:.087}] } } });
  const ids=Array.from({length:world.count-first},(_,i)=>first+i), matrix=new Float32Array(12);
  let shift=0;
  K.bones.bind(world,{ids,bid:new Float32Array(ids.length),M:matrix,pose() {
    matrix.set([1,0,0,0,1,0,0,0,1,shift,0,0]);
  }});
  return { world,w,h,unit,pose(pixels) {
    shift=pixels*unit;
    K.sceneMeshes.pose(mesh,base.positions.map((n,i)=>i%3===0?n+shift:n));
    world.anim.update(1/60,0);
    curve.pose(world,{ shift });
  } };
}

test('interactive rest coordinates follow each native geometry representation and engraving reaches all three',
  {skip:!process.env.INK_TEST_CHROME},()=>{
  const result=runWebGL({},fixture,(kit,build,backend)=>{
    const {world,w,h,unit,pose}=build(kit);
    const renderer=backend(w,h,{ offscreen:true });
    const draw=frame=>{
      renderer.draw(world,{changedRows:undefined,...frame});
      return atob(renderer.image());
    };
    try {
      pose(0);
      const original=draw({engraving:false});
      const screenOriginal=draw({engraving:false,stable:false});
      const raw=draw({raw:true,engraving:false}), etched=draw({raw:true});
      const policy={targets:[{material:'canvas',palette:['#747474','#929292'],dither:{
        space:'object',spacing:.118,scale:1.1,fade:[.55,1.9],strength:.93,pattern:'bayer'}}]};
      const constrained=draw({engraving:false,stable:false,paletteConstraints:policy});
      pose(1);
      const translated=draw({engraving:false});
      const screenTranslated=draw({engraving:false,stable:false});
      const etchTranslated=draw({raw:true});
      const moves=[[-1.875,'mesh'],[0,'curve'],[1.875,'splat']];
      const count=(left,right,x0,x1,y0,y1,dx=0)=>{
        let changes=0;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
          const at=(y*w+x)*3,next=at+dx*3;
          if(left.slice(at,at+3)!==right.slice(next,next+3))changes++;
        }
        return changes;
      };
      return { driver:renderer.driver,policy:count(constrained,screenOriginal,95,109,28,36),
        surfaces:moves.map(([center,name])=>{
          const x=Math.round(w/2+center/unit),box=[x-7,x+7,29,35];
          return {name,rest:count(original,translated,...box,1),
            screen:count(screenOriginal,screenTranslated,...box,1),etch:count(raw,etched,...box),
            attached:count(etched,etchTranslated,...box,1)};
        })};
    } finally { renderer.close(); }
  });
  for(const row of result.surfaces){
    assert(row.screen>18,JSON.stringify(row));
    assert(row.rest<=4,JSON.stringify(row));
    assert(row.etch>=32,JSON.stringify(row));
    assert(row.attached<=18,JSON.stringify(row));
  }
  assert(result.policy>8,JSON.stringify(result));
});
