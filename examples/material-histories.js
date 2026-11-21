module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'material-histories',
  name:'Salt Stair',
  seed:54,
  build(seed) {
    const B=makeBuilder(seed,[
      0x304655,0x313d48,0x4d5559,0x72746e,0x979186,0xb4a99a,0xd9c5aa,
      0x313f3a,0x365d58,0x54847a,0x79a293,0x47332d,0x734d3b,0xa77455,0xd5a273,
      0x5b4150,0x884d46,0xb87a60,0xcfa56e,0xe5ca91,0xffdf9a,0xffedbc
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.captureAlbedo=true;
    S.sun=K.V.norm([-.65,.72,.51]);
    S.amb=.34;
    S.sky=.17;
    const quarry={r:[2,3,4,5,6],albedo:'#ada391',materialId:'quarry-limestone'};
    const stone=K.surface.material(quarry,{
      signals:{
        cycles:{type:'weather',channel:'wetCycles',range:[0,3]},
        wind:{type:'weather',channel:'windExposure',range:[.6,8]},
        use:{type:'weather',channel:'abrasion',range:[.25,3]},
        deposit:{type:'weather',channel:'pigment',range:[.05,.8]}
      },
      layers:{
        tideMarks:{type:'tint',stage:'material',blend:'multiply',color:[.46,.53,.58],strength:0,
          mask:{type:'noise',scale:.28,low:.22,high:.71,seed:27},drive:{strength:{signal:'cycles',to:.69}}},
        salt:{type:'tint',stage:'material',color:'#d8c7a6',strength:0,
          mask:{type:'noise',scale:.15,low:.25,high:.82,seed:84},drive:{strength:{signal:'wind',to:.63}}},
        tread:{type:'tint',stage:'material',color:'#e8d1b2',strength:0,
          mask:{type:'noise',scale:.24,low:.12,high:.68,seed:19},drive:{strength:{signal:'use',to:.79}}},
        ochre:{type:'tint',stage:'material',color:'#a05a39',strength:0,
          mask:{type:'noise',scale:.27,low:.2,high:.72,seed:141},drive:{strength:{signal:'deposit',to:.91}}},
        film:{type:'tint',stage:'material',blend:'multiply',color:[.45,.53,.61],strength:.61,
          mask:{type:'weather',channel:'wetness',low:.035,high:.24}},
        frost:{type:'tint',stage:'material',color:'#b4d2d3',strength:.72,
          mask:{type:'weather',channel:'frost',low:.013,high:.18}},
        snow:{type:'tint',stage:'material',color:'#f0ebdd',strength:.81,
          mask:{type:'weather',channel:'snow',low:.025,high:.24}},
        polished:{type:'specular',color:'#fbd5a0',roughness:[.69,.52],strength:.04,
          drive:{roughness:{signal:'use',to:[.22,.28]},strength:{signal:'use',to:.50}}}
      }
    });
    const base={r:[1,2,3,4]}, timber={r:[11,12,13,14]}, tile={r:[7,8,9,10]}, iron={r:[1,2,3]};
    S.rock([.04,-1.02,-.26],[4.86,1.01,3.68],base,{res:.15});
    S.box([0,-.20,0],[4.49,.21,3.11],base,{res:.115,rd:.16});
    for (let row=0;row<9;row++) for (let col=0;col<13;col++) {
      const x=(col-6)*.662,z=(row-4)*.65;
      S.box([x,.019,z],[.32,.06,.313],quarry,{res:.083,rd:.035});
    }
    S.box([-1.91,.64,-1.55],[1.76,.65,1.43],base,{res:.10,rd:.10});
    for (let row=0;row<6;row++) {
      const y=.147+row*.218, z=2.18-row*.59, x=-1.91;
      S.box([x,y*.5,z-.23],[1.74,y*.5,.405],base,{res:.09,rd:.042});
      for (let col=0;col<5;col++) {
        const offset=(col-2)*.699;
        S.box([x+offset,y,z],[.342,.107,.336],stone,{res:.062,rd:.042,objectId:'stair'});
      }
    }
    for (let i=0;i<5;i++) {
      const z=-1.34-i*.32;
      S.box([-1.91,1.355,z],[1.74,.117,.151],stone,{res:.077,rd:.024,objectId:'stair'});
    }
    S.box([2.15,1.05,-1.27],[1.67,1.06,.244],base,{res:.10,rd:.05});
    for (let row=0;row<6;row++) for (let col=0;col<5;col++) {
      const x=2.15+(col-2)*.654+(row%2?.085:-.08),y=.222+row*.329;
      S.box([x,y,-.98],[.317,.154,.167],stone,{res:.057,rd:.046,objectId:'sheltered-wall'});
    }
    S.box([2.16,2.19,-1.04],[1.78,.124,.36],quarry,{res:.066,rd:.08});
    for (const x of [.48,3.85]) {
      S.box([x,.126,.73],[.2,.135,.18],base,{res:.065,rd:.05});
      S.box([x,1.32,.74],[.08,1.22,.075],timber,{res:.062,rd:.02});
      S.tube([[x,1.98,.74],[x,2.37,-.14]],.061,.061,timber,{res:.052});
    }
    S.box([2.16,2.48,.91],[1.86,.067,.063],timber,{res:.07,rd:.02});
    for (let row=0;row<8;row++) for (let col=0;col<10;col++) {
      const y=2.54+row*.057,z=.89-row*.316,x=2.16+(col-4.5)*.361;
      S.box([x,y,z],[.173,.042,.202],tile,{res:.065,rd:.028});
    }
    const marker={r:[17,18,19]}, glow={r:[20,21],em:true};
    for (const x of [-3.82,.29]) {
      S.box([x,.22,1.4],[.21,.22,.18],quarry,{res:.069,rd:.05});
      S.lathe([x,.42,1.4],.79,[.083,.078],iron,{res:.057});
      S.ball([x,1.22,1.4],.12,marker,{res:.05});
    }
    S.lathe([2.72,2.42,.65],.154,[.028,.049],iron,{res:.051});
    S.ball([2.72,2.21,.65],[.105,.15,.105],glow,{res:.049,ghost:true});
    S.lathe([2.72,2.11,.65],.080,[.113,.083],timber,{res:.050});
    S.bake();

    const roof=K.procedural.overheadCover.rasterize({
      surfaces:[{min:[.30,-1.58],max:[4.13,1.04],heightAt:()=>2.55}]
    },{spacing:.11});
    const clear={rain:0,snowfall:0,humidity:.31,airTemperature:16,windX:2.8,windZ:-.4,daylight:.85,
      surfaceAbrasion:.25,surfacePigment:.13};
    const profiles={
      clear,
      rain:{...clear,rain:.77,humidity:.95,airTemperature:7,windX:4.2,daylight:.22,surfaceAbrasion:.33,surfacePigment:.017},
      freeze:{...clear,snowfall:.15,humidity:.84,airTemperature:-8,windX:3.7,daylight:.14,surfaceAbrasion:.12,surfacePigment:.024},
      thaw:{...clear,airTemperature:20,windX:3.6,surfaceAbrasion:.45,surfacePigment:.18}
    };
    const keys=[
      [0,'clear'],[.5,'rain'],[1.75,'clear'],[4.4,'rain'],[5.55,'clear'],
      [8,'freeze'],[10.3,'thaw'],[12.1,'rain'],[13.15,'thaw']
    ].map(([at,profile])=>({at,profile,ease:'hold'}));
    return B.finish({
      cam:{target:[0,.79,-.22],dist:13.15,pitch:.45,yaw:.29,sway:0},
      radius:17,detail:23,dither:0,
      skyEnvironment:{
        defaults:{zenith:'#3e5c78',horizon:'#cfbfab',ground:'#687e82',sunStrength:0},
        profiles,sequences:{seasons:{duration:16.4,loop:false,keys}},tracks:[{id:'seasons',sequence:'seasons'}]
      },
      weatherBinding:{surface:{
        width:44,height:32,cell:.21,origin:[-4.62,-3.36],step:.10,
        capacity:.30,wetDiffusion:.003,heatDiffusion:.003,maxRunoff:.06,evaporation:1.08,exchange:2.8,
        history:{dryThreshold:.18,wetThreshold:.56,pigmentCapacity:1,wash:2.1,windLoss:.12,abrasionLoss:1.9},
        forcing(x,z,time,state,signal) {
          const exposed=K.procedural.overheadCover.exposure(roof,[x,.12,z]);
          const path=Math.exp(-1.25*(x+1.85-.19*Math.sin(2.2*z))**2);
          const deposits=.20+.63*(1-exposed)+.19*(.5+.5*Math.cos(2.6*x+z*1.7));
          return {precipitationExposure:exposed,shelter:.92*(1-exposed),
            abrasionRate:signal.abrasionRate*path,pigmentRate:signal.pigmentRate*deposits};
        }
      }}
    });
  }
});
