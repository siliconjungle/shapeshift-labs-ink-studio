/* The lock keeper and a brass inspection machine pass at dusk. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'material-ink-rules',
  name: 'The night inspection',
  seed: 37,
  build(seed) {
    const palette = [
      0x151b2b,0x212c40,0x303c51,0x465169,0x60667a,0x82818c,
      0x182e37,0x26424a,0x3e5b5c,0x60736a,0x849083,
      0x272236,0x44304a,0x65425f,0x92596d,0xc17a7a,0xe0a087,
      0x593c4a,0x8a555e,0xb9716b,0xd58a76,0xedaa89,0xffca9e,
      0x392d3a,0x705042,0x9a694e,0xc38c56,0xe7b46d,0xffd998,0xffecb9,
      0x173b43,0x2c6464,0x618c77,0xa9c5a0,0xe5e4b8
    ];
    const B = makeBuilder(seed,palette), S = K.sculpt(makeSculpt(B));
    const light = K.V.norm([-.58,.52,.60]);
    Object.assign(S,{sun:light,amb:.38,sky:.15,sunK:.55,wob:.003});
    const stone = {r:[1,2,3,4,5],materialId:'scenery'};
    const nearStone = {r:[6,7,8,9,10],materialId:'scenery'};
    const cloak = {r:[11,12,13,14,15],materialId:'cloth'};
    const hem = {r:[12,13,14,15,16],materialId:'cloth'};
    const face = {r:[17,18,19,20,21,22],materialId:'skin'};
    const dark = {r:[0,11,12,17],materialId:'eyes'};
    const lamp = {r:[33,34,29],em:true,materialId:'lamp'};
    const box = (at,half,mat,opts) => S.box(at,half,mat,{rd:.025,...opts});
    const tube = (points,radius,mat,opts) => S.tube(points,radius,radius,mat,opts);
    for (let i=0; i<8; i++) {
      const x=-4.9+i*1.34, objectId='lock-masonry';
      box([x,.9,-3.45],[.15,1.18,.25],stone,{rd:.06,res:.08,objectId});
      for (let j=0;j<6;j++) {
        const a=j*Math.PI/5;
        box([x+.65+.64*Math.cos(a),1.95+.61*Math.sin(a),-3.45],[.19,.195,.22],stone,
          {rd:.035,res:.085,objectId,ax:[[Math.cos(a),Math.sin(a),0],[-Math.sin(a),Math.cos(a),0],[0,0,1]]});
      }
    }
    for (const y of [.09,.36,.58])
      box([0,y,-1.55],[4.3,.128,.23],nearStone,{res:.07,objectId:'lock-wall'});
    for (let i=-7;i<=7;i++) {
      const x=i*.57;
      box([x,.73,-1.53],[.265,.061,.271],nearStone,{res:.052,objectId:'lock-cap'});
      if (i%3===0) box([x,.43,-1.34],[.055,.19,.045],stone,{res:.043,objectId:'lock-brackets'});
    }
    S.bake();

    const x=-1.32, z=.38, keeper={objectId:'keeper',res:.035};
    const skin={...keeper,res:.022,surfaceId:'keeper-face'};
    S.lathe([x,.14,z],1.50,t=>.39+.24*(1-t)**1.4,cloak,{...keeper,maxRadius:.64});
    S.ball([x+.04,1.37,z],[.55,.32,.28],cloak,keeper);
    tube([[x-.41,1.36,z],[x-.46,1.02,z+.08],[x-.23,.83,z+.30]],.145,cloak,keeper);
    tube([[x+.39,1.40,z],[x+.61,1.07,z+.09],[x+.34,.94,z+.27]],.139,cloak,keeper);
    S.ball([x+.27,1.01,z+.32],[.14,.075,.08],face,{...keeper,res:.025,surfaceId:'keeper-hand'});
    S.ball([x,1.83,z],[.424,.462,.317],cloak,keeper);
    S.ball([x+.101,1.833,z+.232],[.299,.346,.193],face,skin);
    S.ball([x+.332,1.810,z+.345],[.074,.076,.066],face,skin);
    S.ball([x+.067,1.772,z+.397],[.106,.093,.046],face,skin);
    tube([[x+.158,1.919,z+.410],[x+.222,1.910,z+.412],[x+.266,1.917,z+.386]],.014,dark,{...keeper,res:.012});
    tube([[x+.160,1.946,z+.410],[x+.225,1.950,z+.408],[x+.270,1.939,z+.384]],.016,dark,{...keeper,res:.013});
    tube([[x+.241,1.731,z+.393],[x+.291,1.733,z+.380]],.011,dark,{...keeper,res:.011});
    tube([[x-.225,1.955,z+.24],[x-.191,2.08,z+.264],[x-.070,2.145,z+.264],[x+.079,2.178,z+.221]],
      .047,hem,keeper);
    tube([[x-.33,1.54,z+.09],[x-.14,1.42,z+.278],[x+.11,1.47,z+.321],[x+.34,1.55,z+.23]],.09,hem,keeper);
    tube([[x-.07,1.435,z+.30],[x+.08,1.263,z+.331],[x-.01,1.105,z+.34]],.06,hem,keeper);
    S.ball([x-.196,1.482,z+.293],[.043,.051,.03],lamp,{...keeper,res:.021});
    S.bake();

    const positions=[], uvs=[], indices=[], faceMaterials=[];
    const swatches=[0x4b3b3c,0x705042,0x9a694e,0xb68155,0xc89661,0xe7b46d,0x61484a,0x3e4a4b];
    const strips=new Uint8Array(8*4*4);
    for (let v=0;v<4;v++) for (let u=0;u<8;u++) {
      const c=swatches[u], lift=[0,0,3,-4][v];
      strips.set([(c>>16)+lift,(c>>8&255)+lift,(c&255)+lift,255],4*(v*8+u));
    }
    function facet(points,shade,mat=0) {
      const start=positions.length/3, u=(shade+.5)/8;
      positions.push(...points.flat());
      for (const point of points) uvs.push(u,Math.min(1,Math.max(0,.18+.65*(point[1]-.45)/1.9)));
      for (let i=1;i<points.length-1;i++) {
        indices.push(start,start+i,start+i+1);
        faceMaterials.push(mat);
      }
    }
    function stamped(cx,cy,cz,w,h,depth,faceShade) {
      const shape=[[-.75,1],[.68,1],[1,.54],[1,-.56],[.64,-1],[-.74,-1],[-1,-.53],[-1,.53]];
      const ring=(scale,at)=>shape.map(([x,y])=>[cx+x*w*scale,cy+y*h*scale,at]);
      const back=ring(.87,cz-depth), rim=ring(1,cz-.12), top=ring(.84,cz);
      const outer=[2,1,0,7,0,1,2,3], bevel=[5,3,2,1,1,2,3,4];
      for (let i=0;i<shape.length;i++) {
        const j=(i+1)%shape.length;
        facet([back[i],back[j],rim[j],rim[i]],outer[i]);
        facet([rim[i],rim[j],top[j],top[i]],bevel[i]);
      }
      facet(top,faceShade);
    }
    stamped(.05,1.04,.26,.53,.41,.59,2);
    stamped(.05,1.62,.22,.63,.37,.59,3);
    stamped(-.03,1.71,.302,.46,.15,.23,7);
    facet([[-.415,1.771,.318],[.286,1.771,.318],[.347,1.707,.318],[-.335,1.707,.318]],0,1);
    stamped(.49,1.06,.38,.195,.17,.27,4);
    for (let i=0;i<4;i++) stamped(-.20+i*.124,1.19,.331,.041,.067,.16,0);
    for (const sign of [-1,1]) {
      stamped(.53*sign,.75,.10,.13,.28,.35,6);
      stamped(.58*sign,.48,.30,.193,.135,.41,2);
      stamped(.56*sign,1.48,.05,.176,.233,.36,1);
    }
    stamped(.28,2.04,-.039,.051,.212,.15,2);
    stamped(.28,2.22,-.04,.113,.043,.16,5);
    const machine=K.sceneMeshes.create({id:'inspection-machine',positions,uvs,indices,faceMaterials,
      materials:[{id:'metal',texture:{width:8,height:4,pixels:strips}},{id:'lamp',color:0xa9c5a0}]});
    const world=B.finish({
      id:'material-ink-rules', meshes:[machine],
      cam:{target:[.02,1.30,-.21],dist:5.15,pitch:.04,yaw:-.055,sway:0},
      skyEnvironment:{defaults:{zenith:'#313e58',horizon:'#988a8b',ground:'#383143',sunStrength:0}},
      aerialPerspective:{start:5.1,density:.048,contrast:.21}, radius:8,dither:0,detail:25,
      look:{splatCoverage:'continuous',ink:{
        light, depthGap:.14, occlusionSilhouettes:true, boundary:{color:'#35313c',strength:.42},
        silhouette:{color:'#39303f',strength:.50}, crease:false,
        materials:{
          skin:{silhouette:{color:'#97585e',strength:.65},crease:{cosine:.42,color:'#874d57',strength:.29},
            shadowEdge:{color:'#934f5b',threshold:.41,strength:.60},
            hatch:{color:'#95525d',direction:[1,.65,0],spacing:.11,width:.22,lightRange:[.10,.37],strength:.38}},
          metal:{silhouette:{color:'#342a39',highlight:'#f1bf7d',strength:.71},
            crease:{color:'#674643',highlight:'#e9b678',cosine:.74,strength:.65},
            shadowEdge:{color:'#5a3e43',threshold:.51,minLightDelta:.13,strength:.66},
            hatch:{color:'#49363a',direction:[.72,1,.19],spacing:.124,width:.24,lightRange:[.22,.49],strength:.62}},
          cloth:{silhouette:{color:'#392739',strength:.87},crease:{cosine:.20,color:'#3b2a43',strength:.37},
            shadowEdge:{color:'#51304c',threshold:.29,strength:.43},
            hatch:{color:'#36273a',direction:[1,-.37,0],spacing:.106,width:.24,lightRange:[.23,.57],strength:.59}},
          scenery:{silhouette:{color:'#38414e',strength:.48},crease:{cosine:.27,color:'#343b49',strength:.34},
            shadowEdge:{color:'#424555',threshold:.33,strength:.33},
            hatch:{color:'#36444a',direction:[.25,1,.16],spacing:.21,width:.27,lightRange:[.15,.56],strength:.37},
            distance:{near:6,far:12}},
          eyes:{silhouette:false,boundary:false},lamp:{silhouette:false,boundary:false}
        }
      }}
    });
    const posed=Float32Array.from(positions);
    const stage=K.stage(world);
    stage.stateful=false;
    stage.add({pre(_dt,t) {
      const approach=Math.min(1,Math.max(0,t/2.4)), turn=.44-.22*approach;
      const c=Math.cos(turn), s=Math.sin(turn);
      for(let i=0;i<positions.length;i+=3) {
        posed[i]=1.07+.26*(1-approach)+positions[i]*c+positions[i+2]*s;
        posed[i+1]=positions[i+1]+.022*Math.sin(t*5.4);
        posed[i+2]=-1+1.46*approach+positions[i+2]*c-positions[i]*s;
      }
      K.sceneMeshes.pose(machine,posed);
    }});
    stage.update(0,0);
    return world;
  }
});
