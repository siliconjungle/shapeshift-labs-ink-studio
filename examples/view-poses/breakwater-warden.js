/* An orbitable, contact-locked lantern staff pose. */
function breakwaterWarden({KIT:K,makeBuilder,makeSculpt}) {
  const {V}=K;
  const shoulderL=[-.421,1.583,.025], elbowL=[-.577,1.228,.062], wristL=[-.32,1.114,.394];
  const shoulderR=[.421,1.583,.025], elbowR=[.619,1.310,.181], wristR=[.335,1.510,.406];
  const gripL=[-.254,1.119,.467], gripR=[.271,1.501,.475];
  const staffPivot=V.lerp(gripL,gripR,.5);
  const footL=[-.293,.014,.062], footR=[.33,.014,-.102];
  const asset={
    format:'ink-studio/view-poses',version:1,anchor:'chest',
    chains:{
      'left grip':{upper:'upper-L',lower:'lower-L',wrist:'hand-L',point:gripL,grip:'staff'},
      'right grip':{upper:'upper-R',lower:'lower-R',wrist:'hand-R',point:gripR,grip:'staff'}
    },
    locks:{
      'left foot':{part:'boot-L',point:footL},
      'right foot':{part:'boot-R',point:footR}
    },
    sectors:[
      {id:'Port',yaw:-42,width:150,elbows:{'left grip':57,'right grip':-37},
        props:{staff:{move:[.105,.10,.080],rotation:[-7,-9,-11]}}},
      {id:'Starboard',yaw:54,width:150,elbows:{'left grip':-33,'right grip':53},
        props:{staff:{move:[-.082,.047,.063],rotation:[6,10,7]}}}
    ]
  };
  const palette=[
    0x101921,0x1d2a36,0x293c46,0x3a5057,0x4e6569,0x768f85,0x9aae95,
    0x152b37,0x1e4651,0x2b6a73,0x469799,0x76c7b1,0xb5e9cc,
    0x432e38,0x6b4648,0x965744,0xba6d46,0xd79050,0xf6b869,0xffd58a,0xffedb6,
    0x28233b,0x463851,0x72526a,0x9a706e,0xbf9382,0xe1ba9c,
    0x245465,0x397b92,0x4ca8b1,0x93e4d8,0xefffd6
  ];
  function build(seed=63,{controls}={}) {
    const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), tags=K.deform.tags(S);
    Object.assign(S,{sun:V.norm([-.56,.75,.54]),amb:.51,sky:.19,sunK:.59,wob:.02});
    const steel={r:[0,1,2,3,4,5]}, teal={r:[7,8,9,10,11,12]}, gold={r:[13,15,16,17,18,19,20]};
    const copper={r:[13,14,15,16,17]}, indigo={r:[0,21,22,23,24]}, stone={r:[1,2,3,4,5]},
      cloth={r:[21,22,23,24,25]}, skin={r:[22,23,24,25,26]},
      lantern={r:[17,18,19,20,31],em:true}, cool={r:[27,28,29,30,31],em:true};
    if (controls?.boundaryShot) for (const [material,name] of [[steel,'steel'],[teal,'enamel'],[gold,'brass'],
      [copper,'copper'],[indigo,'indigo'],[stone,'stone'],[cloth,'cloth'],[skin,'skin'],[lantern,'lantern'],[cool,'visor']])
      material.materialId=name;
    const box=(p,h,mat,tag,res=.047,rd=.05)=>S.box(p,h,mat,{tag,objectId:tag,res,rd});
    const ball=(p,r,mat,tag,res=.047)=>S.ball(p,r,mat,{tag,objectId:tag,res});
    const tube=(p,r,mat,tag,res=.047)=>S.tube(p,r,r,mat,{tag,objectId:tag,res});
    const turn=(p,h,r,mat,tag,res=.052)=>S.lathe(p,h,r,mat,{tag,objectId:tag,res});
    turn([0,-.222,0],.223,[1.18,1.18,1.105,1.105],stone,null,.072);
    turn([0,-.161,0],.027,[1.192,1.192],copper,null,.064);
    turn([0,-.016,0],.016,[1.094,1.094],steel,null,.073);
    for(let i=0;i<12;i++){
      const t=i*Math.PI/6,x=.992*Math.sin(t),z=.992*Math.cos(t);
      ball([x,.008,z],i%3===0?[.041,.018,.041]:[.018,.015,.018],i%3===0?gold:stone,null,.035);
    }
    for(const [x,z,side] of [[-.293,.062,'L'],[.33,-.102,'R']]){
      const trousers='leg-'+side, boot='boot-'+side;
      tube([[x,.151,z],[x*.94,.517,z-.026],[x*.73,.971,-.035]],.137,indigo,trousers,.051);
      box([x,.507,z+.104],[.128,.133,.045],teal,trousers,.043,.045);
      box([x,.523,z+.145],[.094,.048,.014],gold,trousers,.034,.015);
      box([x,.089,z+.051],[.135,.077,.209],indigo,boot,.046,.057);
      box([x,.043,z+.059],[.144,.032,.217],steel,boot,.047,.026);
      box([x,.103,z+.196],[.123,.052,.059],copper,boot,.038,.033);
    }
    const torso='chest';
    turn([0,.799,-.023],.783,[.442,.407,.343,.356,.410,.253],teal,torso,.051);
    turn([0,1.495,0],.129,[.251,.186,.184],indigo,torso,.045);
    box([0,1.014,.250],[.366,.057,.082],copper,torso,.045,.029);
    box([0,1.013,.325],[.093,.060,.017],gold,torso,.035,.025);
    box([-.091,1.267,.274],[.153,.141,.044],indigo,torso,.041,.042);
    box([-.091,1.304,.315],[.137,.047,.019],teal,torso,.036,.023);
    for(const y of [1.11,1.25,1.40]) ball([.153,y,.298],.030,gold,torso,.030);
    tube([[.023,.872,.299],[.025,1.505,.272]],.021,cloth,torso,.039);
    box([.015,1.238,-.304],[.242,.247,.115],copper,torso,.052,.061);
    box([.051,1.397,-.418],[.104,.047,.021],teal,torso,.041,.029);

    ball([0,1.797,.019],[.229,.251,.211],skin,'head',.046);
    ball([0,1.960,-.010],[.287,.183,.253],gold,'head',.044);
    box([0,1.913,.128],[.296,.039,.194],copper,'head',.041,.033);
    box([.004,1.845,.192],[.205,.077,.062],steel,'head',.038,.048);
    box([.013,1.858,.247],[.153,.030,.018],cool,'head',.032,.019);
    box([.025,1.714,.142],[.163,.068,.081],indigo,'head',.042,.044);
    ball([-.203,1.824,.029],[.057,.078,.072],copper,'head',.038);

    for(const [side,shoulder,elbow,wrist,grip] of
      [['L',shoulderL,elbowL,wristL,gripL],['R',shoulderR,elbowR,wristR,gripR]]){
      const upper='upper-'+side,lower='lower-'+side,hand='hand-'+side;
      tube([shoulder,V.lerp(shoulder,elbow,.55),elbow],.118,teal,upper,.046);
      ball(shoulder,[.161,.143,.135],teal,upper,.044);
      ball(V.lerp(shoulder,elbow,.24),[.139,.096,.136],copper,upper,.041);
      tube([elbow,wrist],.092,cloth,lower,.044);
      ball(elbow,[.109,.101,.102],teal,lower,.039);
      tube([V.lerp(elbow,wrist,.57),V.lerp(elbow,wrist,.89)],.093,copper,lower,.041);
      ball(V.lerp(wrist,grip,.65),[.095,.072,.079],indigo,hand,.036);
      ball(V.add(grip,[0,.015,.044]),[.070,.044,.035],gold,hand,.032);
    }
    const direction=V.norm(V.sub(gripR,gripL)), along=(p,t)=>V.mad(p,direction,t);
    const tail=along(gripL,-.58), tip=along(gripR,.61);
    tube([tail,tip],.041,copper,'staff',.039);
    tube([along(tail,-.054),along(tail,.155)],.051,gold,'staff',.037);
    tube([along(gripL,-.079),along(gripL,.083)],.054,cloth,'staff',.037);
    tube([along(gripR,-.078),along(gripR,.081)],.054,cloth,'staff',.037);
    const cage=along(gripR,.43);
    tube([along(cage,-.137),along(cage,.239)],.078,gold,'staff',.039);
    ball(cage,[.102,.112,.090],lantern,'staff',.041);
    for(const z of [-.062,.062]) {
      const start=V.add(along(cage,-.118),[.022,0,z]), end=V.add(along(cage,.118),[.022,0,z]);
      tube([start,end],.020,copper,'staff',.031);
    }
    ball(along(cage,.225),[.057,.079,.060],gold,'staff',.035);
    if (controls?.relayShot) Object.assign(S,{captureAlbedo:true,keepRenderSdf:true,keepReferenceSdf:true});
    S.bake();
    if (controls?.relayShot) {
      // The copper floor and pale teal wall return color below the hard key.
      box([0,-.53,-.43],[3.75,.09,3.3],stone,'floor',.10,.03);
      box([2.26,.94,-.91],[.085,1.42,1.54],teal,'return-wall',.085,.05);
      box([0,1.00,-1.52],[2.0,1.54,.12],indigo,'back-wall',.105,.04);
      for (const x of [-1.23,-.57,.71,1.38]) {
        box([x,1.00,-1.35],[.036,1.52,.048],steel,'seams',.079,.018);
        box([x,.24,-1.28],[.12,.070,.046],teal,'mounting-plates',.045,.019);
      }
      box([-.98,.888,-.79],[.16,.49,.12],copper,'signal-box',.046,.06);
      box([-.98,1.00,-.653],[.11,.16,.016],indigo,'signal-box',.035,.026);
      box([-.98,1.07,-.631],[.085,.014,.009],cool,'signal-display',.022,.011);
      box([.94,1.88,-1.25],[.53,.08,.08],steel,'wall-rail',.064,.032);
      S.bake();
    }
    const world=B.finish({cam:{target:[0,.98,0],yaw:-42*Math.PI/180,pitch:.14,dist:4.65,ortho:true,sway:0},
      radius:4,detail:24,dither:0,look:{splatCoverage:'continuous'}});
    const parts={
      chest:{pivot:[0,1.185,0]},head:{pivot:[0,1.611,0],parent:'chest'},
      'upper-L':{pivot:shoulderL,parent:'chest'},'lower-L':{pivot:elbowL,parent:'upper-L'},'hand-L':{pivot:wristL,parent:'lower-L'},
      'upper-R':{pivot:shoulderR,parent:'chest'},'lower-R':{pivot:elbowR,parent:'upper-R'},'hand-R':{pivot:wristR,parent:'lower-R'},
      'leg-L':{pivot:[-.216,.96,0]},'leg-R':{pivot:[.216,.96,0]},
      'boot-L':{pivot:footL,parent:'leg-L'},'boot-R':{pivot:footR,parent:'leg-R'},staff:{pivot:staffPivot}
    };
    for(const [id,part] of Object.entries(parts)) part.ids=tags[id];
    const puppet=K.puppet(world,{parts,viewPoses:controls?.corrections!==false&&asset,
      pose(time,_dt,actor) { actor.pose.head={rot:[0,3*Math.sin(time*1.3),1.5*Math.sin(time*.9)]}; }});
    world.anim.update(0,0);
    world.warden={puppet,asset:structuredClone(asset)};
    if (controls?.relayShot) {
      world.cam={...world.cam,target:[0,1.08,.04],dist:3.36,yaw:-.29,pitch:.073};
      world.look={...world.look,sdfAssist:{posed:true}};
      world.liveSun={direction:V.norm([-.88,.43,.29]),ambient:.40,intensity:.69,
        shadows:true,mapSize:512,bias:.018,filter:0};
    }
    return world;
  }
  return {id:'breakwater-warden',name:'Breakwater Warden',seed:63,build};
}
if(typeof module!=='undefined') module.exports=breakwaterWarden;
