/* A small sluice diver for testing a branched procedural rig. */
function sluiceDiverScene({ KIT: K, makeBuilder, makeSculpt }) {
  const spine=['head','collar','rib','abdomen','tail-base','tail-mid','tail-tip'];
  const fins=[['collar','crest-root','crest-mid','crest-tip'],['rib','keel-root','keel-mid','keel-tip']];
  const paths=[spine,...fins];
  const rest={
    head:[-1.9,.18,.14],collar:[-2.36,.12,.14],rib:[-2.79,.16,.14],abdomen:[-3.23,.12,.14],
    'tail-base':[-3.64,.04,.14],'tail-mid':[-4.03,-.04,.14],'tail-tip':[-4.35,-.10,.14],
    'crest-root':[-2.49,.45,.14],'crest-mid':[-2.69,.73,.14],'crest-tip':[-3.00,.79,.14],
    'keel-root':[-2.86,-.17,.14],'keel-mid':[-3.06,-.46,.14],'keel-tip':[-3.38,-.52,.14]
  };
  const wheels=[
    { x:-.03,y:.97,r:.54 },
    { x:.47,y:-.72,r:.59 }
  ];
  const route=[
    [0,-1.9,.18],[.7,-1.45,.39],[1.45,-.87,.13],[2.12,-.37,.05],[2.72,.34,.14],
    [3.38,1.1,.35],[4.12,2.36,.48],[4.86,3.05,.19],[5.25,3.05,.19]
  ];
  function driveHead(time) {
    const i=route.findIndex(row=>row[0]>time);
    if (i<0) return [route.at(-1)[1],route.at(-1)[2],.14];
    const [start,x,y]=route[i-1], [end,toX,toY]=route[i];
    const f=K.anim.ease((time-start)/(end-start),'smooth');
    return [x+(toX-x)*f,y+(toY-y)*f,.14];
  }
  const palette=[0x0a1520,0x152936,0x21404c,0x345762,0x4c6f71,0x6d9390,
    0x122c33,0x22575c,0x3a8b85,0x65bca7,0xa4ebc0,0xe1f4bc,
    0x62404a,0x94594d,0xd38a55,0xffcb77,0xffe4a4,0xd0f6da];
  function build(seed=42) {
    const B=makeBuilder(seed,palette);
    const S=K.sculpt(makeSculpt(B));
    const V=K.V;
    S.sun=V.norm([-.42,.65,.64]);
    S.amb=.52; S.sunK=.61;
    const stone={r:[1,2,3,4]}, trim={r:[2,3,4,5]}, dark={r:[0,1,2]};
    S.box([0,-.18,-1.38],[4.76,1.72,.14],dark,{res:.105,rd:.14});
    for(let row=0;row<7;row++) for(let col=-5;col<=5;col++){
      const x=col*.865+row%2*.42;
      if(Math.abs(x)>4.53)continue;
      S.box([x,-1.63+row*.47,-1.178],[.418,.221,.042],
        {r:(row*7+col*13)%4===0?[1,2,3]:[0,1,2,3]},{res:.09,rd:.023});
    }
    for(const y of [-1.88,1.83]) {
      S.box([0,y,-.48],[4.78,.12,.56],stone,{res:.089,rd:.035});
      for(const x of [-3.91,-2.6,-1.3,0,1.3,2.6,3.91])
        S.box([x,y+.011,.065],[.032,.058,.035],trim,{res:.035});
    }
    for(const x of [-4.40,4.40]){
      S.box([x,.02,-.95],[.21,1.56,.22],stone,{res:.082,rd:.038});
      S.box([x,.81,-.692],[.078,.21,.042],{r:[13,14,15],em:true},{res:.051,rd:.02});
    }
    for(const { x,y,r } of wheels){
      S.tube([[x,y,-.97],[x,y,.44]],r,r,stone,{res:.068});
      S.tube([[x,y,.432],[x,y,.469]],r*.91,r*.91,trim,{res:.061});
      S.tube([[x,y,.466],[x,y,.494]],r*.74,r*.74,stone,{res:.061});
      S.tube([[x,y,.492],[x,y,.519]],r*.24,r*.24,trim,{res:.058});
      for(let j=0;j<6;j++){
        const a=j*Math.PI/3;
        S.ball([x+r*.83*Math.cos(a),y+r*.83*Math.sin(a),.50],.055,{r:[2,4,5]},{res:.036});
      }
    }
    S.bake();

    let colliders=true, rig;
    function field(x,y) {
      const wall=Math.min(y+1.78,1.72-y);
      return colliders ? Math.min(wall,...wheels.map(w=>Math.hypot(x-w.x,y-w.y)-w.r)) : wall;
    }
    const joints=Object.fromEntries(Object.entries(rest).map(([id,at])=>[id,{
      at, radius: id==='head'?.22 : id==='collar'?.195 : id==='rib'?.17 : id==='abdomen'?.125 : .061,
      mass:id==='head'?1.2:id.includes('tip')?.45:.85
    }]));
    Object.assign(joints.head,{ drive:driveHead,compliance:.000013 });
    Object.assign(joints['crest-tip'],{ compliance:.0036,drive:t=>{
      const [x,y,z]=rig.point('collar');
      return [x-.60,y+.56+.18*Math.sin(t*4.8),z];
    } });
    Object.assign(joints['keel-tip'],{ compliance:.0036,drive:t=>{
      const [x,y,z]=rig.point('rib');
      return [x-.54,y-.53+.14*Math.cos(t*5.2),z];
    } });
    rig=K.proceduralBody.create({
      joints,
      links:paths.flatMap(path=>path.slice(1).map((to,i)=>({from:path[i],to}))),
      bends:paths.flatMap((path,j)=>path.slice(2).map((_,i)=>({
        through:path.slice(i,i+3),compliance:j?.0011:.000085
      }))),
      sdf:field,gravity:[0,-.65,0],damping:4.8,friction:.07,contactTolerance:.027
    });

    const C=K.curveSplats, art=[];
    const bind=(id,path,settings)=>art.push(C.bind(B,{kind:'path',id,points:path.map(joint=>rest[joint])},
      rig.curve(path),{object:'diver',material:id,edge:'hard',caps:'blunt',profileSamples:36,...settings}));
    bind('spine',spine,{width:{samples:[.20,.38,.36,.29,.18,.115,.051]},color:'#65bca7',
      lighting:{preset:'metal-wire',highlightColor:'#a4ebc0'},
      along:{pigment:{keys:[[0,'#286967'],[.34,'#4b9d89'],[.70,'#56a697'],[1,'#c6e3b1']]}}});
    bind('crest',fins[0],{width:{samples:[.105,.15,.106,.034]},color:'#e2a46b',
      lighting:'matte-thread',along:{pigment:{keys:[[0,'#468f7e'],[.46,'#bc885d'],[1,'#ffce83']]}}});
    bind('keel',fins[1],{width:{samples:[.11,.12,.073,.033]},color:'#9be0b3',
      lighting:'glossy-hair'});

    const groups=[];
    function part(from,to,at,buildPart){
      const first=B.count(), att=rig.attachment(from,to,{at,up:[0,0,1]});
      buildPart(att.frame().point);
      S.bake();
      groups.push({att,ids:Array.from({length:B.count()-first},(_,i)=>first+i)});
    }
    const moss={r:[6,7,8,9,10]}, enamel={r:[7,8,9,10,11]}, brass={r:[12,13,14,15]},
      wick={r:[15,16,17],em:true}, pupil={r:[0,6]};
    const plus=(p,x,y,z)=>V.add(p,[x,y,z]);
    part('collar','head',1,p=>{
      S.ball(plus(p,.013,.005,0),[.247,.205,.174],moss,{res:.047});
      S.ball(plus(p,.177,-.015,.01),[.109,.095,.105],enamel,{res:.041});
      S.ball(plus(p,-.07,.118,.084),[.162,.080,.111],brass,{res:.044});
      S.ball(plus(p,.04,.047,.179),[.077,.076,.040],brass,{res:.034});
      S.ball(plus(p,.054,.049,.207),[.050,.052,.019],pupil,{res:.029});
      S.ball(plus(p,.062,.057,.223),[.027,.032,.017],wick,{res:.021});
    });
    for(const [i,id] of spine.slice(1,5).entries())part(spine[i+2],id,1,p=>{
      const size=.184-i*.024;
      S.ball(p,[size*.69,size,size*.92],i===0?brass:enamel,{res:.042});
      S.ball(plus(p,-.01,.063-i*.007,size*.8),[.047-i*.006,.037-i*.004,.023],
        {r:i===0?[15,16]:[10,11],em:true},{res:.025});
    });
    for(const [i,path] of fins.entries())part(path[2],path[3],1,p=>{
      S.ball(p,[.078,.040,.052],i?enamel:brass,{res:.034});
      S.ball(plus(p,-.024,.009,.033),.032,i?{r:[9,10,11],em:true}:wick,{res:.024});
    });

    const cam={target:[0,.02,0],yaw:0,pitch:0,dist:8.55};
    const world=B.finish({cam,radius:6,dither:0,look:{pixelSize:1},
      fog:{c:0,start:1,max:0},liveSun:{shadows:false,direction:[-.46,.61,.64],ambient:.57,intensity:.92}});
    const matrices=new Float32Array(groups.length*12);
    const ids=groups.flatMap(({ids})=>ids), bid=groups.flatMap(({ids},i)=>ids.map(()=>i));
    K.bones.bind(world,{ids,bid,M:matrices,curveBindings:art,pose(_time,dt){
      rig.step(dt);
      groups.forEach(({att},i)=>matrices.set(att.matrix(),i*12));
    }});
    world.anim.stateful=true;
    world.anim.update(0,0);
    world.diver={
      rig,paths,duration:route.at(-1)[0],
      target(point) { rig.target('head',point); },
      setContacts(on) { colliders=on; },
      reset() { rig.reset(); world.anim.update(0,0); }
    };
    return world;
  }
  return {id:'sluice-diver',name:'Sluice Diver',seed:42,build};
}
if (typeof module !== 'undefined') module.exports=sluiceDiverScene;
