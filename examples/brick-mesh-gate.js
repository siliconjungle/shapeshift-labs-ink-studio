/* Local excavation of an indexed sluice gate on a shared SDF lattice. */
module.exports=({KIT:K,makeBuilder,makeSculpt})=>{
  const P=K.procedural, id='brick-mesh-gate',seed=93;
  const palette=[0x172338,0x25394e,0x3d5368,0x577681,0x82a2a6,0xb7c9b7,
    0x563c4c,0x83564f,0xb77f62,0xd4a97d,0xf0cfa3,0xffdfad,
    0x2a5a60,0x427a79,0x66a78c,0xafd1a6,0x45495b,0x667688,0x945f4b,0xc98c59];
  function box(px,py,pz,hx,hy,hz){
    return (x,y,z)=>{
      const a=Math.abs(x-px)-hx,b=Math.abs(y-py)-hy,c=Math.abs(z-pz)-hz;
      return Math.hypot(Math.max(a,0),Math.max(b,0),Math.max(c,0))+Math.min(0,Math.max(a,b,c));
    };
  }
  const wall=box(0,1.34,.01,2.53,1.27,.38), crown=box(0,2.63,.02,2.67,.16,.53);
  const towers=[-2.23,2.23].map(x=>box(x,1.46,0,.34,1.42,.62));
  const bases=[-2.23,2.23].map(x=>box(x,.16,0,.46,.17,.75));
  const lintels=[-2.23,2.23].map(x=>box(x,2.89,.01,.43,.145,.69));
  const solid=[wall,crown,...towers,...bases,...lintels];
  const materials=[
    {id:'ochre-masonry',color:0xb77f62},{id:'dark-mortar',color:0x704f52},
    {id:'verdigris-trim',color:0x47827e},{id:'fresh-cut',color:0xe3b789},{id:'basalt-footings',color:0x596c7b}
  ];
  const opening={
    operation:'subtract',material:'fresh-cut',sdf:box(.04,1.08,.02,.57,.94,1.03),
    bounds:{min:[-.78,-.15,-.88],max:[.86,2.23,.9]}
  };
  const breach={
    operation:'subtract',material:'fresh-cut',
    sdf:(x,y,z)=>Math.hypot(x-2.19,(y-2.77)*.9,(z-.32)*.73)-.49,
    bounds:{min:[1.49,1.99,-.60],max:[2.91,3.5,1.04]}
  };

  function build(value){
    const B=makeBuilder(value,palette),S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.54,.83,.54]),amb:.43,sky:.15,sunK:.64});
    const paving={r:[1,2,3,4,5]}, bronze={r:[6,7,8,9,10]}, jade={r:[12,13,14,15]};
    S.box([0,-.25,.08],[3.36,.25,1.57],paving,{rd:.20,res:.147,objectId:'dry-dock'});
    for(let i=-7;i<=7;i++){
      const x=i*.43;
      S.box([x,.026,.96],[.207,.051,.45],paving,{rd:.038,res:.103,objectId:'paving'});
    }
    S.box([0,.04,-1.0],[2.61,.060,.47],jade,{rd:.06,res:.13,objectId:'rear-walkway'});
    S.box([0,.22,-1.23],[.43,.22,.24],bronze,{rd:.10,res:.077,objectId:'rear-marker'});
    S.ball([0,.54,-1.21],[.105,.13,.09],{r:[10,11],em:true},{res:.051,objectId:'rear-lantern'});
    for(const side of [-1,1]){
      S.box([side*2.94,.12,.56],[.16,.16,.14],jade,{rd:.045,res:.083,objectId:'bollards'});
      S.ball([side*2.94,.3,.56],[.14,.062,.13],bronze,{res:.072,objectId:'bollards'});
    }
    S.bake();
    const root=P.sparseBricks.create({cell:.105,brickSize:8,base:(...point)=>Math.min(...solid.map(sd=>sd(...point)))});
    const field=P.brickMeshes.create({bricks:root,objectId:'sluice-gate',materials,
      bounds:{min:[-3.02,-.16,-.87],max:[3.02,3.19,.87]},
      materialAt(x,y){
        if(y<.36)return 'basalt-footings';
        if(y>2.51||Math.abs(x)>2.05)return 'verdigris-trim';
        if(Math.min(Math.abs(y-.92),Math.abs(y-1.53),Math.abs(y-2.12))<.065)return 'dark-mortar';
        return 'ochre-masonry';
      }});
    const window=root.edit(opening), chipped=window.edit(breach), revisions=[root,window,chipped];
    const world=B.finish({id,brickMeshes:[field],cam:{target:[0,1.38,.03],dist:10.9,yaw:.22,pitch:.18,ortho:true},radius:5.9,dither:0,
      look:{pixelSize:1},fog:{c:0,start:1,max:0},
      areaLights:[{id:'quay-light',shape:'disk',at:[-2.55,4.75,2.66],normal:[.33,-.6,-.75],
        size:[.3,.3],color:'#ffdbad',intensity:4,radius:8,sampleGrid:1,visible:false,shadows:false}]});
    let state=0;
    K.stage(world).add({pre(_dt,t){
      const next=t>=2?2:t>=.82?1:0;
      if(next!==state){field.update(revisions[next]);state=next;}
      world.cam.yaw=.22+.17*Math.sin(t*.71);
    }});
    return world;
  }
  return {id,seed,name:'Verdigris sluice',build};
};
