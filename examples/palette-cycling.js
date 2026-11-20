module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'palette-cycling',
  name: 'Fernfall',
  seed: 29,
  build(seed, { cycle = true } = {}) {
    const palette = [
      0x111f2a, 0x172934, 0x22333d, 0x33454b, 0x495452, 0x66655a, 0x8b7962, 0xb19a78,
      0x142f2b, 0x1d4436, 0x2c5c43, 0x3f7550, 0x598c5b, 0x79a26b, 0xa8b875,
      0x123244, 0x174354, 0x205666, 0x2e6c77, 0x3b8287, 0x529b96, 0x70aea2, 0x96c4ae,
      0xadd3bb, 0xcbe3c8, 0xe7ebce, 0xfaf0ce,
      0x285b68, 0x35717b, 0x46858a, 0x5c9994, 0x80b2a3, 0x5c9994, 0x46858a,
      0x6e4c42, 0xa5714d, 0xd39a5d, 0xf9d58d
    ];
    const roles = {
      sheet: [21, 22, 23, 24, 25, 26, 24, 23],
      shadowFlow: [27, 28, 29, 30, 31, 32, 33],
      splash: [20, 21, 22, 24, 25, 26, 23, 22],
      pool: [16, 17, 18, 19, 20, 21, 20, 18]
    };
    // Equal RGB swatches occupy different phases, so each slot in a cycle is distinct.
    for (const [name, ramp] of Object.entries(roles)) {
      const used = new Set();
      roles[name] = ramp.map(slot => {
        if (used.has(slot)) return palette.push(palette[slot]) - 1;
        used.add(slot);
        return slot;
      });
    }
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: K.V.norm([-.63, .74, .28]), amb: .19, sunK: .74, sky: .21, shLen: 0 });

    const stone = { r: [1, 2, 3, 4, 5, 6] };
    const cliff = { r: [1, 2, 3, 4, 6, 7] };
    const wetRock = { r: [0, 1, 2, 3, 4] };
    const moss = { r: [8, 9, 10, 11, 12, 13] };
    const brush = { r: [9, 10, 11, 12, 13, 14] };
    const box = (at, half, mat, res = .11, rd = .07) => S.box(at, half, mat, { res, rd });
    const rock = (at, half, mat, res = .13) => S.rock(at, half, mat, { res });
    const tile = (width, height, size, paint) => ({
      width, height, size,
      slots: Array.from({ length: width * height }, (_, i) => paint((i % width + .5) / width, (Math.floor(i / width) + .5) / height))
    });
    const indexed = (projection, raster, loops) => ({
      type: 'projected', pattern: 'indexed', projection, raster,
      cycles: cycle ? Object.fromEntries(loops.map(([role, period, phase = 0]) =>
        [role, { role, period, direction: 'reverse', phase }])) : {}
    });
    const turn = (n, length) => ((n % length) + length) % length;
    const swatch = (role, step) => roles[role][turn(Math.floor(step), roles[role].length)];

    // Long banks and fractured ledges lead from the shaded foreground up to the spring.
    box([0,-.31,.28], [4.18,.24,3.3], wetRock, .17, .14);
    box([-.17,1.05,-1.14], [3.28,1.07,1.33], wetRock, .16, .19);
    box([-.53,3.09,-2.89], [2.85,1.0,1.04], stone, .16, .21);
    const walls = [
      [-2.69,.52,.87,.97,.83,.90],[-2.41,1.34,.19,1.03,.81,.92],
      [-2.65,2.25,-.71,1.05,.70,.88],[-2.62,3.12,-1.51,.90,.78,.68],
      [-2.13,3.81,-2.06,.92,.58,.73],[-3.42,1.22,.01,.64,1.22,.92],
      [-3.39,2.97,-1.28,.68,.62,.78],[-2.98,4.10,-2.49,.71,.57,.73],
      [1.05,3.35,-2.23,.77,.91,.69],[1.96,3.67,-2.57,.77,.66,.71],
      [2.69,2.82,-1.86,.94,.82,.85],[1.98,2.08,-1.26,.92,.75,1.00],
      [2.81,1.25,-.08,1.04,.84,.99],[3.33,.66,1.10,.78,.72,.88],
      [1.87,.43,.87,.52,.57,.52],[-1.49,.25,1.4,.53,.36,.49],
      [-3.32,.22,2.6,.75,.45,.78],[3.52,.28,2.65,.69,.49,.73],
      [-2.81,.03,3.08,.92,.20,.46],[2.93,.07,3.06,1.02,.26,.44]
    ];
    for (const [i,[x,y,z,rx,ry,rz]] of walls.entries()) {
      rock([x,y,z],[rx,ry,rz],y>2.6?cliff:stone);
      if (i%3!==2) rock([x-.10,y+ry*.19,z+rz*.64],[rx*.67,ry*.22,rz*.36],i%3===0?wetRock:stone,.108);
      if (i%4!==2) rock([x-.04,y+ry*.84,z+rz*.05],[rx*.70,ry*.22,rz*.71],moss,.10);
    }
    for (const [x,y,z,scale] of [
      [-3.36,1.52,1.11,1.06],[-2.34,2.75,-.20,.95],[-2.07,4.23,-1.97,.76],
      [1.64,4.11,-2.25,.86],[2.61,3.52,-1.54,.89],[3.44,1.13,1.39,1.0], [2.05,.92,1.19,.67],
      [-2.96,.50,2.89,1.14],[3.08,.58,2.97,1.10]
    ]) {
      const root=[x,y,z];
      for (let i=0;i<5;i++) {
        const angle=i*1.31+x*.7, dx=Math.cos(angle), dz=Math.sin(angle);
        const tip=[x+dx*scale*.45,y+scale*(.30+(i%2)*.11),z+dz*scale*.45];
        const hinge=[x+dx*scale*.24,y+scale*.48,z+dz*scale*.24];
        S.tube([root,hinge,tip],.026,.010,brush,{res:.047});
        for (let j=1;j<=4;j++) {
          const t=j/5, reach=(1-t*.7)*scale*.18;
          const mid=hinge.map((n,k)=>n+(tip[k]-n)*t);
          for (const sign of [-1,1]) {
            const leaf=[mid[0]+dz*reach*sign,mid[1]-.025,mid[2]-dx*reach*sign];
            S.tube([mid,leaf],.034,.01,i%3===0?brush:moss,{res:.044});
          }
        }
      }
    }

    // Staggered threads share the fall's direction and leave broad, quiet shadow between highlights.
    const threads = [
      [.074,.019,4,.8], [.14,.031,2,.1], [.216,.015,9,.6], [.29,.055,3,.8],
      [.388,.033,8,.2], [.445,.018,1,.4], [.510,.075,11,.7], [.622,.022,4,.2],
      [.681,.038,7,.6], [.763,.051,2,.4], [.849,.015,4,.9], [.901,.031,8,.3]
    ];
    function paintSheet(u,v) {
      const undulation=.022*Math.sin(v*6.9)+.016*Math.sin(v*14+u*5);
      const center=u+undulation + (u-.5)*.19*v*v;
      for (const [x,width,offset,sway] of threads) {
        const centerline=x+.023*Math.sin(v*(6+sway*4)+offset);
        const spread=width*(.62+.38*Math.sin((v*sway*3+offset)*Math.PI)**2);
        const side=(center-centerline)/spread;
        if (Math.abs(side)>1) continue;
        const role = offset%3===1 || (Math.abs(side)>.60 && v>.12) ? 'shadowFlow' : 'sheet';
        const travel=40*(Math.sqrt(.18+v)-Math.sqrt(.18));
        return swatch(role, travel+offset+side*side*(.7+v*1.8));
      }
      if (v<.09 && Math.sin(u*38)+Math.sin(u*86)>.32) return 22;
      if (center>.28 && center<.78 && Math.sin(center*23)>-.21) return v>.69?20:21;
      return center>.13 && center<.9?18:17;
    }
    function fall({x,z,top,bottom,width,lean,phases,split=false}) {
      const height=top-bottom;
      const flute=(u,v)=>.037*Math.sin(u*16+v*4)+.028*Math.cos(u*6-v*6);
      function crossSection(v) {
        const shift=lean*v*v+.046*Math.sin(v*5);
        const half=width*(1-.14*Math.sin(v*Math.PI)+.21*v**5);
        const face=z+.24*(1-Math.exp(-v*13))+.28*v**5;
        return [x+shift,half,face];
      }
      const material=K.surface.material({r:[16,17,18,19]}, {layers:{flow:indexed(
        p=>{
          const v=(top-p[1])/height;
          const [center,half]=crossSection(v);
          return [(p[0]-center)/(2*half)+.5,v];
        },
        tile(112,134,[1,1],paintSheet),
        [['sheet',.6,phases],['shadowFlow',.75,phases+.2]]
      )}});
      const center=[x,(top+bottom)*.5,z+.22];
      S.add({
        bc:center,br:Math.hypot(width*1.36,height*.5,.65),
        sd(px,py,pz) {
          const v=K.clamp((top-py)/height);
          const [cx,half,face]=crossSection(v);
          const u=(px-cx)/half;
          const sheet=Math.max(Math.abs(px-cx)-half,Math.abs(pz-face-flute(u,v))-.061, bottom-py,py-top);
          // The rock at the foot of the lower run divides its last few ribbons.
          return split?Math.max(sheet,.093-Math.abs(px-(x+width*.52))-(1-v)*.78):sheet;
        },
        sample(emit) {
          for (let y=bottom;y<=top;y+=this.res*.83) {
            const v=(top-y)/height;
            const [cx,half,face]=crossSection(v);
            for (let u=-1;u<=1;u+=this.res/half) {
              const flutedFace=face+flute(u,v);
              emit(cx+half*u,y,flutedFace+.061);
              emit(cx+half*u,y,flutedFace-.061);
            }
          }
        }
      },material,{res:.061,tag:top>3?'upper-fall':'lower-fall'});
      const lip=K.surface.material({r:[18,19,20,21]}, {layers:{crest:indexed(
        {origin:[x-width,top,z-.48]},tile(104,24,[2*width,.67],(u,v)=>{
          if (Math.sin(u*44)+.64*Math.sin(u*91)<-.62) return 19;
          return swatch('sheet',v*6+Math.floor(u*14)*2+phases*8);
        }),[['sheet',.6,phases]]
      )}});
      box([x,top-.033,z-.225],[width,.039,.281],lip,.063,.038);
    }
    fall({x:-.79,z:-1.86,top:4.23,bottom:2.22,width:.70,lean:-.11,phases:.34});
    fall({x:.05,z:-.10,top:2.28,bottom:.10,width:1.25,lean:.15,phases:0,split:true});

    const terrace=K.surface.material({r:[17,18,19,20]}, {layers:{water:indexed(
      {origin:[-1.51,2.2,-1.75]},tile(112,45,[2.94,1.75],(u,v)=>{
        const weave=Math.sin(u*46+v*3)+Math.sin(u*17-v*7);
        return weave>.44?swatch('shadowFlow',v*18+u*3):null;
      }),[['shadowFlow',.75,.44]]
    )}});
    box([-.03,2.171,-.89],[1.45,.073,.91],terrace,.083,.065);

    // Pool marks become thinner, shorter and darker as they leave the impact zone.
    const pool = K.surface.material({r:[15,16,17]}, {layers:{
      reflection:indexed({origin:[-3.37,0,.32]},tile(168,100,[6.74,3.0],(u,v)=>{
        const x=(u-.53)*2, dist=Math.hypot(x*1.27,(v+.07)*1.04);
        const reflectionWidth=.28-.16*v+.065*Math.sin(v*34);
        const reflected=Math.abs(x+.07*Math.sin(v*23))<reflectionWidth;
        if (reflected && Math.sin(v*134+Math.sin(u*32)*.7)>.0)
          return swatch('pool',v*33+(u<.53?1:3));
        const edge=Math.sin(dist*44+Math.sin(u*35)*.5);
        if (edge>.74 && Math.sin(u*65+v*17)>-.15 && v<.87) return swatch('pool',dist*18+u*3);
        return reflected && v<.57?17:15;
      }),[['pool',2,.2]]),
      breaker:indexed({origin:[-1.86,0,.22]},tile(138,58,[3.79,1.21],(u,v)=>{
        const x=(u-.52)*2;
        const reach=.65+.10*Math.sin(x*15)+.09*Math.cos(x*32);
        if ((x/.92)**2+(v/reach)**2>1) return null;
        const turbulence=Math.sin(u*103+v*18)+.55*Math.cos(u*57-v*43);
        if (turbulence<-.43+v*1.22) return null;
        const curl=v*19+3*Math.sin(u*17+v*2)+2*Math.sin(u*34-v*6);
        return swatch('splash',curl);
      }),[['splash',1.2,.18]])
    }});
    S.ball([0,-.053,1.71],[3.39,.082,1.79],pool,{res:.079});

    for (const [x,y,z,s] of [[1.07,.23,.53,.25],[-1.39,.22,.65,.32],[-2.19,.08,2.14,.33],[2.42,.12,2.15,.37]])
      rock([x,y,z],[s,s*.66,s*.77],wetRock,.087);
    for (const [x,z,r] of [[-1.84,2.23,.14],[-1.57,2.56,.16],[1.36,2.28,.13],[2.10,2.56,.18]]) {
      S.ball([x,.035,z],[r,.024,r*.86],brush,{res:.045});
      S.ball([x+r*.31,.064,z],[.054,.035,.050],{r:[34,35,36,37]},{res:.039});
    }
    S.bake();
    return B.finish({
      cam:{target:[0,2.05,.10],dist:11.65,yaw:.17,pitch:.36,ortho:true,sway:0},
      radius:11,detail:26,dither:0,paletteRoles:roles,look:{splatCoverage:'continuous'},
      atmosphere:[
        K.atmosphere.sphere({at:[.08,.22,.59],radius:.51,color:'#9cbfb0',density:.28}),
        K.atmosphere.sphere({at:[-.82,2.35,-1.24],radius:.49,color:'#a7c1b6',density:.22})
      ]
    });
  }
});
