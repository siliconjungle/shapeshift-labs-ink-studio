// Three specimens with separately grouped ropes and an intentionally wide safety pair.
module.exports = function strandFixture({ KIT:K, makeBuilder }, atlases) {
  const palette = [0x141e2a,0x1f3040,0x283d4c,0x385064,0x577385,0x90a9ac];
  const B = makeBuilder(45,palette);
  const assets = ['coil','rigging','fringe'], rails = [];
  const colors = [
    ['#bc684e','#eb9665','#f9ca8b','#f7deaa'],
    ['#458496','#6aa4b4','#98ced1','#bce4d2'],
    ['#8b5285','#b873a0','#db91a6','#f1c7b2']
  ];
  const style = { width:.021,edge:'hard',profileSamples:16,lod:{ aggregate:{ samples:18,
    coverage:{width:[.47,.85],spacing:[.71,.99]} } } };
  function threads(object,id,count,at,appearance) {
    const rows = Array.from({length:count},(_,i)=>({
      id:id+'-'+i,
      path:{points:Array.from({length:33},(_,j)=>at(j/32,i-(count-1)*.5))}
    }));
    const material = colors[assets.indexOf(object)];
    K.curveSplats.draw(B,{kind:'textile',plan:{threads:rows}},{
      ...style,color:({index})=>material[index%material.length],object,material:object,target:{part:'strands'},...appearance
    });
  }
  function rect(x0,y0,x1,y1,z,color) {
    rails.push({positions:[x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z],color});
  }

  const cx = -2.6;
  for (let coil=0; coil<5; coil++) threads('coil','coil-'+coil,4,(u,i)=>{
    const a = (u-.50)*(1.73-coil*.015)*Math.PI;
    return [cx+(.43+coil*.093+i*.010)*Math.sin(a),1.96+(.63+coil*.099+i*.010)*Math.cos(a),.10-coil*.022+i*.002];
  });
  threads('coil','lead',4,(u,i)=>[cx-.66+.41*u+i*.010,1.68-1.39*u+.13*Math.sin(5*u),.20]);

  for (let j=0; j<6; j++) threads('rigging','guy-'+j,4,(u,i)=>[
    (j-2.5)*.095+(j-2.5)*.178*u+i*.010,
    2.98-2.36*u-.062*Math.sin(Math.PI*u),.10+(2.5-j)*u*.09+i*.002
  ]);
  threads('rigging','safety-pair',2,(u,i)=>[
    -.92+1.85*u,.95+.66*u+.17*Math.sin(Math.PI*u)+i*.215,.24+i*.004
  ],{width:.037,color:'#e8be86'});

  const fx = 2.53;
  for (let j=0; j<11; j++) threads('fringe','tassel-'+j,4,(u,i)=>{
    const offset=(j-5)*.149, drop=1.65+.42*Math.cos((j-5)*.37)+(j%2)*.12;
    return [fx+offset*(1+.21*u)+u*.14*Math.sin(4*u+j*.91)+i*.010,
      2.69-drop*u,.10+.08*Math.sin(6*u+j)*u+i*.002];
  },{taper:[[0,1],[.82,1],[1,.75]]});

  for (const x of [cx,0,fx]) {
    rect(x-1.18,.04,x+1.18,3.36,-.51,1);
    rect(x-1.12,.105,x+1.12,3.30,-.50,2);
    rect(x-1.11,.105,x-1.07,3.26,-.49,3);
    rect(x-1.11,.107,x+1.07,.171,-.48,3);
    for (let tick=0;tick<6;tick++)
      rect(x-.93+tick*.34,.224,x-.88+tick*.34,.251,-.47,4);
  }
  rect(cx-.87,2.49,cx-.55,2.55,.23,4);
  rect(cx+.44,2.25,cx+.90,2.30,.23,4);
  rect(-.45,2.95,.45,3.02,.18,4);
  rect(-.99,.535,.99,.625,.24,4);
  rect(-.99,.565,.99,.587,.242,5);
  rect(fx-.92,2.63,fx+.92,2.77,.18,4);
  rect(fx-.92,2.725,fx+.92,2.756,.182,5);
  const positions=[],uvs=[],indices=[],faceMaterials=[];
  for (const rail of rails) {
    const i=positions.length/3;
    positions.push(...rail.positions);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(i,i+1,i+2,i+2,i+1,i+3);
    faceMaterials.push(rail.color,rail.color);
  }
  const stand=K.sceneMeshes.create({id:'strand-sample-rack',positions,uvs,indices,faceMaterials,
    materials:palette.map((color,i)=>({id:'rack-'+i,color})) });
  const world=B.finish({id:'strand-sample-rack',meshes:[stand],radius:6,dither:0,
    cam:{target:[0,1.73,0],dist:7.7,yaw:0,pitch:0,fov:.56},fog:{c:0,start:1,max:0} });
  if (atlases) {
    const sprites=K.sprite.reconstruction;
    sprites.bindParts(world,assets.map(object=>({
      object,part:'strands',material:object,representation:'curves',
      sprite:{asset:sprites.asset({atlas:atlases[object],projectedRange:[.275,.40]}),
        at:atlases[object].metadata.pivot,lighting:false}
    })));
  }
  return {world,assets,width:288,height:144};
};
