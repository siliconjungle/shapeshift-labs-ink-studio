module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'caused-marks',
  name:'The tide gate',
  seed:212,
  build(seed) {
    const B=makeBuilder(seed,[
      0x456376,0x293b43,0x526169,0x778079,0x999889,0xb7ab98,0xd5c4a8,0xe5d5b9,
      0x454841,0x5c5349,0x705047,0x83594c,0x93775e,0xb79a7a,0xd5b891,0xeacda9,
      0x485747,0x56674c,0x6e7b54,0x8d9662,0xadb47b,0x6a7f73,
      0x1f3940,0x315b5c,0x4e7772,0x72968c,0x503d35,0x795743,0xa67b54,0xebbf75,0xffde94
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.63,.69,.59]);
    S.amb=.42;
    S.sky=.19;
    S.pixel=true;
    const cut={r:[2,3,4,5],materialId:'cut-stone'};
    const plaster={r:[4,5,6,7],materialId:'plaster'};
    const paving={r:[3,4,5,6],materialId:'paving'};
    const timber={r:[26,27,28],materialId:'wood'};
    const teal={r:[22,23,24,25],materialId:'tile'};
    const iron={r:[1,2,3]};
    S.rock([0,-1.02,-.65],[5.05,1.15,3.35],cut,{res:.17});
    S.box([0,-.25,-.32],[4.96,.26,3.05],cut,{res:.115,rd:.12});
    for (let row=0;row<8;row++) for (let col=0;col<13;col++) {
      const x=(col-6)*.724+(row%2?.10:0),z=(row-3.5)*.641+.2;
      S.box([x,.034,z],[.35,.06,.31],paving,{res:.065,rd:.028,objectId:'quay'});
    }
    S.box([-2.43,1.44,-.54],[2.03,1.36,.50],plaster,{res:.066,rd:.07,objectId:'wash-wall'});
    S.box([2.25,1.44,-.54],[1.97,1.36,.50],plaster,{res:.066,rd:.07,objectId:'covered-wall'});
    for (const x of [-4.37,4.16]) {
      for(let row=0;row<6;row++) S.box([x,.285+row*.45,-.36],[.191,.219,.43],cut,{res:.066,rd:.046});
    }

    // The sill ends at different depths and heights. Its geometry supplies every drip origin.
    for (const [x,y,z,w,d] of [
      [-3.89,2.79,-.32,.44,.81],[-3.00,2.80,-.31,.453,.70],[-2.06,2.77,-.30,.482,.81],[-1.10,2.78,-.28,.492,.69]
    ]) S.box([x,y,z],[w,.115,d],cut,{res:.055,rd:.052,objectId:'sill'});
    for (let col=0;col<7;col++) {
      const x=-4.24+col*.59;
      S.box([x,.26,-.04],[.283,.09,.095],cut,{res:.072,rd:.032,objectId:'wash-wall'});
    }

    // A recessed turn gate divides the exposed and sheltered bays.
    S.box([-.06,1.14,-.33],[.43,1.10,.258],timber,{res:.054,rd:.042,objectId:'gate'});
    for (let i=0;i<7;i++) S.box([-.43+i*.122,1.15,-.031],[.053,1.075,.035],timber,
      {res:.050,rd:.009,objectId:'gate'});
    for (const x of [-.56,.45]) {
      S.box([x,1.20,-.04],[.12,1.173,.16],cut,{res:.053,rd:.04,objectId:'gate-jamb'});
      S.box([x,.16,.035],[.18,.16,.15],cut,{res:.055,rd:.046});
    }
    S.box([-.05,2.39,-.12],[.68,.142,.242],cut,{res:.056,rd:.033});
    S.box([-.05,.14,.31],[.66,.07,.27],cut,{res:.047,rd:.025,objectId:'threshold'});
    S.lathe([.19,1.26,.053],.071,.049,iron,{res:.027});
    S.torus([.19,1.30,.105],.072,.016,iron,{res:.034,ax:S.AZ});

    // Deep green roof shelters the adjoining plaster bays.
    S.box([2.27,2.89,-.02],[2.08,.13,1.24],timber,{res:.075,rd:.04});
    for(let row=0;row<7;row++) for(let col=0;col<11;col++){
      const x=.40+col*.372,y=3.028+row*.061,z=1.12-row*.369;
      S.box([x,y,z],[.176,.048,.22],teal,{res:.065,rd:.032});
    }
    for (const x of [.63,3.91]) {
      S.tube([[x,2.17,.048],[x,2.83,1.06]],.073,.073,timber,{res:.057});
    }
    const lamp={r:[29,30],em:true};
    S.tube([[-.28,2.26,.1],[-.28,2.32,.34],[-.28,2.14,.39]],.026,.026,iron,{res:.036});
    S.ball([-.28,2.05,.39],[.106,.139,.108],lamp,{res:.043,ghost:true});
    S.lathe([-.28,1.905,.39],.064,[.11,.128],iron,{res:.037});
    S.lathe([-.28,2.17,.39],.093,[.13,.017],iron,{res:.046});
    for (const [x,z] of [[-4.51,1.7],[4.42,1.86]]) {
      S.box([x,.16,z],[.184,.14,.18],cut,{res:.055,rd:.035});
      S.lathe([x,.25,z],.75,[.095,.084],teal,{res:.048});
      S.ball([x,1.02,z],.104,{r:[28,29]},{res:.043});
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.24,-.16],dist:13.8,yaw:.21,pitch:.31,sway:0},
      detail:23,radius:17,dither:0,look:{pixel:true},
      skyEnvironment:{defaults:{zenith:'#456681',horizon:'#d3cdb1',ground:'#779598',sunStrength:0}}
    });
  }
});
