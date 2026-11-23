/* A rotating indexed signal receiver above a splat-built canal station. */
module.exports = ({ KIT: K, SceneMeshes = K.sceneMeshes, SpriteSurface, makeBuilder, makeSculpt }) => {
  const id = 'native-textured-mesh', seed = 75;
  const palette = [0x172339,0x253853,0x38516a,0x536e7d,0x7d9c9c,0xb6c6ad,
    0x42384c,0x71545c,0xaf7063,0xe59b6c,0xf4c484,0xffe4ac,
    0x173c48,0x1c5960,0x347f79,0x66afa0,0x9edcc4,0xdcf4cd,
    0x563730,0x885941,0xc18654,0xe2b472,0xc3b6b4,0x4c4273,0x685b87];
  const cyan={r:[12,13,14,15,16]}, basalt={r:[1,2,3,4,5]}, brass={r:[18,19,20,21,11]};
  const hex = (color, alpha = 255) => [color >> 16, color >> 8 & 255, color & 255, alpha];
  const texture = (width, height, paint) => {
    const pixels = new Uint8Array(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) pixels.set(paint(x,y),4*(y*width+x));
    return {width,height,pixels};
  };
  function receiver() {
    const positions=[], uvs=[], indices=[], faceMaterials=[];
    function quad(corners, material) {
      const at=positions.length/3;
      positions.push(...corners.flat());
      uvs.push(0,0,1,0,0,1,1,1);
      indices.push(at,at+1,at+2,at+2,at+1,at+3);
      faceMaterials.push(material,material);
    }
    const x=1.05,y=.68,z=.34, top=1.94, bottom=top-y*2;
    quad([[-x,top,z],[x,top,z],[-x,bottom,z],[x,bottom,z]],1);
    quad([[x,top,-z],[-x,top,-z],[x,bottom,-z],[-x,bottom,-z]],0);
    quad([[-x,top,-z],[x,top,-z],[-x,top,z],[x,top,z]],0);
    quad([[-x,bottom,z],[x,bottom,z],[-x,bottom,-z],[x,bottom,-z]],0);
    quad([[x,top,z],[x,top,-z],[x,bottom,z],[x,bottom,-z]],0);
    quad([[-x,top,-z],[-x,top,z],[-x,bottom,-z],[-x,bottom,z]],0);
    quad([[-.55,top+.27,.07],[.69,top+.27,.07],[-.55,top+.006,.07],[.69,top+.006,.07]],2);
    const bronze = texture(32,20,(u,v)=>{
      const frame = u<2 || u>29 || v<2 || v>17;
      if (frame) return hex(u===0||v===0 ? 0xf0ba79 : 0x865c51);
      if (v%4===0) return hex(0x583b49);
      return hex((u+v*3)%17<4 ? 0xc18654 : 0xaf7063);
    });
    const panel = texture(64,40,(u,v)=>{
      const border=u<4||u>=60||v<4||v>=36;
      if (border) {
        const yellow = v<4 || u<3;
        return hex((u+2*v)%14<4 ? 0xffe4ac : yellow ? 0xc18654 : 0x885941);
      }
      if (v>=28) {
        if (v===28 || v===35) return hex(0x38516a);
        return hex(u%8<4 && u>=12 && u<52 ? 0xe59b6c : 0x253853);
      }
      if (u<7 || u>56 || v<7 || v>25) return hex(0x347f79);
      const scan = Math.round(4*Math.sin(u*.31)+2*Math.sin(u*.74))+16;
      if (v===scan) return hex(0xdcf4cd);
      if (Math.abs(scan-v)===1) return hex(0x66afa0);
      if (u%8===0 || v%6===0) return hex(0x1c5960);
      return hex(0x173c48);
    });
    const normals = texture(64,40,(u,v)=>[v<4||v>=28 ? 128+(u%7<3?-45:38) : 128,
      u<4||u>=60 ? 181 : 128, 248, 255]).pixels;
    const grille = texture(36,9,(u,v)=>{
      if (v===0 || v===8 || u%6<2 || u>=34)
        return hex(v===0 ? 0xf4c484 : 0xe59b6c);
      return hex(0,0);
    });
    const mesh=SceneMeshes.create({id:'tidal-receiver',positions,uvs,indices,faceMaterials,materials:[
      {id:'ribbed-bronze',texture:bronze},
      {id:'signal-glass',texture:panel,normal:normals},
      {id:'aerial-grille',texture:grille}
    ]});
    return {mesh,positions};
  }

  function build(value) {
    const B=makeBuilder(value,palette), S=K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.6,.75,.55]),amb:.4,sky:.19,sunK:.68});
    S.box([0,-.27,0],[3,.22,1.82],basalt,{rd:.18,res:.17,objectId:'quay'});
    S.box([0,.003,0],[2.91,.075,1.70],cyan,{rd:.14,res:.13,objectId:'quay'});
    for(let i=-5;i<=5;i++) {
      S.box([i*.49,.103,.96],[.229,.036,.52],basalt,{rd:.035,res:.125,objectId:'quay-stones'});
      S.box([i*.49,.103,-1.03],[.23,.036,.39],basalt,{rd:.04,res:.125,objectId:'quay-stones'});
    }
    S.box([0,.21,0],[1.16,.22,.62],basalt,{rd:.13,res:.1,objectId:'receiver-cradle'});
    S.box([0,.42,0],[.70,.13,.51],brass,{rd:.115,res:.09,objectId:'receiver-cradle'});
    for(const x of [-1.98,1.98]) {
      S.box([x,.33,-.11],[.27,.29,.29],cyan,{rd:.075,res:.1,objectId:'cable-pedestal'});
      S.ball([x,.66,-.11],[.13,.19,.13],brass,{res:.066,objectId:'cable-insulator'});
      S.ball([x,.86,-.11],[.076,.07,.079],{r:[11],em:true},{res:.046});
    }
    S.bake();
    for(const [k,tone] of ['#f4c484','#66afa0','#af7063'].entries()) {
      const z=.63+k*.12, y=.22+k*.055;
      K.curveSplats.draw(B,{kind:'path',id:'canal-feed-'+k,points:[
        [-1.97,.51,-.04],[-1.83,y,z],[-1.32,y+.12,z+.26],[-.76,y+.14,z+.19],
        [.38,y+.04,z+.20],[1.21,y+.1,z+.22],[1.78,y+.01,z],[1.97,.51,-.04]
      ]},{object:'feed-lines',material:'insulated-wire',width:.033+k*.009,edge:'hard',color:tone,lighting:'metal-wire'});
    }
    const sign=SpriteSurface.make(40);
    sign.face([1.40,.76,-.70],[.94,0,0],[0,.52,0],40,22,(u,v)=>{
      if (v===0||u===0||u===39||v===21) return 0xe2b472;
      if (v===2||v===19) return 0x347f79;
      const arrow=u>=22&&v>=6&&v<=16&&(u<30&&v>=10&&v<=12||u>=28&&u<=35-Math.abs(v-11));
      const bars=u>=4&&u<=18&&u%4<2&&v>=5+(u%3)&&v<=16;
      return arrow ? 0xf4c484 : bars ? 0x9edcc4 : 0x173c48;
    },{id:'canal-marker',materialId:'enamel-sign'});
    const {mesh,positions}=receiver();
    const world=B.finish({id,meshes:[mesh],spriteSurfaces:sign.finish(),
      cam:{target:[0,.96,0],dist:6.65,yaw:.35,pitch:.28,ortho:true},
      look:{pixelSize:1},radius:4.8,dither:0,
      areaLights:[{id:'inspection-lamp',shape:'disk',at:[-1.75,2.35,1.65],normal:[.32,-.40,-.85],
        size:[.28,.28],color:'#ffd1a1',intensity:8,radius:5,sampleGrid:1,visible:false,shadows:false}]});
    const posed=Float32Array.from(positions), stage=K.stage(world);
    stage.add({pre(_dt,t){
      const turn=.64*Math.sin(1.4*t), c=Math.cos(turn), s=Math.sin(turn);
      for(let i=0;i<positions.length;i+=3) {
        posed[i]=positions[i]*c+positions[i+2]*s;
        posed[i+2]=positions[i+2]*c-positions[i]*s;
      }
      SceneMeshes.pose(mesh,posed);
      world.cam.yaw=.35-.12*Math.sin(1.4*t);
    }});
    return world;
  }

  return {id,seed,name:'Aster canal receiver',build};
};
