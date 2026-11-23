// A miniature salvage sub with a stencilled call sign and a fine aerial.
module.exports=function salvageSignal({KIT:K,makeBuilder},baked) {
  const palette=[
    0x111d30,0x1b3042,0x2b4858,0x436775,0x619094,
    0x29494a,0x356263,0x458485,0x67a9a1,0x86c6ad,
    0x513e51,0x79545b,0xaa685b,0xd88e65,0xf7b978,0xffdda0,
    0x423753,0x594963,0x94677a,0xc58886,0x9bb7a5
  ];
  const B=makeBuilder(29,palette), meshes=K.sceneMeshes, w=112,h=64;
  const rgba=new Uint8Array(w*h*4), hatch=[0x29494a,0x356263,0x458485,0x67a9a1];
  const d=(u,v,x,y)=>Math.hypot(u-x,(v-y)*.64);
  function hullColor(u,v,x,y) {
    const edge=Math.abs(u-.5)*1.86+Math.max(0,Math.abs(v-.5)-.27)*1.2;
    if(edge>.985 || v<.065 || v>.94)return null;
    if(edge>.934 || v<.105 || v>.902)return 0x513e51;
    if(edge>.889 || v<.148 || v>.866)return 0xaa685b;
    const rib=Math.abs(v-.77)<.019 || Math.abs(v-.233)<.020;
    let packed=rib?0x29494a:hatch[Math.min(3,Math.floor(v*4))];
    if((x+y)%9===0 && (u<.15 || u>.89))packed=0x2b4858;
    for(const cx of [.254,.414]){
      const distance=d(u,v,cx,.59);
      if(distance<.081)packed=distance<.056?0x111d30:0xd88e65;
      if(distance<.040)packed=distance<.031?0x2b4858:0x619094;
      if(Math.abs(u-cx+.014)<.0045 && Math.abs(v-.61)<.009)packed=0x86c6ad;
    }
    if(u>.556 && u<.828 && v>.35 && v<.71){
      packed=0x29494a;
      if(v<.384 || v>.675 || u<.569 || u>.816)packed=0x79545b;
      if(Math.abs(v-.50)<.012 && u>.585 && u<.804)packed=0x619094;
      if(v>.466 && v<.574 && u>.645 && u<.651 ||
          v>.465 && v<.477 && u>.648 && u<.67)packed=0xd88e65;
    }
    return packed;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const color=hullColor((x+.5)/w,(y+.5)/h,x,y);
    if(color!==null)rgba.set([color>>16,(color>>8)&255,color&255,255],(y*w+x)*4);
  }
  const bounds=[-1.91,-.85,1.76,.85], [left,bottom,right,top]=bounds;
  const body=meshes.create({id:'salvage-hull',objectId:'salvage-sub',partId:'hull',
    positions:[left,bottom,0,right,bottom,0,left,top,0,right,top,0],uvs:[0,0,1,0,0,1,1,1],
    indices:[0,1,2,2,1,3],materials:[{id:'enamel',texture:{width:w,height:h,pixels:rgba}}]});
  const v=[],uv=[],tri=[],slots=[];
  function quad(x0,y0,x1,y1,z,material) {
    const first=v.length/3;
    v.push(x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z);
    uv.push(0,0,1,0,0,1,1,1);
    tri.push(first,first+1,first+2,first+2,first+1,first+3);
    slots.push(material,material);
  }
  quad(-4.50,-2.27,4.50,2.27,-.63,1);
  quad(-4.45,-2.22,4.45,2.22,-.61,0);
  for(let x=-4.40;x<4.42;x+=.55)quad(x,-2.12,x+.012,2.12,-.60,1);
  for(let y=-2.10;y<2.15;y+=.47)quad(-4.38,y,4.38,y+.012,-.58,1);
  for(const side of [-1,1]){
    const x=side*2.24;
    quad(x-.34,-.79,x+.34,-.60,-.22,2);
    quad(x-.26,-.26,x+.26,.20,-.19,1);
    quad(x-.14,-.18,x+.14,.13,-.18,3);
    quad(x-.085,-.12,x+.085,.08,-.17,2);
    quad(x-.16,-.60,x+.16,-.26,-.22,1);
  }
  quad(-1.12,.74,-.95,.98,-.1,3);
  quad(.98,.74,1.16,.98,-.1,3);
  quad(-1.16,-1.02,1.26,-.88,-.24,2);
  quad(-.96,-.92,-.72,-.75,-.23,1);
  quad(.82,-.92,1.05,-.75,-.23,1);
  const background=meshes.create({id:'test-range',positions:v,uvs:uv,indices:tri,faceMaterials:slots,
    materials:[0x1b3042,0x2b4858,0x436775,0xaa685b].map((color,i)=>({id:'beam-'+i,color}))});
  const wire=[[-1.03,.955,-.03],[-.85,1.30,-.04],[-.51,1.42,-.04],[.73,1.30,-.03],[1.07,.953,-.03]];
  K.curveSplats.draw(B,{kind:'path',points:wire},
    {width:.025,edge:'hard',color:'#aa685b',object:'aerial',material:'braid'});
  const spark=B.count();
  B.disc(1.53,.71,.13,[0,0,1],.027,.006,B.P[12],.65);
  const camera={target:[0,.1,0],dist:6.9,yaw:0,pitch:0,ortho:true,fov:2*Math.atan(.238)};
  const shot={
    budget:60,
    marks:[
      {id:'port-eye',at:{mesh:body.id,uv:[.24,.61],offset:.035},color:'#fff3af',priority:100,bias:.085},
      {id:'starboard-eye',at:{mesh:body.id,uv:[.40,.61],offset:.035},color:'#fff3af',priority:90,bias:.085},
      {id:'call-sign',at:{mesh:body.id,uv:[.654,.52],offset:.035},stamp:['#.','#.','##'],color:'#ffa777',priority:75,size:.038},
      {id:'spark',at:{splat:spark},color:'#ffe8a0',priority:54,active:[.30,1.86]},
      {id:'aerial',path:wire,color:'#f3c182',priority:42,size:.038}
    ]
  };
  const world=B.finish({id:'salvage-signal',meshes:[background,body],cam:camera,radius:7,dither:0,
    fog:{c:0,start:1,max:0},look:{coverageFilter:true,protectedPixels:shot}});
  const carrier=makeBuilder(29,palette).finish({meshes:[body],cam:camera,radius:7,dither:0,fog:{c:0,start:1,max:0}});
  const M=new Float32Array(12);
  K.bones.bind(world,{ids:[spark],bid:[0],M,pose(t){
    M.set([1,0,0,0,1,0,0,0,1,Math.sin(t*8)*.033,Math.sin(t*6)*.12,0]);
  }});
  if(baked) {
    const atlas={metadata:baked.metadata,images:Object.fromEntries(Object.entries(baked.images)
      .map(([id,bytes])=>[id,Uint8Array.from(bytes)]))};
    const S=K.sprite.reconstruction;
    S.bindParts(world,[{object:body.objectId,part:body.partId,material:'enamel',representation:'mesh',mesh:body,
      sprite:{asset:S.asset({atlas,range:[9.2,12.2]}),at:[0,.1,0],lighting:false}}]);
  }
  function view(u) {
    const phase=2*Math.PI*u, retreat=.5-.5*Math.cos(phase);
    return {...camera,dist:6.9+8.4*retreat,target:[.11*Math.sin(phase),.10+.06*Math.sin(phase-.2),0],
      yaw:.072*Math.sin(phase)};
  }
  return {id:world.id,name:'Salvage Signal',seed:29,build:()=>world,world,carrier,view,width:240,height:112};
};
