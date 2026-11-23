// Four authored curves isolate straight spans, curvature, roll and axial depth.
module.exports = function subdivisionFixture({ KIT, makeBuilder }, distance = 6.6) {
  const palette = [0x14222f,0x23374a,0x456273,0x9ee6cb,0xf8c788,0xe897a9,0x98a7f6];
  const B = makeBuilder(11,palette), { curveSplats:curves } = KIT;
  const path = (id, sample, style) => curves.draw(B,
    { kind:'path', id, points:Array.from({ length:129 }, (_,i)=>sample(i/128)) },
    { object:id, edge:'hard', ...style });
  const x = u => -2.2 + 4.4*u;
  path('straight', u=>[x(u),.96,0], { width:.112,color:'#9ee6cb' });
  path('bend', u=>[x(u),.29 + .25*Math.sin(u*2.7*Math.PI) * Math.sin(Math.PI*u),0],
    { width:.128,color:'#f8c788',caps:{ start:'rounded',end:{ type:'tapered',length:.16 } } });
  path('twist', u=>[x(u),-.36,0],
    { width:.28,color:'#e897a9',edge:'beta',opacity:.84,section:'flattened',aspect:.22,
      up:[0,1,0],twist:[[0,0],[.24,0],[.43,1.34],[.61,1.34],[.80,-.48],[1,-.48]] });
  path('depth', u=>[x(u),-.98,.37*Math.sin(u*3.2*Math.PI)*Math.sin(Math.PI*u)],
    { width:.118,color:'#98a7f6' });

  const positions = [],uvs = [],indices = [],faceMaterials = [];
  const panel = (left,bottom,right,top,z,material) => {
    const i = positions.length/3;
    positions.push(left,bottom,z,right,bottom,z,left,top,z,right,top,z);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(i,i+1,i+2,i+2,i+1,i+3);
    faceMaterials.push(material,material);
  };
  panel(-2.48,-1.25,2.48,1.25,-.55,1);
  panel(-2.45,-1.22,2.45,1.22,-.54,0);
  for (const y of [.66,-.04,-.68]) panel(-2.44,y,2.44,y+.012,-.53,2);
  for (const edge of [-1,1]) {
    const x = 2.36*edge;
    for (const y of [-1.12,1.12]) panel(x-.027,y-.028,x+.027,y+.028,-.51,2);
  }
  const mesh = KIT.sceneMeshes.create({ id:'survey-backboard',positions,uvs,indices,faceMaterials,
    materials:palette.map((color,i)=>({ id:'survey-'+i,color })) });
  const world = B.finish({ meshes:[mesh],radius:6,cam:{ target:[0,0,0],dist:distance,pitch:.02,fov:.62 },
    fog:{ start:1,max:0 }, dither:0, look:{ curveSubdivision:true } });
  return { world,width:188,height:116 };
};
