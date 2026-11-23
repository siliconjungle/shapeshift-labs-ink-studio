// A sliding foreground shutter crosses a lit pressure deck.
module.exports=function pressureDeck({KIT:K,makeBuilder}) {
  const palette=[
    0x111c2c,0x192a3c,0x243b4a,0x30515e,0x406a73,0x54848a,0x72a6a4,0x9ac5b7,0xc7ded0,
    0x563b45,0x79514e,0xa36952,0xc4825e,0xe6a670,0xf9ca91,0xffe6b2,
    0x544859,0x7c6881,0xa785a0,0xd4afbd,0xeec9c4,0xfff6dd
  ];
  const B=makeBuilder(41,palette);
  function mesh(id, rectangles) {
    const positions=[],uvs=[],indices=[],faceMaterials=[],materials=[];
    const byColor=new Map();
    for(const [l,b,r,t,z,color] of rectangles){
      if(!byColor.has(color)){
        byColor.set(color,materials.length);
        materials.push({id:'paint-'+color.toString(16),color});
      }
      const i=positions.length/3;
      positions.push(l,b,z,r,b,z,l,t,z,r,t,z);
      uvs.push(0,0,1,0,0,1,1,1);
      indices.push(i,i+1,i+2,i+2,i+1,i+3);
      faceMaterials.push(byColor.get(color),byColor.get(color));
    }
    return {asset:K.sceneMeshes.create({id,positions,uvs,indices,faceMaterials,materials}),positions};
  }
  const rows=[
    [-3.9,-1.78,3.9,1.78,-.38,0x243b4a],
    [-3.81,-1.68,3.81,1.68,-.34,0x30515e],
    [-3.78,-1.55,3.78,1.49,-.32,0x406a73],
    [-3.75,-1.36,3.75,1.27,-.29,0x30515e],
    [-3.75,-1.34,3.75,-1.29,-.27,0x54848a],
    [-3.75,1.22,3.75,1.27,-.27,0x54848a]
  ];
  for(const x of [-2.63,-1.26,.10,1.46,2.82]){
    rows.push([x-.46,-.86,x+.48,.93,-.22,0x243b4a],
      [x-.42,-.81,x+.43,.88,-.21,0x406a73],
      [x-.35,-.73,x+.36,.54,-.18,0x30515e]);
    for(let j=0;j<5;j++)rows.push([x-.27,-.63+j*.20,x+.26,-.59+j*.20,-.17,0x54848a]);
    rows.push([x-.28,.63,x+.28,.76,-.16,0x243b4a],[x-.16,.66,x+.14,.73,-.15,0x9ac5b7]);
  }
  for(let i=0;i<7;i++){
    const x=-3.56+i*1.17;
    rows.push([x-.10,-1.20,x+.10,-1.04,-.17,0x563b45],[x-.05,-1.16,x+.047,-1.09,-.16,0xe6a670]);
  }
  const wall=mesh('pressure deck',rows);
  const gateParts=[
    [-.76,-1.36,.76,1.43,.18,0x563b45],[-.70,-1.25,.70,1.30,.24,0x79514e],
    [-.64,-1.16,.64,1.20,.26,0xa36952],[-.54,-.84,.54,.78,.30,0xc4825e],
    [-.37,-.38,.37,.43,.32,0x563b45],[-.30,-.29,.30,.36,.34,0x243b4a],
    [-.20,-.21,.20,.27,.35,0x406a73],[-.15,-.16,.15,.22,.36,0x54848a],
    [-.29,-.71,.31,-.58,.33,0x79514e],[-.47,1.02,.47,1.12,.31,0x563b45]
  ];
  for(let i=0;i<5;i++)gateParts.push([-.43+i*.18,1.035,-.33+i*.18,1.106,.32,0xf9ca91]);
  for(const [x,y] of [[-.60,-1.04],[.60,-1.04],[-.60,1.04],[.60,1.04]])
    gateParts.push([x-.022,y-.030,x+.023,y+.032,.29,0xf9ca91]);
  const gate=mesh('moving shutter',gateParts);
  const cam={target:[0,0,0],dist:7,yaw:0,pitch:0,ortho:true,fov:2*Math.atan(.255)};
  const world=B.finish({id:'pressure-deck',meshes:[wall.asset,gate.asset],cam,dither:0,radius:7,
    fog:{c:0,start:1,max:0},look:{surfaceHistory:{weight:.75,depthPixels:.75,maxGap:.24},coverageFilter:true}});
  function sample(i,count){
    const u=i/count,t=.10*i;
    const cut=i===0 || i===Math.floor(count*.70);
    const shift=i<Math.floor(count*.70)?-.12-1.95*Math.cos(u*2*Math.PI*0.85):1.25-.115*(i-Math.floor(count*.70));
    const z=i<Math.floor(count*.36)?0:i<Math.floor(count*.70)?.22:-.05;
    K.sceneMeshes.pose(gate.asset,gate.positions.map((value,k)=>value+(k%3===0?shift:k%3===2?z:0)));
    const pulse=.23+1.55*Math.pow(.5+.5*Math.sin(i*1.55+.8),1.2);
    return {time:t,resetRenderHistory:cut,camera:{...cam,target:[i<Math.floor(count*.70)?u*.26:-.31,.02*Math.sin(i*.45),0]},
      areaLights:[{id:'overhead',shape:'disk',at:[-.45,.58,1.32],normal:[0,0,-1],size:[.48,.31],
        color:'#ffe0b8',intensity:pulse,radius:24,sampleGrid:2,visible:false,shadows:false},
      {id:'cool fill',shape:'disk',at:[1.7,-.08,1.8],normal:[0,0,-1],size:[.21,.3],
        color:'#91caf2',intensity:.34,radius:22,sampleGrid:1,visible:false,shadows:false}]};
  }
  return {id:world.id,name:'Pressure Deck',seed:41,build:()=>world,world,width:236,height:112,sample};
};
