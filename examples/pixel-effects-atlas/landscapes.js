/* Water, plants, masonry and materials. */
module.exports = function landscapes(D) {
  const {size,width,height,tau,clamp,mix,smooth,wrap,rgb,hex,alpha,band,hash,noise,texture,pixel,draw,layer,
    circle,rect,poly,line,ribbon,curve,halo,sky,plate,rasterSimulation:S}=D;

  const pool = pixel((x,y)=>{
    const wave=texture(x*.073,y*.115,77), d=Math.hypot((x-93)*.74,(y-60)*.92);
    return band([0x0e1826,0x18233a,0x25314b,0x2f4658,0x466071],.18+.39*wave+.15*smooth(100,25,d));
  });
  const beds=[[15,12,1.23],[57,2,1.08],[112,22,1.28],[156,9,1.40],[191,37,.91],
    [10,69,1.24],[64,55,1.52],[147,63,.82],[174,99,1.26],[31,117,1.54],[108,99,1.88],
    [67,136,1.06],[144,132,1.02],[-4,109,.84],[109,64,.53],[37,81,.55]];
  const bloomShadows=[0x461c43,0x68234d,0x8c3265,0xb94375,0xd3629a,0xe78bb0,0xffbabe];
  const bloomLight=[0xbf4e9a,0xde5ca3,0xf189b3,0xfca6c2,0xffc2cf,0xffe4d2];
  function lotuses(u) {
    const phase=u*tau,waves=[],leaves=[],petals=[];
    for(let i=0;i<97;i++){
      const a=hash(i,3,8)*width,b=hash(i,9,3)*height;
      const x=a+3*Math.sin(phase+i),y=b+1.8*Math.cos(phase+i*.43),w=2+9*hash(i,15);
      waves.push(line([[x,y],[x+w*.42,y-.6],[x+w,y]],alpha(i%5===0?0x70b5b0:0x435976,.15+.43*hash(i,6)),1));
    }
    for(const [i,[x0,y0,scale]] of beds.entries()){
      const x=x0+1.25*Math.sin(phase+i),y=y0+.85*Math.cos(phase+i*.7);
      for(let j=0;j<4;j++){
        const a=i+j*2.23+.095*Math.sin(phase+j),r=(7+4*hash(i,j))*scale;
        const cx=x+Math.cos(a)*r*1.7,cy=y+Math.sin(a)*r*1.3;
        const contour=curve(18,t=>[cx+Math.cos(a+.37+t*(tau-.74))*r,cy+Math.sin(a+.37+t*(tau-.74))*r*.67]);
        leaves.push(poly([[cx+2,cy],...contour],band([0x17424a,0x1b5c56,0x277763,0x4b916d],hash(i,3+j))));
        leaves.push(line(contour.slice(9,18),0x5ba881));
        for(let k=2;k<17;k+=4)leaves.push(line([[cx,cy],[mix(cx,contour[k][0],.8),mix(cy,contour[k][1],.82)]],0x32806c));
      }
      petals.push(circle(x+1,y+4,12*scale,0x081c25,7*scale));
      for(let j=19;j>=0;j--){
        const a=j*D.sampling.phyllotaxis.goldenAngle+i*.71+.085*Math.sin(phase+j*.31);
        const reach=(3.8+.64*j)*scale*(.93+.065*Math.sin(phase+i+j*.6)),w=(2.3+j*.075)*scale;
        const dx=Math.cos(a),dy=Math.sin(a),ox=-dy*w,oy=dx*w*.66;
        const tip=[x+dx*reach,y+dy*reach*.75-1.4*scale];
        const points=[[x,y],[x+.48*dx*reach+ox,y+.32*dy*reach+oy],
          [mix(x,tip[0],.80)+.57*ox,mix(y,tip[1],.77)+.52*oy],tip,
          [mix(x,tip[0],.87)-.49*ox,mix(y,tip[1],.84)-.55*oy],
          [x+.61*dx*reach-ox,y+.40*dy*reach-oy]];
        const face=.36-dy*.16+(hash(i,j)*.36),mid=[x+.48*dx*reach,y+.37*dy*reach],step=points[1];
        petals.push(poly(points,band(bloomShadows,face)));
        petals.push(poly([mid,[mix(step[0],tip[0],.35),mix(step[1],tip[1],.35)],tip],band(bloomLight,face+.18)));
        if(j%3!==0)petals.push(line([[mix(x,tip[0],.69),mix(y,tip[1],.69)],tip],band(bloomLight,.48+hash(j,9,i)*.44)));
      }
      petals.push(circle(x,y,3.8*scale,0x783548,3*scale),circle(x-.5,y-1,2.9*scale,0xed944f,2.2*scale));
      for(let j=0;j<6;j++){const a=j*2.399+phase*.31;
        petals.push(circle(x+Math.cos(a)*2.1*scale,y+Math.sin(a)*1.6*scale,.55*scale,j%2?0xffdf82:0xf6b459));}
    }
    return layer(pool,draw(waves),draw(leaves),draw(petals));
  }

  const tunnelX=100,tunnelY=62;
  const bevelShade=(x,y)=>smooth(46,8,Math.hypot(x*.85,y-14));
  const wetMasonry = pixel((x,y)=>{
    if(y>109)return band([0x0b1a23,0x102936,0x15394a,0x225d62],.20+.38*texture(x*.04,y*.16,2));
    const dx=x-tunnelX,dy=(y-tunnelY)*.98,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
    const inside=d<40;
    const row=Math.floor(y/9),u=wrap(x+row%2*10,20),v=y%9;
    const joint=Math.min(u,20-u,v,9-v);
    const ring=d>38&&d<52,rib=Math.min(wrap(a*15/tau,1),1-wrap(a*15/tau,1));
    const glow=smooth(95,25,Math.hypot((x-90)*.72,(y-79)*1.2));
    const m=texture(x*.11,y*.17,93),salt=hash(Math.floor(x),Math.floor(y),17);
    if(inside){
      const blade=Math.abs(wrap(x-4,13)-6.5), lit=glow*.41+.22*bevelShade(dx,dy);
      if(blade<2.8)return band([0x161225,0x302335,0x48404f,0x726668,0x969284],.19+lit+.28*smooth(2.8,0,blade)+m*.14);
      return band([0x080b13,0x101222,0x1b1e2f,0x293543],.21+.29*(d/40)**3+.24*m);
    }
    if(!ring&&joint<.85||ring&&rib<.052)return 0x09121a;
    const bevel=ring?smooth(38,46,d)*smooth(53,46,d):smooth(.5,4,joint)*.57;
    const growth=texture(x*.14+7,y*.085,22)*.85+.22*glow;
    const moss=growth>.57||(ring&&dy>0&&growth>.45);
    if(ring && d<42)return band([0x4e583b,0x737b48,0x9f9f68,0xd2c990,0xe0dbb5],.24+.28*glow+.18*m+.15*Math.cos(a+.65));
    return band(moss?[0x212a22,0x39462a,0x526134,0x748343,0x9d9f52,0xc5b96b]:
      [0x111524,0x22243a,0x33374d,0x4b4e64,0x626781],.12+.27*m+.25*bevel+.27*glow+.13*salt);
  });
  const sewerDrops=Array.from({length:36},(_,i)=>{
    const x=70+57*hash(i,8,3),y=tunnelY-Math.sqrt(39**2-(x-tunnelX)**2)*1.01;
    return {x,y,phase:hash(i,3,5),duration:1+Math.floor(hash(i,8,9)*3),size:1+2*hash(i,4,8)};
  });
  function sewer(u) {
    const phase=u*tau,water=draw(Array.from({length:100},(_,i)=>{
      const x=hash(i,4,11)*width,y=111+hash(i,5,4)*32,dx=6+15*hash(i,8,4);
      const k=.3+.7*Math.sin(phase*2+y*.28+i)**2;
      return line([[x+Math.sin(phase+i)*2,y],[x+dx,y-.42]],alpha(i%5===0?0x9ee88e:0x358386,k*.61));
    }));
    const streams=[],glimmer=[];
    for(let i=0;i<17;i++){
      const x=53+i*5.9,y=101+3*Math.sin(x*.32),length=2+16*hash(i,13);
      if(i%3===1)continue;
      streams.push(poly([[x-2,y],[x+2.8,y-1],[x+1,y+length],[x-.3,y+length]],i%2===0?0x677944:0x445737));
    }
    for(const [i,q] of sewerDrops.entries()){
      const a=wrap(u*q.duration+q.phase,1),y=q.y+(111-q.y)*a*a;
      const x=q.x+.66*Math.sin(a*9+i),tail=q.size*(1+6*a);
      streams.push(line([[q.x,q.y],[x,y]],alpha(0x89924c,i%4===0?.71:.27),i%4===0?2:1));
      glimmer.push(line([[x,y-tail],[x,y]],alpha(i%4===0?0xe9e4a0:0x9dc277,.3+.6*a)));
      if(a>.88)glimmer.push(circle(x,112,1+16*(a-.88),alpha(0xd5eca5,1-(a-.88)/.12),1));
    }
    const drops=draw(glimmer);
    return layer(wetMasonry,water,draw(streams),halo(drops,0x68a943,5,.83),drops);
  }

  const seabed = pixel((x,y)=>{
    const d=Math.hypot(x-96,y-72);
    if(d>58)return band([0x070e1d,0x101727,0x18263c],.26+.26*texture(x*.05,y*.05,4));
    const z=y/144, contours=Math.sin(x*.058+y*.08)*6+8*Math.sin(x*.139)*Math.sin(y*.102);
    const shelf=y>96+contours;
    const v=.18+(.65-z*.35)*texture(x*.068,y*.092,1);
    const lightShelf=texture(x*.043+2,y*.057-3,49);
    return band(shelf?[0x102c54,0x164472,0x1c5a8a,0x27789d]:
      [0x161939,0x1f2955,0x213b77,0x235398,0x2675ac,0x35b3dc],v+.22*lightShelf);
  });
  function underwater(u) {
    const phase=u*tau,coral=[],fish=[];
    for(let i=0;i<28;i++){
      const x=37+118*hash(i,0,4),y=109+19*hash(i,7,3),h=9+33*hash(i,12,1);
      if(Math.hypot(x-96,y-72)>57)continue;
      const a=.76*Math.sin(phase+i*1.862),c=i%4===0?0x457b8c:0x194d68;
      const path=curve(11,t=>[x+6*Math.sin(a+t*2.2)*t,y-h*t]);
      coral.push(ribbon(path,path.map((_,j)=>Math.max(1,(12-j)*.24)),c));
      for(let j=5;j<11;j+=2){
        const q=path[j],sg=j%4===1?-1:1;
        coral.push(line([q,[q[0]+sg*(3+j*.8),q[1]-3-j*.36]],j%3===0?0x4a8c96:c,j%3===0?2:1));
      }
    }
    for(let i=0;i<14;i++){
      const x=96+35*Math.sin(phase+i*.19)+i*.42,y=58+i*.8+6*Math.sin(phase*2+i*.45),sg=Math.cos(phase+i*.19)>0?1:-1;
      if(Math.hypot(x-96,y-72)>56)continue;
      fish.push(poly([[x-3*sg,y],[x,y-1.5],[x+2.7*sg,y],[x,y+1.3]],i%3?0x72c0cc:0xbdedc9));
      fish.push(line([[x-2*sg,y],[x-4*sg,y-1.5]],0x4b889d));
    }
    const submerged=pixel((x,y)=>{
      const d=Math.hypot(x-96,y-72);
      if(d>56)return;
      const sx=x+.9*Math.sin(y*.15+phase)*2,sy=y+2.6*Math.cos(x*.11-phase);
      const flow=texture(sx*.041+Math.cos(phase)*.54,sy*.047+Math.sin(phase)*.36,43);
      const cells=texture(sx*.083+Math.cos(-phase)*1.1,sy*.065+Math.sin(-phase)*.59,8);
      const edge=Math.abs(.62-cells*.60-flow*.73);
      if(flow>.62)return [...rgb(band([0x235b9b,0x258fce,0x45bddc,0x65e5f1],smooth(.62,.86,flow))),
        Math.round(106+105*smooth(.62,.87,flow))];
      if(edge<.032&&flow>.36)return [...rgb(0x63dbef),Math.round(smooth(.032,0,edge)*138)];
    });
    const light=pixel((x,y)=>{
      const d=Math.hypot(x-96,y-72);
      if(d>60&&d<62)return 0x224461;
      if(d>57&&d<60)return band([0x275b9b,0x239aca,0x55d5e4,0xc2eff3,0xe9fafb],smooth(125,24,y)*.92);
      if(d>=57||y<22)return;
      const r=Math.sin(x*.219+Math.sin(y*.088+phase)*1.4+phase*2)+.49*Math.cos(y*.24+Math.cos(x*.12-phase)*.8);
      if(Math.abs(r)<.078&&y>75)return [...rgb(0x75d8cd),Math.floor(110*smooth(116,90,y))];
      const col=texture(x*.074+Math.cos(phase)*.48,y*.04+Math.sin(phase)*.32,10),beam=smooth(.57,.77,col)*smooth(106,36,y);
      if(beam>.035)return [...rgb(0x72dded),Math.round(114*beam)];
    });
    return layer(seabed,draw(coral),submerged,draw(fish),light);
  }

  const letters=[
    ['111','010','010','010','111'],
    ['1001','1101','1011','1001','1001'],
    ['1001','1010','1100','1010','1001']
  ];
  let mpm;
  function material(u) {
    if(!mpm){
      const bodies=letters.map((rows,index)=>{
        const points=[],scale=8.4, left=[33,63,106][index], top=26-index*3;
        rows.forEach((row,y)=>[...row].forEach((v,x)=>{
          if(v==='1')for(let j=0;j<5;j++)for(let i=0;i<5;i++)
            points.push([left+scale*(x+(i+.5)/5),top+scale*(y+(j+.5)/5)]);
        }));
        return {points,material:index,spacing:1.5,release:.17+.12*index,velocity:[(index-1)*21,-2]};
      });
      mpm=S.session(S.define('mpm',{...size,cell:2.35,substeps:5,maxSpeed:156,gravity:[0,137],
        materials:[{type:'elastic',color:'#f0a97d',stiffness:420},{type:'fluid',color:'#509dda',stiffness:330},
          {type:'elastic',color:'#9bddb1',stiffness:230}],
        walls:[[17,118,158,7],[17,107,3,12],[173,107,3,12]],bodies},{seed:93,dt:1/48}),{every:12,cache:16});
    }
    const state=mpm.seek(u*2.65);
    const back=draw([
      rect(14,17,164,103,0x0b1425),rect(17,117,158,1,0x6f8fa8),rect(17,118,158,8,0x23364b),
      rect(17,126,158,1,0x131c2c),rect(17,107,3,10,0x243b50),rect(173,107,3,10,0x243b50),
      ...Array.from({length:19},(_,i)=>line([[23+i*8,116],[23+i*8,111-i%2*4]],0x1c394c)),
      ...Array.from({length:11},(_,i)=>line([[20,25+i*8],[171,25+i*8]],0x142136))
    ]);
    return layer(plate({colors:[0x0e111e,0x121620,0x1a1b2b],pattern:'slate',fade:.35}),back,state.value);
  }

  const bambooBack=plate({colors:[0x101926,0x182335,0x1d3040,0x253c48,0x344b55],
    pattern:'tiles',size:36,center:[105,63],seed:18,fade:.6});
  function bamboo(u) {
    const phase=u*tau,commands=[],mist=[];
    const grove=[
      {x:36,z:.24,h:77},{x:156,z:.29,h:91},{x:54,z:.43,h:91},{x:122,z:.54,h:99},
      {x:74,z:.94,h:119},{x:95,z:1,h:123},{x:116,z:.82,h:101}
    ];
    for(const [i,{x,z,h}] of grove.entries()){
      const bend=(4+z*9)*Math.sin(phase-i*.49)+10*(hash(i,11,12)-.5);
      const base=137+(i%3)*5,p=curve(30,t=>[x+bend*t*t,base-h*t]);
      const colors=z>.75?[0x183d32,0x32724d,0x5b9e59,0x83b46a,0xbcd48b]:
        [0x142733,0x24474b,0x37655a,0x4b8065,0x6b9c77];
      const w=3.2+8.1*z;
      commands.push(ribbon(p,p.map((_,j)=>w*(1-.65*j/30)),colors[0]));
      commands.push(line(p.map(([x,y],j)=>[x-w*.10*(1-j/31),y]),colors[1],w*.65));
      commands.push(line(p.map(([x,y],j)=>[x-w*.22*(1-j/32),y]),colors[2],Math.max(1,w*.22)));
      for(let j=3;j<30;j+=4){
        const [px,py]=p[j],sg=(i+j)%3===0?1:i%2===0?-1:1,reach=10+23*z;
        const ringWidth=w*.45*(1-.63*j/30);
        commands.push(line([[px-ringWidth,py-1],[px+ringWidth,py+1]],colors[0],2.65));
        commands.push(line([[px-ringWidth,py-1.2],[px+.50*ringWidth,py-.4]],colors[3],1.65));
        if(j<9&&i%2===0)continue;
        const angle=-.56+hash(i,j,88)*.62;
        const branch=curve(9,l=>[px+sg*reach*l*(1.20-.2*l),py+reach*(l*angle-.25*l*l)]);
        commands.push(line(branch,colors[1],z>.7?2:1.3));
        const tip=branch.at(-1);
        for(let l=2;l<10;l++){
          const [cx,cy]=branch[l],k=l/9;
          const len=(8+19*z)*(1.16-.49*k),spread=3.1*z+1.0;
          const tilt=(l%2===0?-1:1)*(3.2+.30*l)+2.2*Math.sin(phase*2+i+l*.7);
          const p1=[cx+sg*len*.40,cy+tilt*.41-spread],p2=[cx+sg*len,cy+tilt];
          commands.push(poly([[cx,cy],p1,p2,[cx+sg*len*.32,cy+tilt*.68+spread]],
            band(colors,.31+.54*hash(i,l+j*13,40))));
          if(z>.65&&l%2===0)commands.push(line([[cx,cy],p1,[mix(p1[0],p2[0],.62),mix(p1[1],p2[1],.62)]],colors[3],1.25));
        }
        if(tip[1]<36&&z>.7)commands.push(circle(tip[0],tip[1],.8,colors[4]));
      }
      const q=wrap(u+hash(i,8,6),1),y=43+q*82;
      mist.push(line([[x+8*Math.sin(q*5+i),y],[x+3+9*Math.sin(q*5+i),y+.8]],alpha(colors[4],.48*Math.sin(q*Math.PI))));
    }
    const ground=draw([poly([[0,133],[28,126],[78,132],[115,124],[159,132],[192,121],[192,144],[0,144]],0x132431)]);
    return layer(bambooBack,ground,draw(commands),draw(mist));
  }

  return {lotuses,sewer,underwater,material,bamboo};
};
