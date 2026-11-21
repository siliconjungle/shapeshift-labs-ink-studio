module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'courier-shot-lighting',
  name: 'The night courier',
  seed: 24,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101827, 0x263246, 0x344358, 0x4b5b6c, 0x617178, 0x7b8791,
      0x282633, 0x463341, 0x663f4c, 0x8f5260, 0xaa6267, 0xbe7973,
      0x553949, 0x785062, 0x9c686d, 0xc68979, 0xe6ae8b,
      0x3d323a, 0x644940, 0x97754f, 0xb49159, 0xe6b770,
      0x286474, 0x5c90a1, 0xb3d2bd, 0xfbd396, 0xffffdb
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { keepRenderSdf: true, sun: K.V.norm([-.66,.85,.18]), amb:.32, sky:.13, sunK:.39, wob:.01 });
    const stone = { r:[1,2,3,4,5], materialId:'slate' }, edge = { r:[0,1,2,3], materialId:'slate' };
    const hood = { r:[6,7,8,9,10], materialId:'cloak' }, cloth = { r:[6,7,8,9], materialId:'cloak' };
    const scarf = { r:[8,9,10,11,15], materialId:'scarf' }, skin = { r:[12,13,14,15,16], materialId:'skin' };
    const leather = { r:[1,6,7,17,18], materialId:'leather' };
    const brass = { r:[17,18,19,20,21], materialId:'brass' };
    const glow = { r:[21,24,25,26], em:true, materialId:'flame' };
    const blue = { r:[2,22,23,24], materialId:'enamel' };
    const wall = { objectId:'wall', res:.066 }, floor = { objectId:'floor', res:.09 };
    const actor = { objectId:'courier', res:.032 }, lamp = { objectId:'lantern', res:.024 };
    const box = (at, half, material, item, rd = .025) => S.box(at, half, material, { ...item, rd });
    const tube = (points, radius, material, item) => S.tube(points, radius, radius, material, item);

    box([0,-.19,.45],[3.8,.19,2.5],edge,floor,.06);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 10; i++) {
      const x = (i - 4.5) * .74 + .19 * (j % 2), z = 2.03 - .58 * j;
      box([x,-.027+.017*Math.sin(1.4*i+j),z],[.354,.033,.275],(i+j)%3?stone:edge,floor,.044);
    }
    for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
      const x = (i - 5.5) * .62 + .31 * (j % 2);
      if (x < -1.9 && j > 1 && j < 7) continue;
      const z = -.72 + .042 * Math.sin(i * 3.7 + j * 2.2);
      box([x,.14+.285*j,z],[.298,.129,.14],(i+2*j)%5?stone:edge,wall,.027);
    }
    for (const x of [-1.79,1.63]) {
      box([x,1.25,-.45],[.075,1.29,.056],edge,wall);
      box([x,.205,-.41],[.115,.073,.08],stone,wall);
    }
    for(let i=0;i<5;i++) box([1.62,1.01+i*.113,-.350],[.415,.027,.060],edge,wall,.011);
    box([1.62,1.24,-.405],[.44,.365,.047],blue,wall,.023);
    for (let i=0;i<4;i++) box([1.62,1.038+i*.126,-.348],[.40,.020,.018],edge,wall,.006);
    S.bake();

    for (const side of [-1,1]) {
      const x=-.33+side*.16;
      tube([[x,.85,.29],[x+side*.05,.45,.34],[x+side*.07,.12,.39]],.131,leather,actor);
      S.ball([x+side*.064,.105,.485],[.131,.105,.217],leather,actor);
    }
    S.lathe([-.32,.45,.20],.99,t => .30 + .14*(1-t)**1.55,cloth,{...actor,maxRadius:.44});
    S.ball([-.32,1.20,.17],[.39,.31,.235],hood,actor);
    tube([[-.58,1.24,.18],[-.755,.98,.35],[-.77,.74,.45]],.107,cloth,actor);
    S.ball([-.774,.71,.452],[.107,.126,.09],leather,actor);
    tube([[-.045,1.22,.27],[.21,1.05,.48],[.48,1.40,.56]],.103,hood,actor);
    S.ball([.485,1.423,.562],[.115,.09,.10],leather,actor);
    S.ball([-.295,1.7,.232],[.319,.365,.258],hood,{...actor,surfaceId:'courier-hood'});
    S.ball([-.264,1.702,.405],[.236,.258,.189],skin,{...actor,surfaceId:'courier-face'});
    S.ball([-.156,1.669,.555],[.069,.064,.074],skin,{...actor,surfaceId:'courier-face'});
    for (const x of [-.322,-.13]) {
      box([x,1.755,.557],[.052,.015,.019],leather,actor,.009);
      box([x+.012,1.74,.572],[.011,.014,.009],blue,actor,.003);
    }
    tube([[-.563,1.442,.374],[-.329,1.367,.525],[-.036,1.447,.385]],.092,scarf,actor);
    tube([[-.519,1.407,.389],[-.694,1.365,.322],[-.881,1.448,.191]],.059,scarf,actor);
    box([-.279,1.009,.481],[.091,.078,.039],brass,actor,.017);
    tube([[-.504,1.227,.316],[-.199,.943,.423],[.003,.695,.297]],.028,leather,actor);
    S.bake();

    const at = (y,z = .715) => [.576,y,z];
    S.lathe(at(1.105),.059,[.147,.137],brass,lamp);
    S.lathe(at(1.164),.252,[.121,.107],blue,lamp);
    S.ball(at(1.284,.734),[.107,.134,.106],glow,lamp);
    S.lathe(at(1.404),.055,[.152,.107],brass,lamp);
    tube([at(1.44,.715),at(1.518,.690),at(1.522,.634),at(1.455,.617)],.022,brass,lamp);
    for (const sign of [-1,1]) {
      tube([[.576 + sign*.128,1.153,.723],[.576 + sign*.128,1.424,.723]],.017,brass,lamp);
    }
    S.bake();

    return B.finish({
      cam:{target:[.12,1.18,.05],dist:4.35,yaw:.08,pitch:.11,ortho:true,sway:0},
      radius:6, dither:0,
      skyEnvironment:{defaults:{zenith:'#182642',horizon:'#435875',ground:'#23313e',sunStrength:0}},
      look:{splatCoverage:'continuous'}
    });
  }
});
