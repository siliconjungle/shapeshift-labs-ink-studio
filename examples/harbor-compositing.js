module.exports = ({ KIT:K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface }) => ({
  id:'harbor-compositing', name:'Harbor signal house', seed:37,
  build(seed) {
    const B = makeBuilder(seed,[
      0x101c2c,0x1a2c40,0x283f53,0x435567,0x64797d,0x96a092,
      0x523645,0x714d55,0x986557,0xc48b65,0xe3b177,0xffd08b,0xffe9b4,
      0x193d49,0x2d626d,0x437e81,0x6e9d97,0x9ac9bb,
      0x362d3d,0x525168,0x6b6580,0x95819b
    ]);
    const S=makeSculpt(B);
    Object.assign(S,{amb:.28,sky:.19,sunK:.43,shLen:0,sun:K.V.norm([-.65,.62,.42])});
    const slate={r:[0,1,2,3,4]}, copper={r:[6,7,8,9,10,11]}, glass={r:[13,14,15,16,17]};
    const ember={r:[9,10,11,12],em:true};
    const box=(at,half,m,tag,res=.105,rd=.032)=>S.box(at,half,m,{tag,res,rd});
    const ball=(at,half,m,tag,res=.065)=>S.ball(at,half,m,{tag,res});
    box([0,1.13,-1.28],[2.23,1.1,.17],slate,'house',.135);
    for(let j=0;j<5;j++) for(let i=-3;i<=3;i++)
      box([i*.56+(j%2)*.21,.215+j*.447,-1.09],[.27,.206,.055],
        [slate,glass,slate][(i+j+6)%3],'house',.13,.022);
    box([0,2.18,-.52],[2.44,.132,.94],slate,'roof',.10,.071);
    box([0,2.09,.43],[2.44,.046,.092],copper,'roof',.09);
    box([0,.07,-.76],[2.49,.17,.60],slate,'house',.092);
    for (const x of [-2.13,2.13]) {
      box([x,1.08,-.01],[.187,1.00,.42],slate,'piers',.089,.053);
      box([x,.28,.36],[.218,.082,.109],copper,'piers',.078);
      box([x,1.70,.36],[.068,.169,.043],copper,'piers',.063);
      box([x,1.70,.412],[.027,.10,.033],ember,'pier-lamps',.057);
      box([x*1.14,-.06,1.24],[.235,.127,2.49],slate,'quay',.133,.076);
    }
    for (const y of [.34,1.86])
      box([0,y,.06],[1.951,.033,.067],copper,'window-frame',.069,.018);
    for (const x of [-1.91,1.91,.52])
      box([x,1.1,.06],[.025,.764,.057],copper,'window-frame',.066,.014);
    const signal='harbor-signal';
    box([-.68,.28,-.24],[.31,.14,.275],copper,signal,.065,.061);
    box([-.68,.66,-.23],[.103,.316,.127],copper,signal,.058);
    ball([-.68,1.16,-.17],[.348,.343,.229],copper,signal,.061);
    ball([-.68,1.17,.031],[.209,.204,.055],ember,signal,.054);
    box([-.68,1.53,-.12],[.142,.055,.132],copper,signal,.054);
    ball([-.68,1.74,-.13],[.062,.162,.055],copper,signal,.056);
    box([1.32,.31,-.31],[.32,.19,.263],glass,'switchbox',.069,.035);
    box([1.32,.49,-.09],[.251,.059,.046],copper,'switchbox',.061);
    for(const x of [1.14,1.38,1.53]) ball([x,.365,-.071],[.046,.048,.041],ember,'switchbox',.044);
    S.bake();

    const start=B.count();
    for(let x=0;x<18;x++) for(let y=0;y<11;y++){
      const u=-1.80+x*.205, v=.44+y*.126;
      if (u>.38) continue;
      const glint=Math.abs(v-1.42-u*.26)<.096;
      B.disc(u,v,.139,[0,0,1],.106,.011,B.P[glint?17:14],glint ? .46 : .23,{gl:true,nd:true});
    }
    B.describeSplats(start,B.count(),{object:'blue-pane',material:'glass'});
    const floor=SpriteSurface.make();
    floor.mesh(TexturedSurface.heightfield({bounds:[-3,3,-1.54,5.45],segments:[4,4],height:()=>-.51}),
      21,25,(x,y)=>x%4===0||y%5===0?0x1c293d:0x263d51);
    const pool=K.procedural.waterBodies.create({id:'harbor',bounds:{min:[-2.22,-1.18],max:[2.22,5.25]},
      resolution:[16,16],sample:()=>({bed:-.66,surface:-.055}),
      optics:{tint:[.012,.04,.085],extinction:[.15,.09,.06],surfaceColor:[.73,.88,1],surface:.99,
        refraction:0,foam:0,caustics:0,reflection:{plane:'harbor',distortion:1.35,blur:.45}}});
    const areaLights=[
      {id:'amber-window',at:[-1.52,1.55,1.29],normal:[.3,-.17,-1],color:'#ff9456',
        size:[.65,1.18],radius:4.6,intensity:t=>3.7+.7*Math.cos(t*3),volumeIntensity:2,sampleGrid:3,visible:false,shadows:false},
      {id:'blue-pier',at:[1.73,1.79,1.27],normal:[-.42,-.20,-1],color:'#60c2ff',
        size:[1.12,1.27],radius:4.9,intensity:t=>3.2-.5*Math.cos(t*3),volumeIntensity:2.7,sampleGrid:3,visible:false,shadows:false}
    ];
    return B.finish({cam:{target:[0,.77,.24],dist:7.6,yaw:-.16,pitch:.322,ortho:true,sway:0},detail:21,radius:6,dither:0,
      spriteSurfaces:floor.finish(), water:K.procedural.waterBodies.scene([pool]),
      reflections:[K.reflection.plane({id:'harbor',at:[0,-.055,0]})],areaLights,
      look:{splatCoverage:'continuous',stableTransparency:{mode:'blend',depthTolerance:.055}},refract:2.4});
  }
});
