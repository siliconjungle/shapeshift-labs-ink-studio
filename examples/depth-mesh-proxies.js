/* A mineral scan with a depth-only shell and visible rear returns to diagnose. */
module.exports = ({KIT:K, SceneMeshes=K.sceneMeshes, makeBuilder, makeSculpt, SpriteSurface}) => {
  const id='depth-mesh-proxies', seed=915;
  const colors=[0x191d33,0x2a304b,0x3b4560,0x586077,0x858996,
    0x16444f,0x205b65,0x327d83,0x56a59d,0x92c9b0,0xbfdcc0,
    0x774252,0xa8545c,0xe06c60,0xf49d77,0xffcf8d,0x49334e,0x633d5b,0x76585e,0xa8736e];
  const outline=[[-.98,.39],[.86,.38],[1.35,.93],[1.17,2.03],[.65,2.57],[-.75,2.52],[-1.31,1.88],[-1.38,.95]];
  const inner=outline.map(([x,y])=>[x*.78,1.46+(y-1.46)*.81]);
  const points=[...outline.map(p=>[...p,.14]),...inner.map(p=>[...p,.56])].flat();
  const indices=[];
  for(let i=0;i<8;i++) {
    const next=(i+1)%8;
    indices.push(i,next,i+8,next,next+8,i+8);
  }
  for(let i=1;i<7;i++)indices.push(8,8+i,9+i);

  function build(value) {
    const B=makeBuilder(value,colors), S=K.sculpt(makeSculpt(B)), {V}=K;
    const stone={r:[1,2,3,4]}, rim={r:[5,6,7,8]};
    Object.assign(S,{sun:V.norm([-.6,.78,.58]),amb:.43,sky:.16,sunK:.65});
    S.box([0,-.24,0],[2.46,.22,1.51],stone,{rd:.19,res:.149,objectId:'scan-plinth'});
    S.box([0,.007,0],[2.34,.065,1.39],rim,{rd:.17,res:.12,objectId:'scan-plinth'});
    S.box([0,.19,.04],[1.31,.17,.68],stone,{rd:.115,res:.1,objectId:'core-cradle'});
    S.box([-.84,.32,.12],[.19,.1,.54],{r:[11,12,13,14,15]},{rd:.06,res:.065,objectId:'cradle-bracket'});
    S.box([.82,.32,.12],[.19,.1,.54],{r:[11,12,13,14,15]},{rd:.06,res:.065,objectId:'cradle-bracket'});
    S.bake();
    let state=value>>>0;
    const random=()=>((state=Math.imul(1664525,state)+1013904223>>>0)/4294967296);
    const at=i=>points.slice(i*3,i*3+3);
    function facet(first,rear) {
      const [a,b,c]=indices.slice(first,first+3).map(at), ab=V.sub(b,a), ac=V.sub(c,a);
      const cross=V.cross(ab,ac), normal=V.norm(cross), area=V.len(cross)*.5;
      const count=Math.ceil(area/(rear?.0068:.0096));
      for(let i=0;i<count;i++) {
        const u=(i+.5)/count, v=(i*.61803398875)%1, s=Math.sqrt(u);
        const p=V.add(a,V.add(V.mul(ab,s*(1-v)),V.mul(ac,s*v)));
        if(rear){p[0]*=.89; p[1]=1.46+(p[1]-1.46)*.90; p[2]-=.23;}
        else p[2]-=.018+.017*random();
        const section=Math.sin(p[1]*10+p[0]*3.6)+.38*Math.sin(p[0]*17+p[1]*13);
        const faceLight=V.dot(normal,[-.32,.52,.76]);
        const fleck=random(), tint=rear ? (fleck>.82?15:fleck>.49?14:13) :
          fleck>.986 ? 10 : section>.8 ? (faceLight>.63?8:7) :
          (section<-.76 ? 5 : faceLight>.61 ? 7 : 6)+(fleck>.86?1:0);
        const size=(rear?.075:.061)*(.73+random()*.51);
        const sparseBand=Math.abs(p[1]-(1.42+.27*p[0]+.065*Math.sin(p[0]*8)))<.095;
        const density=rear?.94:sparseBand?.19:.52+(fleck>.9?.30:.07);
        B.disc(...p,normal,size,.012,B.P[tint],density);
      }
    }
    let first=B.count();
    for(let i=0;i<indices.length;i+=3)facet(i,true);
    B.describeSplats(first,B.count(),{object:'rear-returns',material:'warm-scan-noise'});
    first=B.count();
    for(let i=0;i<indices.length;i+=3)facet(i,false);
    B.describeSplats(first,B.count(),{object:'mineral-core',material:'malachite'});
    const plate=SpriteSurface.make(48);
    plate.face([1.23,.31,1.08],[.75,0,0],[0,.34,0],38,17,(x,y)=>{
      if(x===0||x===37||y===0||y===16)return 0x586077;
      if(y>=6&&y<=11&&(x>=4&&x<=14&&x%4<2||x>=22&&x<=32&&x%5<3))
        return x<15?0x92c9b0:0xffcf8d;
      return 0x191d33;
    },{id:'scan-tag'});
    const proxy=SceneMeshes.depthProxy({id:'mineral-front-shell',positions:points,indices});
    const world=B.finish({id,splatDepthProxies:{meshes:[proxy],tolerance:.055},
      spriteSurfaces:plate.finish(),cam:{target:[0,1.09,0],dist:7.15,pitch:.20,yaw:.14,ortho:true},
      radius:4.8,dither:0,look:{pixelSize:1}});
    K.stage(world).add({pre(_dt,t){world.cam.yaw=.14+.25*Math.sin(t*1.65);}});
    return world;
  }
  return {id,seed,name:'Malachite scan',build};
};
