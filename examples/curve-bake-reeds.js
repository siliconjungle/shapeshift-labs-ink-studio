// Paired assets that can render as finite spans, textured ribbons or depth cards.
module.exports = function curveBakeFixture({ KIT:K,makeBuilder }, mode = 'geometry', atlases = {}) {
  const palette = [0x141f2d,0x243849,0x395365,0x619392,0xf2c387,0xbd7856,0xfeebc5,
    0xb0e0c5,0x85bc90,0x5d8f73,0xd4e7ab,0xc47b9b,0x645e91,0x90b6b7];
  const B=makeBuilder(31,palette), surfaces=K.sceneMeshes, sprites=K.sprite.reconstruction;
  const assets=[
    { object:'braid',part:'braided-wire',material:'metal',range:[6.9,9.5] },
    { object:'reeds',part:'stems',material:'reed',range:[6.9,9.5] }
  ];
  const sample=(n,f)=>Array.from({length:n},(_,i)=>f(i/(n-1)));
  const draw=(asset,id,points,style)=>K.curveSplats.draw(B,{id,points},{
    object:asset.object, material:asset.material, target:{part:asset.part},
    edge:'hard',...style
  });
  if(mode!=='ribbon'){
    for(let i=0;i<3;i++) draw(assets[0],'wire-'+i,sample(100,u=>{
      const theta=u*4.55*Math.PI+i*Math.PI*2/3;
      return [-1.35+Math.cos(theta)*.32+.11*Math.sin(u*5.5),.11+u*2.18,.18+Math.sin(theta)*.28];
    }),{ width:.144,color:['#f2c387','#bd7856','#feebc5'][i],caps:'blunt',
      taper:[[0,.68],[.20,1],[.83,1],[1,.65]] });
    for(let i=0;i<14;i++){
      const spread=(i-6.5)/6.5, height=.98+(i*11%17)/17*1.40;
      const color=['#85bc90','#b0e0c5','#5d8f73','#d4e7ab'][i%4];
      draw(assets[1],'reed-'+i,sample(22,u=>[
        1.34+spread*(.12+.79*u*u)+Math.sin(u*3+i)*.065*u,
        .13+height*u,.09+.27*Math.sin(i*1.3)+.24*u*spread
      ]),{ width:.09+(i%3)*.014,color,
        ...(i%4===0 && {edge:'beta',opacity:.7}),
        taper:[[0,1],[.58,.91],[1,.08]],caps:'rounded' });
    }
  }
  const faces=[];
  const rect=(x0,y0,x1,y1,z,material)=>{
    faces.push({ positions:[x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z],material });
  };
  for(const x of [-1.35,1.34]){
    rect(x-.60,-.08,x+.60,.20,-.16,1);
    rect(x-.56,.02,x+.56,.18,.4,2);
    rect(x-.56,.16,x+.56,.20,.41,3);
  }
  // A pale crosspiece threads between the rear and forward strands.
  rect(-2.12,.91,2.12,1.00,.19,12);
  rect(-2.12,.978,2.12,1.00,.198,13);
  for(const x of [-2.06,2.04]){
    rect(x,.92,x+.065,.965,.202,4);
    rect(x-.028,.03,x+.083,.91,-.38,2);
  }
  const positions=[],uvs=[],indices=[],faceMaterials=[];
  for(const row of faces) {
    const i=positions.length/3;
    positions.push(...row.positions); uvs.push(0,0,1,0,0,1,1,1);
    indices.push(i,i+1,i+2,i+2,i+1,i+3); faceMaterials.push(row.material,row.material);
  }
  const stand=surfaces.create({id:'reed-braid-mount',positions,uvs,indices,faceMaterials,
    materials:palette.map((color,i)=>({id:'mount-'+i,color})) });
  const meshes=[stand];
  if(mode==='ribbon')for(const asset of assets) meshes.push(K.curveSplats.bakedRibbon(atlases[asset.object]).mesh);
  const world=B.finish({id:'braid-and-reeds',meshes,cam:{target:[0,1.13,0],dist:7.95,yaw:0,pitch:.06,fov:.57},
    radius:5,dither:0,fog:{c:0,start:1,max:0},look:{curveSubdivision:true} });
  if(mode==='card'||mode==='auto'){
    sprites.bindParts(world,assets.map(({object,part,material,range})=>({
      object,part,material,representation:'curves',
      sprite:{asset:sprites.asset({atlas:atlases[object],range}),at:atlases[object].metadata.pivot,lighting:false}
    })));
  }
  return { world,assets,width:192,height:120 };
};
