const pathInk = require('./relay-look.json');

module.exports = ({KIT,makeBuilder,makeSculpt}) => ({
  id:'relay-pool',
  name:'The Keeper in the Flooded Relay',
  seed:57,
  build(seed) {
    const pal=[0x111e2a,0x253441,0x3c5760,0x547a7a,0x8ea49a,0xb9bca6,
      0x2f2630,0x583b3e,0x916448,0xc39963,0xf6d799,0x172e38,0x38717a,0x63aaa2,0xb4eee0];
    const B=makeBuilder(seed,pal), S=KIT.sculpt(makeSculpt(B));
    Object.assign(S,{keepReferenceSdf:true,captureAlbedo:true,amb:.29,sunK:.82,wob:0});
    const tint=(materialId,r,albedo,extra={})=>({materialId,r,albedo,...extra});
    const floor=tint('basalt',[0,1,2],'#343e49'), wall=tint('tile',[1,2,3,4],'#536a70');
    const dark=tint('black-iron',[0,6,7],'#352b39'), bronze=tint('bronze',[6,7,8,9,10],'#c79b66');
    const verdigris=tint('enamel',[11,12,13,14],'#508f92'), grip=tint('cloth',[6,7,8],'#865c5b');
    const visor=tint('visor',[12,13,14],'#a0fae2',{em:.35});
    const flood=tint('wet-enamel',[0,1,2],'#172c35');
    const glass=tint('optical-glass',[3,4,5],'#e4f6eb',{glass:true,a:.18,
      optical:{reflection:.035,absorption:.09,reflectionColor:'#e5f5ed'}});
    const box=(p,h,m,id,res=.12,rd=.038)=>S.box(p,h,m,{objectId:id,res,rd});
    const ball=(p,r,m,id,res=.09)=>S.ball(p,r,m,{objectId:id,res});
    const tube=(p,r,m,id,res=.083)=>S.tube(p,r,r,m,{objectId:id,res});
    box([0,-.19,1.05],[3.3,.16,3.26],floor,'floor',.23);
    box([0,1.13,-1.1],[3.4,1.54,.13],wall,'wall',.20);
    for (const x of [-2.62,-1.96,-1.30,-.64,.02,.68,1.34,2,2.66]) {
      box([x,1.19,-.954],[.012,1.45,.011],dark,'masonry-joints',.13,.008);
    }
    for (const y of [.31,.71,1.11,1.51,1.91,2.31])
      box([0,y,-.944],[3.35,.013,.012],dark,'masonry-joints',.16,.008);
    box([.99,1.31,-.89],[.31,1.11,.062],dark,'channel',.14);
    box([1.0,1.4,-.804],[.045,.82,.025],bronze,'channel',.085,.02);
    box([1.00,1.9,-.75],[.19,.12,.035],verdigris,'indicator',.073);
    for (const y of [.53,.70,2.04,2.23])
      box([1.00,y,-.77],[.18,.025,.02],bronze,'indicator',.058,.012);
    S.bake();

    box([-.35,.037,1.78],[1.56,.04,2.04],flood,'flood-pool',.25,.085);
    for (const x of [-1.94,1.24])
      box([x,.068,1.80],[.046,.064,2.04],bronze,'pool-rim',.13,.033);
    for (const z of [-.26,3.81])
      box([-.35,.065,z],[1.63,.055,.053],bronze,'pool-rim',.14,.027);
    box([-.66,.142,-.22],[.63,.11,.43],dark,'keeper-plinth',.13);
    box([-.66,.248,-.22],[.52,.035,.39],bronze,'keeper-plinth',.11,.034);
    S.bake();

    const keeper='keeper', x=-.66, z=-.26;
    box([x,.69,z],[.38,.42,.215],verdigris,keeper,.082,.12);
    box([x,.67,z+.215],[.27,.11,.038],bronze,keeper,.065,.032);
    box([x,.67,z+.253],[.17,.035,.012],dark,keeper,.041,.012);
    for (const side of [-1,1]) {
      const sx=x+side*.397;
      ball([sx,.91,z],[.16,.175,.17],bronze,keeper,.072);
      tube([[sx,.90,z],[sx+side*.09,.65,z+.037],[sx+side*.046,.46,z+.12]],.087,grip,keeper,.069);
      ball([sx+side*.046,.449,z+.137],[.105,.103,.105],verdigris,keeper,.06);
    }
    box([x,1.105,z],[.16,.14,.125],dark,keeper,.082,.046);
    ball([x,1.449,z],[.337,.321,.265],bronze,keeper,.075);
    box([x,1.442,z+.183],[.322,.073,.147],dark,keeper,.066,.061);
    box([x,1.438,z+.381],[.249,.036,.050],visor,keeper,.046,.026);
    box([x,1.234,z+.064],[.254,.092,.136],verdigris,keeper,.075,.067);
    for (const side of [-1,1])
      ball([x+side*.308,1.405,z],[.072,.11,.128],verdigris,keeper,.055);
    tube([[x+.211,1.656,z],[x+.299,1.873,z-.033]],.026,bronze,keeper,.044);
    ball([x+.299,1.873,z-.033],.043,visor,keeper,.039);
    S.bake();

    const panel=[-1.005,1.325,.445];
    ball(panel,[.63,.60,.137],glass,'glass-port',.105);
    S.bake();
    for (const side of [-1,1]) {
      const points=Array.from({length:9},(_,i)=>{
        const angle=Math.PI/2+side*Math.PI*i/8;
        return [panel[0]+.659*Math.cos(angle),panel[1]+.625*Math.sin(angle),panel[2]+.012];
      });
      tube(points,.036,bronze,'port-rim',.071);
    }
    for (const sx of [-1.66,-.35]) {
      box([sx,.58,.455],[.039,.325,.044],dark,'port-frame',.09,.024);
      box([sx,.31,.455],[.107,.058,.087],bronze,'port-frame',.077,.020);
    }
    S.bake();

    return B.finish({id:'relay-pool',name:'The Keeper in the Flooded Relay',
      cam:{target:[-.32,.52,.82],dist:6.05,yaw:-.11,pitch:.51,ortho:true,sway:0},
      radius:8,look:{pathInk},
      liveSun:{direction:KIT.V.norm([-.57,.72,.48]),ambient:.085,intensity:1.18,shadows:true}});
  }
});
