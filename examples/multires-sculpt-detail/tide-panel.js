// An instrument panel with independently sculpted engraving and coarse form.
module.exports=({KIT:K,makeBuilder,makeSculpt})=>{
  const P=K.procedural, id='tide-panel', seed=29;
  const palette=[0x192531,0x28394a,0x465765,0x6e8288,0xa3b0a6,0x254d52,
    0x3e7674,0x5e9e8b,0x9bc3a7,0x593b39,0x86554a,0xbd825e,0xe5ad76,0xf5d294];
  const ramps=[[0x243b41,0x315958,0x488473,0x65a790,0x9bcaab],
    [0x593b39,0x86554a,0xbd825e,0xe5ad76,0xf5d294]];
  function paint(source) {
    const light=K.V.norm([-.25,.86,.44]), dc=source.bricks.cell*.44;
    const uvs=new Float32Array(source.positions.length/3*2);
    for (let i=0;i<source.positions.length/3;i++) {
      const p=source.positions.slice(i*3,i*3+3);
      const normal=K.V.norm(p.map((_,a)=>{
        const lo=p.slice(),hi=p.slice();
        lo[a]-=dc; hi[a]+=dc;
        return source.bricks.distance(...hi)-source.bricks.distance(...lo);
      }));
      uvs[i*2]=Math.min(1,Math.max(0,.48+.48*K.V.dot(normal,light)));
      uvs[i*2+1]=.5;
    }
    const materials=source.materials.map(({id},slot)=>{
      const pixels=new Uint8Array(32*4), ramp=ramps[slot];
      for (let i=0;i<32;i++) {
        const color=ramp[Math.min(ramp.length-1,Math.floor(i*ramp.length/32))];
        pixels.set([color>>16,color>>8&255,color&255,255],i*4);
      }
      return {id,texture:{width:32,height:1,pixels}};
    });
    return {uvs,materials};
  }
  return {id,seed,name:'Tide gauge',build(value) {
    const B=makeBuilder(value,palette), S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.55,.76,.54]),amb:.45,sky:.15,sunK:.68});
    S.box([0,0,-.48],[2.62,1.6,.15],{r:[1,2,3,4]},{rd:.18,res:.115});
    for (const x of [-2.2,2.2]) for (const y of [-1.18,1.18])
      S.ball([x,y,.23],[.103,.103,.065],{r:[9,10,11,12,13]},{res:.045});
    S.bake();
    const field=P.sculptMasks.field({kind:'box',min:[-2.28,-1.27,-.45],max:[2.28,1.27,.18]});
    const bricks=P.sparseBricks.create({cell:.06,brickSize:10,base:field});
    const panel=P.brickMeshes.create({bricks,objectId:'gauge',
      bounds:{min:[-2.58,-1.48,-.6],max:[2.58,1.48,.66]},
      materials:[{id:'jade',color:0x6ba797},{id:'rim',color:0xb67d54}],
      materialAt:(x,y)=>Math.abs(x)>2.12 || Math.abs(y)>1.12 ? 'rim' : 'jade',derived:{depthProxy:true,bakePaint:paint}});
    return B.finish({id,brickMeshes:[panel],look:{pixelSize:1},dither:0,radius:4.6,
      cam:{target:[0,0,-.06],yaw:.24,pitch:.26,dist:7.1,ortho:true},fog:{c:0,start:1,max:0}});
  }};
};
