/* Glassbank at shift change, with a coarse skyline, low fog and a backlight. */
const studio = require('..');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'depth-aware-layers', name:'Last shift at Glassbank', seed:64,
  build(seed) {
    const palette = [
      0x132432,0x1b303b,0x263f4b,0x345560,0x466e74,0x627f7a,0x7e9588,0xb2b5a0,
      0x26343d,0x404449,0x5d5350,0x846754,0xa88263,0xd2a477,
      0x412e3a,0x643a42,0x944d45,0xbf6b4a,0xe0935a,0xf8be75,0xffd899,
      0x383c4f,0x505873,0x696c80,0x958896,0xbfa8a7,
      0x225158,0x317277,0x51a299,0x9be1bf,0xdcf3c7
    ];
    const cam={target:[0,1.42,-.15],dist:6.9,yaw:0,pitch:.023,sway:0};
    const builder = offset => {
      const B=makeBuilder(seed+offset,palette), S=K.sculpt(makeSculpt(B));
      Object.assign(S,{sun:K.V.norm([-.65,.62,.4]),amb:.47,sky:.12,sunK:.56,wob:.005});
      const box=(at,half,mat,objectId,res=.075,rd=.028)=>S.box(at,half,mat,{objectId,res,rd});
      const tube=(points,radius,mat,objectId,res=.055)=>S.tube(points,radius,radius,mat,{objectId,res});
      return {B,S,box,tube};
    };
    const stone={r:[0,1,2,3,4],materialId:'basalt'};
    const brass={r:[8,9,10,11,12,13],materialId:'brass'};
    const coat={r:[14,15,16,17,18,19],materialId:'workwear'};
    const skin={r:[10,11,12,13,19,20],materialId:'skin'};
    const bright={r:[28,29,30],em:true,materialId:'glass'};
    const far = builder(4);
    for (let i=0;i<10;i++) {
      const x=(i-4.6)*1.65, depth=-6.4-(i%3)*1.1, height=1.70+.72*(i*5%7)/3;
      const stone={r:i%3?[2,3,4,5]:[21,22,23,24]};
      far.box([x,height/2-.16,depth],[.72,height/2,.62],stone,'skyline',.19,.075);
      far.box([x,height-.16,depth],[.787,.082,.67],{r:[2,3,4]},'eaves',.19,.034);
      if (i%3===0) {
        far.box([x,height+.38,depth],[.21,.53,.22],stone,'chimneys',.115);
        far.box([x,height+.91,depth],[.30,.10,.29],{r:[3,4,5]},'chimneys',.13);
      }
      for (let y=.42;y<height-.31;y+=.43) for (const side of [-.38,.22])
        far.box([x+side,y,depth+.627],[.074,.117,.023],{r:[5,6,7]},'lit-windows',.086);
    }
    for(const x of [-4.4,3.68]) {
      far.box([x,1.9,-4.75],[.5,2.05,.36],{r:[2,3,4,5]},'cooling-towers',.15,.13);
      far.box([x,3.14,-4.68],[.73,.135,.455],{r:[3,4,5]},'cooling-towers',.14);
      far.tube([[x,3.30,-4.60],[x+.02,4.52,-4.60]],.048,{r:[2,3,4]},'antennas',.06);
    }
    far.S.bake();
    const skyline=far.B.finish({cam:{...cam},radius:12,dither:0,look:{splatCoverage:'continuous'},
      fog:{start:.60,max:.25,color:'#849795'}});

    const {B,S,box,tube}=builder(0);
    box([0,-.19,.16],[4.65,.24,1.72],stone,'catwalk',.14,.07);
    box([0,.03,1.25],[4.66,.12,.22],brass,'catwalk-edge',.096,.03);
    for (let i=-7;i<=7;i++) {
      box([i*.63,.15,1.426],[.17,.017,.028],brass,'rivets',.043,.01);
      box([i*.63,.07,.71],[.30,.023,.41],stone,'deck-plates',.087,.022);
    }
    for(const x of [-3.35,-2.06,1.85,3.64]) {
      box([x,.50,-.29],[.056,.48,.068],stone,'rail-posts',.055);
      box([x,.976,-.29],[.089,.045,.09],brass,'rail-posts',.047);
    }
    for(const [x0,x1] of [[-3.35,-2.06],[1.85,3.64]])
      tube([[x0,.93,-.29],[x1,.93,-.29]],.037,brass,'rail',.046);
    for(const x of [-2.18,2.26]) {
      box([x,1.95,-.76],[.082,1.80,.082],stone,'gantry',.073);
      box([x,3.57,-.75],[.21,.155,.13],brass,'gantry',.081);
    }
    box([.04,3.63,-.76],[2.25,.11,.12],stone,'gantry',.082);
    tube([[-2.18,2.82,-.68],[-1.79,3.38,-.68],[-1.56,3.53,-.68]],.031,brass,'gantry',.052);
    tube([[1.97,3.53,-.68],[2.26,3.12,-.68],[2.26,2.58,-.68]],.031,brass,'gantry',.046);
    box([1.15,1.25,-.92],[.50,.24,.17],brass,'relay-case',.060,.058);
    box([1.15,.59,-.98],[.26,.48,.20],stone,'relay-base',.070);
    box([1.15,1.53,-.83],[.54,.082,.21],stone,'relay-cap',.059,.035);
    box([1.15,1.305,-.724],[.40,.093,.018],bright,'relay-core',.039,.036);
    for (const x of [.77,1.54])
      box([x,1.31,-.687],[.022,.125,.025],brass,'relay-cap',.045,.011);
    tube([[1.44,1.46,-.88],[1.49,2.19,-.92],[1.83,2.67,-.82],[2.26,2.67,-.78]],.026,stone,'cable',.043);
    tube([[.88,1.42,-.89],[.72,1.95,-.82],[.2,2.16,-.77],[-.51,2.51,-.72],[-1.9,2.46,-.71]],.023,stone,'cable',.042);
    S.bake();

    const first=B.count(), z=.59, actor='inspector';
    const A=(x,height,offset=0)=>[x,height,z+offset];
    S.lathe(A(0,.61),.87,t=>.40-.09*t,coat,{objectId:actor,res:.04,maxRadius:.40});
    for (const side of [-1,1]) {
      S.ball(A(side*.23,1.26),[.16,.20,.16],coat,{objectId:actor,res:.036});
      tube([A(side*.31,1.23),A(side*.40,1.04,.03),A(side*.38,.83,.09)],.091,coat,actor,.037);
      S.ball(A(side*.37,.80,.146),[.082,.081,.066],skin,{objectId:actor,res:.028});
      tube([A(side*.146,.66),A(side*.175,.45,.01),A(side*.197,.20,.035)],.107,stone,actor,.043);
      S.ball(A(side*.196,.195,.10),[.144,.086,.167],stone,{objectId:actor,res:.044});
    }
    S.ball(A(.016,1.72,.084),[.244,.263,.179],skin,{objectId:actor,res:.027});
    S.ball(A(.200,1.695,.192),[.065,.059,.061],skin,{objectId:actor,res:.024});
    box(A(.101,1.767,.241),[.086,.018,.012],stone,actor,.019,.012);
    S.ball(A(-.016,1.88,.026),[.275,.131,.230],coat,{objectId:actor,res:.027});
    box(A(.079,1.819,.189),[.241,.037,.096],brass,actor,.030,.022);
    const strap={r:[8,9,10,11]};
    tube([A(-.21,1.40,.19),A(-.004,1.13,.275),A(.19,.83,.233)],.038,strap,actor,.027);
    box(A(.122,1.021,.271),[.063,.053,.021],brass,actor,.028,.013);
    S.bake();
    const end=B.count();

    const bounds={min:[-5,.03,-2.65],max:[5,1.47,-.35]};
    const field=K.procedural.density.bounded({bounds,sample:(x,y,z,t)=>{
      const bank=.46+.22*Math.sin(2.2*x+5*z-1.3*t)+.24*Math.cos(5.5*y+z+.78*t);
      return Math.max(0,bank)*(1-.54*y/1.47);
    }});
    const world=B.finish({
      id:'depth-aware-layers',cam:{...cam},radius:12,dither:0,detail:25,
      skyEnvironment:{defaults:{zenith:'#263c53',horizon:'#90a69a',ground:'#273740',sunStrength:0}},
      atmosphere:[K.atmosphere.field({field,density:.75,step:.105,color:'#70a9a2',lit:false})],
      volumeQuality:{scale:4,steps:48,depthTolerance:.32,stats:true},
      emissiveFinishes:[{id:'relay-glow',select:{object:'relay-core'},
        glow:{radius:22,scale:4,color:'#75dfc7',strength:.56,falloff:1.42,threshold:.12,small:false}}],
      look:{splatCoverage:'continuous',ink:{silhouette:{strength:.32,color:'#18313c'},crease:false}}
    });
    const scenery = {resolution:4,filter:'linear',depthTest:{bias:.12},
      source({w,h}) {
        const frame=studio.render(skyline,{w,h,px:1,transparent:true,passes:['depth'],raw:true});
        return {w,h,rgb:frame.rgb,alpha:frame.alpha,depth:frame.passes.depth};
      }};
    const lettering = { resolution:1,draw:[
      { type:'rect',rect:[13,12,100,20],color:'#152733e0' },
      { type:'path',points:[[13,34],[113,34]],width:1,color:'#7fa69b' },
      { type:'text',text:'GLASSBANK',at:[63,26],size:11,color:'#d6dfbf',width:1.2 }
    ] };
    world.look.composite={world:{resolution:1},layers:[scenery,lettering]};
    const stage=K.stage(world);
    stage.stateful=false;
    stage.add({ pre(_dt,t) {
      const walk=-1.01+Math.min(2.6,Math.max(0,t))*.69;
      for(let i=first;i<end;i++){
        const p=i*16;
        stage.D[p]=stage.base[p]+walk;
        stage.D[p+1]=stage.base[p+1]+.014*Math.sin(t*6.4);
        stage.touch(i);
      }
    } });
    stage.update(0,0);
    return world;
  }
});
