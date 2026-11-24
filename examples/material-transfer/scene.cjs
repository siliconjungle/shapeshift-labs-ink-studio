'use strict';

module.exports = function mudroom() {
  const palette = [
    0x182228, 0x26343a, 0x394f53, 0x547477, 0x789b99, 0x9ab1a6, 0xb4c8b0,
    0x302723, 0x4b332b, 0x684537, 0x8c5b45, 0xb1815c, 0xd4ad75,
    0x1d3634, 0x32564a, 0x4a7960, 0x759264, 0xc4b777, 0xe8ca8c,
    0x161e25, 0x2b303b, 0x53616a, 0xa9a68a, 0xd5a755, 0xfce0a2
  ];
  const roles = { metal:[1,2,3], accent:[22,23,24] };
  const role = colors => {
    const name = 'finish-' + colors.join('-');
    roles[name] = colors;
    return name;
  };
  const box = (id, at, half, colors, extra = {}) =>
    ({ id, kind:'box', at, half, round:.025, res:.062, mat:{ role:role(colors) }, ...extra });
  const surface = (id, materialId, at, half, colors) => box(id,at,half,colors,{
    res:.073, round:.014, mat:{ role:role(colors), materialId }
  });
  const lane = [
    box('foundation',[0,-.34,0],[6.4,.24,1.73],[0,1,2],{ round:.14, res:.098 }),
    surface('mud-bed','mud',[-5.1,-.10,0],[1.15,.10,1.45],[8,9,10,11]),
    ...Array.from({length:10},(_,x) => Array.from({length:4},(_,z) => surface(
      'tile-'+x+'-'+z,'tile',[-3.436+x*1.023,-.10,-1.083+z*.722],[.504,.10,.352],
      (x+z*3)%5 === 0 ? [3,4,5] : (x+z)%4 === 0 ? [4,5,6] : [3,4,5,6]
    ))).flat(),
    box('front-lintel',[0,-.135,1.49],[6.26,.09,.055],[2,3,4],{res:.075}),
    box('rear-lintel',[0,-.119,-1.49],[6.26,.14,.06],[2,3,4],{res:.074}),
    box('threshold',[-3.948,-.02,0],[.025,.032,1.43],[10,11,12],{ res:.045 }),
    ...[-6.27,6.27].map((x,i) => box('end-'+i,[x,-.068,0],[.035,.071,1.45],[2,3,4])),
    ...Array.from({length:18},(_,i) => box('edge-rivet-'+i,[-6+i*.70,-.146,1.59],[.033,.026,.025],
      i%3===0?[10,11,12]:[2,3,4],{ res:.025 }))
  ];
  const garden = [
    ...Array.from({length:15},(_,i) => box('mud-bank-'+i,[-6.1+i%5*.41,.012,(i<5?1.15:i<10?-1.1:.94)+(i%3)*.08],
      [.10+(i%3)*.022,.013,.045],[7,8,9],{res:.033})),
    ...Array.from({length:13},(_,i) => box('wet-clay-'+i,[-6.05+i%4*.45,.005,-.86+Math.floor(i/4)*.55+(i%2)*.14],
      [.075+(i%4)*.022,.008,.025],i%3===0?[10,11,12]:[8,9,10],{res:.028})),
    ...[-6.0,-5.67,-5.25,-4.72,-4.33].flatMap((x,i)=>[
      box('reed-'+i,[x,.14,-1.38],[.027,.22,.045],[13,14,15],{res:.025}),
      box('reed-seed-'+i,[x+.025,.38+(i%3)*.04,-1.39],[.032,.12,.024],[15,16,17],{res:.023})]),
    ...Array.from({length:24},(_,i) => box('inlay-'+i,[-3.68+(i%12)*.82,.003,(i<12?-1.2:1.18)+(i%3)*.035],
      [.058,.006,.011],i%3===0?[3,4,5]:[4,5,6],{res:.025})),
    ...[-3.4,2.68,5.62].flatMap((x,i) => [
      box('rail-post-'+i,[x,.19,-1.60],[.045,.26,.065],[1,2,3],{res:.042}),
      box('rail-cap-'+i,[x,.45,-1.60],[.074,.032,.07],[10,12,18],{res:.034})
    ]),
    box('rail', [1.06,.39,-1.6],[4.53,.036,.032],[2,3,4],{res:.075})
  ];
  const soleWidth = .14, soleLength = .235;
  const legs = ['left','right'].flatMap((part,i) => {
    const z = i ? -.30 : .30;
    return [
      box(part+'-sole',[-5.87,.038,z],[soleLength,.035,soleWidth],[19,20,21],{part,res:.033}),
      box(part+'-toe',[-5.79,.10,z],[.15,.055,soleWidth-.012],[1,2,3],{part,res:.033}),
      box(part+'-top',[-5.98,.17,z],[.108,.14,soleWidth-.025],[20,21,22],{part,res:.033}),
      box(part+'-welt',[-5.82,.066,z],[.17,.012,soleWidth+.009],[10,11,12],{part,res:.026}),
      box(part+'-stitch',[-5.84,.177,z],[.055,.014,soleWidth-.019],[22,23,24],{part,res:.025})
    ];
  });
  const contacts = [
    {time:.30,x:-5.38,part:'left',material:'mud'},
    {time:.60,x:-4.79,part:'right',material:'mud'},
    ...Array.from({length:12},(_,i) => ({time:.92+i*.31,x:-3.55+i*.81,part:i%2?'right':'left',material:'tile'}))
  ].map(({time,x,part,material},i) => ({
    id:'step-'+String(i+1).padStart(2,'0'),interaction:'step',carrier:part,entity:'walker',time,
    material,point:[x,0,part==='left'?.30:-.30],speed:2,load:10,heading:[1,0,part==='left'?.075:-.075]
  }));
  const track = (target, keys) => ({target,keys:keys.map(([time,value])=>({time,value,ease:'linear'}))});
  const boot = part => {
    const hits = contacts.filter(hit=>hit.carrier===part);
    const keys = [[0,[0,0,0]]];
    let x=0;
    for (const hit of hits) {
      const next = hit.point[0]+5.87, start=keys.at(-1)[0];
      keys.push([(start+hit.time)*.5,[(x+next)*.5,.20,0]],[hit.time,[next,0,0]]);
      x=next;
    }
    keys.push([5.30,[x+.27,.14,0]],[5.60,[x+.56,0,0]]);
    return track('/poses/'+part+'/translation',keys);
  };
  return {
    id:'mudroom',name:'After the Rain',seed:33,palette,roles,
    camera:{target:[0,.04,0],dist:7.6,yaw:-.05,pitch:1.16,projection:'orthographic'},
    light:{sun:[-.38,.88,.37],ambient:.59},
    finish:{radius:13,dither:0,look:{pixelSize:1},materialResponse:{
      recipe:{format:'ink-studio/material-response',version:1,materials:{
        mud:{pickup:{amount:1}},
        tile:{
          chart:{bounds:[-3.95,-1.44,6.27,1.44],reach:.095},resolution:[256,80],
          transfer:{from:'mud',fraction:.54,size:[.40,.62],duration:12,
            bands:[
              {at:.012,color:'#819088'},{at:.027,color:'#7e8071'},{at:.050,color:'#796e5c'},
              {at:.095,color:'#6b5848'},{at:.176,color:'#553d33'},{at:.33,color:'#3d2c28'}
            ]}
        }
      }},
      contacts
    }},
    parts:{left:{joint:[0,0,0]},right:{joint:[0,0,0]}},
    solids:[...lane,...garden,...legs],
    timeline:{duration:5.60,tracks:[boot('left'),boot('right')]}
  };
};
