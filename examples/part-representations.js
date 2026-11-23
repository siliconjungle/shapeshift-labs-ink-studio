/* Each distant cel is baked from the same native part that it replaces. */
module.exports = (kit, baked) => {
  const {KIT:K,makeBuilder,makeSculpt}=kit;
  const meshes=K.sceneMeshes, sprites=K.sprite.reconstruction;
  const id='part-representations', object='brine-lantern', seed=216;
  const pivot=[0,1.43,0], yaw=.24, pitch=.18;
  const palette=[0x171d2e,0x25384e,0x37576a,0x588986,0x8fb3a2,0xbfceb4,
    0x553643,0x855455,0xc38365,0xe8ab71,0xffd394,0xffecc2,
    0x114552,0x1e716f,0x46a18e,0x70c9a5,0xc5efb0,0xc2a5bd];
  const entries=[
    {part:'shell',material:'glazed-enamel',representation:'mesh',range:[9,13]},
    {part:'cables',material:'copper-braid',representation:'curves',range:[7.6,11]},
    {part:'halo',material:'mint-glow',representation:'splats',range:[6.4,9.8]}
  ];

  function housing() {
    const positions=[], uvs=[], indices=[];
    function quad(a,b,c,d) {
      const at=positions.length/3;
      positions.push(...a,...b,...c,...d);
      uvs.push(0,0,1,0,0,1,1,1);
      indices.push(at,at+1,at+2,at+2,at+1,at+3);
    }
    const front=[[-.76,2.13,.43],[.76,2.13,.43],[-.64,.73,.43],[.64,.73,.43]];
    const back=[[-.72,2.01,-.43],[.72,2.01,-.43],[-.61,.79,-.43],[.61,.79,-.43]];
    quad(...front);
    quad(back[1],back[0],back[3],back[2]);
    quad(back[0],front[0],back[2],front[2]);
    quad(front[1],back[1],front[3],back[3]);
    quad(back[0],back[1],front[0],front[1]);
    quad(front[2],front[3],back[2],back[3]);
    const width=48,height=44,pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const rim=x<5||x>=43||y<5||y>=39, bolt=(x===3||x===44)&&(y===3||y===40);
      let ink=0x124451;
      if (rim) ink=bolt?0xffecc2:(x+y*3)%13<3?0xf2b97c:y<6||x<5?0xba7755:0x84544c;
      else if(y>=32) ink=(x>9&&x<39&&x%6<3)?0xe8ab71:0x285b58;
      else if(y===7||x===7||y===30||x===40) ink=0x31776e;
      else {
        const spark=Math.round(4*Math.sin(x*.37)+2*Math.sin(x*.81))+19;
        if(y===spark) ink=0xc5efb0;
        else if(Math.abs(y-spark)===1) ink=0x46a18e;
        else if(x%8===0||y%7===0) ink=0x1e716f;
      }
      pixels.set([ink>>16,ink>>8&255,ink&255,255],(y*width+x)*4);
    }
    return meshes.create({id:'brine-housing',objectId:object,partId:'shell',positions,uvs,indices,
      materials:[{id:'glazed-enamel',texture:{width,height,pixels}}]});
  }

  function cables(B) {
    for(const side of [-1,1]) {
      const points=[[side*.48,.40,.18],[side*.75,.52,.61],[side*1.13,.85,.58],
        [side*1.26,1.31,.52],[side*1.12,1.77,.45],[side*.68,1.83,.37]];
      K.curveSplats.draw(B,{kind:'path',id:side<0?'port-feed':'starboard-feed',points},
        {object,material:'copper-braid',target:{part:'cables'},color:side<0?'#f0b773':'#c38365',
          width:.115,edge:'hard',caps:'blunt',lighting:'metal-wire'});
    }
  }

  function halo(B,seed) {
    let state=seed>>>0;
    const random=()=>((state=Math.imul(1664525,state)+1013904223>>>0)/4294967296);
    const first=B.count();
    for(let i=0;i<96;i++){
      const r=random(), phase=random()*Math.PI*2, z=.14+(random()-.5)*.45;
      const x=Math.sin(phase)*(.23+r*.26), y=2.14+r*.83+Math.cos(phase)*.13;
      const slot=r>.67 ? 15 : random()>.55 ? 16 : 14;
      B.disc(x,y,z,[0,0,1],.045+(1-r)*.087,.06,B.P[slot],i%11===0 ? 1.26 : .34+(1-r)*.40);
    }
    B.describeSplats(first,B.count(),{object,material:'mint-glow',target:{entity:object,part:'halo'}});
  }

  function platform(B) {
    const S=K.sculpt(makeSculpt(B)), stone={r:[1,2,3,4,5]}, metal={r:[6,7,8,9,10]};
    Object.assign(S,{sun:K.V.norm([-.62,.78,.5]),amb:.43,sky:.20,sunK:.63});
    S.box([0,-.18,0],[2.35,.19,1.38],stone,{rd:.19,res:.15,objectId:'dock'});
    S.box([0,.037,0],[2.27,.065,1.29],{r:[12,13,14,15]},{rd:.14,res:.11,objectId:'dock'});
    S.box([0,.26,.01],[1.10,.18,.64],stone,{rd:.11,res:.083,objectId:'dock-cradle'});
    S.box([0,.58,.025],[.43,.17,.36],metal,{rd:.063,res:.076,objectId:'dock-cradle'});
    for(const side of [-1,1]) {
      S.box([side*1.68,.109,.78],[.18,.048,.24],metal,{rd:.04,res:.074,objectId:'deck-brackets'});
      S.box([side*.82,.41,.30],[.13,.075,.16],metal,{rd:.035,res:.061,objectId:'deck-brackets'});
    }
    S.bake();
  }

  function native(seed,part) {
    const B=makeBuilder(seed,palette);
    if(!part)platform(B);
    if(!part||part==='cables')cables(B);
    if(!part||part==='halo')halo(B,seed);
    const mesh=!part||part==='shell'?housing():null;
    return {mesh,world:B.finish({id,...(mesh&&{meshes:[mesh]}),
      cam:{target:pivot.slice(),dist:6.4,yaw,pitch,sway:0},radius:5,dither:0,
      fog:{c:0,start:1,max:0},look:{pixelSize:1,splatCoverage:'continuous'}})};
  }

  function bake(value=seed) {
    const {spriteAtlas}=require('../cli/sprite-atlas.js');
    return Object.fromEntries(entries.map(({part})=>{
      const {world}=native(value,part);
      return [part,spriteAtlas(world,{pivot,width:64,height:64,directions:8,yaw,pitches:[pitch],
        maps:['depth','normal'],view:{dist:7.1,raw:true}})];
    }));
  }

  function build(value=seed) {
    const {world,mesh}=native(value), atlases=baked??bake(value);
    sprites.bindParts(world,entries.map(({part,material,representation,range})=>({
      object,part,material,representation,...(representation==='mesh'&&{mesh}),
      sprite:{asset:sprites.asset({atlas:atlases[part],range}),at:pivot,lighting:false}
    })));
    K.stage(world).add({pre(_dt,t){
      const u=Math.max(0,Math.min(1,t/3.2)), pull=u*u*(3-2*u);
      world.cam.dist=6.4+8.9*pull;
      world.cam.yaw=yaw+.16*Math.sin(u*Math.PI);
    }});
    return world;
  }

  return {id,seed,name:'Brine lantern',build,bake};
};
