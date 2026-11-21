/* Two adjacent shadow shapes on a small night export. */
module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'shadow-readability',
  name:'Low tide watch',
  seed:37,
  build(seed) {
    const B=makeBuilder(seed,[
      0x101623,0x202733,0x2f3949,0x3e4b5e,0x526379,0x6b7c8c,0x8b99a1,
      0x182d37,0x29444a,0x3d5b5c,0x57716e,0x7f8983,
      0x514050,0x745166,0x946978,0xb98a87,0xd6a28a,0xeeb894,
      0x453437,0x654849,0x946655,0xc39164,0xedba7d,0xffdf9d,0xffefbb
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.62,.68,.4]),amb:.28,sky:.17,sunK:.59,wob:.006});
    const rock={r:[0,1,2,3,4]}, path={r:[1,2,3,4]}, water={r:[7,8,9,10]},
      metal={r:[1],materialId:'iron-post'}, coat={r:[1],materialId:'watchcoat'},
      hem={r:[12,13,14,15]}, skin={r:[12,13,14,15,16,17]},
      bronze={r:[18,19,20,21,22]}, glass={r:[21,22,23,24],em:true};
    const box=(at,half,m,o)=>S.box(at,half,m,{rd:.035,...o});
    const line=(points,r,m,o)=>S.tube(points,r,r,m,o);
    const ground={res:.085,objectId:'quay'}, bg={res:.125,objectId:'harbour'};
    box([0,-.2,.45],[5,.2,2.65],rock,{...ground,res:.14});
    for(let j=0;j<5;j++) for(let i=0;i<13;i++){
      const x=(i-6)*.7 + (j%2)*.34, z=2.3-j*.68;
      box([x,-.025+.009*Math.cos(i+3*j),z],[.337,.036,.325],(i+j)%4?path:rock,ground);
    }
    box([0,-.42,-3.8],[11,.1,4.4],water,bg);
    for(const [x,y,z,r] of [[-5.8,-.04,-8,[4.2,.85,1.6]],[4.4,.02,-8.2,[3.2,.78,1.8]],
      [6.9,.06,-10.8,[3.2,1.12,2.1]]])
      S.rock([x,y,z],r,rock,{...bg,res:.23});
    for(const [x,y,z,len] of [[-.8,-.308,-2.5,1.7],[1.8,-.31,-1.9,1.1],[-4,-.31,-2.1,.87],[3.4,-.31,-3.7,.88]])
      box([x,y,z],[len,.008,.018],{r:[9,10,11]},{...bg,res:.085,rd:0});
    const rail={res:.061,objectId:'rail'};
    line([[-4.5,.6,-.97],[3.6,.6,-.97]],.033,rock,rail);
    for(const x of [-3.9,-2.25,1.26,2.59,3.8]) {
      box([x,.33,-.98],[.10,.36,.09],rock,rail);
      box([x,.70,-.98],[.121,.03,.104],path,rail);
    }
    S.bake();

    const pillar={res:.044,objectId:'mooring-post'}, a=.15;
    S.lathe([a,.07,.06],1.63,t=>.20+.06*(Math.cos(t*Math.PI*2)**12),metal,{...pillar,maxRadius:.26});
    S.ball([a,1.67,.06],[.27,.11,.27],metal,pillar);
    S.torus([a,1.47,.06],.235,.027,bronze,pillar);
    S.torus([a,.23,.06],.244,.023,metal,pillar);
    S.bake();

    const x=-.53,z=.55, self={res:.035,objectId:'keeper'};
    const dark={r:[0,1,18,19]};
    for(const sign of [-1,1]) {
      line([[x+sign*.18,.75,z],[x+sign*.21,.21,z+.037]],.104,dark,self);
      S.ball([x+sign*.212,.125,z+.112],[.123,.1,.172],dark,self);
    }
    S.lathe([x,.41,z],1.05,t=>.33+.145*(1-t)**1.51,coat,{...self,maxRadius:.48});
    S.ball([x,1.28,z],[.34,.261,.23],coat,self);
    S.ball([x-.04,1.74,z],[.327,.34,.263],hem,self);
    S.ball([x-.049,1.72,z+.238],[.209,.236,.115],skin,{...self,surfaceId:'face'});
    S.ball([x-.202,1.68,z+.308],[.067,.051,.063],skin,self);
    box([x-.123,1.765,z+.339],[.042,.012,.01],dark,{...self,res:.019});
    line([[x-.287,1.41,z+.093],[x-.117,1.345,z+.222],[x+.215,1.404,z+.166]],.052,hem,self);
    line([[x-.215,1.23,z],[x-.425,1.11,z+.08],[x-.52,1.37,z+.275]],.081,coat,self);
    S.ball([x-.53,1.379,z+.274],[.083,.069,.076],skin,self);
    S.bake();

    const lantern={res:.023,objectId:'lantern'}, lx=x-.68, lz=z+.31;
    S.lathe([lx,1.007,lz],.041,[.095,.084],bronze,lantern);
    S.lathe([lx,1.217,lz],.038,[.096,.068],bronze,lantern);
    S.ball([lx,1.126,lz],[.066,.099,.072],glass,lantern);
    line([[lx-.073,1.243,lz],[lx-.062,1.35,lz],[lx+.041,1.36,lz],[lx+.069,1.246,lz]],.015,bronze,lantern);
    S.bake();

    const darks=[
      {select:{material:'watchcoat'},colors:['#251927','#3c2742','#503449'],range:[.12,.39]},
      {select:{material:'iron-post'},colors:['#101b22','#14252e','#233741'],range:[.12,.39]}
    ];
    return B.finish({
      cam:{target:[-.16,1.00,-.31],dist:4.5,yaw:.095,pitch:.11,sway:0},radius:10,dither:0,
      skyEnvironment:{defaults:{zenith:'#354457',horizon:'#87999d',ground:'#405554',sunStrength:0}},
      look:{splatCoverage:'continuous',effectPalettes:{darks}},
      shadowReadability:{
        subjects:[{id:'Watchcoat',select:{material:'watchcoat'}},{id:'Mooring post',select:{material:'iron-post'}}],
        states:[{id:'Shared swatch',look:{effectPalettes:false}},{id:'Reserved ramps'}]
      }
    });
  }
});
