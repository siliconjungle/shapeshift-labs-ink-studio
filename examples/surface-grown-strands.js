// A skinned textile sample and a locally editable clay bed share a native scene.
module.exports = function surfaceGrowthFixture({KIT:K,makeBuilder}) {
  const palette=[0x172531,0x223a48,0x456371,0x62938d,0x87c1aa,0xfbe6b4,0xd89771,0xec987b,
    0xa65154,0x744d47,0x96604a,0xc18b67,0xd3a47c,0x718458,0x90bb79,0xdbcf8b];
  const B=makeBuilder(17,palette), curves=K.curveSplats, P=K.procedural, surfaces=K.sceneMeshes;
  const positions=[],uvs=[],indices=[],weights=[];
  const nu=22,nv=14;
  for (let j=0;j<=nv;j++) for (let i=0;i<=nu;i++) {
    const u=i/nu,v=j/nv;
    positions.push(-3.22+2.94*u,.58+.12*Math.sin(u*Math.PI)*Math.sin(v*5.2),1.08-2.06*v);
    uvs.push(u,v);
    const right=u*u*(3-2*u);
    weights.push([[0,1-right],[1,right]]);
    if (j<nv && i<nu) {
      const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;
      indices.push(a,b,c,c,b,d);
    }
  }
  const texWidth=96,texHeight=64,pixels=new Uint8Array(texWidth*texHeight*4);
  for (let y=0;y<texHeight;y++) for (let x=0;x<texWidth;x++) {
    const edge=y<6 || y>57, stripe=y>=11&&y<=14 || y>=46&&y<=49;
    const base=edge ? [28,62,74] : stripe ? [69,121,131] : [40,83,99];
    const grain=((x+y)&1)*7+(x%3===0 ? 5 : 0);
    pixels.set([...base.map(n=>n+grain),255],(y*texWidth+x)*4);
  }
  const fabric=surfaces.create({id:'dyed-canvas',positions,uvs,indices,materials:[
    {id:'canvas',texture:{width:texWidth,height:texHeight,pixels}}
  ]});
  const carrier={kind:'uv',mesh:fabric};
  const stitchRows=[];
  for (const [row,v] of [.23,.72].entries()) for (let i=0;i<14;i++) {
    const u=.075+i*.063;
    stitchRows.push({id:'stitch-'+row+'-'+i,from:[u,v-.031],to:[u+.027,v+.031],lift:.028});
  }
  const stitches=curves.grow(B,carrier,{stitches:stitchRows,segments:6,offset:.012},
    {object:'canvas-stitch',width:.038,edge:'hard',color:'#fbe6b4'});
  const frayRows=Array.from({length:53},(_,i)=>({id:'fray-'+i,uv:[.018+i*.0184,.025+.013*(i%3)],
    heading:-Math.PI*.54+(i%9)*.05,length:.105+(i*19%22)*.0041}));
  const fray=curves.grow(B,carrier,{seed:51,roots:frayRows,segments:6,lean:2.0,bend:.31},
    {object:'canvas-fray',width:.022,edge:'hard',profileSamples:8,taper:[[0,1],[.68,.77],[1,.27]],
      color:({index})=>['#f3b391','#ec987b','#d36a68','#a95b67'][index%4]});
  const pile=curves.grow(B,carrier,{seed:'dyed-nap',scatter:{cells:[23,5],min:[.08,.375],max:[.91,.58]},
    segments:5,length:[.076,.157],lean:.85,bend:.65},
    {object:'canvas-pile',width:.025,edge:'hard',profileSamples:8,taper:[[0,1],[1,.30]],
      color:({index})=>['#95cfae','#59a19e','#8ebcad','#c5d3ad'][index%4]});

  const center=[1.77,.34,.04];
  const base=(x,y,z)=>{
    const q=[Math.abs(x-center[0])-1.30,Math.abs(y-center[1])-.31,Math.abs(z-center[2])-.95];
    return Math.hypot(...q.map(v=>Math.max(v,0)))+Math.min(0,Math.max(...q))-.10;
  };
  const bricks=P.sparseBricks.create({cell:.075,brickSize:6,base});
  const field=P.brickMeshes.create({bricks,objectId:'clay-bed',bounds:{min:[.22,-.22,-1.09],max:[3.32,1.02,1.19]},
    materials:[{id:'clay',color:0x925b49},{id:'top',color:0xb98466},{id:'edge',color:0xcba07c},{id:'cut',color:0x683e42}],
    materialAt:(x,y)=>y>.70 ? 'top' : y>.53 ? 'edge' : 'clay'});
  const rootRows=Array.from({length:115},(_,i)=>{
    const x=.62+(i%15)*.164+.033*Math.sin(i*13.16),z=-.71+Math.floor(i/15)*.206+.061*Math.cos(i*16.37);
    return {id:'shoot-'+i,point:[x,.75,z],normal:[0,1,0],tangent:[1,0,0],
      heading:.2+i*.36,length:.11+((i*17)%51)*.0038};
  });
  const shoots=curves.grow(B,{kind:'sdf',field,reach:.29},{roots:rootRows,seed:8,segments:7,lean:.72,bend:1.05},
    {object:'clay-shoot',width:.034,edge:'hard',profileSamples:8,taper:[[0,1],[.49,.76],[1,.20]],
      color:({index})=>['#bec88a','#91bd79','#d4c981','#6c9f77','#ddd09b'][index%5]});
  const holding=[];
  for (const [i,[x0,x1]] of [[-3.45,-.07],[.24,3.31]].entries()) {
    const pts=[x0,-.085,1.26,x1,-.085,1.26,x0,-.085,-1.19,x1,-.085,-1.19,
      x0,-.20,1.26,x1,-.20,1.26];
    holding.push(surfaces.create({id:'sample-tray-'+i,positions:pts,
      uvs:[0,0,1,0,0,1,1,1,0,1,1,1],indices:[0,1,2,2,1,3,0,4,1,1,4,5],
      materials:[{id:'tray',color:i===0 ? 0x365261 : 0x684c48}]}));
  }
  const world=B.finish({id:'surface-grown-strands',cam:{target:[0,.49,0],dist:8.65,yaw:-.16,pitch:.78,fov:.56},
    radius:6,dither:0,fog:{c:0,start:1,max:0},meshes:[...holding,fabric],brickMeshes:[field]});
  const pose=surfaces.skin(fabric,weights), identity=[1,0,0,0,1,0,0,0,1,0,0,0];
  const matrices=Float32Array.from([...identity,...identity]);
  let amount=0, level='rest';
  K.bones.bind(world,{ids:[],bid:[],M:matrices,meshBindings:[pose],
    curveBindings:[stitches,fray,pile],pose(){
      const ang=.54*amount,c=Math.cos(ang),s=Math.sin(ang),x=-1.83,y=.60;
      matrices.set([c,-s,0,s,c,0,0,0,1,x-c*x+s*y,y-s*x-c*y,.11*amount],12);
    }});
  const bounds={min:[1.12,-.17,-.57],max:[2.48,.95,.72]};
  const gouge=(x,z)=>Math.hypot(x-1.80,(z-.075)*1.22)-.53;
  function setFrame({bend,edit}) {
    amount=bend;
    world.anim.update(1/60,0);
    if (edit!==level) {
      const shallow=(x,y,z)=>Math.max(gouge(x,z),Math.abs(y-.71)-.135);
      const deep=(x,y,z)=>gouge(x,z);
      if (edit==='rest') field.update(bricks);
      else field.update(bricks.edit({operation:'subtract',bounds,sdf:edit==='shallow' ? shallow : deep,material:'cut'}));
      level=edit;
    }
    shoots.pose(world);
    return {stitches:stitches.snapshot(),fray:fray.snapshot(),pile:pile.snapshot(),shoots:shoots.snapshot()};
  }
  return {world,setFrame,width:288,height:152};
};
