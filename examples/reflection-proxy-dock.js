// Vesper Dock. Foreground water and a glass pane share the live signal's shape.
module.exports=({KIT:K,makeBuilder,makeSculpt})=>({
  id:'vesper-dock-reflections',name:'Vesper Dock',seed:30,
  build(seed){
    const B=makeBuilder(seed,[0x142131,0x1c3042,0x324650,0x435d64,0x61848b,0x92a9a0,
      0x392b35,0x5c3937,0x8f5944,0xc27e54,0xf0af61,0xffd991,0x296072,0x53999d,0x93ddd3,0xffe6b5]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{amb:.61,sky:.16,sunK:.52,sun:K.V.norm([-.65,.66,.56]),wob:.011});
    const trim={r:[1,2,3,4]}, slate={r:[1,2,3]}, granite={r:[2,3,4,5]}, bronze={r:[6,7,8,9]};
    const light={r:[10,11,15],em:true,v:.48}, aqua={r:[12,13,14],em:true,v:.48};
    function box(at,half,mat,objectId,res=.087,rest={}){
      S.box(at,half,mat,{objectId,res,rd:Math.min(...half)*.7,...rest});
    }
    box([0,-.33,-.04],[4.10,.2,2.58],slate,'dock foundation',.16);
    box([0,-.21,-.10],[4.03,.08,2.5],trim,'dock tiles',.13);
    for(const [y,z] of [[-.09,2.20],[.07,-2.17]]){
      box([0,y,z],[3.96,.075,.14],granite,'quay edge',.095);
      for(let i=0;i<6;i++)box([-3.24+i*1.28,y+.08,z+.022],[.23,.019,.045],bronze,'rail tabs',.05);
    }
    for(const x of [-3.81,-.46,.80,3.81])
      box([x,-.018,-.04],[.106,.078,2.22],granite,'basin trim',.101);
    box([.19,-.052,-.10],[.58,.104,2.10],trim,'walkway',.11);
    for(let z=-1.82;z<2;z+=.53)
      box([.16,.062,z],[.42,.014,.202],granite,'walkway tiles',.087);
    box([2.27,-.014,.67],[1.45,.103,1.39],trim,'service forecourt',.114);
    for(const x of [1.24,2.24,3.24])
      for(const z of [.49,1.29,1.91])box([x,.092,z],[.46,.017,.28],granite,'service tiles',.10);
    box([0,.05,-2.37],[3.99,.13,.15],slate,'riser',.098);
    box([0,.87,-2.48],[3.91,.70,.114],trim,'back bulkhead',.13);
    box([0,1.59,-2.45],[3.97,.075,.15],granite,'back coping',.1);
    for(const x of [-3.65,-2.64,-1.67,-.70,.68,1.64,2.60,3.58]){
      box([x,.78,-2.34],[.058,.59,.038],granite,'bulkhead seam',.071);
      box([x,.25,-2.29],[.111,.045,.022],bronze,'bulkhead marker',.049);
    }
    function signal(x,y,z,color,id) {
      box([x,y-.60,z],[.09,.57,.11],bronze,id,.060);
      box([x,y,z],[.38,.41,.075],bronze,id,.057);
      for(const side of [-1,1])box([x,y,z+side*.079],[.32,.34,.019],slate,id,.057);
      for(const [dx,dy] of [[-.20,-.105],[-.10,-.028],[0,.078],[.10,-.028],[.20,-.105]])
        for(const side of [-1,1])box([x+dx,y+dy,z+side*.108],[.060,.057,.013],color,id,.032,{ghost:true});
      for(const [dx,dy] of [[-.24,.244],[.24,.244],[-.24,-.249],[.24,-.249]])
        box([x+dx,y+dy,z+.106],[.029,.025,.012],granite,id,.026);
    }
    signal(-1.96,1.42,-1.78,light,'amber signal');
    signal(2.04,1.06,1.32,aqua,'cyan signal');
    const glassZ=-.48, glassX=2.50;
    const glass=K.reflection.material({r:[12],glass:true,materialId:'signal glass',
      optical:{coverage:.20,absorption:.65,scattering:1.55,depth:{thickness:.4}}},'window',{
      f0:1,strength:1,distortion:0,proxy:{distance:[10,13],roughness:.05}
    });
    box([glassX,1.42,glassZ],[.83,.68,.014],glass,'signal glass',.043,{ghost:true});
    for(const x of [glassX-.88,glassX+.88])
      box([x,1.40,glassZ+.014],[.047,.75,.058],bronze,'window frame',.062);
    for(const y of [.70,2.15])box([glassX,y,glassZ+.014],[.9,.043,.056],bronze,'window frame',.062);
    box([glassX,.12,glassZ-.16],[.98,.047,.27],trim,'window footing',.082);
    const worn=K.reflection.material({r:[7],materialId:'worn screen'},'panel',{
      f0:1,strength:.95,blur:5,proxy:{distance:false,roughness:.88,probe:'pier',probeSize:32}
    });
    box([.92,1.30,-1.64],[.44,.51,.036],worn,'weathered screen',.052,{ghost:true});
    for(const x of [.45,1.39])box([x,1.30,-1.59],[.035,.54,.054],bronze,'screen frame',.056);
    for(const y of [.76,1.84])box([.92,y,-1.59],[.48,.031,.054],bronze,'screen frame',.056);
    box([1.34,1.27,-1.01],[.16,.29,.019],aqua,'pier guide light',.037,{ghost:true});
    S.bake();

    const water=K.procedural.waterBodies, style={tint:[.14,.25,.29],surfaceColor:[.85,.95,.98],surface:.86,foam:0,
      extinction:[1.25,.75,.5],caustics:0,refraction:.65,deepTint:[.08,.16,.22]};
    const pool=water.create({id:'foreground pool',bounds:{min:[-3.72,-2.14],max:[-.56,2.03]},
      resolution:[20,24],sample:()=>({bed:-.28,surface:.03}),
      optics:{...style,optical:{reflection:.68,absorption:.55,scattering:.15,reflectionColor:'#d6f1f5',scatteringColor:'#34565a'},
        reflection:{plane:'pool',distortion:1.4,proxy:{distance:[10.4,12.8],roughness:.18}}}});
    const runoff=water.create({id:'rough runoff',bounds:{min:[1.02,-2.20],max:[3.67,-.69]},
      resolution:[16,10],sample:()=>({bed:-.22,surface:.026}),
      optics:{...style,surface:.58,reflection:{plane:'runoff',distortion:3.5,blur:5,proxy:{roughness:.95}}}});
    const select=id=>{
      let last, at;
      return (i,_x,_y,_z,world)=>{
        if(world!==last){last=world;at=world.renderMetadata?.objects.indexOf(id);}
        return at>0&&world.renderMetadata.objectIds[i]===at;
      };
    };
    const reflections=[
      K.reflection.plane({id:'pool',at:[0,.03,0],select:select('amber signal')}),
      K.reflection.plane({id:'window',at:[0,0,glassZ+.014],normal:[0,0,1],select:select('cyan signal')}),
      K.reflection.plane({id:'panel',at:[0,0,-1.604],normal:[0,0,1],select:select('pier guide light')}),
      K.reflection.plane({id:'runoff',at:[0,.026,0],select:select('cyan signal')})
    ];
    return B.finish({reflections,reflectionProbes:[K.reflection.probe({
      id:'pier',at:[.92,1.18,-1.19],size:128,bounds:{min:[.28,.5,-1.9],max:[1.66,1.94,.2]},
      capture:{include:[{object:'pier guide light'}]}
    })],water:water.scene([pool,runoff]),dither:0,radius:12,
      cam:{target:[0,.7,-.03],dist:9,yaw:.25,pitch:.40,ortho:true,sway:0},
      skyEnvironment:{defaults:{zenith:'#27394d',horizon:'#818da0',ground:'#28353c',sunStrength:0}}});
  }
});
