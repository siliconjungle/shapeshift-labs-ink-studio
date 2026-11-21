module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'part-motion',
  name:'The tide dial',
  seed:27,
  build(seed) {
    const B = makeBuilder(seed,[
      0x142332,0x213443,0x2e4c55,0x47696c,0x6c8981,0xa7b29a,
      0x3a2c3c,0x62424b,0x945c55,0xb98161,0xd9a16f,0xf8cc85,0xffedb1,
      0x24555f,0x327d80,0x65a397,0xa7ccae,
      0x412b40,0x734457,0xb15e68,0xe18d78,0xffba92
    ]);
    const S = makeSculpt(B), rig = K.rig(B,S);
    const moving = new Set(['tide-needle','counterweight','servo-wheel']);
    rig.resolve = solid => moving.has(solid.tag) ? rig.part(solid.tag) : 0;
    Object.assign(S,{amb:.36,sky:.18,sunK:.65,shLen:0,sun:K.V.norm([-.57,.71,.50])});
    const stone = {r:[0,1,2,3,4,5]}, frame = {r:[6,7,8,9,10]}, brass = {r:[7,8,9,10,11,12]};
    const teal = {r:[1,2,13,14,15,16]}, enamel = {r:[17,18,19,20,21]};
    const box = (at,half,mat,tag,res=.095,rd=.045) => S.box(at,half,mat,{tag,res,rd});
    const ball = (at,half,mat,tag,res=.075) => S.ball(at,half,mat,{tag,res});
    const wheel = [0,1.2,-.21], needle = [0,1.2,.15], tip = [.95,1.21,.20], servo = [-1.36,.47,.33];
    box([0,-.31,0],[2.69,.265,1.13],stone,'quay',.13,.10);
    box([0,-.065,.09],[2.73,.052,1.145],stone,'quay',.085,.045);
    for (let x=-4;x<=4;x++) {
      box([x*.58,-.036,.57],[.28,.031,.43],{r:[1,2,3,4,5]},'quay',.073,.022);
      box([x*.58,-.20,1.11],[.276,.096,.046],{r:[0,1,2,3]},'quay',.084,.024);
    }
    for (const x of [-2.27,2.27]) {
      box([x,.64,-.13],[.24,.63,.27],stone,'housing',.104,.075);
      box([x,1.23,-.13],[.29,.086,.30],frame,'housing',.085);
      box([x,.09,-.13],[.34,.081,.38],frame,'housing',.085);
    }
    ball(wheel,[1.24,1.17,.23],frame,'dial',.098);
    ball([0,1.20,-.071],[1.125,1.06,.15],teal,'dial',.079);
    for (let i=0;i<24;i++) {
      const a=i*Math.PI/12;
      ball([1.03*Math.cos(a),1.2+.96*Math.sin(a),.008],
        [i%3 ? .025 : .050,i%3 ? .029 : .053,.045],i%3 ? stone : brass,'dial',.036);
    }
    box([.47,1.20,.177],[.54,.058,.063],brass,'tide-needle',.047,.027);
    ball(tip,[.126,.116,.091],enamel,'tide-needle',.047);
    box([-.34,1.20,.17],[.42,.042,.05],teal,'tide-needle',.052,.024);
    ball(needle,[.16,.154,.117],brass,'tide-needle',.050);
    box([-.21,1.2,.09],[.3,.048,.044],frame,'counterweight',.048,.02);
    ball([-.52,1.2,.10],[.138,.132,.094],enamel,'counterweight',.048);
    box([servo[0],.226,servo[2]],[.29,.24,.25],frame,'servo-housing',.085);
    ball(servo,[.275,.259,.111],brass,'servo-wheel',.055);
    for (let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      ball([servo[0]+.23*Math.cos(a),servo[1]+.23*Math.sin(a),.42],[.087,.087,.058],frame,'servo-wheel',.044);
    }
    // This stationary gate masks the needle and exposes it as the arm swings through.
    box([.57,.708,.50],[.086,.713,.092],stone,'front-gate',.056,.020);
    box([.57,1.420,.50],[.155,.073,.136],brass,'front-gate',.052,.027);
    box([.57,.121,.56],[.164,.093,.135],frame,'front-gate',.050,.027);
    S.bake();

    const world = B.finish({cam:{target:[0,1.07,0],dist:5.85,yaw:-.12,pitch:.16,sway:0,ortho:false},
      radius:6,detail:20,dither:0,look:{splatCoverage:'continuous'}});
    const stage = K.stage(world);
    rig.bind(stage);
    stage.add({pre(_dt,t) {
      const phase=t*Math.PI, arc=Math.sin(phase-.75);
      rig.set('tide-needle',K.M.rot([0,0,1],arc*.87),needle,needle);
      rig.set('counterweight',K.M.rot([0,0,1],-.62*arc),wheel,wheel);
      rig.set('servo-wheel',K.M.rot([0,0,1],t*Math.PI*1.5),servo,servo);
      rig.apply();
      const cut=t>=1;
      world.cam.yaw=(cut ? .26 : -.19)+.045*arc;
      world.cam.target=[cut ? .26 : -.09,1.06,0];
    }});
    return world;
  }
});
