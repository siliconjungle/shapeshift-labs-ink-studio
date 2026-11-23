// A signal bridge with tension wires, painted markings, a perforated grille, and splat beacons.
module.exports = function signalBridge({ KIT:K, SpriteSurface, makeBuilder }) {
  const palette=[
    0x101c2d,0x172b3f,0x223d51,0x305165,0x436878,0x5d838a,0x82a19d,0xb4c2a5,
    0x4e3c4b,0x795252,0xa96952,0xcb8b60,0xe7aa70,0xf7ce90,0xffe9b3,
    0x6e3b5e,0xa14e6d,0xce686b,0xf48572,0xfdae8a
  ];
  const B=makeBuilder(82,palette), curves=K.curveSplats, decals=SpriteSurface.make(96);
  const positions=[], uvs=[], indices=[], faceMaterials=[];
  const materials=['frame','plate','bracket','copper','lettering','grille'].map((id,i)=>({
    id,color:palette[[2,1,3,10,14,7][i]]
  }));
  function rect(x0,y0,x1,y1,z,material) {
    const i=positions.length/3;
    positions.push(x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(i,i+1,i+2,i+2,i+1,i+3);
    faceMaterials.push(material,material);
  }
  const panels=[[-3.38,-.12],[.12,3.38]];
  for(const [lo,hi] of panels) {
    rect(lo,-1.41,hi,1.41,-.65,0);
    rect(lo+.053,-1.35,hi-.053,1.35,-.63,1);
    rect(lo+.095,-1.29,hi-.095,-1.20,-.62,2);
    rect(lo+.095,1.19,hi-.095,1.29,-.62,2);
    for(let x=lo+.17;x<hi-.04;x+=.32) {
      rect(x,-1.278,x+.03,-1.224,-.60,0);
      rect(x,1.222,x+.03,1.277,-.60,0);
    }
  }
  const rails=[-3.05,-.42];
  for(const x of rails) {
    rect(x-.067,-.98,x+.067,.96,-.01,2);
    rect(x-.020,-.96,x+.018,.92,.004,0);
    rect(x-.17,-.99,x+.17,-.92,.011,3);
    rect(x-.11,.89,x+.11,.97,.011,3);
  }
  rect(-3.16,-.29,-.32,-.254,-.15,2);
  rect(-3.14,-.26,-.34,-.235,-.14,0);
  function cable(id,knots,width,color) {
    curves.draw(B,{kind:'path',id,points:knots},{edge:'hard',width,color,object:'signal-bridge',material:'wire'});
  }
  for(let i=0;i<5;i++){
    const points=Array.from({length:15},(_,j)=>{
      const u=j/14;
      return [-3.04+2.63*u,.73-i*.218-.42*Math.sin(Math.PI*u)+.084*Math.sin(u*6+i*.31),.14-i*.006];
    });
    cable('catenary-'+i,points,[.028,.022,.024,.019,.026][i],i%2?'#c5aa7d':'#f1d89e');
  }
  for(let i=0;i<7;i++){
    const x=-2.93+i*.39;
    cable('stay-'+i,[[x,.83-i*.057,.04],[x-.10,-.79+i*.062,.04]],.019,'#7ba4a3');
    rect(x-.043,-.92,x+.042,-.84,.032,2);
    rect(x-.029,-.909,x+.027,-.897,.04,4);
  }
  const digits={
    '0':['111','101','101','101','111'],
    '1':['010','110','010','010','111'],
    '2':['111','001','111','100','111'],
    '3':['111','001','111','001','111'],
    '7':['111','001','010','010','010']
  };
  function label(text,x,y,s) {
    decals.face([x,y,.20],[text.length*4*s,0,0],[0,5*s,0],text.length*4,5,(i,j)=>{
      const row=digits[text[Math.floor(i/4)]][j];
      return row[i%4]==='1'?0xf7ce90:null;
    },{id:'serial-'+text,materialId:'printed-decals'});
  }
  label('0237',.53,-.95,.029);
  label('10',2.67,-.95,.029);
  decals.face([.52,-.77,.19],[2.80,0,0],[0,.17,0],55,3,(x,y)=>y===1 && x>=1 && x<54 && x%3!==0 ?
    x%6===1?0xf7ce90:0x5d838a:null,{id:'ruler',materialId:'printed-decals'});
  rect(.46,-.53,3.11,.89,-.26,2);
  rect(.51,-.49,3.06,.84,-.24,0);
  const tx=70,ty=30,pixels=new Uint8Array(tx*ty*4);
  for(let y=0;y<ty;y++)for(let x=0;x<tx;x++){
    const border=x===0||x===tx-1||y===0||y===ty-1, strut=(x+2*y)%7===0 || (x+2*y)%7===1;
    const motif=border||strut||y%10===1;
    const rgba=border?[133,157,150,255]:[(x%9===4?155:105),155,153,motif?255:0];
    pixels.set(rgba,(y*tx+x)*4);
  }
  const grille=K.sceneMeshes.create({id:'signal-grille',
    positions:[.58,-.42,.04,2.98,-.42,.04,.58,.74,.04,2.98,.74,.04],
    uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3],materials:[
      {id:'cutout-grille',texture:{width:tx,height:ty,pixels}}
    ]});
  for(const [i,x] of [1.02,1.80,2.58].entries()){
    const start=B.count(), y=.18;
    for(let j=0;j<16;j++){
      const a=j*2.19,r=.27*Math.sqrt(j/16);
      B.disc(x+Math.sin(a)*r,y+Math.cos(a)*r,-.05+j*.001,[0,0,1],.08,.009,
        B.P[15+(j+i)%5],.70+(j%3)*.09);
    }
    B.describeSplats(start,B.count(),{object:'lamp-'+i,material:'beacon-splats'});
    rect(x-.10,.93,x+.10,1.01,-.03,3);
    rect(x-.059,.952,x+.059,.987,-.012,4);
  }
  const frame=K.sceneMeshes.create({id:'signal-bench',positions,uvs,indices,faceMaterials,materials});
  const tuned={sharpness:.12,materials:{wire:0,'printed-decals':1,'cutout-grille':.22,'beacon-splats':0}};
  const world=B.finish({id:'tidal-signal-bridge',meshes:[frame,grille],spriteSurfaces:decals.finish(),dither:0,radius:6,
    cam:{target:[0,0,0],dist:6,yaw:0,pitch:0,ortho:true,fov:2*Math.atan(.265)},
    fog:{c:0,start:1,max:0},look:{coverageFilter:tuned}});
  function camera(phase) {
    const a=phase*Math.PI*2;
    return {...world.cam,target:[.051*Math.sin(a),.029*Math.sin(a+.55),0],yaw:.025*Math.sin(a+.3)};
  }
  return {id:world.id,name:'Tidal Signal Bridge',world,seed:82,build:()=>world,camera,width:240,height:112};
};
